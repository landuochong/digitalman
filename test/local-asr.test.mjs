import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { localAsrEndpoint, normalizeAsrBaseUrl, transcribeLocalAudio } from "../src/local-asr.mjs";
import { encodePcm16Wav, resampleMono } from "../public/local-asr-recorder.js";

test("builds the local gateway ASR endpoint",()=>{
  assert.equal(normalizeAsrBaseUrl("http://127.0.0.1:8010/"),"http://127.0.0.1:8010");
  assert.equal(localAsrEndpoint("http://127.0.0.1:8010","api/asr/transcribe"),"http://127.0.0.1:8010/api/asr/transcribe");
});

test("proxies a WAV utterance as multipart without exposing gateway details",async()=>{
  let request;
  const result=await transcribeLocalAudio(Buffer.from("RIFF-test"),{fetchImpl:async(url,options)=>{
    request={url,options};
    return new Response(JSON.stringify({text:"你好呀",provider:"xiaozhi_sherpa",duration_ms:86}),{status:200,headers:{"content-type":"application/json"}});
  }});
  assert.equal(request.url,"http://127.0.0.1:8010/api/asr/transcribe");
  assert.equal(request.options.method,"POST");
  assert.equal(request.options.body.get("language"),"zh-CN");
  assert.equal(result.text,"你好呀");
  assert.equal(result.durationMs,86);
});

test("encodes resampled mono audio as a 16 kHz PCM WAV",async()=>{
  const samples=resampleMono([new Float32Array([0,.5,-.5,1])],32_000,16_000);
  assert.equal(samples.length,2);
  const bytes=Buffer.from(await encodePcm16Wav(samples).arrayBuffer());
  assert.equal(bytes.subarray(0,4).toString(),"RIFF");
  assert.equal(bytes.readUInt32LE(24),16_000);
  assert.equal(bytes.readUInt16LE(22),1);
  assert.equal(bytes.readUInt16LE(34),16);
});

test("the page prefers local ASR but retains browser fallback",async()=>{
  const source=await readFile(new URL("../public/app.js",import.meta.url),"utf8");
  assert.match(source,/fetch\("\/api\/asr\/status"\)/);
  assert.match(source,/new LocalAsrRecorder/);
  assert.match(source,/fetch\("\/api\/asr\/transcribe"/);
  assert.match(source,/restoreBrowserFallback/);
  assert.match(source,/if\(speechStartedAt\)\{detector\.hasSpeech=true;detector\.startedAt=Math\.min\(detector\.startedAt,speechStartedAt\)/);
});

test("the ASR status keeps the configured provider distinct from its upstream",async()=>{
  const source=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(source,/provider:asrProvider,upstreamProvider:health\.provider,ready:health\.ready/);
});
