import test from "node:test";
import assert from "node:assert/strict";
import { RecognitionTurnGate,isIncidentalFillerTranscript,recognitionResumeDelayMs,recognitionSilenceMs } from "../public/recognition-turn-gate.js";

test("ignores bare ASR hesitation fillers while keeping substantive speech",()=>{
  for(const text of ["嗯","嗯嗯。","呃","啊！","哦",".","。","！？","I.","a","uh","Um."])assert.equal(isIncidentalFillerTranscript(text),true);
  for(const text of ["嗯，我知道了","啊这个可以","哦好的","你好"])assert.equal(isIncidentalFillerTranscript(text),false);
});

test("does not commit a hallucinated filler turn",()=>{
  const commits=[];
  const gate=new RecognitionTurnGate({onCommit:(text,metrics)=>commits.push({text,...metrics}),now:()=>100});
  assert.equal(gate.update("嗯",{final:true}),false);
  assert.equal(gate.end(),false);
  assert.deepEqual(commits,[]);
});

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

test("carries the measured last-speech silence without counting the whole turn",()=>{
  const {gate,commits,advance}=harness();
  gate.update("今天有点累");
  assert.equal(gate.requestStop({endpointSilenceMs:520}),true);
  advance(24);gate.update("今天有点累。",{final:true,endpointSilenceMs:544});
  assert.deepEqual(commits,[{text:"今天有点累。",trigger:"final-result",turnMs:24,stopToCommitMs:24,endpointSilenceMs:544}]);
});

test("treats a non-continuous Web Speech final result as the utterance boundary",()=>{
  const {gate,commits,pending}=harness();
  gate.update("我想吃");
  assert.equal(gate.update("我想吃火锅",{final:true}),true);
  assert.deepEqual(commits,[{text:"我想吃火锅",trigger:"final-result",turnMs:0,stopToCommitMs:0}]);
  assert.equal(pending(),0);
  assert.equal(gate.requestStop({final:true}),false);
});

test("uses adaptive silence without cutting off very short utterances",()=>{
  assert.equal(recognitionSilenceMs({text:"嗯"}),650);
  assert.equal(recognitionSilenceMs({text:"我想一下"}),560);
  assert.equal(recognitionSilenceMs({text:"关于这个问题我觉得"}),700);
  assert.equal(recognitionSilenceMs({text:"我们出去玩但是"}),700);
  assert.equal(recognitionSilenceMs({text:"今天下班以后我们一起出去走一走吧"}),500);
  assert.equal(recognitionSilenceMs({text:"这样可以吗？"}),420);
  assert.equal(recognitionSilenceMs({final:true,text:"嗯"}),430);
  assert.equal(recognitionSilenceMs({final:true,text:"这样就可以了"}),340);
});

test("resumes listening sooner only after a precise shared PCM tail",()=>{
  assert.equal(recognitionResumeDelayMs({preciseAudioTail:true}),80);
  assert.equal(recognitionResumeDelayMs({preciseAudioTail:true,outputLatencyMs:75}),115);
  assert.equal(recognitionResumeDelayMs({preciseAudioTail:true,outputLatencyMs:300}),180);
  assert.equal(recognitionResumeDelayMs({preciseAudioTail:false}),180);
  assert.equal(recognitionResumeDelayMs(),180);
});

test("can still accept an explicit final VAD boundary from another caller",()=>{
  const {gate,commits,pending}=harness();
  gate.update("这句已经确认");
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
