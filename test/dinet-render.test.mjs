import test from "node:test";
import assert from "node:assert/strict";
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
