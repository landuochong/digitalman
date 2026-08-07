import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { access, mkdir, rename, stat, unlink, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { inferAudioExtension } from "./wav2lip-render.mjs";

const RENDER_PROFILE = "dinet-mini-25fps-retina-v1";

export function buildDINetWorkerCommand(projectRoot) {
  return {
    executable:join(projectRoot, ".venv-dh-live", "bin", "python"),
    args:[
      join(projectRoot, "scripts", "dinet_worker.py"),
      "--asset", join(projectRoot, "public", "dh-live", "actions", "lakeside_idle_test")
    ]
  };
}

async function exists(path) {
  try { await access(path, constants.R_OK); return true; }
  catch { return false; }
}

class PersistentDINetWorker {
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
    const command = buildDINetWorkerCommand(this.projectRoot);
    this.starting = new Promise((resolve, reject) => {
      const child = spawn(command.executable, command.args, {
        cwd:this.projectRoot,
        stdio:["pipe", "pipe", "pipe"]
      });
      this.child = child;
      const timer = setTimeout(() => reject(new Error("DINet 常驻模型加载超时")), 120_000);
      child.stderr.on("data", chunk => { this.stderr = (this.stderr + chunk).slice(-24_000); });
      createInterface({ input:child.stdout }).on("line", line => {
        let message;
        try { message = JSON.parse(line); } catch { return; }
        if (message.type === "ready") {
          clearTimeout(timer); this.starting = null; resolve(); return;
        }
        if (!this.active || message.id !== this.active.id) return;
        const active = this.active; this.active = null; clearTimeout(active.timer);
        if (message.type === "done") active.resolve(message);
        else active.reject(Object.assign(new Error(message.error || "DINet 口型生成失败"), { status:502 }));
      });
      child.once("error", error => { clearTimeout(timer); this.#fail(error); reject(error); });
      child.once("exit", code => {
        clearTimeout(timer);
        const error = new Error(`DINet 常驻进程退出 (${code})${this.stderr ? `：${this.stderr.slice(-800)}` : ""}`);
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
          this.#fail(Object.assign(new Error("DINet 口型生成超时"), { status:504 }));
          this.child?.kill("SIGTERM");
        }, 120_000);
        this.active = { id, resolve, reject, timer };
        this.child.stdin.write(`${JSON.stringify({ id, audio:audioPath, output:outputPath })}\n`);
      });
    });
    this.chain = task.catch(() => {});
    return task;
  }
}

export class DINetRenderStore {
  constructor({ projectRoot, autostart = true }) {
    this.projectRoot = projectRoot;
    this.workDir = join(projectRoot, "data", "dinet-render");
    this.outputDir = join(projectRoot, "public", "dinet-avatar", "generated");
    this.pending = new Map();
    this.worker = new PersistentDINetWorker(projectRoot);
    if (autostart) this.worker.start().catch(() => {});
  }

  async readiness() {
    const required = [
      join(this.projectRoot, ".venv-dh-live", "bin", "python"),
      join(this.projectRoot, "scripts", "dinet_worker.py"),
      join(this.projectRoot, "experiments", "dh-live", "checkpoint", "lstm", "lstm_model_epoch_325.pkl"),
      join(this.projectRoot, "experiments", "dh-live", "checkpoint", "DINet_mini", "epoch_40_new.pth"),
      join(this.projectRoot, "public", "dh-live", "actions", "lakeside_idle_test", "01.mp4"),
      join(this.projectRoot, "public", "dh-live", "actions", "lakeside_idle_test", "combined_data.json.gz")
    ];
    const missing = [];
    for (const path of required) if (!(await exists(path))) missing.push(path);
    return { ready:missing.length === 0, missing };
  }

  async render(audioBuffer) {
    const extension = inferAudioExtension(audioBuffer);
    if (extension !== "wav") {
      throw Object.assign(new Error("DINet 当前仅接受 PCM WAV 音频"), { status:415 });
    }
    const readiness = await this.readiness();
    if (!readiness.ready) throw Object.assign(new Error("DINet 本地模型尚未准备完成"), { status:503 });

    const hash = createHash("sha256")
      .update(RENDER_PROFILE)
      .update(audioBuffer)
      .digest("hex")
      .slice(0, 24);
    const outputName = `${hash}.mp4`;
    const outputPath = join(this.outputDir, outputName);
    if (await exists(outputPath)) {
      const info = await stat(outputPath);
      return { url:`/dinet-avatar/generated/${outputName}`, bytes:info.size, cached:true };
    }
    if (this.pending.has(hash)) return this.pending.get(hash);

    const task = this.#render(hash, audioBuffer, outputPath, outputName)
      .finally(() => this.pending.delete(hash));
    this.pending.set(hash, task);
    return task;
  }

  async #render(hash, audioBuffer, outputPath, outputName) {
    await mkdir(this.workDir, { recursive:true });
    await mkdir(this.outputDir, { recursive:true });
    const audioPath = join(this.workDir, `${hash}.wav`);
    const stagingPath = join(this.workDir, `${hash}.partial.mp4`);
    await writeFile(audioPath, audioBuffer, { mode:0o600 });
    try {
      const metrics = await this.worker.render(audioPath, stagingPath);
      await rename(stagingPath, outputPath);
      const info = await stat(outputPath);
      return {
        url:`/dinet-avatar/generated/${outputName}`,
        bytes:info.size,
        cached:false,
        metrics:{
          frames:metrics.frames,
          audioMs:metrics.audioMs,
          framesMs:metrics.framesMs,
          muxMs:metrics.muxMs,
          totalMs:metrics.totalMs
        }
      };
    } finally {
      await unlink(audioPath).catch(() => {});
      await unlink(stagingPath).catch(() => {});
    }
  }
}
