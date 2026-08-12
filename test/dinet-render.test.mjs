import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDINetWorkerCommand, DINetRenderStore } from "../src/dinet-render.mjs";
import { resolveRealActionAsset } from "../src/real-actions.mjs";

test("preloads one persistent DINet worker with the bedroom asset", () => {
  const command = buildDINetWorkerCommand("/project");
  assert.equal(command.executable, "/project/.venv-dh-live/bin/python");
  assert.deepEqual(command.args, [
    "/project/scripts/dinet_worker.py",
    "--asset",
    "/project/public/dh-live/actions/bedroom_idle_test"
  ]);
});

test("maps anime action names onto same-character real video assets",()=>{
  assert.equal(resolveRealActionAsset("wave_approval"),"bedroom_wave");
  assert.equal(resolveRealActionAsset("nod"),"bedroom_agree_test");
  assert.equal(resolveRealActionAsset("thumbs_up"),"bedroom_agree_test");
  assert.equal(resolveRealActionAsset("clap"),"bedroom_clap");
  assert.equal(resolveRealActionAsset("thinking"),"bedroom_thinking");
  assert.equal(resolveRealActionAsset("surprise"),"bedroom_idle_test");
  assert.equal(resolveRealActionAsset("cross"),"bedroom_cross");
  assert.equal(resolveRealActionAsset("confident_arms_crossed"),"bedroom_arms_crossed");
  assert.equal(resolveRealActionAsset("unknown"),"bedroom_idle_test");
});

test("rejects compressed audio before starting the DINet worker", async () => {
  const store = new DINetRenderStore({ projectRoot:"/project", autostart:false });
  await assert.rejects(
    store.render(Buffer.from("ID3xxxx")),
    error => error.status === 415 && /PCM WAV/.test(error.message)
  );
});

test("includes action package version in the DINet cache key",async()=>{
  const source=await readFile(new URL("../src/dinet-render.mjs",import.meta.url),"utf8");
  assert.match(source,/videoInfo\.size/);
  assert.match(source,/videoInfo\.mtimeMs/);
  assert.match(source,/dataInfo\.mtimeMs/);
});

test("DINet streams raw frames into the final H.264 encode",async()=>{
  const source=await readFile(new URL("../scripts/dinet_worker.py",import.meta.url),"utf8");
  assert.match(source,/subprocess\.Popen/);
  assert.match(source,/"-f", "rawvideo"/);
  assert.match(source,/"-preset", "veryfast"/);
  assert.match(source,/audio_offset_ms/);
  assert.match(source,/StreamingAudio2BlendShape/);
  assert.match(source,/stream_id/);
  assert.match(source,/cancel_stream/);
  assert.doesNotMatch(source,/cv2\.VideoWriter/);
  assert.doesNotMatch(source,/silent_path/);
});

test("neural avatar keeps a persistent idle layer behind speech", async () => {
  const [html, script,styles] = await Promise.all([
    readFile(new URL("../public/wav2lip-avatar/avatar.html", import.meta.url), "utf8"),
    readFile(new URL("../public/wav2lip-avatar/avatar.js", import.meta.url), "utf8"),
    readFile(new URL("../public/wav2lip-avatar/avatar.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="avatar-idle"/);
  assert.match(html, /id="avatar-speech"/);
  assert.match(script, /reflectedIdleTime/);
  assert.match(script, /revealAlignedIdle/);
  assert.match(script, /isSilentAction/);
  assert.match(script, /speechVideo\.muted = isSilentAction/);
  assert.match(script,/wav2lip-enqueue/);
  assert.match(script,/segmentQueue/);
  assert.match(script,/createElement\("video"\)/);
  assert.match(script,/speech-segment/);
  assert.match(script,/requestVideoFrameCallback/);
  assert.match(script,/wav2lip-stream-end/);
  assert.match(script,/activeSegment/);
  assert.match(script,/createBufferSource/);
  assert.match(script,/pcm_s16le/);
  assert.match(script,/video\.muted=externalAudio/);
  assert.match(script,/streamAudioTail/);
  assert.match(script,/stopStreamAudio/);
  assert.match(script,/video\.currentTime=elapsed/);
  assert.match(script,/wav2lip-audio-mode/);
  assert.match(script,/loadedmetadata/);
  assert.match(script,/setTimeout\(done,2500\)/);
  assert.match(script,/wav2lip-audio-unlock/);
  assert.match(script,/mode:context\?"pcm-ready":"mp4"/);
  assert.doesNotMatch(script, /setTimeout\(playIdle,\s*250\)/);
  assert.match(styles,/object-fit:cover/);
  assert.match(styles,/lumi-bedroom-background-v1\.png/);
  assert.doesNotMatch(styles,/body\.loading #state/);
  assert.match(styles,/body\.needs-play #state\{opacity:1/);
});
