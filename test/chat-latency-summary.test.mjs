import test from "node:test";
import assert from "node:assert/strict";
import { summarizeChatTraces, summarizeLatencySamples, summarizeMetric, traceToLatencySample } from "../src/chat-latency-summary.mjs";

test("summarizes bounded percentiles and target rate",()=>{
  assert.deepEqual(summarizeMetric([1000,2000,4000,9000,NaN,-1]),{samples:4,p50Ms:2000,p90Ms:9000,maxMs:9000,withinTargetRate:.5});
  assert.deepEqual(summarizeMetric([]),{samples:0,p50Ms:null,p90Ms:null,maxMs:null,withinTargetRate:null});
});

test("joins server and browser timing without exposing trace content",()=>{
  const traces=[
    {input:{message:"private"},timings:{contextMs:100,upstreamConnectedMs:900,firstSentenceMs:1500},clientTimings:[
      {event:"first-speech",speechKind:"backchannel",requestToEventMs:760,speechEndpointMs:350,vadStopToEventMs:1110},
      {event:"formal-speech",speechKind:"formal",requestToEventMs:2210,backchannelCompletedMs:1410},
      {event:"playback-ended",ttsFirstAudioMs:320,avatarPipelineMs:610,avatarRenderMs:180,videoFirstFrameMs:42,videoHandoffLateMs:8}
    ]},
    {input:{message:"also private"},timings:{contextMs:100,upstreamConnectedMs:3100,firstSentenceMs:4300},clientTimings:[
      {event:"first-speech",speechKind:"long-wait",requestToEventMs:3710,speechEndpointMs:340,vadStopToEventMs:4050,ttsFirstAudioMs:410,avatarPipelineMs:720,avatarRenderMs:240,videoHandoffLateMs:14}
    ]},
    {input:{message:"third private"},timings:{contextMs:100,upstreamConnectedMs:1200,firstSentenceMs:1800},clientTimings:[
      {event:"first-speech",speechKind:"formal",requestToEventMs:2700,speechEndpointMs:300,vadStopToEventMs:3000,ttsFirstAudioMs:350,avatarPipelineMs:650,avatarRenderMs:210,videoHandoffLateMs:10},
      {event:"formal-speech",speechKind:"formal",requestToEventMs:2700,backchannelCompletedMs:2000}
    ]}
  ];
  const summary=summarizeChatTraces(traces);
  assert.equal(summary.sampleCount,3);assert.equal(summary.samplesWithFirstSpeech,3);
  assert.deepEqual(summary.firstSpeechKinds,{backchannel:1,"long-wait":1,formal:1});
  assert.equal(summary.metrics.firstSpeech.withinTargetRate,.667);
  assert.equal(summary.metrics.formalSpeech.samples,2);
  assert.equal(summary.metrics.speechEndpoint.p50Ms,340);
  assert.equal(summary.metrics.context.p50Ms,100);
  assert.equal(summary.metrics.upstreamConnection.p50Ms,1100);
  assert.equal(summary.metrics.textGeneration.p50Ms,600);
  assert.deepEqual(summary.metrics.backchannelToFormal,{samples:1,p50Ms:800,p90Ms:800,maxMs:800,withinTargetRate:1});
  assert.equal(summary.dominantStage,"text-connection");assert.equal(summary.dominantStageP50Ms,1100);
  assert.doesNotMatch(JSON.stringify(summary),/private/);
});

test("converts a trace into an anonymous value-only sample",()=>{
  const sample=traceToLatencySample({finishedAt:"2026-08-14T00:00:00Z",input:{message:"private",userId:"secret"},timings:{firstSentenceMs:1200},clientTimings:[{event:"first-speech",speechKind:"formal",requestToEventMs:1900}]});
  assert.deepEqual(sample,{serverFirstSentenceMs:1200,firstSpeechMs:1900,firstSpeechKind:"formal"});
  assert.doesNotMatch(JSON.stringify(summarizeLatencySamples([sample])),/private|secret/);
  assert.deepEqual(traceToLatencySample({clientTimings:[{event:"first-speech",requestToEventMs:700}]}),{firstSpeechMs:700});
});

test("uses a direct formal-speech event as first speech when its companion event arrives late",()=>{
  const sample=traceToLatencySample({timings:{firstSentenceMs:800},clientTimings:[
    {event:"formal-speech",speechKind:"formal",requestToEventMs:1250,speechEndpointMs:350,vadStopToEventMs:1600,ttsFirstAudioMs:240,avatarRenderMs:180}
  ]});
  assert.deepEqual(sample,{speechEndpointMs:350,serverFirstSentenceMs:800,firstSpeechMs:1250,formalSpeechMs:1250,vadToFirstSpeechMs:1600,firstSpeechKind:"formal",ttsFirstAudioMs:240,avatarRenderMs:180});
});

test("uses pure first-segment render time instead of the TTS-inclusive pipeline",()=>{
  const traces=Array.from({length:3},()=>({timings:{firstSentenceMs:500},clientTimings:[{event:"first-speech",requestToEventMs:2500,ttsFirstAudioMs:300,avatarPipelineMs:1900,avatarRenderMs:1200,videoHandoffLateMs:20}]}));
  const summary=summarizeChatTraces(traces);
  assert.equal(summary.metrics.speechPipelineFirstSegment.p50Ms,1900);
  assert.equal(summary.metrics.avatarRender.p50Ms,1200);
  assert.equal(summary.dominantStage,"avatar-render");
});

test("reports insufficient data before normal conversations arrive",()=>{
  const summary=summarizeChatTraces([]);
  assert.equal(summary.dominantStage,"insufficient-data");assert.equal(summary.metrics.vadToFirstSpeech.samples,0);
  assert.equal(summarizeChatTraces([{timings:{firstSentenceMs:900}},{timings:{firstSentenceMs:1200}}]).dominantStage,"insufficient-data");
  assert.equal(summarizeLatencySamples([{firstSpeechMs:null}]).sampleCount,0);
});

test("can identify speech endpoint delay without counting user speaking time",()=>{
  const samples=Array.from({length:3},()=>({speechEndpointMs:1800,serverFirstSentenceMs:900,ttsFirstAudioMs:350,avatarRenderMs:180,firstSpeechMs:3230}));
  const summary=summarizeLatencySamples(samples);
  assert.equal(summary.dominantStage,"speech-endpoint");
  assert.equal(summary.dominantStageP50Ms,1800);
});

test("derives non-overlapping text stages from cumulative server clocks",()=>{
  const normalized=traceToLatencySample({timings:{contextMs:120,upstreamConnectedMs:820,firstSentenceMs:1420}});
  assert.deepEqual(normalized,{contextMs:120,upstreamHeadersMs:820,upstreamConnectionMs:700,serverFirstSentenceMs:1420,textGenerationMs:600});
  const summary=summarizeLatencySamples(Array.from({length:3},()=>normalized));
  assert.equal(summary.metrics.upstreamHeaders.p50Ms,820);
  assert.equal(summary.metrics.serverFirstSentence.p50Ms,1420);
  assert.equal(summary.dominantStage,"text-connection");
  assert.equal(summary.dominantStageP50Ms,700);
});

test("ranks non-overlapping TTS stages instead of its cumulative first-audio clock",()=>{
  const samples=Array.from({length:3},()=>({ttsFirstAudioMs:950,ttsRequestSetupMs:30,ttsConnectionMs:500,ttsTaskMs:120,ttsSynthesisMs:300,avatarRenderMs:180,firstSpeechMs:1500}));
  const summary=summarizeLatencySamples(samples);
  assert.equal(summary.metrics.ttsFirstAudio.p50Ms,950);
  assert.equal(summary.metrics.ttsConnection.p50Ms,500);
  assert.equal(summary.dominantStage,"tts-connection");
  assert.equal(summary.dominantStageP50Ms,500);
});

test("separates PCM accumulation from DINet rendering in the avatar pipeline",()=>{
  const samples=Array.from({length:3},()=>({speechPipelineFirstSegmentMs:1020,avatarTransportMs:20,avatarPcmBufferingMs:420,avatarRenderMs:180,ttsFirstAudioMs:400,firstSpeechMs:1100}));
  const summary=summarizeLatencySamples(samples);
  assert.equal(summary.metrics.speechPipelineFirstSegment.p50Ms,1020);
  assert.equal(summary.metrics.avatarPcmBuffering.p50Ms,420);
  assert.equal(summary.metrics.avatarRender.p50Ms,180);
  assert.equal(summary.dominantStage,"avatar-pcm-buffer");
  assert.equal(summary.dominantStageP50Ms,420);
});
