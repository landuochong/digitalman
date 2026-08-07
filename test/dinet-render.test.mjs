import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDINetWorkerCommand, DINetRenderStore } from "../src/dinet-render.mjs";
import { resolveRealActionAsset } from "../src/real-actions.mjs";

test("preloads one persistent DINet worker with the lakeside asset", () => {
  const command = buildDINetWorkerCommand("/project");
  assert.equal(command.executable, "/project/.venv-dh-live/bin/python");
  assert.deepEqual(command.args, [
    "/project/scripts/dinet_worker.py",
    "--asset",
    "/project/public/dh-live/actions/lakeside_idle_test"
  ]);
});

test("maps anime action names onto same-character real video assets",()=>{
  assert.equal(resolveRealActionAsset("wave_approval"),"lakeside_wave");
  assert.equal(resolveRealActionAsset("clap"),"lakeside_clap");
  assert.equal(resolveRealActionAsset("thinking"),"lakeside_thinking");
  assert.equal(resolveRealActionAsset("surprise"),"lakeside_idle_test");
  assert.equal(resolveRealActionAsset("cross"),"lakeside_cross");
  assert.equal(resolveRealActionAsset("confident_arms_crossed"),"lakeside_arms_crossed");
  assert.equal(resolveRealActionAsset("unknown"),"lakeside_idle_test");
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

test("neural avatar keeps a persistent idle layer behind speech", async () => {
  const [html, script] = await Promise.all([
    readFile(new URL("../public/wav2lip-avatar/avatar.html", import.meta.url), "utf8"),
    readFile(new URL("../public/wav2lip-avatar/avatar.js", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="avatar-idle"/);
  assert.match(html, /id="avatar-speech"/);
  assert.match(script, /reflectedIdleTime/);
  assert.match(script, /revealAlignedIdle/);
  assert.match(script, /isSilentAction/);
  assert.match(script, /speechVideo\.muted = isSilentAction/);
  assert.doesNotMatch(script, /setTimeout\(playIdle,\s*250\)/);
});
