const video = document.querySelector("#avatar");
const state = document.querySelector("#state");
const idleSrc = "/dh-live/actions/lakeside_idle_test/01.mp4";
let playToken = 0;
let idleTimer;

function notify(type, data = {}) { parent.postMessage({ type, ...data }, location.origin); }
function playIdle() {
  clearTimeout(idleTimer);
  document.body.classList.remove("needs-play"); state.onclick = null;
  video.muted = true; video.loop = true;
  if (!video.src.endsWith(idleSrc)) video.src = idleSrc;
  video.play().catch(() => {});
}

window.addEventListener("message", async event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data?.type === "wav2lip-clear") { playToken++; document.body.classList.remove("loading"); playIdle(); return; }
  if (event.data?.type !== "wav2lip-play" || !event.data.url) return;
  clearTimeout(idleTimer);
  const token = ++playToken;
  document.body.classList.add("loading"); state.textContent = "开始播放";
  video.pause(); video.loop = false; video.muted = false; video.src = event.data.url;
  video.onended = () => {
    if (token !== playToken) return;
    notify("wav2lip-ended", { requestId:event.data.requestId });
    document.body.classList.remove("loading");
    idleTimer = setTimeout(playIdle, 250);
  };
  video.onerror = () => {
    if (token !== playToken) return;
    notify("wav2lip-error", { requestId:event.data.requestId });
    document.body.classList.remove("loading"); playIdle();
  };
  const start = async () => {
    try {
      await video.play();
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

video.addEventListener("canplay", () => notify("dh-live-ready"), { once:true });
playIdle();
