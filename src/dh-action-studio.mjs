import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { inspectVideo, validateActionName, validateVideoInfo } from "../scripts/prepare_dh_action.mjs";

export const MAX_ACTION_VIDEO_BYTES = 120 * 1024 * 1024;

export function isLoopbackAddress(address = "") {
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

export function videoExtension(filename = "") {
  const extension = path.extname(String(filename)).toLowerCase();
  return [".mp4", ".mov", ".m4v", ".webm", ".mkv"].includes(extension) ? extension : ".mp4";
}

function boolean(value) {
  return value === true;
}

export function normalizeTaskOptions(input = {}) {
  const name = validateActionName(String(input.name || "").trim());
  const returnTo = String(input.returnTo || "idle").trim();
  validateActionName(returnTo);
  const useFor = Array.isArray(input.useFor)
    ? input.useFor.map(value => String(value).trim()).filter(Boolean).slice(0, 12)
    : String(input.useFor || "").split(",").map(value => value.trim()).filter(Boolean).slice(0, 12);
  return {
    name,
    returnTo,
    useFor,
    loop: boolean(input.loop),
    interruptible: input.interruptible !== false,
    matting: boolean(input.matting),
    resize: boolean(input.resize),
    allowSizeMismatch: boolean(input.allowSizeMismatch),
    install: input.install !== false,
    force: boolean(input.force),
  };
}

export function buildActionArguments({ scriptPath, videoPath, options }) {
  const args = [scriptPath, "--name", options.name, "--video", videoPath];
  if (options.loop) args.push("--loop");
  else args.push("--return-to", options.returnTo);
  if (options.useFor.length) args.push("--use-for", options.useFor.join(","));
  if (!options.interruptible) args.push("--non-interruptible");
  if (options.matting) args.push("--matting");
  if (options.resize) args.push("--resize");
  if (options.allowSizeMismatch) args.push("--allow-size-mismatch");
  if (!options.install) args.push("--no-install");
  if (options.force) args.push("--force");
  return args;
}

export async function saveActionVideo(request, { uploadDir, filename, maxBytes = MAX_ACTION_VIDEO_BYTES } = {}) {
  const declaredSize = Number(request.headers["content-length"] || 0);
  if (declaredSize > maxBytes) throw Object.assign(new Error("视频超过 120 MB，请先压缩或裁剪"), { status: 413 });
  await mkdir(uploadDir, { recursive: true });
  const uploadId = randomUUID();
  const filePath = path.join(uploadDir, `${uploadId}${videoExtension(filename)}`);
  const handle = await open(filePath, "wx");
  let size = 0;
  try {
    for await (const chunk of request) {
      size += chunk.length;
      if (size > maxBytes) throw Object.assign(new Error("视频超过 120 MB，请先压缩或裁剪"), { status: 413 });
      await handle.write(chunk);
    }
  } catch (error) {
    await handle.close();
    await rm(filePath, { force: true });
    throw error;
  }
  await handle.close();
  if (!size) {
    await rm(filePath, { force: true });
    throw Object.assign(new Error("没有收到视频数据"), { status: 400 });
  }
  try {
    const video = inspectVideo(filePath);
    const warnings = validateVideoInfo(video);
    return { uploadId, filePath, size, video, warnings };
  } catch (error) {
    await rm(filePath, { force: true });
    throw Object.assign(new Error(`视频检查失败：${error.message}`), { status: 400 });
  }
}

function publicTask(task) {
  return {
    id: task.id,
    name: task.name,
    status: task.status,
    logs: task.logs,
    error: task.error,
    createdAt: task.createdAt,
    startedAt: task.startedAt,
    finishedAt: task.finishedAt,
  };
}

export class DhActionTaskStore {
  constructor({ projectRoot, spawnProcess = spawn } = {}) {
    this.projectRoot = projectRoot;
    this.spawnProcess = spawnProcess;
    this.uploads = new Map();
    this.tasks = new Map();
  }

  addUpload(upload) {
    this.uploads.set(upload.uploadId, upload);
    return { uploadId: upload.uploadId, size: upload.size, video: upload.video, warnings: upload.warnings };
  }

  getTask(id) {
    const task = this.tasks.get(id);
    return task ? publicTask(task) : null;
  }

  createTask(uploadId, input) {
    const upload = this.uploads.get(String(uploadId || ""));
    if (!upload) throw Object.assign(new Error("视频已失效，请重新选择并检查"), { status: 404 });
    const options = normalizeTaskOptions(input);
    const id = randomUUID();
    const task = {
      id,
      name: options.name,
      status: "running",
      logs: [],
      error: null,
      createdAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    this.tasks.set(id, task);

    const scriptPath = path.join(this.projectRoot, "scripts", "prepare_dh_action.mjs");
    const args = buildActionArguments({ scriptPath, videoPath: upload.filePath, options });
    const child = this.spawnProcess(process.execPath, args, {
      cwd: this.projectRoot,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = chunk => {
      const lines = String(chunk).split(/\r?\n/).filter(Boolean);
      task.logs.push(...lines);
      if (task.logs.length > 160) task.logs.splice(0, task.logs.length - 160);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    child.once("error", error => {
      task.status = "failed";
      task.error = error.message;
      task.finishedAt = new Date().toISOString();
    });
    child.once("close", code => {
      if (task.status === "failed") return;
      task.status = code === 0 ? "completed" : "failed";
      task.error = code === 0 ? null : `动作生成进程退出（代码 ${code}）`;
      task.finishedAt = new Date().toISOString();
    });
    return publicTask(task);
  }
}
