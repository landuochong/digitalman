import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const cleanRoot = path.join(projectRoot, "public", "clean-avatar");

test("clean avatar manifest uses only project-owned videos and mouth tracks", async () => {
  const manifest = JSON.parse(await readFile(path.join(cleanRoot, "actions", "manifest.json"), "utf8"));
  assert.equal(manifest.format, "digitalman-clean-avatar");
  assert.equal(manifest.version, 1);
  assert.ok(manifest.actions[manifest.defaultAction]);

  for (const [name, action] of Object.entries(manifest.actions)) {
    assert.match(action.video, /^actions\/[a-z-]+\.mp4$/);
    assert.match(action.track, /^actions\/[a-z-]+\.json$/);
    const videoPath = path.join(cleanRoot, action.video);
    const trackPath = path.join(cleanRoot, action.track);
    await access(videoPath);
    const track = JSON.parse(await readFile(trackPath, "utf8"));
    assert.equal(track.format, "digitalman-mouth-track", `${name} track format`);
    assert.equal(track.version, 1, `${name} track version`);
    assert.equal(track.frames.length, track.frameCount, `${name} frame count`);
    assert.ok(track.frameCount > 20, `${name} has too few frames`);
    assert.equal(track.missedFrames, 0, `${name} contains face detection gaps`);
    for (const frame of track.frames) {
      assert.ok(frame.cx > 0 && frame.cx < 1);
      assert.ok(frame.cy > 0 && frame.cy < 1);
      assert.ok(frame.width > 0 && frame.width < 0.3);
      assert.ok(frame.gap >= 0 && frame.gap < 0.1);
    }
  }
});

test("clean avatar runtime contains no MatesX or DH_live binary dependency", async () => {
  const runtime = await readFile(path.join(cleanRoot, "runtime.js"), "utf8");
  assert.doesNotMatch(runtime, /MatesX|DHLiveMini|combined_data|\.wasm/i);
  assert.match(runtime, /digitalman-clean-avatar|mouthTrack|decodeWavPcm16/);
});

test("clean avatar mouth atlas contains project-generated feathered mouth sprites", async () => {
  const atlasRoot = path.join(cleanRoot, "mouth-atlas");
  const atlas = JSON.parse(await readFile(path.join(atlasRoot, "atlas.json"), "utf8"));
  assert.equal(atlas.format, "digitalman-mouth-atlas");
  assert.equal(atlas.version, 1);
  assert.ok(atlas.levels.length >= 4);
  let previousRatio = -1;
  for (const level of atlas.levels) {
    assert.ok(level.openRatio >= previousRatio);
    previousRatio = level.openRatio;
    await access(path.join(atlasRoot, level.image));
  }
});
