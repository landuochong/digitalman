import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectVideo, parseArguments, parseFrameRate, validateActionName } from "../scripts/prepare_dh_action.mjs";

const testDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(testDir, "..");

test("parses fractional video frame rates", () => {
  assert.equal(parseFrameRate("25/1"), 25);
  assert.ok(Math.abs(parseFrameRate("30000/1001") - 29.97002997) < 1e-6);
});

test("accepts safe action names and rejects paths", () => {
  assert.equal(validateActionName("nod_smile"), "nod_smile");
  assert.throws(() => validateActionName("../idle"), /动作名/);
  assert.throws(() => validateActionName("A"), /动作名/);
});

test("parses action preparation flags", () => {
  const options = parseArguments(["--name", "nod_smile", "--video", "clip.mp4", "--loop", "--no-install", "--use-for", "happy,agreement"]);
  assert.equal(options.name, "nod_smile");
  assert.equal(options.loop, true);
  assert.equal(options.install, false);
  assert.deepEqual(options.useFor, ["happy", "agreement"]);
});

test("inspects an existing DH_live action video", () => {
  const info = inspectVideo(path.join(projectRoot, "public", "dh-live", "actions", "idle", "01.mp4"));
  assert.equal(info.width, 1280);
  assert.equal(info.height, 720);
  assert.ok(info.duration > 0.5);
  assert.ok(info.fps > 20);
});
