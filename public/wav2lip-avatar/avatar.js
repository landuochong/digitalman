const idleVideo = document.querySelector("#avatar-idle");
const speechVideo = document.querySelector("#avatar-speech");
const state = document.querySelector("#state");
let playToken = 0;

function notify(type, data = {}) { parent.postMessage({ type, ...data }, location.origin); }
function playIdle() {
  document.body.classList.remove("needs-play"); state.onclick = null;
  speechVideo.classList.remove("active");
  speechVideo.pause();
  idleVideo.play().catch(() => {});
}

function reflectedIdleTime(speechTime) {
  const duration = idleVideo.duration;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, speechTime);
  const phase = speechTime % (duration * 2);
  return phase <= duration ? phase : duration * 2 - phase;
}

async function revealAlignedIdle(token) {
  const target = reflectedIdleTime(speechVideo.currentTime);
  if (Math.abs(idleVideo.currentTime - target) > 0.05) {
    idleVideo.pause();
    await new Promise(resolve => {
      let settled = false;
      let finishIfAligned;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        idleVideo.removeEventListener("seeked", finishIfAligned);
        resolve();
      };
      const timer = setTimeout(done, 140);
      finishIfAligned = () => {
        if (Math.abs(idleVideo.currentTime - target) <= 0.08) done();
      };
      idleVideo.addEventListener("seeked", finishIfAligned);
      const duration = idleVideo.duration;
      const seekTarget = Number.isFinite(duration) && duration > 0
        ? Math.min(target, Math.max(0, duration - 0.04))
        : target;
      try { idleVideo.currentTime = seekTarget; }
      catch { done(); }
    });
  }
  if (token !== playToken) return false;
  speechVideo.classList.remove("active");
  idleVideo.play().catch(() => {});
  return true;
}

window.addEventListener("message", async event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data?.type === "wav2lip-clear") { playToken++; document.body.classList.remove("loading"); playIdle(); return; }
  if (event.data?.type !== "wav2lip-play" || !event.data.url) return;
  const token = ++playToken;
  document.body.classList.add("loading"); state.textContent = "开始播放";
  speechVideo.classList.remove("active");
  speechVideo.pause(); speechVideo.loop = false; speechVideo.muted = false; speechVideo.src = event.data.url;
  speechVideo.onended = async () => {
    if (token !== playToken) return;
    if (!await revealAlignedIdle(token)) return;
    notify("wav2lip-ended", { requestId:event.data.requestId });
    document.body.classList.remove("loading");
  };
  speechVideo.onerror = () => {
    if (token !== playToken) return;
    notify("wav2lip-error", { requestId:event.data.requestId });
    document.body.classList.remove("loading"); playIdle();
  };
  const start = async () => {
    try {
      await speechVideo.play();
      if (token !== playToken) return;
      speechVideo.classList.add("active");
      document.body.classList.remove("needs-play"); state.onclick = null;
      notify("wav2lip-started", { requestId:event.data.requestId });
    } catch {
      state.textContent = "点击播放回答";
      document.body.classList.add("needs-play");
      state.onclick = start;
    }
  };
  await start();
});

idleVideo.addEventListener("canplay", () => notify("dh-live-ready"), { once:true });
playIdle();
