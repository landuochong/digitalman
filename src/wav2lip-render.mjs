import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";

const RENDER_PROFILE = "wav2lip256-15fps-b4-v1";

export function inferAudioExtension(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return null;
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF") return "wav";
  if (buffer.subarray(0, 3).toString("ascii") === "ID3") return "mp3";
  if (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0) return "mp3";
  return null;
}

export function buildWav2LipCommand({ projectRoot, audioPath, outputPath }) {
  return {
    executable:join(projectRoot, ".venv-wav2lip", "bin", "python"),
    args:[
      join(projectRoot, "scripts", "render_wav2lip_offline.py"),
      "--video", join(projectRoot, "public", "dh-live", "actions", "lakeside_idle_test", "01.mp4"),
      "--audio", audioPath,
      "--output", outputPath,
      "--batch-size", "4",
      "--face-batch-size", "4",
      "--detect-stride", "5",
      "--output-fps", "15"
    ]
  };
}

export function buildWav2LipWorkerCommand(projectRoot) {
  return {
    executable:join(projectRoot, ".venv-wav2lip", "bin", "python"),
    args:[
      join(projectRoot, "scripts", "wav2lip_worker.py"),
      "--video", join(projectRoot, "public", "dh-live", "actions", "lakeside_idle_test", "01.mp4"),
      "--batch-size", "4", "--face-batch-size", "4", "--detect-stride", "5",
      "--output-fps", "15"
    ]
  };
}

async function exists(path) {
  try { await access(path, constants.R_OK); return true; }
  catch { return false; }
}

function runProcess(executable, args, { cwd, timeoutMs = 240_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, stdio:["ignore", "pipe", "pipe"] });
    let output = "";
    const collect = chunk => { output = (output + chunk.toString()).slice(-24_000); };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(Object.assign(new Error("真人口型生成超时"), { status:504 }));
    }, timeoutMs);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("exit", code => {
      clearTimeout(timer);
      if (code === 0) resolve(output);
      else reject(Object.assign(new Error(`真人口型生成失败 (${code})${output ? `：${output.slice(-800)}` : ""}`), { status:502 }));
    });
  });
}

class PersistentWav2LipWorker {
  constructor(projectRoot) {
    this.projectRoot = projectRoot;
    this.child = null;
    this.starting = null;
    this.active = null;
    this.chain = Promise.resolve();
    this.stderr = "";
  }

  start() {
    if (this.child) return Promise.resolve();
    if (this.starting) return this.starting;
    const command = buildWav2LipWorkerCommand(this.projectRoot);
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(command.executable, command.args, { cwd:this.projectRoot, stdio:["pipe", "pipe", "pipe"] });
      this.child = child;
      const timer = setTimeout(() => reject(new Error("Wav2Lip 常驻模型加载超时")), 120_000);
      child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk).slice(-24_000); });
      createInterface({ input:child.stdout }).on("line", line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.type === "ready") {
          clearTimeout(timer); this.starting = null; resolve(); return;
        }
        if (!this.active || message.id !== this.active.id) return;
        const active = this.active; this.active = null; clearTimeout(active.timer);
        if (message.type === "done") active.resolve();
        else active.reject(Object.assign(new Error(message.error || "真人口型生成失败"), { status:502 }));
      });
      child.once("error", error => { clearTimeout(timer); this.#fail(error); reject(error); });
      child.once("exit", code => {
        clearTimeout(timer);
        const error = new Error(`Wav2Lip 常驻进程退出 (${code})${this.stderr ? `：${this.stderr.slice(-800)}` : ""}`);
        this.child = null; this.starting = null; this.#fail(error); reject(error);
      });
    });
    return this.starting;
  }

  #fail(error) {
    if (!this.active) return;
    clearTimeout(this.active.timer); this.active.reject(error); this.active = null;
  }

  render(audioPath, outputPath) {
    const task = this.chain.then(async () => {
      await this.start();
      return new Promise((resolve, reject) => {
        const id = createHash("sha256").update(`${audioPath}:${Date.now()}`).digest("hex").slice(0, 16);
        const timer = setTimeout(() => {
          this.#fail(Object.assign(new Error("真人口型生成超时"), { status:504 }));
          this.child?.kill("SIGTERM");
        }, 240_000);
        this.active = { id, resolve, reject, timer };
        this.child.stdin.write(`${JSON.stringify({ id, audio:audioPath, output:outputPath })}\n`);
      });
    });
    this.chain = task.catch(() => {});
    return task;
  }
}

export class Wav2LipRenderStore {
  constructor({ projectRoot }) {
    this.projectRoot = projectRoot;
    this.workDir = join(projectRoot, "data", "wav2lip-render");
    this.outputDir = join(projectRoot, "public", "wav2lip-avatar", "generated");
    this.pending = new Map();
    this.worker = new PersistentWav2LipWorker(projectRoot);
    this.worker.start().catch(() => {});
  }

  async readiness() {
    const required = [
      join(this.projectRoot, ".venv-wav2lip", "bin", "python"),
      join(this.projectRoot, "scripts", "render_wav2lip_offline.py"),
      join(this.projectRoot, "experiments", "livetalking", "models", "wav2lip.pth"),
      join(this.projectRoot, "experiments", "livetalking", "avatars", "wav2lip", "face_detection", "detection", "sfd", "s3fd.pth"),
      join(this.projectRoot, "public", "dh-live", "actions", "lakeside_idle_test", "01.mp4")
    ];
    const missing = [];
    for (const path of required) if (!(await exists(path))) missing.push(path);
    return { ready:missing.length === 0, missing };
  }

  async render(audioBuffer) {
    const extension = inferAudioExtension(audioBuffer);
    if (!extension) throw Object.assign(new Error("仅支持 WAV 或 MP3 音频"), { status:415 });
    const readiness = await this.readiness();
    if (!readiness.ready) throw Object.assign(new Error("Wav2Lip 本地模型尚未准备完成"), { status:503 });

    const hash = createHash("sha256")
      .update(RENDER_PROFILE)
      .update(audioBuffer)
      .digest("hex")
      .slice(0, 24);
    const outputName = `${hash}.mp4`;
    const outputPath = join(this.outputDir, outputName);
    if (await exists(outputPath)) {
      const info = await stat(outputPath);
      return { url:`/wav2lip-avatar/generated/${outputName}`, bytes:info.size, cached:true };
    }
    if (this.pending.has(hash)) return this.pending.get(hash);

    const task = this.#render(hash, extension, audioBuffer, outputPath, outputName)
      .finally(() => this.pending.delete(hash));
    this.pending.set(hash, task);
    return task;
  }

  async #render(hash, extension, audioBuffer, outputPath, outputName) {
    await mkdir(this.workDir, { recursive:true });
    await mkdir(this.outputDir, { recursive:true });
    const audioPath = join(this.workDir, `${hash}.${extension}`);
    const stagingPath = join(this.workDir, `${hash}.partial.mp4`);
    await writeFile(audioPath, audioBuffer, { mode:0o600 });
    try {
      await this.worker.render(audioPath, stagingPath);
      await rename(stagingPath, outputPath);
      const info = await stat(outputPath);
      return { url:`/wav2lip-avatar/generated/${outputName}`, bytes:info.size, cached:false };
    } finally {
      await unlink(audioPath).catch(() => {});
      await unlink(stagingPath).catch(() => {});
    }
  }
}
