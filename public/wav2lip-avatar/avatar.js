const idleVideo = document.querySelector("#avatar-idle");
const speechVideo = document.querySelector("#avatar-speech");
const stage = document.querySelector("#stage");
const state = document.querySelector("#state");
let playToken = 0;
let segmentPlaying=false;
let activeSegment=null;
let streamEnded=true;
let idleRevealTimer=0;
const segmentQueue=[];

function notify(type, data = {}) { parent.postMessage({ type, ...data }, location.origin); }
function playIdle() {
  clearTimeout(idleRevealTimer);idleRevealTimer=0;
  document.body.classList.remove("needs-play"); state.onclick = null;
  speechVideo.classList.remove("active");
  speechVideo.pause();
  for(const video of stage.querySelectorAll(".speech-segment")){video.pause();video.remove();}
  segmentQueue.length=0;segmentPlaying=false;activeSegment=null;streamEnded=true;
  idleVideo.play().catch(() => {});
}

function preloadSegment(item){
  const video=document.createElement("video");
  video.className="avatar-layer speech-segment";video.playsInline=true;
  video.preload="auto";video.src=item.url;video.load();
  stage.append(video);
  return {...item,video};
}

async function playQueuedSegment(){
  if(segmentPlaying||!segmentQueue.length)return;
  clearTimeout(idleRevealTimer);idleRevealTimer=0;
  segmentPlaying=true;const item=segmentQueue.shift(),video=item.video,previous=activeSegment;
  const token=playToken;
  try{
    await video.play();if(token!==playToken)return;
    await new Promise(resolve=>{
      if(typeof video.requestVideoFrameCallback==="function")video.requestVideoFrameCallback(()=>resolve());
      else requestAnimationFrame(()=>resolve());
    });
    video.classList.add("active");
    await new Promise(resolve=>requestAnimationFrame(resolve));
    if(previous&&previous!==video){previous.classList.remove("active");previous.pause();previous.remove();}
    activeSegment=video;
    notify("wav2lip-started",{requestId:item.requestId});
    await new Promise((resolve,reject)=>{video.onended=resolve;video.onerror=reject;});
    notify("wav2lip-ended",{requestId:item.requestId});
  }catch{notify("wav2lip-error",{requestId:item.requestId});}
  finally{
    segmentPlaying=false;
    if(segmentQueue.length)playQueuedSegment();
    else if(token===playToken&&streamEnded)scheduleIdleReveal();
  }
}

function scheduleIdleReveal(){
  clearTimeout(idleRevealTimer);
  idleRevealTimer=setTimeout(()=>{
    if(segmentPlaying||segmentQueue.length||!streamEnded)return;
    const previous=activeSegment;activeSegment=null;
    idleVideo.play().catch(()=>{});
    requestAnimationFrame(()=>{
      previous?.classList.remove("active");previous?.pause();previous?.remove();
      document.body.classList.remove("loading");
    });
  },120);
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
  if(event.data?.type==="wav2lip-enqueue"&&event.data.url){
    clearTimeout(idleRevealTimer);idleRevealTimer=0;streamEnded=false;
    document.body.classList.add("loading");segmentQueue.push(preloadSegment(event.data));playQueuedSegment();return;
  }
  if(event.data?.type==="wav2lip-stream-end"){streamEnded=true;if(!segmentPlaying&&!segmentQueue.length)scheduleIdleReveal();return;}
  const isSilentAction=event.data?.type==="wav2lip-action";
  if ((event.data?.type !== "wav2lip-play"&&!isSilentAction) || !event.data.url) return;
  const token = ++playToken;
  document.body.classList.add("loading"); state.textContent = isSilentAction?"正在回应":"开始播放";
  speechVideo.classList.remove("active");
  speechVideo.pause(); speechVideo.loop = false; speechVideo.muted = isSilentAction; speechVideo.src = event.data.url;
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
