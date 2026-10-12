"""Offline album playback proof; leaves production playback and source assets unchanged.

Run with .venv-dh-live/bin/python -B scripts/verify_album_motion.py.
Outputs are saved in a new temporary directory. No network or paid TTS is used.
"""
import argparse
import contextlib
import json
import math
import subprocess
import sys
import tempfile
import time
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parents[1])
args = parser.parse_args()
root = args.root.resolve()
sys.path.insert(0, str(root / 'scripts'))
from dinet_worker import PersistentDINetRenderer, DH_LIVE_ROOT, device
import cv2
import numpy as np
from scipy.io import wavfile

out = Path(tempfile.mkdtemp(prefix='album-motion-proof-'))
def run(*command):
    subprocess.run(list(map(str, command)), check=True)

run('say', '-v', 'Tingting', '-r', '180', '-o', out/'speech.aiff',
    '你好，今天过得怎么样？记得好好吃饭，有什么开心的事情，可以慢慢告诉我。')
run('ffmpeg', '-v', 'error', '-i', out/'speech.aiff', '-ar', '16000', '-ac', '1', out/'speech.wav')
rate, speech = wavfile.read(out/'speech.wav')
if rate != 16000 or len(speech) == 0:
    raise RuntimeError('System TTS returned empty or invalid audio')

class ShortMotionRenderer(PersistentDINetRenderer):
    def _make_ping_pong_loop(self):
        # A one-second source excerpt followed by its reverse: two seconds total.
        # All tracking/mask arrays must follow precisely the same frame ordering.
        for name in ('frames', 'crop_rects', 'standard_images', 'standard_vertices', 'matrices', 'mouth_masks'):
            values = getattr(self, name)[:25]
            setattr(self, name, values + values[::-1])

t = time.perf_counter()
with contextlib.redirect_stdout(sys.stderr):
    renderer = ShortMotionRenderer(
        root/'public/dh-live/actions/bedroom_idle_test',
        DH_LIVE_ROOT/'checkpoint/lstm/lstm_model_epoch_325.pkl',
        DH_LIVE_ROOT/'checkpoint/DINet_mini/epoch_40_new.pth')
cold = time.perf_counter()-t
still = cv2.cvtColor(renderer.frames[0], cv2.COLOR_RGBA2BGR)
cv2.imwrite(str(out/'still.jpg'), still)
cycle = len(renderer.frames)
speech_frames = math.ceil(len(speech)/rate*25)
total_frames = math.ceil(speech_frames/cycle)*cycle
# Complete the current cycle in silence, not a fresh cycle. Audio2bs whole-wav
# removes five lead feature frames, so append extra padding for frame coverage.
padded = np.pad(speech, (0, max(0, (total_frames+10)*640-len(speech))))
wavfile.write(out/'padded.wav', rate, padded)
with contextlib.redirect_stdout(sys.stderr):
    metrics = renderer.render(out/'padded.wav', out/'render.mp4', video_only=True)

# Compose a visible proof with a static lead/tail. After speech ends, use the
# original silent action frames to avoid residual synthesized mouth motion.
cap = cv2.VideoCapture(str(out/'render.mp4'))
h, w = still.shape[:2]
encoder = subprocess.Popen(['ffmpeg','-v','error','-y','-f','rawvideo','-pix_fmt','bgr24',
    '-s',f'{w}x{h}','-r','25','-i','pipe:0','-an','-c:v','libx264','-preset','fast',
    '-crf','20','-pix_fmt','yuv420p',str(out/'visual.mp4')], stdin=subprocess.PIPE)
states = []
def emit(frame, state):
    encoder.stdin.write(np.ascontiguousarray(frame).tobytes())
    states.append(state)
try:
    for _ in range(25): emit(still, 'static')
    for i in range(total_frames):
        ok, frame = cap.read()
        if not ok: raise RuntimeError(f'Not enough rendered frames: {i}/{total_frames}')
        if i >= speech_frames:
            frame = cv2.cvtColor(renderer.frames[i % cycle], cv2.COLOR_RGBA2BGR)
        if i < 5:
            frame = cv2.addWeighted(still, 1-(i+1)/5, frame, (i+1)/5, 0)
        emit(frame, 'speaking' if i < speech_frames else 'settling')
    for _ in range(50): emit(still, 'static')
finally:
    cap.release(); encoder.stdin.close()
if encoder.wait() != 0: raise RuntimeError('Video encoding failed')
run('ffmpeg','-v','error','-i',out/'visual.mp4','-i',out/'speech.wav',
    '-filter_complex','[1:a]adelay=1000:all=1,apad[a]', '-map','0:v','-map','[a]',
    '-c:v','copy','-c:a','aac','-shortest','-movflags','+faststart',out/'proof.mp4')

# Decode the deliverable, checking static holds and exact phase boundaries.
cap = cv2.VideoCapture(str(out/'proof.mp4'))
decoded = []
while True:
    ok, frame = cap.read()
    if not ok: break
    decoded.append(frame)
cap.release()
assert len(decoded) == len(states), (len(decoded), len(states))
lead_delta = max(float(np.abs(f.astype(float)-decoded[0]).mean()) for f in decoded[:25])
tail_delta = max(float(np.abs(f.astype(float)-decoded[-1]).mean()) for f in decoded[-50:])
pose_delta = float(np.abs(decoded[0].astype(float)-decoded[-1]).mean())
assert max(lead_delta, tail_delta, pose_delta) < 2, 'Static hold changed unexpectedly'
report = dict(device=str(device), coldStartSeconds=round(cold,3),
    speechSeconds=len(speech)/rate, cycleSeconds=cycle/25,
    settlingSeconds=round(total_frames/25-len(speech)/rate,3), render=metrics,
    staticLeadMaxPixelDelta=lead_delta, staticTailMaxPixelDelta=tail_delta,
    initialFinalMeanPixelDelta=pose_delta, output=str(out/'proof.mp4'),
    scope='Offline default-action proof; photo onboarding, nod/smile and live interruptions not validated')
(out/'metrics.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
(out/'index.html').write_text('''<!doctype html><meta charset="utf-8"><title>AI 相框：短动作验证</title>
<style>body{background:#17141f;color:#eee;font:16px system-ui;max-width:760px;margin:32px auto}video{width:360px;max-width:100%;border-radius:18px}p{line-height:1.7}</style>
<h2>静图 → 说话 → 动作收尾 → 静图</h2><p>点击播放。开头静止 1 秒；语音结束后完成当前两秒动作周期，再静止 2 秒。<br>这是离线状态切换样片，尚未接入实时对话。</p>
<video src="proof.mp4" poster="still.jpg" controls playsinline></video>''')
print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)
