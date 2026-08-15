import test from "node:test";
import assert from "node:assert/strict";
import { fetchWithConnectionHedge } from "../src/hedged-fetch.mjs";

function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}

test("fast upstream never starts a duplicate request",async()=>{
  const timers=[],calls=[];
  const result=await fetchWithConnectionHedge("https://upstream.test",{method:"POST"},{
    delayMs:2500,
    fetchImpl:async(_url,init)=>{calls.push(init.signal);return{status:200};},
    schedule:(callback,delay)=>{const timer={callback,delay,unref(){}};timers.push(timer);return timer;},
    cancelSchedule:timer=>{timer.cancelled=true;}
  });
  assert.equal(result.winner,"primary");assert.equal(result.hedged,false);
  assert.equal(calls.length,1);assert.equal(timers[0].delay,2500);assert.equal(timers[0].cancelled,true);
});

test("slow connection starts one hedge and aborts the loser",async()=>{
  const primary=deferred(),timers=[],signals=[];let calls=0;
  const pending=fetchWithConnectionHedge("https://upstream.test",{method:"POST"},{
    delayMs:2500,
    fetchImpl:(_url,init)=>{signals.push(init.signal);return ++calls===1?primary.promise:Promise.resolve({status:200});},
    schedule:(callback,delay)=>{const timer={callback,delay,unref(){}};timers.push(timer);return timer;},
    cancelSchedule:()=>{}
  });
  timers[0].callback();
  const result=await pending;
  assert.equal(result.winner,"hedge");assert.equal(result.hedged,true);assert.equal(calls,2);
  assert.equal(signals[0].aborted,true);assert.equal(signals[1].aborted,false);
});

test("hedging can be disabled without wrapping the request",async()=>{
  let calls=0;
  const response={status:204};
  const result=await fetchWithConnectionHedge("https://upstream.test",{}, {delayMs:0,fetchImpl:async()=>{calls++;return response;}});
  assert.deepEqual(result,{response,winner:"primary",hedged:false});assert.equal(calls,1);
});

test("client cancellation aborts both possible requests without waiting for the hedge",async()=>{
  const controller=new AbortController(),signals=[],timers=[];
  const pending=fetchWithConnectionHedge("https://upstream.test",{signal:controller.signal},{
    delayMs:2500,
    fetchImpl:(_url,init)=>new Promise((_resolve,reject)=>{signals.push(init.signal);init.signal.addEventListener("abort",()=>reject(init.signal.reason),{once:true});}),
    schedule:(callback,delay)=>{const timer={callback,delay,unref(){}};timers.push(timer);return timer;},
    cancelSchedule:timer=>{timer.cancelled=true;}
  });
  controller.abort(new DOMException("cancelled","AbortError"));
  await assert.rejects(pending,error=>error.name==="AbortError");
  assert.equal(signals.length,1);assert.equal(signals[0].aborted,true);assert.equal(timers[0].cancelled,true);
});
