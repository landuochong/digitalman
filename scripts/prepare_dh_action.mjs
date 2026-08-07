#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(scriptDir, "..");
const defaultManifestPath = path.join(projectRoot, "public", "dh-live", "actions", "manifest.json");

function usage() {
  return `用法：
  node scripts/prepare_dh_action.mjs --name <动作名> --video <视频路径> [选项]

选项：
  --dh-live <目录>       DH_live 源码目录，默认 experiments/dh-live
  --python <路径>        Python，默认 .venv-dh-live/bin/python
  --work-dir <目录>      中间产物目录，默认 resources/dh-actions/<动作名>
  --check-only           只检查输入视频，不运行模型
  --matting              启用 DH_live 抠图（需要对应 RVM checkpoint）
  --resize               允许 DH_live 将大视频缩小到支持范围
  --loop                 将动作配置为循环播放
  --return-to <动作名>   非循环动作结束后的状态，默认 idle
  --use-for <a,b,c>      记录适用语义标签
  --non-interruptible    标记为不适合中途打断
  --allow-size-mismatch  允许与当前 idle 分辨率不同
  --no-install           只生成资源，不安装到 public/dh-live/actions
  --force                覆盖同名工作目录或动作包
`;
}

export function parseFrameRate(value) {
  if (!value) return 0;
  const [numerator, denominator = "1"] = String(value).split("/").map(Number);
  return denominator ? numerator / denominator : 0;
}

export function parseArguments(argv) {
  const options = {
    dhLive: path.join(projectRoot, "experiments", "dh-live"),
    python: path.join(projectRoot, ".venv-dh-live", "bin", "python"),
    install: true,
    loop: false,
    interruptible: true,
    returnTo: "idle",
    useFor: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`${argument} 缺少参数`);
      index += 1;
      return value;
    };
    if (argument === "--name") options.name = next();
    else if (argument === "--video") options.video = next();
    else if (argument === "--dh-live") options.dhLive = next();
    else if (argument === "--python") options.python = next();
    else if (argument === "--work-dir") options.workDir = next();
    else if (argument === "--return-to") options.returnTo = next();
    else if (argument === "--use-for") options.useFor = next().split(",").map(value => value.trim()).filter(Boolean);
    else if (argument === "--check-only") options.checkOnly = true;
    else if (argument === "--matting") options.matting = true;
    else if (argument === "--resize") options.resize = true;
    else if (argument === "--loop") options.loop = true;
    else if (argument === "--non-interruptible") options.interruptible = false;
    else if (argument === "--allow-size-mismatch") options.allowSizeMismatch = true;
    else if (argument === "--no-install") options.install = false;
    else if (argument === "--force") options.force = true;
    else if (argument === "--help" || argument === "-h") options.help = true;
    else throw new Error(`未知参数：${argument}`);
  }
  return options;
}

function run(command, args, { cwd = projectRoot, capture = false, env = {} } = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    const detail = capture ? String(result.stderr || result.stdout || "").trim() : "";
    throw new Error(`${command} 执行失败${detail ? `：${detail}` : ""}`);
  }
  return capture ? result.stdout : "";
}

export function inspectVideo(videoPath) {
  const raw = run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,avg_frame_rate,r_frame_rate,nb_frames:format=duration",
    "-of", "json",
    videoPath,
  ], { capture: true });
  const info = JSON.parse(raw);
  const stream = info.streams?.[0];
  if (!stream) throw new Error("输入文件没有视频流");
  return {
    width: Number(stream.width),
    height: Number(stream.height),
    fps: parseFrameRate(stream.avg_frame_rate || stream.r_frame_rate),
    duration: Number(info.format?.duration || 0),
    frames: Number(stream.nb_frames || 0),
  };
}

export function validateActionName(name) {
  if (!/^[a-z][a-z0-9_]{1,39}$/.test(name || "")) {
    throw new Error("动作名只能使用 2–40 位小写字母、数字和下划线，并以字母开头");
  }
  return name;
}

export function validateVideoInfo(info) {
  if (!info.width || !info.height || !info.duration) throw new Error("无法读取有效的视频尺寸或时长");
  if (info.duration < 0.6) throw new Error("视频短于 0.6 秒，无法形成自然动作");
  if (info.duration > 12) throw new Error("单个动作视频不得超过 12 秒，请先裁剪");
  const warnings = [];
  if (Math.abs(info.fps - 25) > 0.1) warnings.push(`源视频是 ${info.fps.toFixed(2)} fps，预处理时会转换为 25 fps`);
  if (info.width % 2 || info.height % 2) warnings.push("视频宽高不是偶数，编码时可能被自动调整");
  return warnings;
}

async function assertReadable(filePath, label) {
  try {
    await access(filePath, fsConstants.R_OK);
  } catch {
    throw new Error(`${label}不可读：${filePath}`);
  }
}

function readPackageData(buffer) {
  const data = JSON.parse(gunzipSync(buffer));
  if (!Array.isArray(data.json_data) || data.json_data.length === 0) throw new Error("动作包没有逐帧关键点数据");
  if (Number(data.frame_num) !== data.json_data.length) throw new Error("动作包帧数与关键点数量不一致");
  for (const [index, frame] of data.json_data.entries()) {
    if (!Array.isArray(frame.rect) || frame.rect.length !== 4 || !Array.isArray(frame.points)) {
      throw new Error(`动作包第 ${index} 帧结构无效`);
    }
  }
  return data;
}

function averageRect(data) {
  const sums = [0, 0, 0, 0];
  for (const { rect } of data.json_data) rect.forEach((value, index) => { sums[index] += Number(value); });
  return sums.map(value => value / data.json_data.length);
}

function compareAlignment(candidateData, candidateVideo, baselineData, baselineVideo) {
  const candidateRect = averageRect(candidateData);
  const baselineRect = averageRect(baselineData);
  const candidateCenter = [(candidateRect[0] + candidateRect[2]) / 2 / candidateVideo.width, (candidateRect[1] + candidateRect[3]) / 2 / candidateVideo.height];
  const baselineCenter = [(baselineRect[0] + baselineRect[2]) / 2 / baselineVideo.width, (baselineRect[1] + baselineRect[3]) / 2 / baselineVideo.height];
  const candidateSize = (candidateRect[2] - candidateRect[0]) / candidateVideo.width;
  const baselineSize = (baselineRect[2] - baselineRect[0]) / baselineVideo.width;
  return {
    centerDelta: Math.hypot(candidateCenter[0] - baselineCenter[0], candidateCenter[1] - baselineCenter[1]),
    scaleDelta: Math.abs(candidateSize - baselineSize) / Math.max(baselineSize, 1e-6),
  };
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

async function writeJsonAtomic(filePath, value) {
  const temporary = `${filePath}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temporary, filePath);
}

async function prepareWorkDirectory(workDir, force) {
  if (force) await rm(workDir, { recursive: true, force: true });
  else {
    try {
      await access(workDir);
      throw new Error(`工作目录已存在：${workDir}；确认覆盖时使用 --force`);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await mkdir(workDir, { recursive: true });
}

async function installAction(options, assetsDir, packageData, packageVideo) {
  const manifest = await loadJson(defaultManifestPath);
  const actionsRoot = path.dirname(defaultManifestPath);
  const targetDir = path.join(actionsRoot, options.name);

  if (options.name !== "idle" && !options.allowSizeMismatch) {
    const baselineDefinition = manifest.actions?.idle;
    const baselineAsset = baselineDefinition?.asset;
    if (baselineAsset) {
      const baselineDir = path.join(actionsRoot, baselineAsset);
      const baselineVideo = inspectVideo(path.join(baselineDir, "01.mp4"));
      if (baselineVideo.width !== packageVideo.width || baselineVideo.height !== packageVideo.height) {
        throw new Error(`动作分辨率 ${packageVideo.width}×${packageVideo.height} 与 idle 的 ${baselineVideo.width}×${baselineVideo.height} 不一致`);
      }
      const baselineData = readPackageData(await readFile(path.join(baselineDir, "combined_data.json.gz")));
      const alignment = compareAlignment(packageData, packageVideo, baselineData, baselineVideo);
      if (alignment.centerDelta > 0.055) throw new Error(`人脸中心与 idle 偏差 ${(alignment.centerDelta * 100).toFixed(1)}%，切换时会明显跳动`);
      if (alignment.scaleDelta > 0.18) throw new Error(`人脸尺寸与 idle 偏差 ${(alignment.scaleDelta * 100).toFixed(1)}%，切换时会明显缩放`);
    }
  }

  try {
    await access(targetDir);
    if (!options.force) throw new Error(`动作目录已存在：${targetDir}；确认覆盖时使用 --force`);
    await rm(targetDir, { recursive: true, force: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await cp(assetsDir, targetDir, { recursive: true });

  manifest.actions[options.name] = {
    asset: options.name,
    ...(options.loop ? { loop: true } : { returnTo: options.returnTo }),
    interruptible: options.interruptible,
    ...(options.useFor.length ? { useFor: options.useFor } : {}),
  };
  await writeJsonAtomic(defaultManifestPath, manifest);
  return targetDir;
}

export async function main(argv = process.argv.slice(2)) {
  const options = parseArguments(argv);
  if (options.help) {
    console.log(usage());
    return;
  }
  validateActionName(options.name);
  if (!options.video) throw new Error("缺少 --video");
  options.video = path.resolve(options.video);
  options.dhLive = path.resolve(options.dhLive);
  options.python = path.resolve(options.python);
  options.workDir = path.resolve(options.workDir || path.join(projectRoot, "resources", "dh-actions", options.name));

  await assertReadable(options.video, "输入视频");
  const sourceInfo = inspectVideo(options.video);
  const warnings = validateVideoInfo(sourceInfo);
  console.log(`视频：${sourceInfo.width}×${sourceInfo.height} · ${sourceInfo.fps.toFixed(2)} fps · ${sourceInfo.duration.toFixed(2)} 秒`);
  warnings.forEach(warning => console.warn(`提醒：${warning}`));
  if (options.checkOnly) return;

  await assertReadable(path.join(options.dhLive, "data_preparation_mini.py"), "DH_live 预处理脚本");
  await assertReadable(path.join(options.dhLive, "data_preparation_web.py"), "DH_live 网页打包脚本");
  await assertReadable(options.python, "Python");
  const checkpointTarget = path.join(options.dhLive, "checkpoint", "DINet_mini", "epoch_40_new.pth");
  try {
    await access(checkpointTarget, fsConstants.R_OK);
  } catch {
    const checkpointSource = path.join(projectRoot, "resources", "models", "DINet_mini", "epoch_40_new.pth");
    await assertReadable(checkpointSource, "DH_live checkpoint");
    await mkdir(path.dirname(checkpointTarget), { recursive: true });
    await cp(checkpointSource, checkpointTarget);
  }

  await prepareWorkDirectory(options.workDir, options.force);
  const cacheRoot = path.join(options.workDir, ".cache");
  await mkdir(cacheRoot, { recursive: true });
  const environment = { MPLCONFIGDIR: cacheRoot, XDG_CACHE_HOME: cacheRoot };
  const miniArgs = ["data_preparation_mini.py", options.video, options.workDir];
  if (options.matting) miniArgs.push("--matting");
  if (options.resize) miniArgs.push("--resize");
  run(options.python, miniArgs, { cwd: options.dhLive, env: environment });
  run(options.python, ["data_preparation_web.py", options.workDir], { cwd: options.dhLive, env: environment });

  const assetsDir = path.join(options.workDir, "assets");
  for (const name of ["01.mp4", "combined_data.json.gz", "thumbnail.jpg"]) {
    await assertReadable(path.join(assetsDir, name), `生成产物 ${name}`);
  }
  const packageData = readPackageData(await readFile(path.join(assetsDir, "combined_data.json.gz")));
  const packageVideo = inspectVideo(path.join(assetsDir, "01.mp4"));
  console.log(`动作包：${packageData.frame_num} 帧 · ${packageVideo.width}×${packageVideo.height}`);

  if (options.install) {
    const installed = await installAction(options, assetsDir, packageData, packageVideo);
    console.log(`已安装：${installed}`);
  } else {
    console.log(`未安装，产物保存在：${assetsDir}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`失败：${error.message}`);
    process.exitCode = 1;
  });
}
