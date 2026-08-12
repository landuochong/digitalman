import test from "node:test";
import assert from "node:assert/strict";
import { RecognitionTurnGate,recognitionSilenceMs } from "../public/recognition-turn-gate.js";

function harness(){
  let now=1_000,nextId=1;
  const timers=new Map(),commits=[];
  const gate=new RecognitionTurnGate({
    now:()=>now,
    setTimer:(callback,delay)=>{const id=nextId++;timers.set(id,{callback,at:now+delay});return id;},
    clearTimer:id=>timers.delete(id),
    onCommit:(text,metrics)=>commits.push({text,...metrics})
  });
  const advance=milliseconds=>{
    now+=milliseconds;
    for(const [id,timer] of [...timers])if(timer.at<=now){timers.delete(id);timer.callback();}
  };
  return {gate,commits,advance,pending:()=>timers.size};
}

test("commits a final recognition correction immediately after VAD stop",()=>{
  const {gate,commits,advance,pending}=harness();
  gate.update("我想吃");
  assert.equal(gate.requestStop(),true);
  advance(24);
  gate.update("我想吃火锅",{final:true});
  gate.end();advance(200);
  assert.deepEqual(commits,[{text:"我想吃火锅",trigger:"final-result",turnMs:24,stopToCommitMs:24}]);
  assert.equal(pending(),0);
});

test("uses a shorter silence window only for a browser-final transcript",()=>{
  assert.equal(recognitionSilenceMs(false),650);
  assert.equal(recognitionSilenceMs(true),450);
});

test("submits an already-final transcript at the VAD boundary without another timer",()=>{
  const {gate,commits,pending}=harness();
  gate.update("这句已经确认",{final:true});
  assert.equal(gate.requestStop({final:true}),true);
  assert.deepEqual(commits,[{text:"这句已经确认",trigger:"vad-final",turnMs:0,stopToCommitMs:0}]);
  assert.equal(pending(),0);
});

test("bounds a delayed recognition end to a 90 ms finalization window",()=>{
  const {gate,commits,advance}=harness();
  gate.update("今天有点累");gate.requestStop();
  advance(89);assert.equal(commits.length,0);
  advance(1);assert.deepEqual(commits,[{text:"今天有点累",trigger:"vad-timeout",turnMs:90,stopToCommitMs:90}]);
  gate.end();assert.equal(commits.length,1);
});

test("uses an early recognition end and never submits a failed turn",()=>{
  const first=harness();first.gate.update("你好");first.gate.requestStop();first.advance(12);
  assert.equal(first.gate.end(),true);first.advance(200);
  assert.deepEqual(first.commits,[{text:"你好",trigger:"recognition-end",turnMs:12,stopToCommitMs:12}]);

  const failed=harness();failed.gate.update("错误片段");failed.gate.requestStop();failed.gate.fail();failed.advance(200);
  assert.equal(failed.gate.end(),false);assert.deepEqual(failed.commits,[]);
});
