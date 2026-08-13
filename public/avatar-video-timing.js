export const VIDEO_PRESTART_LEAD_MS=32;

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
