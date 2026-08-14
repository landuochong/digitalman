import { continuousVideoSync,scheduledAudioAhead,videoBoundaryDelayMs,videoCatchupSeconds,videoPrestartDelayMs } from "../avatar-video-timing.js?v=20260813-bounded-stream-v3";
import { loadPcmBytes } from "../pcm-segment.js?v=20260813-binary-pcm-v1";
import { bufferedVideoAhead,removableVideoRange,splitFragmentedMp4 } from "../fmp4-segment.js?v=20260813-fmp4-v3";
import { scheduleAfterMediaReady } from "../media-audio-gate.js?v=20260813-media-audio-gate-v1";

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
let streamGapIdleTimer=0;
let pendingIdleTimeMs=null;
let pendingIdleLingerMs=120;
let streamAudioContext=null;
let streamAudioTail=0;
let audioScheduleChain=Promise.resolve();
let fragmentedAppendChain=Promise.resolve();
let fragmentedPlayback=null;
let waitingPreview=null;
let waitingPreviewTimer=0;
const streamAudioSources=new Set();
const segmentQueue=[];
const streamItems=new Map();
const cancelledRequests=new Set();
const MAX_VIDEO_AHEAD_SECONDS=4;
const MAX_AUDIO_AHEAD_SECONDS=4;
const STREAM_GAP_IDLE_MS=320;

function notify(type, data = {}) { parent.postMessage({ type, ...data }, location.origin); }
function supportsFragmentedVideo(){return typeof MediaSource!=="undefined"&&MediaSource.isTypeSupported?.('video/mp4; codecs="avc1.64001f"')===true;}
function stopFragmentedPlayback(){
  const playback=fragmentedPlayback;fragmentedPlayback=null;fragmentedAppendChain=Promise.resolve();
  if(!playback)return;try{if(playback.mediaSource.readyState==="open")playback.mediaSource.endOfStream();}catch{}
  playback.video.pause();playback.video.remove();URL.revokeObjectURL(playback.url);
}
function stopStreamAudio(){
  for(const source of streamAudioSources){try{source.stop();}catch{}}
  streamAudioSources.clear();streamAudioTail=0;audioScheduleChain=Promise.resolve();
}
function requestCancelled(requestId){return cancelledRequests.has(requestId);}
function forgetStreamItem(item){
  if(streamItems.get(item?.requestId)===item)streamItems.delete(item.requestId);
}
function cancelStreamRequest(requestId){
  if(!requestId)return;
  cancelledRequests.add(requestId);
  setTimeout(()=>cancelledRequests.delete(requestId),60_000);
  const item=streamItems.get(requestId);if(!item)return;
  item.cancelled=true;
  const queuedIndex=segmentQueue.indexOf(item);if(queuedIndex>=0)segmentQueue.splice(queuedIndex,1);
  if(item.audioSource){try{item.audioSource.stop();}catch{}streamAudioSources.delete(item.audioSource);}
  if(item.audioEnd===streamAudioTail&&streamAudioContext)streamAudioTail=streamAudioContext.currentTime;
  if(item.fragmentedVideo)stopFragmentedPlayback();
  if(item.video&&!item.video.classList.contains("active")){item.video.pause();item.video.remove();}
  forgetStreamItem(item);
}
function playIdle() {
  clearTimeout(idleRevealTimer);idleRevealTimer=0;
  clearTimeout(streamGapIdleTimer);streamGapIdleTimer=0;
  document.body.classList.remove("needs-play"); state.onclick = null;
  speechVideo.classList.remove("active");
  speechVideo.pause();
  for(const video of stage.querySelectorAll(".speech-segment")){video.pause();video.remove();}
  segmentQueue.length=0;streamItems.clear();cancelledRequests.clear();segmentPlaying=false;externalSegmentsPending=0;segmentsPreparing=0;activeSegment=null;activeSegmentSequence=-1;nextPlaybackSequence=0;streamEnded=true;
  pendingIdleTimeMs=null;pendingIdleLingerMs=120;
  stopStreamAudio();stopFragmentedPlayback();
  clearTimeout(waitingPreviewTimer);waitingPreviewTimer=0;waitingPreview=null;
  idleVideo.play().catch(() => {});
}

function clearWaitingPreview({revealIdle=true}={}){
  clearTimeout(waitingPreviewTimer);waitingPreviewTimer=0;
  const video=waitingPreview;waitingPreview=null;
  if(!video)return;
  video.classList.remove("active");
  if(activeSegment===video)activeSegment=null;
  if(revealIdle)idleVideo.play().catch(()=>{});
  setTimeout(()=>{video.pause();video.remove();},180);
}

async function showWaitingPreview(data){
  if(!data.url||segmentPlaying||externalSegmentsPending||segmentsPreparing)return;
  clearWaitingPreview({revealIdle:false});
  const video=document.createElement("video");
  video.className="avatar-layer speech-segment waiting-preview";video.playsInline=true;video.muted=true;video.loop=data.loop!==false;video.preload="auto";video.src=data.url;
  waitingPreview=video;stage.append(video);
  try{
    await video.play();await waitForFirstVideoFrame(video);
    if(waitingPreview!==video)return;
    const previous=activeSegment;activeSegment=video;video.classList.add("active");
    if(previous&&previous!==video){previous.classList.remove("active");setTimeout(()=>{previous.pause();previous.remove();},180);}
    notify("wav2lip-preview-started",{action:data.action,currentTime:video.currentTime,purpose:data.purpose||"reply"});
    const durationMs=Math.max(0,Number(data.durationMs)||0);
    if(durationMs)waitingPreviewTimer=setTimeout(()=>{
      waitingPreviewTimer=0;
      if(waitingPreview!==video)return;
      clearWaitingPreview();
      notify("wav2lip-preview-ended",{action:data.action,purpose:data.purpose||"reply",durationMs});
    },durationMs);
  }catch{if(waitingPreview===video)clearWaitingPreview();}
}

function pcmBuffer(context,audio,bytes){
  if(audio?.encoding!=="pcm_s16le"||audio.channels!==1||!bytes)return null;
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

async function scheduleSegmentAudio(item,pcmBytesPromise,token){
  const [context,bytes]=await Promise.all([ensureStreamAudio(),pcmBytesPromise]);
  if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return false;
  if(!context){notify("wav2lip-audio-mode",{mode:"mp4",sequence:item.segment?.sequence,gapMs:0});return false;}
  while(token===playToken&&scheduledAudioAhead(streamAudioTail,context.currentTime)>MAX_AUDIO_AHEAD_SECONDS)await new Promise(resolve=>setTimeout(resolve,80));
  if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return false;
  const buffer=pcmBuffer(context,item.segment?.audio,bytes);if(!buffer)return false;
  const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);
  const when=Math.max(streamAudioTail,context.currentTime+.06);
  const gapMs=streamAudioTail?Math.max(0,Math.round((when-streamAudioTail)*1000)):0;
  item.audioStart=when;item.audioEnd=when+buffer.duration;streamAudioTail=item.audioEnd;
  item.audioSource=source;source.onended=()=>{streamAudioSources.delete(source);if(item.audioSource===source)item.audioSource=null;};streamAudioSources.add(source);source.start(when);
  notify("wav2lip-audio-buffer",{aheadSeconds:Number(scheduledAudioAhead(streamAudioTail,context.currentTime).toFixed(3)),sources:streamAudioSources.size});
  notify("wav2lip-audio-mode",{mode:"pcm",sequence:item.segment?.sequence,gapMs});return true;
}

function preloadSegment(item){
  if(item.fragmentedVideo){
    const loadFragment=()=>fetch(item.url,{cache:"force-cache"}).then(async response=>response.ok?splitFragmentedMp4(await response.arrayBuffer()):null).catch(()=>null);
    return{...item,loadFragment,videoReady:Promise.resolve()};
  }
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

async function waitForFragmentCapacity(playback,token){
  while(token===playToken&&bufferedVideoAhead(playback.sourceBuffer.buffered,playback.video.currentTime)>MAX_VIDEO_AHEAD_SECONDS)await new Promise(resolve=>setTimeout(resolve,80));
  return token===playToken;
}

async function ensureFragmentedPlayback(token){
  if(fragmentedPlayback)return fragmentedPlayback;
  if(token!==playToken||!supportsFragmentedVideo())return null;
  const mediaSource=new MediaSource(),video=document.createElement("video"),url=URL.createObjectURL(mediaSource);
  video.className="avatar-layer speech-segment";video.playsInline=true;video.preload="auto";video.muted=true;video.src=url;stage.append(video);
  await new Promise((resolve,reject)=>{mediaSource.addEventListener("sourceopen",resolve,{once:true});mediaSource.addEventListener("error",reject,{once:true});});
  if(token!==playToken){video.remove();URL.revokeObjectURL(url);return null;}
  const sourceBuffer=mediaSource.addSourceBuffer('video/mp4; codecs="avc1.64001f"');sourceBuffer.mode="sequence";
  fragmentedPlayback={mediaSource,sourceBuffer,video,url,initAppended:false,started:false,startPromise:null,audioOrigin:null,maxDriftMs:0,prunedSeconds:0};return fragmentedPlayback;
}

function appendFragmentBytes(sourceBuffer,bytes){
  return new Promise((resolve,reject)=>{
    const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(sourceBuffer.error||new Error("fMP4 append failed"));};
    const cleanup=()=>{sourceBuffer.removeEventListener("updateend",done);sourceBuffer.removeEventListener("error",fail);};
    sourceBuffer.addEventListener("updateend",done,{once:true});sourceBuffer.addEventListener("error",fail,{once:true});
    try{sourceBuffer.appendBuffer(bytes);}catch(error){cleanup();reject(error);}
  });
}

function pruneFragmentedVideo(playback){
  const range=removableVideoRange(playback.sourceBuffer.buffered,playback.video.currentTime);if(!range)return Promise.resolve(false);
  return new Promise((resolve,reject)=>{
    const done=()=>{cleanup();playback.prunedSeconds+=range.end-range.start;resolve(true);},fail=()=>{cleanup();reject(playback.sourceBuffer.error||new Error("fMP4 prune failed"));};
    const cleanup=()=>{playback.sourceBuffer.removeEventListener("updateend",done);playback.sourceBuffer.removeEventListener("error",fail);};
    playback.sourceBuffer.addEventListener("updateend",done,{once:true});playback.sourceBuffer.addEventListener("error",fail,{once:true});
    try{playback.sourceBuffer.remove(range.start,range.end);}catch(error){cleanup();reject(error);}
  });
}

function queueFragmentedVideo(item,token){
  return fragmentedAppendChain=fragmentedAppendChain.then(async()=>{
    if(item.cancelled||requestCancelled(item.requestId))return null;
    const playback=await ensureFragmentedPlayback(token);if(!playback||!await waitForFragmentCapacity(playback,token))return null;
    const fragment=await item.loadFragment();if(token!==playToken||item.cancelled||requestCancelled(item.requestId)||!fragment)return null;
    if(!playback.initAppended){await appendFragmentBytes(playback.sourceBuffer,fragment.init);playback.initAppended=true;}
    await pruneFragmentedVideo(playback);await appendFragmentBytes(playback.sourceBuffer,fragment.media);
    const buffered=playback.sourceBuffer.buffered,aheadSeconds=bufferedVideoAhead(buffered,playback.video.currentTime);
    notify("wav2lip-video-buffer",{aheadSeconds:Number(aheadSeconds.toFixed(3)),bufferStart:buffered.length?Number(buffered.start(0).toFixed(3)):0,bufferEnd:buffered.length?Number(buffered.end(buffered.length-1).toFixed(3)):0,prunedSeconds:Number(playback.prunedSeconds.toFixed(3))});
    return playback;
  }).catch(()=>null);
}

async function playFragmentedSegment(item,token){
  externalSegmentsPending++;
  try{
    const [externalAudio,playback]=await Promise.all([item.audioReady,item.fragmentReadyToPlay]);
    if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
    if(!externalAudio||!playback)throw new Error("continuous-media-unavailable");
    playback.startPromise||=(async()=>{
      const waitMs=videoPrestartDelayMs(item.audioStart,streamAudioContext.currentTime);if(waitMs)await new Promise(resolve=>setTimeout(resolve,waitMs));
      if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return false;const playRequestedAt=performance.now();await playback.video.play();await waitForFirstVideoFrame(playback.video);playback.video.pause();
      const boundaryWaitMs=videoBoundaryDelayMs(item.audioStart,streamAudioContext.currentTime);if(boundaryWaitMs)await new Promise(resolve=>setTimeout(resolve,boundaryWaitMs));
      if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return false;
      const catchup=videoCatchupSeconds(item.audioStart,streamAudioContext.currentTime,Number(playback.video.duration)||item.segment?.audioMs/1000||0);
      if(catchup)try{playback.video.currentTime=catchup;}catch{}
      await playback.video.play();if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return false;
      playback.audioOrigin=item.audioStart;playback.started=true;revealSegment(item,playback.video);
      item.startedNotified=true;
      notify("wav2lip-started",{requestId:item.requestId,sequence:item.playbackSequence,firstFrameMs:Math.round(performance.now()-playRequestedAt),handoffLateMs:Math.round(Math.max(0,(streamAudioContext.currentTime-item.audioStart)*1000)),continuousVideo:true});return true;
    })();
    if(!await playback.startPromise)return;
    if(item.playbackSequence>0&&Number.isFinite(playback.audioOrigin)){
      const{driftMs,seekTo}=continuousVideoSync(playback.audioOrigin,streamAudioContext.currentTime,playback.video.currentTime,playback.video.duration);
      playback.maxDriftMs=Math.max(playback.maxDriftMs,Math.abs(driftMs));
      if(seekTo!==null)try{playback.video.currentTime=seekTo;}catch{}
      if(playback.video.paused)await playback.video.play().catch(()=>{});
      notify("wav2lip-video-sync",{sequence:item.playbackSequence,driftMs,maxDriftMs:playback.maxDriftMs});
    }
    if(!item.startedNotified){
      const resumedFromGap=activeSegment!==playback.video;
      if(resumedFromGap){
        const prestartMs=videoPrestartDelayMs(item.audioStart,streamAudioContext.currentTime);if(prestartMs)await new Promise(resolve=>setTimeout(resolve,prestartMs));
        if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
        await playback.video.play().catch(()=>{});await waitForFirstVideoFrame(playback.video);
      }
      const boundaryWaitMs=videoBoundaryDelayMs(item.audioStart,streamAudioContext.currentTime);if(boundaryWaitMs)await new Promise(resolve=>setTimeout(resolve,boundaryWaitMs));
      if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
      if(playback.video.paused)await playback.video.play().catch(()=>{});
      revealSegment(item,playback.video);item.startedNotified=true;
      notify("wav2lip-started",{requestId:item.requestId,sequence:item.playbackSequence,firstFrameMs:0,handoffLateMs:Math.round(Math.max(0,(streamAudioContext.currentTime-item.audioStart)*1000)),continuousVideo:true,resumedFromGap});
    }
    const remainingMs=Math.max(0,(item.audioEnd-streamAudioContext.currentTime)*1000);if(remainingMs)await new Promise(resolve=>setTimeout(resolve,remainingMs));
    if(token===playToken&&!item.cancelled)notify("wav2lip-ended",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:item.playbackSequence,continuousVideo:true});
  }catch{if(token===playToken)notify("wav2lip-error",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:item.playbackSequence,error:"continuous-media-unavailable"});}
  finally{
    forgetStreamItem(item);externalSegmentsPending=Math.max(0,externalSegmentsPending-1);
    if(token===playToken&&!externalSegmentsPending&&!segmentsPreparing&&!segmentPlaying&&!segmentQueue.length){
      if(streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);else scheduleStreamGapIdle();
    }
  }
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
  requestAnimationFrame(()=>{if(previous&&previous!==video){previous.classList.remove("active");const delay=previous.classList.contains("waiting-preview")?180:0;setTimeout(()=>{previous.pause();previous.remove();},delay);if(previous===waitingPreview)waitingPreview=null;}});
  return true;
}

async function playExternalSegment(item,token){
  externalSegmentsPending++;
  const video=item.video,sequence=item.playbackSequence;
  try{
    const waitMs=videoPrestartDelayMs(item.audioStart,streamAudioContext.currentTime);
    if(waitMs)await new Promise(resolve=>setTimeout(resolve,waitMs));
    if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
    video.muted=true;
    const playRequestedAt=performance.now();await video.play();
    await waitForFirstVideoFrame(video);if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
    video.pause();
    const firstFrameMs=Math.round(performance.now()-playRequestedAt);
    const boundaryWaitMs=videoBoundaryDelayMs(item.audioStart,streamAudioContext.currentTime);
    if(boundaryWaitMs)await new Promise(resolve=>setTimeout(resolve,boundaryWaitMs));
    if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
    const catchup=videoCatchupSeconds(item.audioStart,streamAudioContext.currentTime,Number(video.duration)||item.segment?.audioMs/1000||0);
    if(catchup)try{video.currentTime=catchup;}catch{}
    await video.play();if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
    const handoffLateMs=Math.round(Math.max(0,(streamAudioContext.currentTime-item.audioStart)*1000));
    if(revealSegment(item,video))notify("wav2lip-started",{requestId:item.requestId,sequence,firstFrameMs,handoffLateMs});
    const remainingMs=Math.max(0,(item.audioEnd-streamAudioContext.currentTime)*1000);
    if(remainingMs)await new Promise(resolve=>setTimeout(resolve,remainingMs));
    if(token===playToken&&!item.cancelled)notify("wav2lip-ended",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:sequence});
  }catch{if(token===playToken)notify("wav2lip-error",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:sequence});}
  finally{
    forgetStreamItem(item);externalSegmentsPending=Math.max(0,externalSegmentsPending-1);
    if(token!==playToken){video.pause();video.remove();return;}
    if(!video.classList.contains("active")){video.pause();video.remove();}
    if(!externalSegmentsPending&&!segmentsPreparing&&!segmentPlaying&&!segmentQueue.length){
      if(streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);else scheduleStreamGapIdle();
    }
  }
}

async function dispatchSegment(item){
  const token=playToken;
  segmentsPreparing++;
  try{
    if(item.fragmentedVideo){void playFragmentedSegment(item,token);return;}
    await item.videoReady;
    const externalAudio=await item.audioReady;
    if(token!==playToken||item.cancelled||requestCancelled(item.requestId))return;
    if(item.videoOnly&&!externalAudio){notify("wav2lip-error",{requestId:item.requestId,sequence:item.playbackSequence,error:"external-audio-unavailable"});item.video.remove();return;}
    item.video.muted=externalAudio;
    if(externalAudio){void playExternalSegment(item,token);return;}
    segmentQueue.push(item);playQueuedSegment();
  }finally{
    segmentsPreparing=Math.max(0,segmentsPreparing-1);
    if(item.cancelled)forgetStreamItem(item);
    if(token===playToken&&!segmentsPreparing&&!externalSegmentsPending&&!segmentPlaying&&!segmentQueue.length&&streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);
  }
}

async function playQueuedSegment(){
  if(segmentPlaying||!segmentQueue.length)return;
  clearTimeout(idleRevealTimer);idleRevealTimer=0;
  segmentPlaying=true;const item=segmentQueue.shift(),video=item.video,previous=activeSegment;
  const token=playToken;
  try{
    await item.videoReady;if(item.cancelled||requestCancelled(item.requestId))return;video.muted=false;
    await video.play();if(token!==playToken)return;
    await waitForFirstVideoFrame(video);
    revealSegment(item,video);
    notify("wav2lip-started",{requestId:item.requestId});
    await new Promise((resolve,reject)=>{video.onended=resolve;video.onerror=reject;});
    if(!item.cancelled)notify("wav2lip-ended",{requestId:item.requestId});
  }catch{notify("wav2lip-error",{requestId:item.requestId});}
  finally{
    forgetStreamItem(item);segmentPlaying=false;
    if(segmentQueue.length)playQueuedSegment();
    else if(token===playToken&&!externalSegmentsPending){
      if(streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);else scheduleStreamGapIdle();
    }
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
  clearTimeout(streamGapIdleTimer);streamGapIdleTimer=0;
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
      stopFragmentedPlayback();
      document.body.classList.remove("loading");
    });
  },Math.max(audioRemainingMs,Math.min(400,Math.max(80,Number(delayMs)||120))));
}

function scheduleStreamGapIdle(delayMs=STREAM_GAP_IDLE_MS){
  clearTimeout(streamGapIdleTimer);
  if(streamEnded||segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length)return;
  const token=playToken;
  streamGapIdleTimer=setTimeout(async()=>{
    streamGapIdleTimer=0;
    if(token!==playToken||streamEnded||segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length)return;
    const previous=activeSegment;if(!previous)return;
    const sourceTime=Math.max(0,Number(fragmentedPlayback?.video?.currentTime||previous.currentTime)||0);
    await alignIdleToTime(sourceTime);
    if(token!==playToken||streamEnded||segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length||activeSegment!==previous)return;
    activeSegment=null;idleVideo.play().catch(()=>{});
    requestAnimationFrame(()=>{
      previous.classList.remove("active");
      if(previous!==fragmentedPlayback?.video)setTimeout(()=>{previous.pause();previous.remove();},180);
      document.body.classList.remove("loading");
      notify("wav2lip-gap-idle",{gapMs:Math.max(0,Number(delayMs)||0),sourceTimeMs:Math.round(sourceTime*1000)});
    });
  },Math.max(120,Number(delayMs)||STREAM_GAP_IDLE_MS));
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
    const context=await ensureStreamAudio();notify("wav2lip-audio-mode",{mode:context?"pcm-ready":"mp4",fragmentedVideo:Boolean(context&&supportsFragmentedVideo()),gapMs:0});return;
  }
  if(event.data?.type==="wav2lip-preview"&&event.data.url){void showWaitingPreview(event.data);return;}
  if(event.data?.type==="wav2lip-preview-clear"){clearWaitingPreview();return;}
  if(event.data?.type==="wav2lip-cancel"){cancelStreamRequest(event.data.requestId);return;}
  if (event.data?.type === "wav2lip-clear") { playToken++; document.body.classList.remove("loading"); playIdle(); return; }
  if(event.data?.type==="wav2lip-enqueue"&&event.data.url){
    clearTimeout(idleRevealTimer);idleRevealTimer=0;clearTimeout(streamGapIdleTimer);streamGapIdleTimer=0;streamEnded=false;
    document.body.classList.add("loading");cancelledRequests.delete(event.data.requestId);const item=preloadSegment({...event.data,playbackSequence:nextPlaybackSequence++,receivedAt:performance.now()});streamItems.set(item.requestId,item);
    const token=playToken,pcmBytesPromise=loadPcmBytes(item.segment?.audio).catch(()=>null);
    if(item.fragmentedVideo)item.fragmentReadyToPlay=queueFragmentedVideo(item,token);
    // A shared PCM clock is only useful when the matching video is already in
    // MediaSource. Scheduling audio first gave the browser just 60 ms to fetch,
    // parse and append a fragment; a slow append made speech start ahead of the
    // mouth and forced a visible catch-up seek. DINet renders the next 800 ms in
    // roughly 240 ms, so gating each PCM segment on its video append preserves
    // ample headroom without adding silence between segments.
    item.audioReady=audioScheduleChain=audioScheduleChain.then(()=>scheduleAfterMediaReady({
      fragmentedVideo:item.fragmentedVideo,fragmentReadyToPlay:item.fragmentReadyToPlay,
      scheduleAudio:()=>{
        if(item.fragmentedVideo)notify("wav2lip-media-gate",{sequence:item.playbackSequence,mediaReadyMs:Math.round(performance.now()-item.receivedAt)});
        return scheduleSegmentAudio(item,pcmBytesPromise,token);
      }
    })).catch(()=>false);
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
