const MAX_TIMING_MS=180_000;
const numericFields=[
  "requestToEventMs","speechEndpointMs","vadStopToSubmitMs","vadStopToEventMs","recognitionTurnMs","recognitionCommitToRequestMs",
  "chatFirstSentenceMs","avatarFirstSegmentMs","ttsFirstAudioMs","ttsRequestSetupMs","ttsConnectionMs","ttsTaskMs","ttsSynthesisMs","avatarPipelineMs",
  "avatarTransportMs","avatarPcmBufferingMs","avatarRenderMs","videoFirstFrameMs","videoHandoffLateMs","backchannelCompletedMs"
];
const eventKinds=new Set(["first-speech","formal-speech","playback-ended"]);
const speechKinds=new Set(["backchannel","long-wait","formal"]);
const avatarModes=new Set(["real","anime"]);
const recognitionTriggers=new Set(["final-result","vad-final","vad-timeout","recognition-end","local-asr","text"]);

function boundedNumber(value){
  if(value===""||value===null||value===undefined)return undefined;
  const number=Number(value);if(!Number.isFinite(number))return undefined;
  return Math.min(MAX_TIMING_MS,Math.max(0,Math.round(number)));
}

export function sanitizeClientTiming(value={}){
  const event=eventKinds.has(value.event)?value.event:null;
  if(!event)throw Object.assign(new Error("未知的浏览器计时事件"),{status:400});
  const result={event};
  if(speechKinds.has(value.speechKind))result.speechKind=value.speechKind;
  if(avatarModes.has(value.avatarMode))result.avatarMode=value.avatarMode;
  if(recognitionTriggers.has(value.recognitionTrigger))result.recognitionTrigger=value.recognitionTrigger;
  for(const field of numericFields){const number=boundedNumber(value[field]);if(number!==undefined)result[field]=number;}
  return result;
}
