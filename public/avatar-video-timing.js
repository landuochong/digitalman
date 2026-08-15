// A first decoded frame takes 30–63 ms on the current browser path. Use the
// whole 60 ms Web Audio scheduling cushion, then freeze that primed frame until
// the exact audio boundary instead of letting hidden video advance early.
export const VIDEO_PRESTART_LEAD_MS=60;

export function videoPrestartDelayMs(audioStart,currentTime,leadMs=VIDEO_PRESTART_LEAD_MS){
  return Math.max(0,(Number(audioStart)-Number(currentTime))*1000-Math.max(0,Number(leadMs)||0));
}

export function videoBoundaryDelayMs(audioStart,currentTime){
  return Math.max(0,(Number(audioStart)-Number(currentTime))*1000);
}

export function videoCatchupSeconds(audioStart,currentTime,duration,thresholdMs=25){
  const lateSeconds=Math.max(0,Number(currentTime)-Number(audioStart));
  if(lateSeconds*1000<=thresholdMs)return 0;
  return Math.min(lateSeconds,Math.max(0,(Number(duration)||0)-.04));
}

export function continuousVideoSync(audioOrigin,audioTime,videoTime,duration,thresholdMs=25){
  const expected=Math.max(0,Number(audioTime)-Number(audioOrigin));
  const driftMs=Math.round((expected-Number(videoTime))*1000);
  return{expected,driftMs,seekTo:driftMs>thresholdMs?Math.min(expected,Math.max(0,(Number(duration)||expected)-.01)):null};
}

// MediaSource sequence mode joins only encoded speech frames. Web Audio can
// have a real wall-clock gap while the next sentence is still rendering, so
// move the audio origin forward by that gap instead of seeking past the newly
// appended video when speech resumes.
export function continuousVideoOriginAfterGap(audioOrigin,gapMs){
  const origin=Number(audioOrigin);
  return Number.isFinite(origin)?origin+Math.max(0,Number(gapMs)||0)/1000:audioOrigin;
}

export function scheduledAudioAhead(tail,currentTime){return Math.max(0,Number(tail)-Number(currentTime));}
