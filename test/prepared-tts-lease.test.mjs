import test from "node:test";
import assert from "node:assert/strict";
import { PreparedTtsLease } from "../src/prepared-tts-lease.mjs";

function harness(){
  let sequence=0;
  const published=[],discarded=[],timers=[];
  const lease=new PreparedTtsLease({
    prepare:()=>`tts-${++sequence}`,
    publish:(id,issued)=>published.push({id,issued}),
    discard:id=>discarded.push(id),
    refreshMs:8_000,
    schedule:(callback,delay)=>{const timer={callback,delay,cancelled:false,unref(){}};timers.push(timer);return timer;},
    cancelSchedule:timer=>{timer.cancelled=true;}
  });
  return{lease,published,discarded,timers};
}

test("长等待期间轮换预热任务，并只保留最新任务",()=>{
  const state=harness();
  assert.equal(state.lease.start(),"tts-1");
  assert.deepEqual(state.published,[{id:"tts-1",issued:1}]);
  assert.equal(state.timers[0].delay,8_000);

  state.timers[0].callback();
  assert.deepEqual(state.published,[{id:"tts-1",issued:1},{id:"tts-2",issued:2}]);
  assert.deepEqual(state.discarded,["tts-1"]);
});

test("首句出现后冻结最新任务，不再轮换或提前释放",()=>{
  const state=harness();
  state.lease.start();
  const staleCallback=state.timers[0].callback;
  assert.equal(state.lease.freeze(),"tts-1");
  assert.equal(state.timers[0].cancelled,true);
  staleCallback();
  assert.equal(state.published.length,1);
  assert.deepEqual(state.discarded,[]);

  state.lease.cancel();
  assert.deepEqual(state.discarded,["tts-1"]);
});

test("轮换创建失败时停止定时器并清理旧任务",()=>{
  const state=harness();
  state.lease.start();
  state.lease.prepare=()=>{throw new Error("offline");};
  assert.doesNotThrow(()=>state.timers[0].callback());
  assert.deepEqual(state.discarded,["tts-1"]);
  assert.equal(state.lease.currentId,"");
});
