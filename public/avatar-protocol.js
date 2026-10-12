export function buildWav2LipPlaybackMessage(rendered, requestId, { enqueue=false }={}) {
  return {
    type:enqueue?"wav2lip-enqueue":"wav2lip-play",
    url:rendered?.url,
    requestId,
    ...(Number.isFinite(rendered?.metrics?.nextSourceFrameOffset)?{motionEndFrame:rendered.metrics.nextSourceFrameOffset}:{}),
    ...(rendered?.videoOnly?{videoOnly:true}:{}),
    ...(rendered?.fragmentedVideo?{fragmentedVideo:true}:{}),
    ...(rendered?.segment?{segment:rendered.segment}:{})
  };
}
