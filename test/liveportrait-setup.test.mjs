import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const scriptUrl = new URL("../scripts/setup_liveportrait_macos.sh", import.meta.url);
const generatorUrl = new URL("../scripts/generate_liveportrait_material.sh", import.meta.url);

test("LivePortrait macOS setup is isolated and uses native MPS grid sampling", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /\.venv-liveportrait/);
  assert.match(source, /requirements_macOS\.txt/);
  assert.match(source, /torch==2\.13\.0/);
  assert.match(source, /torchvision==0\.28\.0/);
  assert.match(source, /uv pip uninstall[^\n]*torchaudio/);
  assert.match(source, /albucore==0\.0\.12/);
  assert.match(source, /uv pip check/);
});

test("LivePortrait setup downloads only verified human checkpoints", async () => {
  const source = await readFile(scriptUrl, "utf8");
  assert.match(source, /KlingTeam\/LivePortrait/);
  assert.match(source, /LIVEPORTRAIT_HF_ENDPOINT:-https:\/\/hf-mirror\.com/);
  assert.match(source, /expected_size/);
  assert.match(source, /expected_sha/);
  assert.match(source, /shasum -a 256/);
  assert.match(source, /insightface\/models\/buffalo_l\/det_10g\.onnx/);
  assert.match(source, /liveportrait\/retargeting_models\/stitching_retargeting_module\.pth/);
  assert.doesNotMatch(source, /animal/);
  assert.doesNotMatch(source, /xpose/);
});

test("offline material generation defaults to restrained eye motion", async () => {
  const source = await readFile(generatorUrl, "utf8");
  assert.match(source, /region="\$\{4:-eyes\}"/);
  assert.match(source, /multiplier="\$\{5:-0\.35\}"/);
  assert.match(source, /eyes\|exp\|pose\|lip\|all/);
  assert.match(source, /--animation-region "\$region"/);
  assert.match(source, /--driving-multiplier "\$multiplier"/);
  assert.match(source, /--no-flag-normalize-lip/);
  assert.match(source, /--flag-stitching/);
  assert.match(source, /--flag-pasteback/);
});
