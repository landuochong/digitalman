import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDINetWorkerCommand, DINetRenderStore } from "../src/dinet-render.mjs";

test("preloads one persistent DINet worker with the lakeside asset", () => {
  const command = buildDINetWorkerCommand("/project");
  assert.equal(command.executable, "/project/.venv-dh-live/bin/python");
  assert.deepEqual(command.args, [
    "/project/scripts/dinet_worker.py",
    "--asset",
    "/project/public/dh-live/actions/lakeside_idle_test"
  ]);
});

test("rejects compressed audio before starting the DINet worker", async () => {
  const store = new DINetRenderStore({ projectRoot:"/project", autostart:false });
  await assert.rejects(
    store.render(Buffer.from("ID3xxxx")),
    error => error.status === 415 && /PCM WAV/.test(error.message)
  );
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
  assert.doesNotMatch(script, /setTimeout\(playIdle,\s*250\)/);
});
