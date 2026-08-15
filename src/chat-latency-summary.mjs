const TARGET_MS=3000;

function finite(values){return values.map(Number).filter(value=>Number.isFinite(value)&&value>=0&&value<=180_000).sort((a,b)=>a-b);}
function percentile(sorted,ratio){if(!sorted.length)return null;return Math.round(sorted[Math.max(0,Math.ceil(sorted.length*ratio)-1)]);}
export function summarizeMetric(values,{targetMs=TARGET_MS}={}){
  const sorted=finite(values);if(!sorted.length)return{samples:0,p50Ms:null,p90Ms:null,maxMs:null,withinTargetRate:null};
  return{samples:sorted.length,p50Ms:percentile(sorted,.5),p90Ms:percentile(sorted,.9),maxMs:Math.round(sorted.at(-1)),withinTargetRate:Number((sorted.filter(value=>value<=targetMs).length/sorted.length).toFixed(3))};
}

function eventOf(trace,name){return trace?.clientTimings?.find(item=>item.event===name);}
function latestNumber(trace,field){
  const values=(trace?.clientTimings||[]).map(item=>item[field]).filter(value=>value!==null&&value!==undefined&&value!=="").map(Number).filter(Number.isFinite);
  return values.length?values.at(-1):undefined;
}

const sampleFields=["speechEndpointMs","contextMs","upstreamHeadersMs","upstreamConnectionMs","serverFirstSentenceMs","textGenerationMs","firstSpeechMs","formalSpeechMs","backchannelToFormalMs","vadToFirstSpeechMs","ttsFirstAudioMs","ttsRequestSetupMs","ttsConnectionMs","ttsTaskMs","ttsSynthesisMs","speechPipelineFirstSegmentMs","avatarTransportMs","avatarPcmBufferingMs","avatarRenderMs","videoFirstFrameMs","videoHandoffLateMs"];
const speechKinds=new Set(["backchannel","long-wait","formal"]);
function sampleNumber(value){if(value===null||value===undefined||value==="")return undefined;const number=Number(value);return Number.isFinite(number)&&number>=0&&number<=180_000?Math.round(number):undefined;}

export function normalizeLatencySample(value={}){
  const sample={};
  for(const field of sampleFields){const number=sampleNumber(value[field]);if(number!==undefined)sample[field]=number;}
  if(sample.upstreamConnectionMs===undefined&&sample.contextMs!==undefined&&sample.upstreamHeadersMs!==undefined&&sample.upstreamHeadersMs>=sample.contextMs)sample.upstreamConnectionMs=sample.upstreamHeadersMs-sample.contextMs;
  if(sample.textGenerationMs===undefined&&sample.upstreamHeadersMs!==undefined&&sample.serverFirstSentenceMs!==undefined&&sample.serverFirstSentenceMs>=sample.upstreamHeadersMs)sample.textGenerationMs=sample.serverFirstSentenceMs-sample.upstreamHeadersMs;
  if(speechKinds.has(value.firstSpeechKind))sample.firstSpeechKind=value.firstSpeechKind;
  return Object.keys(sample).length?sample:null;
}

export function traceToLatencySample(trace={}){
  const formal=eventOf(trace,"formal-speech"),first=eventOf(trace,"first-speech")||(formal?.speechKind==="formal"?formal:undefined);
  const backchannelCompletedMs=sampleNumber(formal?.backchannelCompletedMs),formalSpeechMs=sampleNumber(formal?.requestToEventMs);
  const backchannelToFormalMs=first?.speechKind!=="formal"&&backchannelCompletedMs!==undefined&&formalSpeechMs!==undefined&&formalSpeechMs>=backchannelCompletedMs?formalSpeechMs-backchannelCompletedMs:undefined;
  return normalizeLatencySample({
    speechEndpointMs:latestNumber(trace,"speechEndpointMs"),contextMs:trace?.timings?.contextMs,upstreamHeadersMs:trace?.timings?.upstreamConnectedMs,serverFirstSentenceMs:trace?.timings?.firstSentenceMs,
    firstSpeechMs:first?.requestToEventMs,formalSpeechMs,backchannelToFormalMs,vadToFirstSpeechMs:first?.vadStopToEventMs,firstSpeechKind:first?.speechKind,
    ttsFirstAudioMs:latestNumber(trace,"ttsFirstAudioMs"),ttsRequestSetupMs:latestNumber(trace,"ttsRequestSetupMs"),ttsConnectionMs:latestNumber(trace,"ttsConnectionMs"),ttsTaskMs:latestNumber(trace,"ttsTaskMs"),ttsSynthesisMs:latestNumber(trace,"ttsSynthesisMs"),speechPipelineFirstSegmentMs:latestNumber(trace,"avatarPipelineMs"),avatarTransportMs:latestNumber(trace,"avatarTransportMs"),avatarPcmBufferingMs:latestNumber(trace,"avatarPcmBufferingMs"),avatarRenderMs:latestNumber(trace,"avatarRenderMs"),
    videoFirstFrameMs:latestNumber(trace,"videoFirstFrameMs"),videoHandoffLateMs:latestNumber(trace,"videoHandoffLateMs")
  });
}

export function summarizeLatencySamples(samples=[]){
  const rows=(Array.isArray(samples)?samples:[]).map(normalizeLatencySample).filter(Boolean);
  const speechEndpoint=rows.map(row=>row.speechEndpointMs);
  const context=rows.map(row=>row.contextMs);
  const serverFirstSentence=rows.map(row=>row.serverFirstSentenceMs);
  const upstreamHeaders=rows.map(row=>row.upstreamHeadersMs);
  const upstreamConnection=rows.map(row=>row.upstreamConnectionMs);
  const textGeneration=rows.map(row=>row.textGenerationMs);
  const firstSpeech=rows.map(row=>row.firstSpeechMs);
  const formalSpeech=rows.map(row=>row.formalSpeechMs);
  const backchannelToFormal=rows.map(row=>row.backchannelToFormalMs);
  const vadToFirstSpeech=rows.map(row=>row.vadToFirstSpeechMs);
  const ttsFirstAudio=rows.map(row=>row.ttsFirstAudioMs);
  const ttsRequestSetup=rows.map(row=>row.ttsRequestSetupMs);
  const ttsConnection=rows.map(row=>row.ttsConnectionMs);
  const ttsTask=rows.map(row=>row.ttsTaskMs);
  const ttsSynthesis=rows.map(row=>row.ttsSynthesisMs);
  const avatarFirstSegment=rows.map(row=>row.speechPipelineFirstSegmentMs);
  const avatarTransport=rows.map(row=>row.avatarTransportMs);
  const avatarPcmBuffering=rows.map(row=>row.avatarPcmBufferingMs);
  const avatarRender=rows.map(row=>row.avatarRenderMs);
  const videoFirstFrame=rows.map(row=>row.videoFirstFrameMs);
  const videoHandoffLate=rows.map(row=>row.videoHandoffLateMs);
  const metrics={
    speechEndpoint:summarizeMetric(speechEndpoint),context:summarizeMetric(context),upstreamHeaders:summarizeMetric(upstreamHeaders),upstreamConnection:summarizeMetric(upstreamConnection),serverFirstSentence:summarizeMetric(serverFirstSentence),textGeneration:summarizeMetric(textGeneration),
    firstSpeech:summarizeMetric(firstSpeech),formalSpeech:summarizeMetric(formalSpeech),backchannelToFormal:summarizeMetric(backchannelToFormal),vadToFirstSpeech:summarizeMetric(vadToFirstSpeech),
    ttsFirstAudio:summarizeMetric(ttsFirstAudio),ttsRequestSetup:summarizeMetric(ttsRequestSetup),ttsConnection:summarizeMetric(ttsConnection),ttsTask:summarizeMetric(ttsTask),ttsSynthesis:summarizeMetric(ttsSynthesis),speechPipelineFirstSegment:summarizeMetric(avatarFirstSegment),avatarTransport:summarizeMetric(avatarTransport),avatarPcmBuffering:summarizeMetric(avatarPcmBuffering),avatarRender:summarizeMetric(avatarRender),
    videoFirstFrame:summarizeMetric(videoFirstFrame,{targetMs:80}),videoHandoffLate:summarizeMetric(videoHandoffLate,{targetMs:80})
  };
  const firstSpeechKinds={};
  for(const row of rows){const kind=row.firstSpeechKind;if(kind)firstSpeechKinds[kind]=(firstSpeechKinds[kind]||0)+1;}
  const candidates=[
    ["speech-endpoint",metrics.speechEndpoint],
    ["local-context",metrics.context],
    ["text-connection",metrics.upstreamConnection],
    ["text-generation",metrics.textGeneration],
    ["tts-request-setup",metrics.ttsRequestSetup],
    ["tts-connection",metrics.ttsConnection],
    ["tts-task",metrics.ttsTask],
    ["tts-synthesis",metrics.ttsSynthesis],
    ["avatar-transport",metrics.avatarTransport],
    ["avatar-pcm-buffer",metrics.avatarPcmBuffering],
    ["avatar-render",metrics.avatarRender],
    ["browser-playback",metrics.videoHandoffLate]
  ].filter(([,metric])=>metric.samples>=3&&Number.isFinite(metric.p50Ms)).map(([stage,metric])=>[stage,metric.p50Ms]);
  const dominant=candidates.sort((a,b)=>b[1]-a[1])[0]||["insufficient-data",null];
  return{
    generatedAt:new Date().toISOString(),sampleCount:rows.length,samplesWithFirstSpeech:rows.filter(row=>Number.isFinite(row.firstSpeechMs)).length,
    targetMs:TARGET_MS,minimumSamplesForConclusion:3,dominantStage:dominant[0],dominantStageP50Ms:dominant[1],firstSpeechKinds,metrics
  };
}

export function summarizeChatTraces(traces=[]){return summarizeLatencySamples((Array.isArray(traces)?traces:[]).map(traceToLatencySample).filter(Boolean));}
