#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const actionsRoot = path.join(projectRoot, "public", "dh-live", "actions");
const background = path.join(projectRoot, "public", "assets", "lumi-bedroom-background-v1.png");
const swiftSource = path.join(projectRoot, "scripts", "replace_video_background.swift");
const defaultActions = [
  "idle_test", "smile_test", "agree_test", "wave", "clap", "cheer",
  "shy", "thinking", "caring", "shrug", "cross", "arms_crossed",
];

function parseActions(argv) {
  const optionIndex = argv.indexOf("--actions");
  if (optionIndex < 0) return defaultActions;
  const value = argv[optionIndex + 1] || "";
  const selected = value.split(",").map(action => action.trim()).filter(Boolean);
  if (!selected.length) throw new Error("--actions 至少需要一个动作名称");
  return selected;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd:projectRoot, stdio:"inherit", ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} 执行失败（${result.status}）`);
}

function capture(command, args) {
  const result = spawnSync(command, args, { cwd:projectRoot, encoding:"utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || `${command} 执行失败`));
  return result.stdout.trim();
}

async function main() {
  const force = process.argv.includes("--force");
  const actions = parseActions(process.argv.slice(2));
  const workspace = await mkdtemp(path.join(os.tmpdir(), "digitalman-bedroom-actions-"));
  const binary = path.join(workspace, "replace-video-background");
  const moduleCache = path.join(workspace, "swift-module-cache");
  await mkdir(moduleCache, { recursive:true });
  const environment = {
    ...process.env,
    SWIFT_MODULECACHE_PATH:moduleCache,
    CLANG_MODULE_CACHE_PATH:moduleCache,
  };

  try {
    run("swiftc", [swiftSource, "-o", binary], { env:environment });
    for (const action of actions) {
      const source = path.join(actionsRoot, `lakeside_${action}`);
      const target = path.join(actionsRoot, `bedroom_${action}`);
      const targetFiles = ["01.mp4", "combined_data.json.gz", "thumbnail.jpg"]
        .map(filename => path.join(target, filename));
      const alreadyComplete = (await Promise.all(targetFiles.map(file => access(file).then(() => true).catch(() => false))))
        .every(Boolean);
      if (alreadyComplete && !force) {
        console.log(`[${action}] 已完成，跳过`);
        continue;
      }
      await rm(target, { recursive:true, force:true });
      const inputFrames = path.join(workspace, `${action}-input`);
      const outputFrames = path.join(workspace, `${action}-output`);
      await mkdir(inputFrames, { recursive:true });
      await mkdir(outputFrames, { recursive:true });
      await mkdir(target, { recursive:true });
      const sourceVideo = path.join(source, "01.mp4");
      const fps = capture("ffprobe", [
        "-v", "error", "-select_streams", "v:0",
        "-show_entries", "stream=avg_frame_rate", "-of", "default=nw=1:nk=1", sourceVideo,
      ]);
      console.log(`\n[${action}] 提取 ${fps} fps 帧`);
      run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", "-i", sourceVideo, "-vsync", "0", path.join(inputFrames, "%06d.png")]);
      run(binary, [inputFrames, background, outputFrames], { env:environment });
      run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-framerate", fps,
        "-i", path.join(outputFrames, "%06d.png"), "-an", "-c:v", "libx264",
        "-preset", "slow", "-crf", "14", "-pix_fmt", "yuv420p",
        "-color_range", "tv", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1",
        "-movflags", "+faststart",
        path.join(target, "01.mp4"),
      ]);
      await cp(path.join(source, "combined_data.json.gz"), path.join(target, "combined_data.json.gz"));
      run("ffmpeg", [
        "-hide_banner", "-loglevel", "error", "-y", "-i", path.join(target, "01.mp4"),
        "-frames:v", "1", "-q:v", "2", path.join(target, "thumbnail.jpg"),
      ]);
      await rm(inputFrames, { recursive:true, force:true });
      await rm(outputFrames, { recursive:true, force:true });
    }
  } finally {
    await rm(workspace, { recursive:true, force:true });
  }
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
