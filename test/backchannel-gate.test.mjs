import test from "node:test";
import assert from "node:assert/strict";
import { BackchannelGate,BackchannelPlayback } from "../public/backchannel-gate.js";

function fakeClock(){let task=null;return{set(fn){task=fn;return 1;},clear(){task=null;},fire(){const fn=task;task=null;fn?.();}};}

test("cancels a backchannel when the real sentence wins the grace window",()=>{
  const clock=fakeClock(),spoken=[];
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  globalThis.setTimeout=fn=>clock.set(fn);globalThis.clearTimeout=()=>clock.clear();
  try{const gate=new BackchannelGate({delayMs:500,onSpeak:value=>spoken.push(value)});gate.offer("嗯");gate.cancel();clock.fire();assert.deepEqual(spoken,[]);}
  finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test("speaks once when the model remains slow",()=>{
  const clock=fakeClock(),spoken=[];
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  globalThis.setTimeout=fn=>clock.set(fn);globalThis.clearTimeout=()=>clock.clear();
  try{const gate=new BackchannelGate({delayMs:500,onSpeak:value=>spoken.push(value)});gate.offer("我在");clock.fire();clock.fire();assert.deepEqual(spoken,["我在"]);}
  finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test("prepares immediately, reuses prepared work, and cancels unused work",()=>{
  const clock=fakeClock(),events=[];
  const originalSet=globalThis.setTimeout,originalClear=globalThis.clearTimeout;
  globalThis.setTimeout=fn=>clock.set(fn);globalThis.clearTimeout=()=>clock.clear();
  try{
    const gate=new BackchannelGate({
      delayMs:500,
      onPrepare:value=>{events.push(["prepare",value]);return{ready:true};},
      onSpeak:(value,prepared)=>events.push(["speak",value,prepared]),
      onCancel:(value,prepared)=>events.push(["cancel",value,prepared])
    });
    gate.offer("我在");assert.deepEqual(events,[["prepare","我在"]]);
    clock.fire();assert.deepEqual(events.at(-1),["speak","我在",{ready:true}]);
    gate.offer("慢慢说");gate.cancel();assert.deepEqual(events.at(-1),["cancel","慢慢说",{ready:true}]);
  }finally{globalThis.setTimeout=originalSet;globalThis.clearTimeout=originalClear;}
});

test("claims an identical backchannel with its real playback lifecycle",()=>{
  const playback=new BackchannelPlayback("我想想。"),events=[];
  assert.equal(playback.claim("我想想",{onStart:()=>events.push("start"),onComplete:()=>events.push("complete")}),true);
  playback.start();playback.complete();assert.deepEqual(events,["start","complete"]);
});

test("can claim an already completed backchannel but not different text",()=>{
  const playback=new BackchannelPlayback("我在。"),events=[];playback.start();playback.complete();
  assert.equal(playback.claim("我在",{onStart:()=>events.push("start"),onComplete:()=>events.push("complete")}),true);
  assert.deepEqual(events,["start","complete"]);
  assert.equal(playback.claim("我在",{onStart:()=>events.push("duplicate")}),false);
  assert.equal(playback.claim("慢慢说",{onStart:()=>events.push("wrong")}),false);
});

test("cannot claim a stale backchannel after a different formal sentence",()=>{
  const playback=new BackchannelPlayback("我在。"),events=[];
  assert.equal(playback.claim("先休息一下。"),false);playback.close();playback.start();playback.complete();
  assert.equal(playback.claim("我在。",{onStart:()=>events.push("late")}),false);assert.deepEqual(events,[]);
});
