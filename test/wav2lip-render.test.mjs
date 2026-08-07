import test from "node:test";
import assert from "node:assert/strict";
import { buildWav2LipCommand, buildWav2LipWorkerCommand, inferAudioExtension } from "../src/wav2lip-render.mjs";

test("recognizes supported speech audio without trusting a filename", () => {
  assert.equal(inferAudioExtension(Buffer.from("RIFFxxxxWAVE")), "wav");
  assert.equal(inferAudioExtension(Buffer.from("ID3xxxx")), "mp3");
  assert.equal(inferAudioExtension(Buffer.from([0xff, 0xfb, 0x90, 0x64])), "mp3");
  assert.equal(inferAudioExtension(Buffer.from("nope")), null);
});

test("preloads one persistent wav2lip worker", () => {
  const command = buildWav2LipWorkerCommand("/project");
  assert.equal(command.executable, "/project/.venv-wav2lip/bin/python");
  assert.equal(command.args[0], "/project/scripts/wav2lip_worker.py");
  assert.deepEqual(command.args.slice(-2), ["--output-fps", "15"]);
});

test("builds wav2lip invocation without a shell", () => {
  const command = buildWav2LipCommand({ projectRoot:"/project", audioPath:"/tmp/a.wav", outputPath:"/tmp/o.mp4" });
  assert.equal(command.executable, "/project/.venv-wav2lip/bin/python");
  assert.deepEqual(command.args.slice(0, 3), ["/project/scripts/render_wav2lip_offline.py", "--video", "/project/public/dh-live/actions/lakeside_idle_test/01.mp4"]);
  assert.ok(command.args.includes("/tmp/a.wav"));
  assert.ok(command.args.includes("/tmp/o.mp4"));
  assert.deepEqual(command.args.slice(-2), ["--output-fps", "15"]);
  assert.equal(command.args[command.args.indexOf("--batch-size") + 1], "4");
});
