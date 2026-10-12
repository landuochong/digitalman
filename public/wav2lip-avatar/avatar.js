import { continuousVideoOriginAfterGap,continuousVideoSync,scheduledAudioAhead,videoBoundaryDelayMs,videoCatchupSeconds,videoPrestartDelayMs } from "../avatar-video-timing.js?v=20260814-audio-gap-v1";
import { loadPcmBytes } from "../pcm-segment.js?v=20260813-binary-pcm-v1";
import { bufferedVideoAhead,removableVideoRange,splitFragmentedMp4 } from "../fmp4-segment.js?v=20260813-fmp4-v3";
import { scheduleAfterMediaReady } from "../media-audio-gate.js?v=20260813-media-audio-gate-v1";
import { AlbumMotion } from "../album-motion.js?v=20261012-motion-v3";

const idleVideo = document.querySelector("#avatar-idle");
const speechVideo = document.querySelector("#avatar-speech");
const stage = document.querySelector("#stage");
const state = document.querySelector("#state");
const characterProfiles={
  lumi:{idleAsset:"bedroom_idle_test",idleVideo:"01-seamless.mp4?v=20260814-stable-face-v2"},
  xiaotao:{idleAsset:"xiaotao_idle",idleVideo:"01.mp4?v=20260815-xiaotao-v2"}
};
const requestedCharacter=new URLSearchParams(location.search).get("character");
const activeCharacter=characterProfiles[requestedCharacter]?requestedCharacter:"lumi";
const characterProfile=characterProfiles[activeCharacter],characterRoot=`/dh-live/actions/${characterProfile.idleAsset}`;
idleVideo.poster=`${characterRoot}/thumbnail.jpg`;
idleVideo.src=`${characterRoot}/01.mp4`;
stage.style.backgroundImage=`url("${characterRoot}/thumbnail.jpg")`;
document.body.dataset.character=activeCharacter;
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
let fragmentedPlaybackPromise=null;
let fragmentedPlaybackGeneration=0;
let waitingPreview=null;
let waitingPreviewTimer=0;
const streamAudioSources=new Set();
const segmentQueue=[];
const streamItems=new Map();
const cancelledRequests=new Set();
const MAX_VIDEO_AHEAD_SECONDS=4;
const MAX_AUDIO_AHEAD_SECONDS=4;
const STREAM_GAP_IDLE_MS=320;
const RESUMABLE_PREVIEW_ACTIONS=new Set(["thinking","caring","nod","happy","idle"]);

function notify(type, data = {}) { parent.postMessage({ type, ...data }, location.origin); }
const motionPlanResponse=await fetch("/album-motion-plan.json?v=20261012-motion-v3");
if(!motionPlanResponse.ok)throw new Error("动作配置加载失败");
const motionPlan=await motionPlanResponse.json();
const albumMotion=new AlbumMotion({
  sourceFrames:motionPlan.characters[activeCharacter].sourceFrames,
  seek:async seconds=>{
    idleVideo.pause();
    if(idleVideo.readyState<2){
      await new Promise(resolve=>{
        let timer;const done=()=>{clearTimeout(timer);idleVideo.removeEventListener('loadeddata',done);idleVideo.removeEventListener('error',done);resolve();};
        idleVideo.addEventListener('loadeddata',done,{once:true});idleVideo.addEventListener('error',done,{once:true});timer=setTimeout(done,2000);
      });
    }
    if(idleVideo.readyState<2||Math.abs(idleVideo.currentTime-seconds)<.001)return;
    await new Promise(resolve=>{
      let timer;const done=()=>{clearTimeout(timer);idleVideo.removeEventListener('seeked',done);resolve();};
      idleVideo.addEventListener('seeked',done,{once:true});timer=setTimeout(done,200);
      idleVideo.currentTime=seconds;
    });
  },
  show:()=>{speechVideo.classList.remove('active');for(const video of stage.querySelectorAll('.speech-segment'))video.classList.remove('active');},
  onState:value=>{document.body.dataset.albumState=value;}
});
function keepIdlePlaying(){void albumMotion.freeze();}
function completeAlbumSegment(item){albumMotion.complete(item.playbackSequence, item.motionEndFrame);}
function supportsFragmentedVideo(){return typeof MediaSource!=="undefined"&&MediaSource.isTypeSupported?.('video/mp4; codecs="avc1.64001f"')===true;}
function stopFragmentedPlayback(){
  const playback=fragmentedPlayback;fragmentedPlayback=null;fragmentedPlaybackPromise=null;fragmentedPlaybackGeneration++;fragmentedAppendChain=Promise.resolve();
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
  void prewarmFragmentedPlayback(playToken);
  clearTimeout(waitingPreviewTimer);waitingPreviewTimer=0;waitingPreview=null;
  keepIdlePlaying();
}

function clearWaitingPreview({revealIdle=true}={}){
  clearTimeout(waitingPreviewTimer);waitingPreviewTimer=0;
  const video=waitingPreview;waitingPreview=null;
  if(!video)return;
  const wasSpeechOverlay=video.dataset.overlaySpeech==="true";
  video.classList.remove("active");
  if(activeSegment===video)activeSegment=null;
  if(wasSpeechOverlay&&activeSegment){
    if(activeSegment===fragmentedPlayback?.video&&streamAudioContext&&Number.isFinite(fragmentedPlayback.audioOrigin)){
      const{seekTo}=continuousVideoSync(fragmentedPlayback.audioOrigin,streamAudioContext.currentTime,activeSegment.currentTime,activeSegment.duration);
      if(seekTo!==null)try{activeSegment.currentTime=seekTo;}catch{}
    }
    if(activeSegment.ended){activeSegment.classList.remove("active");activeSegment=null;}
    else activeSegment.play().catch(()=>{});
  }
  if(revealIdle&&(!activeSegment||activeSegment.ended))keepIdlePlaying();
  setTimeout(()=>{video.pause();video.remove();},180);
}

async function showWaitingPreview(data){
  // Listening and thinking remain a still image, including unsolicited previews.
  notify("wav2lip-preview-ended",{action:data.action,purpose:data.purpose||"reply",durationMs:0});
}

function canResumeWaitingPreview(video){
  return Boolean(video?.isConnected&&video.dataset.purpose==="reply"&&video.loop&&RESUMABLE_PREVIEW_ACTIONS.has(video.dataset.action));
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
  item.audioGapMs=gapMs;
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
  if(fragmentedPlaybackPromise)return fragmentedPlaybackPromise;
  if(token!==playToken||!supportsFragmentedVideo())return null;
  const generation=fragmentedPlaybackGeneration;
  const pending=(async()=>{
    const mediaSource=new MediaSource(),video=document.createElement("video"),url=URL.createObjectURL(mediaSource);
    video.className="avatar-layer speech-segment";video.playsInline=true;video.preload="auto";video.muted=true;video.src=url;stage.append(video);
    try{
      await new Promise((resolve,reject)=>{mediaSource.addEventListener("sourceopen",resolve,{once:true});mediaSource.addEventListener("error",reject,{once:true});});
      if(token!==playToken||generation!==fragmentedPlaybackGeneration){video.remove();URL.revokeObjectURL(url);return null;}
      const sourceBuffer=mediaSource.addSourceBuffer('video/mp4; codecs="avc1.64001f"');sourceBuffer.mode="sequence";
      fragmentedPlayback={mediaSource,sourceBuffer,video,url,initAppended:false,started:false,startPromise:null,audioOrigin:null,maxDriftMs:0,prunedSeconds:0};return fragmentedPlayback;
    }catch(error){video.remove();URL.revokeObjectURL(url);throw error;}
  })();
  fragmentedPlaybackPromise=pending;
  try{return await pending;}finally{if(fragmentedPlaybackPromise===pending)fragmentedPlaybackPromise=null;}
}

function prewarmFragmentedPlayback(token=playToken){
  if(streamAudioContext?.state!=="running"||!supportsFragmentedVideo())return Promise.resolve(null);
  return ensureFragmentedPlayback(token).catch(()=>null);
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
    if(item.audioGapMs>0&&!item.audioGapApplied){
      playback.audioOrigin=continuousVideoOriginAfterGap(playback.audioOrigin,item.audioGapMs);
      item.audioGapApplied=true;
    }
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
    if(token===playToken&&!item.cancelled){completeAlbumSegment(item);notify("wav2lip-ended",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:item.playbackSequence,continuousVideo:true});}
  }catch{if(token===playToken)notify("wav2lip-error",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:item.playbackSequence,error:"continuous-media-unavailable"});}
  finally{
    forgetStreamItem(item);externalSegmentsPending=Math.max(0,externalSegmentsPending-1);
    if(token===playToken&&!externalSegmentsPending&&!segmentsPreparing&&!segmentPlaying&&!segmentQueue.length){
      if(streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);else scheduleStreamGapReveal();
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
  albumMotion.begin();
  const previous=activeSegment;activeSegment=video;activeSegmentSequence=sequence;
  video.classList.add("active");
  requestAnimationFrame(()=>{if(previous&&previous!==video){
    const keepSpeechOverlay=previous===waitingPreview&&previous.dataset.overlaySpeech==="true";
    if(!keepSpeechOverlay)previous.classList.remove("active");
    const keepWaitingPreview=previous===waitingPreview&&canResumeWaitingPreview(previous);
    if(!keepWaitingPreview&&!keepSpeechOverlay){
      const delay=previous.classList.contains("waiting-preview")?180:0;
      setTimeout(()=>{previous.pause();previous.remove();},delay);
      if(previous===waitingPreview)waitingPreview=null;
    }
  }});
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
    if(token===playToken&&!item.cancelled){completeAlbumSegment(item);notify("wav2lip-ended",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:sequence});}
  }catch{if(token===playToken)notify("wav2lip-error",{requestId:item.requestId,streamId:item.segment?.id,sequence:item.segment?.sequence,playbackSequence:sequence});}
  finally{
    forgetStreamItem(item);externalSegmentsPending=Math.max(0,externalSegmentsPending-1);
    if(token!==playToken){video.pause();video.remove();return;}
    if(!video.classList.contains("active")){video.pause();video.remove();}
    if(!externalSegmentsPending&&!segmentsPreparing&&!segmentPlaying&&!segmentQueue.length){
      if(streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);else scheduleStreamGapReveal();
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
    if(!item.cancelled){completeAlbumSegment(item);notify("wav2lip-ended",{requestId:item.requestId});}
  }catch{notify("wav2lip-error",{requestId:item.requestId});}
  finally{
    forgetStreamItem(item);segmentPlaying=false;
    if(segmentQueue.length)playQueuedSegment();
    else if(token===playToken&&!externalSegmentsPending){
      if(streamEnded)scheduleIdleReveal(pendingIdleLingerMs,pendingIdleTimeMs);else scheduleStreamGapReveal();
    }
  }
}

function scheduleIdleReveal(delayMs=120,idleTimeMs=null){
  clearTimeout(streamGapIdleTimer);streamGapIdleTimer=0;
  clearTimeout(idleRevealTimer);
  const audioRemainingMs=streamAudioContext?Math.max(0,(streamAudioTail-streamAudioContext.currentTime)*1000):0;
  idleRevealTimer=setTimeout(async()=>{
    if(segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length||!streamEnded)return;
    const previous=activeSegment,preview=waitingPreview;activeSegment=null;waitingPreview=null;
    clearTimeout(waitingPreviewTimer);waitingPreviewTimer=0;
    previous?.pause();
    const token=playToken;
    if(!await albumMotion.settle()||token!==playToken)return;
    requestAnimationFrame(()=>{
      if(token!==playToken||segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length||!streamEnded)return;
      previous?.classList.remove("active");previous?.pause();previous?.remove();
      if(preview&&preview!==previous){preview.pause();preview.remove();}
      stopFragmentedPlayback();
      void prewarmFragmentedPlayback(playToken);
      document.body.classList.remove("loading");
    });
  },Math.max(audioRemainingMs,Math.min(400,Math.max(80,Number(delayMs)||120))));
}

function scheduleStreamGapReveal(delayMs=STREAM_GAP_IDLE_MS){
  clearTimeout(streamGapIdleTimer);
  if(streamEnded||segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length)return;
  const token=playToken;
  streamGapIdleTimer=setTimeout(async()=>{
    streamGapIdleTimer=0;
    if(token!==playToken||streamEnded||segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length)return;
    const previous=activeSegment;if(!previous)return;
    const sourceTime=Math.max(0,Number(fragmentedPlayback?.video?.currentTime||previous.currentTime)||0);
    const preview=null;
    if(preview)await preview.play().catch(()=>{});else keepIdlePlaying();
    if(token!==playToken||streamEnded||segmentPlaying||externalSegmentsPending||segmentsPreparing||segmentQueue.length||activeSegment!==previous)return;
    activeSegment=preview;
    if(!preview)keepIdlePlaying();
    requestAnimationFrame(()=>{
      previous.classList.remove("active");
      preview?.classList.add("active");
      if(previous!==fragmentedPlayback?.video)setTimeout(()=>{previous.pause();previous.remove();},180);
      document.body.classList.remove("loading");
      notify(preview?"wav2lip-gap-preview":"wav2lip-gap-idle",{gapMs:Math.max(0,Number(delayMs)||0),sourceTimeMs:Math.round(sourceTime*1000),...(preview?{action:preview.dataset.action,currentTime:preview.currentTime}:{})});
    });
  },Math.max(120,Number(delayMs)||STREAM_GAP_IDLE_MS));
}

async function revealAlignedIdle(token) {
  if (token !== playToken) return false;
  if(!await albumMotion.settle())return false;
  if (token !== playToken) return false;
  return true;
}

window.addEventListener("message", async event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if(event.data?.type==="wav2lip-audio-unlock"){
    const context=await ensureStreamAudio();
    if(!context){notify("wav2lip-audio-mode",{mode:"mp4",fragmentedVideo:false,gapMs:0});return;}
    const canFragment=supportsFragmentedVideo();notify("wav2lip-audio-mode",{mode:"pcm-ready",fragmentedVideo:false,gapMs:0});
    if(canFragment){const playback=await prewarmFragmentedPlayback(playToken);if(playback)notify("wav2lip-audio-mode",{mode:"pcm-ready",fragmentedVideo:true,gapMs:0,prewarmed:true});}
    return;
  }
  if(event.data?.type==="wav2lip-preview"&&event.data.url){void showWaitingPreview(event.data);return;}
  if(event.data?.type==="wav2lip-preview-clear"){clearWaitingPreview();return;}
  if(event.data?.type==="wav2lip-cancel"){cancelStreamRequest(event.data.requestId);return;}
  if (event.data?.type === "wav2lip-clear") { playToken++; document.body.classList.remove("loading"); playIdle(); return; }
  if(event.data?.type==="wav2lip-enqueue"&&event.data.url){
    albumMotion.cancel();
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
  if(isSilentAction){notify("wav2lip-ended",{requestId:event.data.requestId});return;}
  if ((event.data?.type !== "wav2lip-play"&&!isSilentAction) || !event.data.url) return;
  const token = ++playToken;
  albumMotion.cancel();
  document.body.classList.add("loading"); state.textContent = isSilentAction?"正在回应":"开始播放";
  speechVideo.classList.remove("active");
  speechVideo.pause(); speechVideo.loop = false; speechVideo.muted = isSilentAction; speechVideo.src = event.data.url;
  speechVideo.onended = async () => {
    if (token !== playToken) return;
    albumMotion.complete(0,event.data.motionEndFrame);
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
      albumMotion.begin();
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
document.addEventListener("visibilitychange",()=>{if(!document.hidden&&!activeSegment)keepIdlePlaying();});
playIdle();
