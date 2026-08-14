import test from "node:test";
import assert from "node:assert/strict";
import { BackchannelGate,BackchannelPlayback,backchannelContinuationMs,remainingAfterSpokenBackchannel } from "../public/backchannel-gate.js";

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

test("cancels a committed backchannel while it is still unheard",()=>{
  const playback=new BackchannelPlayback("我在。"),events=[];
  const unregister=playback.onCancel(()=>events.push("cancel"));
  assert.equal(playback.cancelBeforeStart(),true);
  playback.start();playback.complete();
  assert.equal(playback.claim("我在。",{onStart:()=>events.push("late")}),false);
  assert.deepEqual(events,["cancel"]);unregister();
});

test("never cuts a backchannel that has actually started",()=>{
  const playback=new BackchannelPlayback("我想想。"),events=[];
  playback.onCancel(()=>events.push("cancel"));playback.start();
  assert.equal(playback.cancelBeforeStart(),false);playback.complete();
  assert.equal(playback.completed,true);assert.deepEqual(events,[]);
});

test("allows a speculative preparation to detach its cancellation listener",()=>{
  const playback=new BackchannelPlayback("嗯。"),events=[];
  const unregister=playback.onCancel(()=>events.push("cancel"));unregister();
  assert.equal(playback.cancelBeforeStart(),true);assert.deepEqual(events,[]);
});

test("removes only an already spoken backchannel prefix from a formal reply",()=>{
  assert.equal(remainingAfterSpokenBackchannel("听着呢。","听着呢，什么事？"),"什么事？");
  assert.equal(remainingAfterSpokenBackchannel("我想想。","我想想，这件事可以分两步。"),"这件事可以分两步。");
  assert.equal(remainingAfterSpokenBackchannel("谢谢你。","谢谢你的心意，真的很惊喜。"),"你的心意，真的很惊喜。");
  assert.equal(remainingAfterSpokenBackchannel("谢谢你。","谢谢你呀，被惦记的感觉真好。"),"被惦记的感觉真好。");
  assert.equal(remainingAfterSpokenBackchannel("我在。","我在认真听。"),null);
});

test("does not trim different wording or a longer backchannel",()=>{
  assert.equal(remainingAfterSpokenBackchannel("嗯。","听着呢，什么事？"),null);
  assert.equal(remainingAfterSpokenBackchannel("听着呢。","听着。"),null);
  assert.equal(remainingAfterSpokenBackchannel("听着呢。","听着呢。"),null);
});

test("advances the action by measured backchannel audio instead of gesture hold time",()=>{
  assert.equal(backchannelContinuationMs({expectedAudioMs:690,receivedAudioMs:400}),690);
  assert.equal(backchannelContinuationMs({expectedAudioMs:690,receivedAudioMs:690}),690);
  assert.equal(backchannelContinuationMs({}),400);
});
