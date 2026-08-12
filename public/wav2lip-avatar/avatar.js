const idleVideo = document.querySelector("#avatar-idle");
const speechVideo = document.querySelector("#avatar-speech");
const stage = document.querySelector("#stage");
const state = document.querySelector("#state");
let playToken = 0;
let segmentPlaying=false;
let activeSegment=null;
let streamEnded=true;
let idleRevealTimer=0;
let pendingIdleTimeMs=null;
let pendingIdleLingerMs=120;
let streamAudioContext=null;
let streamAudioTail=0;
let audioScheduleChain=Promise.resolve();
const streamAudioSources=new Set();
const segmentQueue=[];

function notify(type, data = {}) { parent.postMessage({ type, ...data }, location.origin); }
function stopStreamAudio(){
  for(const source of streamAudioSources){try{source.stop();}catch{}}
  streamAudioSources.clear();streamAudioTail=0;audioScheduleChain=Promise.resolve();
}
function playIdle() {
  clearTimeout(idleRevealTimer);idleRevealTimer=0;
  document.body.classList.remove("needs-play"); state.onclick = null;
  speechVideo.classList.remove("active");
  speechVideo.pause();
  for(const video of stage.querySelectorAll(".speech-segment")){video.pause();video.remove();}
  segmentQueue.length=0;segmentPlaying=false;activeSegment=null;streamEnded=true;
  pendingIdleTimeMs=null;pendingIdleLingerMs=120;
  stopStreamAudio();
  idleVideo.play().catch(() => {});
}

function pcmBuffer(context,audio){
  if(audio?.encoding!=="pcm_s16le"||audio.channels!==1||!audio.data)return null;
  const bytes=Uint8Array.from(atob(audio.data),character=>character.charCodeAt(0));
  if(!bytes.length||bytes.length%2)return null;
  const samples=new Int16Array(bytes.buffer,bytes.byteOffset,bytes.byteLength/2);
  const buffer=context.createBuffer(1,samples.length,Number(audio.sampleRate)||16000),channel=buffer.getChannelData(0);
  for(let index=0;index<samples.length;index++)channel[index]=samples[index]/(samples[index]<0?32768:32767);
  return buffer;
}

async function ensureStreamAudio(){
  const sharedContext=parent.__lumiAvatarAudioContext;
  const Context=window.AudioContext||window.webkitAudioContext;if(!sharedContext&&!Context)return null;
  streamAudioContext||=sharedContext||new Context({sampleRate:16000});
  if(streamAudioContext.state!=="running")await streamAudioContext.resume().catch(()=>{});
  return streamAudioContext.state==="running"?streamAudioContext:null;
}

async function scheduleSegmentAudio(item){
  const context=await ensureStreamAudio();if(!context){notify("wav2lip-audio-mode",{mode:"mp4",sequence:item.segment?.sequence,gapMs:0});return false;}
  const buffer=pcmBuffer(context,item.segment?.audio);if(!buffer)return false;
  const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
  const when=Math.max(streamAudioTail,context.currentTime+.06);
  const gapMs=streamAudioTail?Math.max(0,Math.round((when-streamAudioTail)*1000)):0;
  item.audioStart=when;item.audioEnd=when+buffer.duration;streamAudioTail=item.audioEnd;
  source.onended=()=>streamAudioSources.delete(source);streamAudioSources.add(source);source.start(when);
  notify("wav2lip-audio-mode",{mode:"pcm",sequence:item.segment?.sequence,gapMs});return true;
}

function preloadSegment(item){
  const video=document.createElement("video");
  video.className="avatar-layer speech-segment";video.playsInline=true;
  video.preload="auto";video.src=item.url;
  const videoReady=new Promise(resolve=>{
    let settled=false;const done=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
    const timer=setTimeout(done,2500);video.addEventListener("loadedmetadata",done,{once:true});video.addEventListener("error",done,{once:true});
  });
  video.load();
  stage.append(video);
  return {...item,video,videoReady};
}

async function playQueuedSegment(){
  if(segmentPlaying||!segmentQueue.length)return;
  clearTimeout(idleRevealTimer);idleRevealTimer=0;
  segmentPlaying=true;const item=segmentQueue.shift(),video=item.video,previous=activeSegment;
  const token=playToken;
  try{
    await item.videoReady;
    const externalAudio=await item.audioReady;
    video.muted=externalAudio;
    if(externalAudio&&item.audioStart>streamAudioContext.currentTime+.02){
      await new Promise(resolve=>setTimeout(resolve,Math.max(0,(item.audioStart-streamAudioContext.currentTime)*1000-18)));
    }
    if(externalAudio&&streamAudioContext.currentTime>item.audioStart+.025){
      const elapsed=Math.min(Math.max(0,streamAudioContext.currentTime-item.audioStart),Math.max(0,(Number(video.duration)||item.segment?.audioMs/1000||0)-.04));
      if(elapsed>.025)try{video.currentTime=elapsed;}catch{}
    }
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
    if(externalAudio&&item.audioEnd>streamAudioContext.currentTime){
      await new Promise(resolve=>setTimeout(resolve,(item.audioEnd-streamAudioContext.currentTime)*1000));
    }
    notify("wav2lip-ended",{requestId:item.requestId});
  }catch{notify("wav2lip-error",{requestId:item.requestId});}
  finally{
    segmentPlaying=false;
    if(segmentQueue.length)playQueuedSegment();
    else if(token===playToken&&streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);
  }
}

async function alignIdleToTime(speechTime){
  const target=reflectedIdleTime(speechTime);
  if(Math.abs(idleVideo.currentTime-target)<=.05)return;
  idleVideo.pause();
  await new Promise(resolve=>{
    let settled=false;
    const done=()=>{if(settled)return;settled=true;clearTimeout(timer);idleVideo.removeEventListener("seeked",done);resolve();};
    const timer=setTimeout(done,140);idleVideo.addEventListener("seeked",done,{once:true});
    const duration=idleVideo.duration;
    try{idleVideo.currentTime=Number.isFinite(duration)&&duration>0?Math.min(target,Math.max(0,duration-.04)):target;}catch{done();}
  });
}

function scheduleIdleReveal(delayMs=120,idleTimeMs=null){
  clearTimeout(idleRevealTimer);
  if(Number.isFinite(Number(idleTimeMs)))void alignIdleToTime(Number(idleTimeMs)/1000);
  const audioRemainingMs=streamAudioContext?Math.max(0,(streamAudioTail-streamAudioContext.currentTime)*1000):0;
  idleRevealTimer=setTimeout(async()=>{
    if(segmentPlaying||segmentQueue.length||!streamEnded)return;
    if(Number.isFinite(Number(idleTimeMs)))await alignIdleToTime(Number(idleTimeMs)/1000);
    const previous=activeSegment;activeSegment=null;
    idleVideo.play().catch(()=>{});
    requestAnimationFrame(()=>{
      previous?.classList.remove("active");previous?.pause();previous?.remove();
      document.body.classList.remove("loading");
    });
  },Math.max(audioRemainingMs,Math.min(400,Math.max(80,Number(delayMs)||120))));
}

function reflectedIdleTime(speechTime) {
  const duration = idleVideo.duration;
  if (!Number.isFinite(duration) || duration <= 0) return Math.max(0, speechTime);
  const phase = speechTime % (duration * 2);
  return phase <= duration ? phase : duration * 2 - phase;
}

async function revealAlignedIdle(token) {
  await alignIdleToTime(speechVideo.currentTime);
  if (token !== playToken) return false;
  speechVideo.classList.remove("active");
  idleVideo.play().catch(() => {});
  return true;
}

window.addEventListener("message", async event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if(event.data?.type==="wav2lip-audio-unlock"){
    const context=await ensureStreamAudio();notify("wav2lip-audio-mode",{mode:context?"pcm-ready":"mp4",gapMs:0});return;
  }
  if (event.data?.type === "wav2lip-clear") { playToken++; document.body.classList.remove("loading"); playIdle(); return; }
  if(event.data?.type==="wav2lip-enqueue"&&event.data.url){
    clearTimeout(idleRevealTimer);idleRevealTimer=0;streamEnded=false;
    document.body.classList.add("loading");const item=preloadSegment(event.data);
    item.audioReady=audioScheduleChain=audioScheduleChain.then(async()=>{await item.videoReady;return scheduleSegmentAudio(item);}).catch(()=>false);
    segmentQueue.push(item);playQueuedSegment();return;
  }
  if(event.data?.type==="wav2lip-stream-end"){
    streamEnded=true;pendingIdleLingerMs=event.data.lingerMs;pendingIdleTimeMs=event.data.idleTimeMs;
    if(!segmentPlaying&&!segmentQueue.length)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);return;
  }
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
