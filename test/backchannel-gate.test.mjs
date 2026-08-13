import test from "node:test";
import assert from "node:assert/strict";
import { BackchannelGate } from "../public/backchannel-gate.js";

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
