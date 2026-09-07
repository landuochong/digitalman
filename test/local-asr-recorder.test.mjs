import test from "node:test";
import assert from "node:assert/strict";
import { LocalAsrRecorder } from "../public/local-asr-recorder.js";

function fakeContext(sampleRate=16_000){
  const processor={connect(){},disconnect(){},onaudioprocess:null};
  return{
    sampleRate,destination:{},processor,
    createMediaStreamSource:()=>({connect(){},disconnect(){}}),
    createScriptProcessor:()=>processor,
    createGain:()=>({gain:{value:1},connect(){},disconnect(){}}),
  };
}

function feed(processor,length,value){
  processor.onaudioprocess({inputBuffer:{getChannelData:()=>new Float32Array(length).fill(value)}});
}

test("barge-in recording includes bounded audio captured before start",async()=>{
  const context=fakeContext(),recorder=new LocalAsrRecorder(context,{}, {preRollMs:1000});
  feed(context.processor,3200,.1);feed(context.processor,3200,.2);feed(context.processor,3200,.3);
  recorder.start({preRollMs:350});feed(context.processor,1600,.4);
  const result=recorder.stop();
  assert.equal(result.durationMs,500);
  assert.equal((await result.blob.arrayBuffer()).byteLength,44+8000*2);
});

test("ordinary recording does not inherit idle pre-roll",()=>{
  const context=fakeContext(),recorder=new LocalAsrRecorder(context,{});
  feed(context.processor,3200,.1);recorder.start();feed(context.processor,1600,.2);
  assert.equal(recorder.stop().durationMs,100);
});
