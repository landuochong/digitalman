import { videoBoundaryDelayMs,videoCatchupSeconds,videoPrestartDelayMs } from "../avatar-video-timing.js?v=20260813-video-handoff-v11";

const idleVideo = document.querySelector("#avatar-idle");
const speechVideo = document.querySelector("#avatar-speech");
const stage = document.querySelector("#stage");
const state = document.querySelector("#state");
let playToken = 0;
let segmentPlaying=false;
let externalSegmentsPending=0;
let segmentsPreparing=0;
let activeSegment=null;
let activeSegmentSequence=-1;
let nextPlaybackSequence=0;
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
  segmentQueue.length=0;segmentPlaying=false;externalSegmentsPending=0;segmentsPreparing=0;activeSegment=null;activeSegmentSequence=-1;nextPlaybackSequence=0;streamEnded=true;
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
    const timer=setTimeout(done,2500);video.addEventListener("loadeddata",done,{once:true});video.addEventListener("error",done,{once:true});
  });
  video.load();
  stage.append(video);
  return {...item,video,videoReady};
}

async function waitForFirstVideoFrame(video){
  await new Promise(resolve=>{
    let settled=false;const done=()=>{if(settled)return;settled=true;clearTimeout(timer);resolve();};
    const timer=setTimeout(done,80);
    if(typeof video.requestVideoFrameCallback==="function")video.requestVideoFrameCallback(done);
    else requestAnimationFrame(done);
  });
}

function revealSegment(item,video){
  const sequence=item.playbackSequence;
  if(sequence<activeSegmentSequence)return false;
  const previous=activeSegment;activeSegment=video;activeSegmentSequence=sequence;
  video.classList.add("active");
  requestAnimationFrame(()=>{if(previous&&previous!==video){previous.classList.remove("active");previous.pause();previous.remove();}});
  return true;
}

async function playExternalSegment(item,token){
  externalSegmentsPending++;
  const video=item.video,sequence=item.playbackSequence;
  try{
    const waitMs=videoPrestartDelayMs(item.audioStart,streamAudioContext.currentTime);
    if(waitMs)await new Promise(resolve=>setTimeout(resolve,waitMs));
    if(token!==playToken)return;
    video.muted=true;
    const playRequestedAt=performance.now();await video.play();
    await waitForFirstVideoFrame(video);if(token!==playToken)return;
    video.pause();
    const firstFrameMs=Math.round(performance.now()-playRequestedAt);
    const boundaryWaitMs=videoBoundaryDelayMs(item.audioStart,streamAudioContext.currentTime);
    if(boundaryWaitMs)await new Promise(resolve=>setTimeout(resolve,boundaryWaitMs));
    if(token!==playToken)return;
    const catchup=videoCatchupSeconds(item.audioStart,streamAudioContext.currentTime,Number(video.duration)||item.segment?.audioMs/1000||0);
    if(catchup)try{video.currentTime=catchup;}catch{}
    await video.play();if(token!==playToken)return;
    const handoffLateMs=Math.round(Math.max(0,(streamAudioContext.currentTime-item.audioStart)*1000));
    if(revealSegment(item,video))notify("wav2lip-started",{requestId:item.requestId,sequence,firstFrameMs,handoffLateMs});
    const remainingMs=Math.max(0,(item.audioEnd-streamAudioContext.currentTime)*1000);
    if(remainingMs)await new Promise(resolve=>setTimeout(resolve,remainingMs));
    if(token===playToken)notify("wav2lip-ended",{requestId:item.requestId,sequence});
  }catch{if(token===playToken)notify("wav2lip-error",{requestId:item.requestId,sequence});}
  finally{
    externalSegmentsPending=Math.max(0,externalSegmentsPending-1);
    if(token!==playToken){video.pause();video.remove();return;}
    if(!video.classList.contains("active")){video.pause();video.remove();}
    if(!externalSegmentsPending&&!segmentsPreparing&&!segmentPlaying&&!segmentQueue.length&&streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);
  }
}

async function dispatchSegment(item){
  const token=playToken;
  segmentsPreparing++;
  try{
    await item.videoReady;
    const externalAudio=await item.audioReady;
    if(token!==playToken)return;
    if(item.videoOnly&&!externalAudio){notify("wav2lip-error",{requestId:item.requestId,sequence:item.playbackSequence,error:"external-audio-unavailable"});item.video.remove();return;}
    item.video.muted=externalAudio;
    if(externalAudio){void playExternalSegment(item,token);return;}
    segmentQueue.push(item);playQueuedSegment();
  }finally{
    segmentsPreparing=Math.max(0,segmentsPreparing-1);
    if(token===playToken&&!segmentsPreparing&&!externalSegmentsPending&&!segmentPlaying&&!segmentQueue.length&&streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);
  }
}

async function playQueuedSegment(){
  if(segmentPlaying||!segmentQueue.length)return;
  clearTimeout(idleRevealTimer);idleRevealTimer=0;
  segmentPlaying=true;const item=segmentQueue.shift(),video=item.video,previous=activeSegment;
  const token=playToken;
  try{
    await item.videoReady;video.muted=false;
    await video.play();if(token!==playToken)return;
    await waitForFirstVideoFrame(video);
    revealSegment(item,video);
    notify("wav2lip-started",{requestId:item.requestId});
    await new Promise((resolve,reject)=>{video.onended=resolve;video.onerror=reject;});
    notify("wav2lip-ended",{requestId:item.requestId});
  }catch{notify("wav2lip-error",{requestId:item.requestId});}
  finally{
    segmentPlaying=false;
    if(segmentQueue.length)playQueuedSegment();
    else if(token===playToken&&!externalSegmentsPending&&streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);
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
    if(segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length||!streamEnded)return;
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
    document.body.classList.add("loading");const item=preloadSegment({...event.data,playbackSequence:nextPlaybackSequence++});
    item.audioReady=audioScheduleChain=audioScheduleChain.then(()=>scheduleSegmentAudio(item)).catch(()=>false);
    void dispatchSegment(item);return;
  }
  if(event.data?.type==="wav2lip-stream-end"){
    streamEnded=true;pendingIdleLingerMs=event.data.lingerMs;pendingIdleTimeMs=event.data.idleTimeMs;
    if(!segmentPlaying&&!externalSegmentsPending&&!segmentsPreparing&&!segmentQueue.length)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);return;
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
