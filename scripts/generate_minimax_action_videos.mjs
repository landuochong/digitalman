#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_REFERENCE = path.join(PROJECT_ROOT, "public", "assets", "lumi-mature-reference-v1.png");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "resources", "minimax-generated", "lumi-mature-v1");
const API_BASE = "https://api.minimaxi.com";
const POLL_INTERVAL_MS = 10_000;

const ACTIONS = {
  idle: {
    filename: "idle.mp4",
    prompt: `固定机位的可爱真人数字伙伴待机镜头。严格保持参考图中的同一位年轻成年女性、脸型、五官、长发、粉色花朵发饰、海军风白色上衣和百褶裙、身材比例、湖边背景、构图、夕阳光线和颜色完全一致。她始终站在画面正中央，双脚和躯干位置不移动，肩膀放松，双臂和藏在身后的双手保持参考图姿势不变。只允许非常轻微且连续的自然呼吸、一次自然眨眼和甜美但几乎不可察觉的面部微笑；眼神明亮、友善、稳定地看向镜头。头部不摇晃，眼睛不左右乱看，身体不左右摆动，裙摆和头发不飘动。嘴唇始终自然闭合，不露牙，不说话，不发声。镜头完全静止，无推拉、无摇移、无变焦。首尾姿势和位置完全相同，整体可爱、清新、自然，不幼稚、不夸张。`,
  },
  smile: {
    filename: "smile.mp4",
    prompt: `固定机位的可爱真人数字伙伴甜美微笑动作。严格保持参考图中的同一位年轻成年女性、脸型、五官、长发、粉色花朵发饰、海军风白色上衣和百褶裙、身材比例、湖边背景、构图、夕阳光线和颜色完全一致。她始终站在画面正中央，身体、肩膀、双臂和藏在身后的双手位置保持不变。开始时表情自然平静，随后缓慢露出清新、甜美、可爱的闭嘴微笑，脸颊微微上扬，眼神自然变得明亮柔和，停留片刻后平滑恢复初始表情。可以有一次轻柔眨眼，但不能歪头或摇头。嘴唇始终闭合，不露牙，不说话，不发声；眼睛稳定看向镜头，不左右乱看；身体不摆动，裙摆和头发不飘动。镜头完全静止，无推拉、无摇移、无变焦。首尾姿势、位置和表情完全相同，动作可爱而克制。`,
  },
  agree: {
    filename: "agree.mp4",
    prompt: `固定机位的真人数字伙伴赞同动作。严格保持参考图中的同一位成年女性、脸型、五官、发型、酒红色连衣裙、身材比例、背景、构图、光线和颜色完全一致。她始终站在画面正中央，肩膀、双臂和双手保持放松且位置不变。她稳定看向镜头，缓慢而小幅地点头一次，配合轻微、克制的闭嘴微笑，然后自然回到初始平静姿势。点头幅度很小，只转动颈部，不带动身体前后或左右移动。嘴唇始终闭合，不露牙，不说话，不发声；眼睛不左右乱看，身体不摆动，衣服和头发不飘动。镜头完全静止，无推拉、无摇移、无变焦。首尾姿势和位置完全相同，动作真实自然。`,
  },
  agree_subtle: {
    filename: "agree-subtle.mp4",
    prompt: `固定机位的可爱真人数字伙伴做一次极轻微的赞同点头。严格保持参考图中的同一位年轻成年女性、脸型、五官、长发、粉色花朵发饰、海军风白色上衣和百褶裙、身材比例、湖边背景、构图、夕阳光线和颜色完全一致。她始终站在画面正中央，肩膀、锁骨、躯干、双臂和藏在身后的双手必须像固定住一样完全不动。她的眼睛全程明亮、友善并稳定直视镜头，不向下看。只允许颈部做一次幅度极小的点头：下巴向下移动不超过约一厘米，头部俯仰不超过约三度，随后立即平滑回到初始角度；配合甜美、可爱、克制的闭嘴微笑。绝对不能深低头、弯腰、鞠躬、歪头或带动肩膀。嘴唇始终闭合，不露牙，不说话，不发声。镜头完全静止，无推拉、无摇移、无变焦。首尾画面完全相同，动作清新可爱而自然。`,
  },
  idle_closed_cute: {
    filename: "idle-closed-cute.mp4",
    prompt:
      "A cute young adult woman matching the reference image exactly stands naturally by the lakeside at sunset. Preserve her face, long dark hair, pink flower hair accessory, sailor-style white top, pleated skirt, body proportions, lighting, and background. Keep both hands behind her back and keep her head and body facing the camera. She stays almost perfectly still with only subtle natural breathing and one soft blink. Her lips remain gently sealed for the entire video, never opening and never showing teeth; no speech, no singing, no lip movement, no wink. Cute, clean, natural expression. Locked camera, no zoom, no reframing, no body sway, no walking, no hand movement, no background change.",
  },
  agree_micro_cute: {
    filename: "agree-micro-cute.mp4",
    prompt:
      "A cute young adult woman matching the reference image exactly stands naturally by the lakeside at sunset. Preserve her face, long dark hair, pink flower hair accessory, sailor-style white top, pleated skirt, body proportions, lighting, and background. Keep both hands behind her back and keep her body completely still. She looks directly into the camera with eyes open, gives a tiny warm closed-mouth smile, and for only a moment brings her chin inward by less than one centimeter, then immediately returns to the starting pose. Her forehead, eyes, and nose remain nearly at the same height; this is not a bow and not a downward head movement. Lips stay gently sealed, never show teeth; no speech, no lip movement, no wink. Locked camera, no zoom, no reframing, no body sway, no hand movement, no background change.",
  },
};

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const options = {
    reference: DEFAULT_REFERENCE,
    output: DEFAULT_OUTPUT,
    outputExplicit: false,
    engine: "h3",
    actions: Object.keys(ACTIONS),
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reference") options.reference = path.resolve(argv[++index]);
    else if (arg === "--output") {
      options.output = path.resolve(argv[++index]);
      options.outputExplicit = true;
    }
    else if (arg === "--engine") options.engine = argv[++index];
    else if (arg === "--actions") options.actions = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`未知参数：${arg}`);
  }
  for (const name of options.actions) {
    if (!ACTIONS[name]) throw new Error(`不支持的动作：${name}`);
  }
  if (!new Set(["h3", "hailuo02"]).has(options.engine)) throw new Error(`不支持的引擎：${options.engine}`);
  if (options.engine === "hailuo02" && !options.outputExplicit) options.output = `${DEFAULT_OUTPUT}-hailuo02`;
  return options;
}

function imageDataUrl(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;
}

async function apiRequest(url, options, label) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof body === "string" ? body.slice(0, 800) : JSON.stringify(body);
    throw new Error(`${label}失败（HTTP ${response.status}）：${detail}`);
  }
  return body;
}

function engineProfile(engine) {
  return engine === "hailuo02"
    ? { engine, model: "MiniMax-Hailuo-02", resolution: "768P", duration: 6 }
    : { engine, model: "MiniMax-H3", resolution: "768P", duration: 4 };
}

function readState(statePath, referencePath, profile) {
  if (fs.existsSync(statePath)) return JSON.parse(fs.readFileSync(statePath, "utf8"));
  return {
    engine: profile.engine,
    model: profile.model,
    resolution: profile.resolution,
    duration: profile.duration,
    reference: path.relative(PROJECT_ROOT, referencePath),
    createdAt: new Date().toISOString(),
    actions: {},
  };
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporaryPath, statePath);
}

async function submitAction(apiKey, imageUrl, action, profile) {
  if (profile.engine === "hailuo02") {
    const body = await apiRequest(`${API_BASE}/v1/video_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `[固定] ${action.prompt}`,
        first_frame_image: imageUrl,
        last_frame_image: imageUrl,
        model: profile.model,
        duration: profile.duration,
        resolution: profile.resolution,
        prompt_optimizer: false,
        aigc_watermark: false,
      }),
    }, "创建视频任务");
    if (!body.task_id) throw new Error(`创建视频任务未返回 task_id：${JSON.stringify(body)}`);
    return String(body.task_id);
  }
  const payload = {
    model: profile.model,
    content: [
      { type: "text", text: action.prompt },
      { type: "image_url", image_url: { url: imageUrl }, role: "first_frame" },
      { type: "image_url", image_url: { url: imageUrl }, role: "last_frame" },
    ],
    resolution: profile.resolution,
    duration: profile.duration,
    ratio: "adaptive",
    aigc_watermark: false,
  };
  const body = await apiRequest(`${API_BASE}/v2/video_generation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "创建视频任务");
  if (!body.task_id) throw new Error(`创建视频任务未返回 task_id：${JSON.stringify(body)}`);
  return String(body.task_id);
}

async function waitForAction(apiKey, taskId, profile) {
  let previousStatus = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const queryUrl = profile.engine === "hailuo02"
      ? `${API_BASE}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`
      : `${API_BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`;
    const body = await apiRequest(queryUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, "查询视频任务");
    if (profile.engine === "hailuo02") {
      const status = body.status;
      if (!status) throw new Error(`查询视频任务返回异常：${JSON.stringify(body)}`);
      if (status !== previousStatus) {
        console.log(`任务 ${taskId}：${status}`);
        previousStatus = status;
      }
      if (status === "Success") {
        if (!body.file_id) throw new Error(`任务成功但缺少 file_id：${JSON.stringify(body)}`);
        const fileBody = await apiRequest(`${API_BASE}/v1/files/retrieve?file_id=${encodeURIComponent(body.file_id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }, "获取视频下载地址");
        if (!fileBody.file?.download_url) throw new Error(`文件查询缺少下载地址：${JSON.stringify(fileBody)}`);
        return {
          content: { url: fileBody.file.download_url },
          resolution: profile.resolution,
          duration: profile.duration,
          ratio: `${body.video_width || "?"}:${body.video_height || "?"}`,
          usage: null,
          videoWidth: body.video_width,
          videoHeight: body.video_height,
          fileId: String(body.file_id),
        };
      }
      if (status === "Fail") throw new Error(`任务 ${taskId} 失败：${JSON.stringify(body.base_resp || {})}`);
      continue;
    }
    const task = body.task;
    if (!task?.status) throw new Error(`查询视频任务返回异常：${JSON.stringify(body)}`);
    if (task.status !== previousStatus) {
      console.log(`任务 ${taskId}：${task.status}`);
      previousStatus = task.status;
    }
    if (task.status === "succeeded") {
      if (!task.content?.url) throw new Error(`任务成功但缺少下载地址：${JSON.stringify(body)}`);
      return task;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(`任务 ${taskId} ${task.status}：${JSON.stringify(task.error || {})}`);
    }
  }
}

async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载视频失败（HTTP ${response.status}）`);
  const temporaryPath = `${outputPath}.part`;
  fs.writeFileSync(temporaryPath, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(temporaryPath, outputPath);
}

async function main() {
  loadEnv(path.join(PROJECT_ROOT, ".env"));
  const options = parseArgs(process.argv.slice(2));
  const profile = engineProfile(options.engine);
  if (!fs.existsSync(options.reference)) throw new Error(`参考图不存在：${options.reference}`);
  const imageSize = fs.statSync(options.reference).size;
  if (imageSize > 30 * 1024 * 1024) throw new Error("参考图超过 MiniMax 30 MB 限制");

  if (options.dryRun) {
    console.log(JSON.stringify({
      reference: options.reference,
      output: options.output,
      imageBytes: imageSize,
      engine: profile.engine,
      model: profile.model,
      resolution: profile.resolution,
      duration: profile.duration,
      actions: options.actions.map((name) => ({ name, filename: ACTIONS[name].filename, prompt: ACTIONS[name].prompt })),
    }, null, 2));
    return;
  }

  const apiKey = (process.env.MINIMAX_VIDEO_API_KEY || process.env.MINIMAX_API_KEY)?.trim();
  if (!apiKey) throw new Error("缺少 MINIMAX_VIDEO_API_KEY（也未配置兼容回退项 MINIMAX_API_KEY）");
  fs.mkdirSync(options.output, { recursive: true });
  const statePath = path.join(options.output, "generation.json");
  const state = readState(statePath, options.reference, profile);
  const imageUrl = imageDataUrl(options.reference);

  for (const name of options.actions) {
    const action = ACTIONS[name];
    const outputPath = path.join(options.output, action.filename);
    const record = state.actions[name] || { prompt: action.prompt };
    state.actions[name] = record;

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      console.log(`${name} 已存在，跳过：${outputPath}`);
      continue;
    }
    try {
      if (!record.taskId) {
        console.log(`提交 ${name}（${profile.duration} 秒 / ${profile.resolution} / ${profile.model}）…`);
        record.taskId = await submitAction(apiKey, imageUrl, action, profile);
        record.status = "submitted";
        record.submittedAt = new Date().toISOString();
        writeState(statePath, state);
        console.log(`${name} 任务已提交：${record.taskId}`);
      } else {
        console.log(`继续查询 ${name} 已有任务：${record.taskId}`);
      }

      const task = await waitForAction(apiKey, record.taskId, profile);
      await downloadVideo(task.content.url, outputPath);
      record.status = "succeeded";
      record.completedAt = new Date().toISOString();
      record.output = path.relative(PROJECT_ROOT, outputPath);
      record.task = {
        resolution: task.resolution,
        duration: task.duration,
        ratio: task.ratio,
        usage: task.usage,
        videoWidth: task.videoWidth,
        videoHeight: task.videoHeight,
        fileId: task.fileId,
      };
      writeState(statePath, state);
      console.log(`${name} 已下载：${outputPath}`);
    } catch (error) {
      record.status = "failed";
      record.failedAt = new Date().toISOString();
      record.error = error.message;
      writeState(statePath, state);
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
