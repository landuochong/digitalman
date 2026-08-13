import { randomUUID } from "node:crypto";

const DEFAULT_SAMPLE_RATE = 16_000;
const DEFAULT_CHANNELS = 1;
const DEFAULT_MAX_AUDIO_MS = 60_000;
const DEFAULT_SEGMENT_MS = 800;
const DEFAULT_FIRST_SEGMENT_MS = 800;
const MIN_TAIL_MS = 240;

function streamError(message, status) {
  return Object.assign(new Error(message), { status });
}

export function encodePcm16Wav(pcm, sampleRate = DEFAULT_SAMPLE_RATE, channels = DEFAULT_CHANNELS) {
  if (!Buffer.isBuffer(pcm)) pcm = Buffer.from(pcm);
  const header = Buffer.alloc(44);
  const byteRate = sampleRate * channels * 2;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class DINetStreamSessionStore {
  constructor({ renderer, maxAudioMs = DEFAULT_MAX_AUDIO_MS, segmentMs = DEFAULT_SEGMENT_MS, firstSegmentMs = DEFAULT_FIRST_SEGMENT_MS, now = () => performance.now(), publishAudio=null, releaseAudio=null }) {
    this.renderer = renderer;
    this.maxAudioMs = maxAudioMs;
    this.segmentMs = segmentMs;
    this.firstSegmentMs = firstSegmentMs;
    this.now = now;
    this.publishAudio=publishAudio;this.releaseAudio=releaseAudio;
    this.sessions = new Map();
  }

  start({ action = "idle", sampleRate = DEFAULT_SAMPLE_RATE, channels = DEFAULT_CHANNELS, frameOffset = 0, videoOnly = false, binaryAudio = false, fragmentedVideo = false } = {}) {
    if (sampleRate !== DEFAULT_SAMPLE_RATE || channels !== DEFAULT_CHANNELS) {
      throw streamError("流式 DINet 当前只接受 16 kHz、单声道 PCM16", 415);
    }
    frameOffset=Number(frameOffset);
    if(!Number.isSafeInteger(frameOffset)||frameOffset<0)throw streamError("动作起始帧无效",400);
    const id = randomUUID();
    const startedAt = this.now();
    this.sessions.set(id, {
      id, action, sampleRate, channels, startedAt,
      firstChunkAt:null, nextSequence:0, bytes:0, chunks:[], state:"open",
      segmentSequence:0, frameOffset, renderedAudioMs:0,videoOnly:Boolean(videoOnly),binaryAudio:Boolean(videoOnly&&binaryAudio),fragmentedVideo:Boolean(videoOnly&&fragmentedVideo)
    });
    return { id, action, sampleRate, channels, frameOffset,videoOnly:Boolean(videoOnly),binaryAudio:Boolean(videoOnly&&binaryAudio),fragmentedVideo:Boolean(videoOnly&&fragmentedVideo), nextSequence:0, mode:"stateful-segments" };
  }

  append(id, sequence, chunk) {
    const session = this.#open(id);
    if (!Number.isSafeInteger(sequence) || sequence < 0) {
      throw streamError("音频分片序号无效", 400);
    }
    if (sequence !== session.nextSequence) {
      throw streamError(`音频分片乱序：期望 ${session.nextSequence}，收到 ${sequence}`, 409);
    }
    if (!Buffer.isBuffer(chunk) || chunk.length === 0 || chunk.length % 2 !== 0) {
      throw streamError("音频分片必须是非空 PCM16 数据", 400);
    }
    const maxBytes = Math.floor(this.maxAudioMs * session.sampleRate * session.channels * 2 / 1000);
    if (session.bytes + chunk.length > maxBytes) {
      throw streamError(`流式音频不能超过 ${this.maxAudioMs / 1000} 秒`, 413);
    }
    session.firstChunkAt ??= this.now();
    session.chunks.push(Buffer.from(chunk));
    session.bytes += chunk.length;
    session.nextSequence += 1;
    return {
      id, acceptedSequence:sequence, nextSequence:session.nextSequence,
      bufferedMs:this.#audioMs(session)
    };
  }

  async finish(id) {
    const session = this.#open(id);
    if (!session.bytes) throw streamError("流式会话没有收到音频", 400);
    session.state = "rendering";
    const finishRequestedAt = this.now();
    try {
      const wav = encodePcm16Wav(Buffer.concat(session.chunks), session.sampleRate, session.channels);
      const rendered = await this.renderer.render(wav, session.action);
      const completedAt = this.now();
      return {
        ...rendered,
        stream:{
          id,
          mode:"whole-wav-fallback",
          chunks:session.nextSequence,
          audioMs:this.#audioMs(session),
          firstChunkDelayMs:Math.round((session.firstChunkAt ?? finishRequestedAt) - session.startedAt),
          bufferingMs:Math.round(finishRequestedAt - (session.firstChunkAt ?? session.startedAt)),
          finishToReadyMs:Math.round(completedAt - finishRequestedAt),
          totalMs:Math.round(completedAt - session.startedAt)
        }
      };
    } finally {
      this.sessions.delete(id);
    }
  }

  async drain(id, { final=false, onSegment }={}) {
    const session = this.#open(id);
    const bytesPerMs = session.sampleRate * session.channels * 2 / 1000;
    const minimumTailBytes = Math.round(MIN_TAIL_MS * bytesPerMs);
    const results=[];
    while (true) {
      const available = session.chunks.reduce((total, chunk) => total + chunk.length, 0);
      const targetMs = session.segmentSequence === 0 ? this.firstSegmentMs : this.segmentMs;
      const segmentBytes = Math.round(targetMs * bytesPerMs);
      const take = final
        ? available
        : available >= segmentBytes + minimumTailBytes ? segmentBytes : 0;
      if (!take) break;
      if (final && take < minimumTailBytes) break;
      const pcm=this.#takeBytes(session,take);
      const sequence=session.segmentSequence++;
      const frameOffset=session.frameOffset;
      const outputFrames=Math.max(1,Math.round(take/bytesPerMs/40));
      const renderStartedAt=this.now();
      const rendered=await this.renderer.render(
        encodePcm16Wav(pcm,session.sampleRate,session.channels),
        session.action,
        {frameOffset,outputFrames,streamId:id,streamFinal:final,videoOnly:session.videoOnly,fragmentedVideo:session.fragmentedVideo}
      );
      const frames=Number(rendered?.metrics?.frames)||outputFrames;
      session.frameOffset+=frames;
      session.renderedAudioMs+=Math.round(take/bytesPerMs);
      const publishedAudio=session.binaryAudio&&this.publishAudio
        ? await this.publishAudio({pcm,streamId:id,sequence,sampleRate:session.sampleRate,channels:session.channels})
        : {data:pcm.toString("base64")};
      const audio={encoding:"pcm_s16le",sampleRate:session.sampleRate,channels:session.channels,...publishedAudio};
      const result={
        ...rendered,
        segment:{
          id,sequence,frameOffset,audioMs:Math.round(take/bytesPerMs),renderMs:Math.round(this.now()-renderStartedAt),audioMode:session.videoOnly?"external-pcm":"multiplexed",
          audio
        }
      };
      results.push(result);
      await onSegment?.(result);
      if (final) break;
    }
    return results;
  }

  complete(id) {
    const session=this.sessions.get(id);
    if(!session)return {id,completed:false};
    const result={id,completed:true,segments:session.segmentSequence,audioMs:session.renderedAudioMs};
    this.sessions.delete(id);
    void this.renderer.cancelStream?.(id).catch?.(()=>{});
    return result;
  }

  cancel(id) {
    const session = this.sessions.get(id);
    if (!session) return { id, cancelled:false };
    session.state = "cancelled";
    session.chunks.length = 0;
    this.sessions.delete(id);
    void this.releaseAudio?.(id);
    void this.renderer.cancelStream?.(id).catch?.(()=>{});
    return { id, cancelled:true };
  }

  #open(id) {
    const session = this.sessions.get(id);
    if (!session) throw streamError("流式 DINet 会话不存在或已经结束", 404);
    if (session.state !== "open") throw streamError("流式 DINet 会话当前不可写入", 409);
    return session;
  }

  #audioMs(session) {
    return Math.round(session.bytes / (session.sampleRate * session.channels * 2) * 1000);
  }

  #takeBytes(session, size) {
    const output=Buffer.allocUnsafe(size);let written=0;
    while(written<size){
      const chunk=session.chunks[0],remaining=size-written,take=Math.min(chunk.length,remaining);
      chunk.copy(output,written,0,take);written+=take;
      if(take===chunk.length)session.chunks.shift();else session.chunks[0]=chunk.subarray(take);
    }
    return output;
  }
}
