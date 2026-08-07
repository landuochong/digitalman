import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildActionArguments, DhActionTaskStore, isLoopbackAddress, normalizeTaskOptions, videoExtension } from "../src/dh-action-studio.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

test("studio API only accepts loopback addresses", () => {
  assert.equal(isLoopbackAddress("127.0.0.1"), true);
  assert.equal(isLoopbackAddress("::1"), true);
  assert.equal(isLoopbackAddress("::ffff:127.0.0.1"), true);
  assert.equal(isLoopbackAddress("192.168.1.8"), false);
  assert.equal(isLoopbackAddress(""), false);
});

test("video upload extensions are restricted", () => {
  assert.equal(videoExtension("clip.MOV"), ".mov");
  assert.equal(videoExtension("clip.webm"), ".webm");
  assert.equal(videoExtension("../../payload.sh"), ".mp4");
});

test("task options become explicit process arguments", () => {
  const options = normalizeTaskOptions({ name:"nod_smile", useFor:"agreement,happy", loop:false, resize:true, install:false });
  const args = buildActionArguments({ scriptPath:"/project/prepare.mjs", videoPath:"/tmp/my video.mp4", options });
  assert.deepEqual(args, [
    "/project/prepare.mjs", "--name", "nod_smile", "--video", "/tmp/my video.mp4",
    "--return-to", "idle", "--use-for", "agreement,happy", "--resize", "--no-install",
  ]);
  assert.throws(() => normalizeTaskOptions({ name:"../idle" }), /动作名/);
});

test("task store captures generator output and completion", async () => {
  let spawned;
  const fakeSpawn = (command, args, options) => {
    spawned = { command, args, options };
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    setImmediate(() => {
      child.stdout.write("视频：1280×720\n");
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };
  const store = new DhActionTaskStore({ projectRoot, spawnProcess:fakeSpawn });
  store.addUpload({ uploadId:"upload-1", filePath:"/tmp/action clip.mp4", size:42, video:{}, warnings:[] });
  const created = store.createTask("upload-1", { name:"nod_smile", install:false });
  assert.equal(created.status, "running");
  await new Promise(resolve => setImmediate(resolve));
  const completed = store.getTask(created.id);
  assert.equal(completed.status, "completed");
  assert.deepEqual(completed.logs, ["视频：1280×720"]);
  assert.equal(spawned.command, process.execPath);
  assert.equal(spawned.options.cwd, projectRoot);
  assert.ok(spawned.args.includes("/tmp/action clip.mp4"));
  assert.ok(spawned.args.includes("--no-install"));
});
