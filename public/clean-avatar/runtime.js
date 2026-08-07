const video = document.querySelector("#avatarVideo");
const canvas = document.querySelector("#avatarCanvas");
const context = canvas.getContext("2d", { alpha: false });
const status = document.querySelector("#status");
const query = new URLSearchParams(location.search);
const initialAction = query.get("action") || "idle";
const debugMouth = query.get("debugMouth") === "1";

let manifest;
let currentAction = "";
let currentDefinition;
let mouthTrack;
let mouthAtlas;
let mouthImages = [];
let actionRequest = Promise.resolve();
let speech = null;
let smoothedOpen = 0;
let debugSpeechStartedAt = 0;

function waitFor(target, event) {
  return new Promise((resolve, reject) => {
    const cleanup = () => { target.removeEventListener(event, done); target.removeEventListener("error", failed); };
    const done = () => { cleanup(); resolve(); };
    const failed = () => { cleanup(); reject(new Error(`视频事件失败：${event}`)); };
    target.addEventListener(event, done, { once: true });
    target.addEventListener("error", failed, { once: true });
  });
}

function resolveAction(name) {
  return manifest.actions[name] ? name : manifest.defaultAction;
}

async function switchAction(name) {
  const selected = resolveAction(name);
  const definition = manifest.actions[selected];
  actionRequest = actionRequest.catch(() => {}).then(async () => {
    if (currentAction === selected && !video.paused) return selected;
    status.hidden = false;
    status.textContent = "正在切换动作…";
    const trackPromise = fetch(definition.track, { cache: "no-cache" }).then(response => {
      if (!response.ok) throw new Error(`嘴部轨迹加载失败：${response.status}`);
      return response.json();
    });
    video.src = definition.video;
    video.loop = definition.loop === true;
    await waitFor(video, "loadedmetadata");
    mouthTrack = await trackPromise;
    if (mouthTrack.width !== video.videoWidth || mouthTrack.height !== video.videoHeight) {
      throw new Error("嘴部轨迹尺寸与视频不一致");
    }
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    currentAction = selected;
    currentDefinition = definition;
    video.onended = definition.loop ? null : () => switchAction(definition.returnTo || manifest.defaultAction);
    await video.play();
    status.hidden = true;
    return selected;
  });
  return actionRequest;
}

function decodeWavPcm16(buffer) {
  const view = new DataView(buffer);
  if (view.byteLength < 44 || view.getUint32(0, false) !== 0x52494646 || view.getUint32(8, false) !== 0x57415645) return null;
  let offset = 12;
  let format = null;
  let dataOffset = 0;
  let dataSize = 0;
  while (offset + 8 <= view.byteLength) {
    const id = String.fromCharCode(view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3));
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16) {
      format = {
        encoding: view.getUint16(body, true),
        channels: view.getUint16(body + 2, true),
        sampleRate: view.getUint32(body + 4, true),
        bits: view.getUint16(body + 14, true),
      };
    }
    if (id === "data") { dataOffset = body; dataSize = Math.min(size, view.byteLength - body); break; }
    offset = body + size + (size % 2);
  }
  if (!format || format.encoding !== 1 || format.bits !== 16 || !dataOffset || !dataSize) return null;
  return { view, ...format, dataOffset, sampleCount: Math.floor(dataSize / 2 / format.channels) };
}

function startSpeech(buffer) {
  const decoded = decodeWavPcm16(buffer);
  if (!decoded) {
    speech = null;
    return;
  }
  speech = { ...decoded, startedAt: performance.now() + 45 };
}

function loadImage(source) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`口型图片加载失败：${source}`));
    image.src = source;
  });
}

async function loadMouthAtlas() {
  const response = await fetch("mouth-atlas/atlas.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`口型图集加载失败：${response.status}`);
  mouthAtlas = await response.json();
  mouthImages = await Promise.all(mouthAtlas.levels.map(level => loadImage(`mouth-atlas/${level.image}`)));
}

function audioOpenAmount(now) {
  if (debugSpeechStartedAt) {
    const elapsed = (now - debugSpeechStartedAt) / 1000;
    if (elapsed >= 0 && elapsed < 3) {
      const envelope = Math.min(1, elapsed * 4, (3 - elapsed) * 4);
      return envelope * (0.18 + Math.abs(Math.sin(elapsed * 7.4)) * 0.62);
    }
    if (elapsed >= 3) debugSpeechStartedAt = 0;
  }
  if (!speech) return 0;
  const elapsed = (now - speech.startedAt) / 1000;
  if (elapsed < 0) return 0;
  const center = Math.floor(elapsed * speech.sampleRate);
  if (center >= speech.sampleCount) { speech = null; return 0; }
  const radius = Math.max(64, Math.floor(speech.sampleRate * 0.018));
  const start = Math.max(0, center - radius);
  const end = Math.min(speech.sampleCount, center + radius);
  let energy = 0;
  for (let sample = start; sample < end; sample += 2) {
    let mixed = 0;
    for (let channel = 0; channel < speech.channels; channel += 1) {
      mixed += speech.view.getInt16(speech.dataOffset + (sample * speech.channels + channel) * 2, true) / 32768;
    }
    mixed /= speech.channels;
    energy += mixed * mixed;
  }
  const rms = Math.sqrt(energy / Math.max(1, Math.ceil((end - start) / 2)));
  return Math.max(0, Math.min(1, (rms - 0.018) * 7.6));
}

function drawProceduralMouth(frame, openAmount) {
  const width = frame.width * canvas.width;
  const cx = frame.cx * canvas.width;
  const cy = frame.cy * canvas.height;
  const baseGap = Math.max(frame.gap * canvas.height, width * 0.018);
  const targetGap = baseGap + width * 0.105 * openAmount;
  if (targetGap <= baseGap * 1.08) return;

  context.save();
  context.translate(cx, cy);
  context.rotate(frame.angle);
  const cavityWidth = width * (0.68 + openAmount * 0.08);
  const cavityHeight = targetGap;
  const gradient = context.createRadialGradient(0, cavityHeight * 0.05, 1, 0, cavityHeight * 0.08, cavityWidth * 0.48);
  gradient.addColorStop(0, "#351318");
  gradient.addColorStop(0.7, "#4a171d");
  gradient.addColorStop(1, "rgba(82,31,38,.15)");
  context.fillStyle = gradient;
  context.beginPath();
  context.ellipse(0, 0, cavityWidth / 2, cavityHeight / 2, 0, 0, Math.PI * 2);
  context.fill();

  if (openAmount > 0.2) {
    context.fillStyle = `rgba(244,238,228,${Math.min(0.86, (openAmount - 0.2) * 1.35)})`;
    context.beginPath();
    context.ellipse(0, -cavityHeight * 0.22, cavityWidth * 0.35, cavityHeight * 0.12, 0, Math.PI, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawAtlasMouth(frame, openAmount) {
  if (!mouthAtlas || mouthImages.length < 2 || openAmount < 0.035) return false;
  const shapedOpen = Math.min(0.78, openAmount * 0.82);
  const level = Math.min(mouthImages.length - 2, Math.max(1, Math.round(shapedOpen * (mouthImages.length - 1))));
  const image = mouthImages[level];
  const width = frame.width * canvas.width * mouthAtlas.patchWidthScale;
  const height = width / mouthAtlas.aspectRatio;
  context.save();
  context.translate(frame.cx * canvas.width, frame.cy * canvas.height);
  context.rotate(frame.angle);
  context.globalAlpha = Math.min(1, 0.58 + shapedOpen * 0.7);
  context.drawImage(image, -width / 2, -height / 2, width, height);
  context.restore();
  return true;
}

function render(now) {
  if (video.readyState >= 2 && mouthTrack?.frames?.length) {
    context.drawImage(video, 0, 0, canvas.width, canvas.height);
    const frameIndex = Math.min(mouthTrack.frames.length - 1, Math.max(0, Math.floor(video.currentTime * mouthTrack.fps)));
    const targetOpen = audioOpenAmount(now);
    smoothedOpen += (targetOpen - smoothedOpen) * (targetOpen > smoothedOpen ? 0.48 : 0.2);
    const frame = mouthTrack.frames[frameIndex];
    if (!drawAtlasMouth(frame, smoothedOpen)) drawProceduralMouth(frame, smoothedOpen);
  }
  requestAnimationFrame(render);
}

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data?.type === "dh-live-audio") {
    const source = event.data.audio;
    const buffer = source instanceof ArrayBuffer
      ? source
      : ArrayBuffer.isView(source) ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength) : null;
    if (buffer) startSpeech(buffer);
  }
  if (event.data?.type === "dh-live-clear") {
    speech = null;
    smoothedOpen = 0;
  }
  if (event.data?.type === "dh-live-action") {
    const requestId = event.data.requestId;
    switchAction(event.data.action).then(action => {
      parent.postMessage({ type: "dh-live-action-ready", action, requestId }, location.origin);
    }).catch(error => {
      parent.postMessage({ type: "dh-live-action-error", action: event.data.action, requestId, error: error.message }, location.origin);
    });
  }
});

try {
  const response = await fetch("actions/manifest.json", { cache: "no-cache" });
  if (!response.ok) throw new Error(`动作清单加载失败：${response.status}`);
  manifest = await response.json();
  await loadMouthAtlas();
  await switchAction(initialAction);
  if (debugMouth) debugSpeechStartedAt = performance.now() + 250;
  requestAnimationFrame(render);
  parent.postMessage({ type: "dh-live-ready" }, location.origin);
} catch (error) {
  status.hidden = false;
  status.textContent = error.message;
  console.error(error);
}
