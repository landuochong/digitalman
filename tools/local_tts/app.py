"""Resident Qwen3-TTS clone service. All inference stays on this Mac."""
import asyncio
import io
import os
import subprocess
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import mlx.core as mx
import numpy as np
import soundfile as sf
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import Response
from pydantic import BaseModel, Field
from mlx_audio.tts.utils import load_model

ROOT = Path(__file__).resolve().parents[2]
ENGINE = Path(os.getenv('QWEN_TTS_HOME', str(ROOT.parent / 'VoiceCloneTTS')))
MODEL = Path(os.getenv('QWEN_TTS_MODEL', str(ENGINE / 'engines/Qwen3-TTS-12Hz-1.7B-Base-bf16')))
REFERENCE = Path(os.getenv('QWEN_TTS_REFERENCE', str(ROOT / 'output/audio/voice_reference_24k.wav')))
TRANSCRIPT = Path(os.getenv('QWEN_TTS_TRANSCRIPT', str(ROOT / 'output/audio/voice_reference_transcript.txt')))
SPEED = float(os.getenv('QWEN_TTS_SPEED', '1.0'))
# Serialize model loading and inference on one worker; MLX state is shared.
worker = ThreadPoolExecutor(max_workers=1)
model = None
reference_text = ''


def initialize():
    global model, reference_text
    if not REFERENCE.is_file() or not TRANSCRIPT.is_file():
        raise RuntimeError('Reference audio or transcript is missing')
    if not 0.5 <= SPEED <= 2.0:
        raise RuntimeError('QWEN_TTS_SPEED must be between 0.5 and 2.0')
    reference_text = TRANSCRIPT.read_text(encoding='utf-8').strip()
    model = load_model(str(MODEL))


@asynccontextmanager
async def lifespan(app):
    await asyncio.get_running_loop().run_in_executor(worker, initialize)
    app.state.lock = asyncio.Lock()
    yield
    worker.shutdown(wait=False, cancel_futures=True)


app = FastAPI(title='Lumi local Qwen3-TTS', lifespan=lifespan)


class Speech(BaseModel):
    text: str = Field(min_length=1, max_length=1800)
    format: str = Field(default='wav', pattern='^(wav|pcm)$')


@app.get('/health')
async def health():
    return {'ready': model is not None, 'provider': 'qwen_local', 'model': MODEL.name,
            'speed': SPEED, 'streaming': False}


def synthesize(text, audio_format):
    start = time.perf_counter()
    mx.random.seed(42)
    pieces = [np.asarray(result.audio, dtype=np.float32) for result in model.generate(
        text=text, ref_audio=str(REFERENCE), ref_text=reference_text,
        lang_code='chinese', temperature=0.7, max_tokens=2048, verbose=False)]
    if not pieces:
        raise RuntimeError('No audio generated')
    audio = np.concatenate(pieces)
    if not np.isfinite(audio).all():
        raise RuntimeError('Invalid audio generated')
    source = io.BytesIO()
    sf.write(source, audio, model.sample_rate, format='WAV', subtype='PCM_16')
    # DINet consumes 16 kHz mono PCM. atempo preserves pitch when slowing speech.
    target = 's16le' if audio_format == 'pcm' else 'wav'
    result = subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', 'pipe:0',
        '-af', f'atempo={SPEED}', '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le',
        '-f', target, 'pipe:1'], input=source.getvalue(), capture_output=True, check=True, timeout=30)
    return result.stdout, round((time.perf_counter() - start) * 1000)


@app.post('/synthesize')
async def speech(payload: Speech, request: Request):
    text = payload.text.strip()
    if not text:
        raise HTTPException(400, 'Empty speech text')
    async with app.state.lock:
        if await request.is_disconnected():
            raise HTTPException(499, 'Request cancelled')
        # Shield the worker so an HTTP cancellation cannot release the lock while
        # a model job is still running. Disconnected queued jobs are skipped above.
        future = asyncio.get_running_loop().run_in_executor(worker, synthesize, text, payload.format)
        try:
            audio, elapsed = await asyncio.shield(future)
        except asyncio.CancelledError:
            await future
            raise
    return Response(audio, media_type='application/octet-stream' if payload.format == 'pcm' else 'audio/wav',
                    headers={'x-generation-ms': str(elapsed), 'x-pcm-sample-rate': '16000'})
