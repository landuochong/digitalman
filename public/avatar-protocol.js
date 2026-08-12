export function buildWav2LipPlaybackMessage(rendered, requestId, { enqueue=false }={}) {
  return {
    type:enqueue?"wav2lip-enqueue":"wav2lip-play",
    url:rendered?.url,
    requestId,
    ...(rendered?.segment?{segment:rendered.segment}:{})
  };
}
