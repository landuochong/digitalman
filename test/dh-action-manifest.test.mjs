import test from "node:test";
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");
const actionsRoot = path.join(projectRoot, "public", "dh-live", "actions");
const manifestPath = path.join(actionsRoot, "manifest.json");

async function loadManifest() {
  return JSON.parse(await readFile(manifestPath, "utf8"));
}

test("DH_live action manifest has a playable default action", async () => {
  const manifest = await loadManifest();
  assert.equal(manifest.version, 1);
  assert.ok(manifest.actions[manifest.defaultAction]?.asset);
});

test("every DH_live action resolves to an existing package without fallback cycles", async () => {
  const manifest = await loadManifest();

  for (const actionName of Object.keys(manifest.actions)) {
    const visited = new Set();
    let resolvedName = actionName;
    let definition = manifest.actions[resolvedName];

    while (definition?.fallback) {
      assert.ok(!visited.has(resolvedName), `fallback cycle at ${resolvedName}`);
      visited.add(resolvedName);
      resolvedName = definition.fallback;
      definition = manifest.actions[resolvedName];
      assert.ok(definition, `${actionName} falls back to unknown action ${resolvedName}`);
    }

    assert.ok(definition?.asset, `${resolvedName} has no asset`);
    const assetRoot = path.join(actionsRoot, definition.asset);
    await access(path.join(assetRoot, "01.mp4"));
    await access(path.join(assetRoot, "combined_data.json.gz"));
  }
});

test("optional DH_live mouth motion scales stay within the renderer safety range", async () => {
  const manifest = await loadManifest();
  for (const [actionName, definition] of Object.entries(manifest.actions)) {
    if (definition.mouthMotionScale === undefined) continue;
    assert.equal(typeof definition.mouthMotionScale, "number", `${actionName} mouthMotionScale must be numeric`);
    assert.ok(definition.mouthMotionScale >= 0.65 && definition.mouthMotionScale <= 1.15,
      `${actionName} mouthMotionScale exceeds the renderer safety range`);
  }
  assert.equal(manifest.actions.lakeside_idle_test.mouthMotionScale, 0.88);
  assert.equal(manifest.actions.lakeside_smile_test.mouthMotionScale, 0.88);
  assert.equal(manifest.actions.lakeside_agree_test.mouthMotionScale, 0.88);
});
