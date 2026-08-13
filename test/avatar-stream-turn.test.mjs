import test from "node:test";
import assert from "node:assert/strict";
import { AvatarStreamTurn } from "../public/avatar-stream-turn.js";

function deferred(){let resolve;const promise=new Promise(done=>{resolve=done;});return{promise,resolve};}

test("queues later sentences before earlier playback completes and ends once",async()=>{
  const firstPlayback=deferred(),secondPlayback=deferred(),events=[];
  const turn=new AvatarStreamTurn({onEnd:data=>events.push(["end",data])});
  turn.enqueue(async current=>{
    events.push("sentence-1");
    current.trackSegment(firstPlayback.promise,800,120);
  });
  turn.enqueue(async current=>{
    events.push("sentence-2");
    current.trackSegment(secondPlayback.promise,600,240);
  });
  const finished=turn.finish();
  await turn.enqueueQueue;
  assert.deepEqual(events,["sentence-1","sentence-2",["end",{audioMs:1400,lingerMs:240,segments:2}]]);
  let settled=false;finished.then(()=>{settled=true;});await Promise.resolve();
  assert.equal(settled,false);
  firstPlayback.resolve();secondPlayback.resolve();await finished;
  assert.equal(settled,true);
  assert.equal(turn.finish(),finished);
});

test("does not end or run queued work for a cancelled turn",async()=>{
  let current=true,ran=false,ended=false;
  const turn=new AvatarStreamTurn({isCurrent:()=>current,onEnd:()=>{ended=true;}});
  current=false;
  turn.enqueue(async()=>{ran=true;});
  await turn.finish();
  assert.equal(ran,false);assert.equal(ended,false);
});

test("offers a playback barrier before a silent full-body action",async()=>{
  const playback=deferred(),turn=new AvatarStreamTurn();
  turn.trackSegment(playback.promise,800);
  let passed=false;const barrier=turn.waitForPlayback().then(()=>{passed=true;});
  await Promise.resolve();assert.equal(passed,false);
  playback.resolve();await barrier;assert.equal(passed,true);
});

test("allocates stable ordered visual sentence identifiers",()=>{
  const turn=new AvatarStreamTurn(),first=turn.allocateSentence(),second=turn.allocateSentence();
  assert.match(first.visualTurnId,/^[0-9a-f-]{36}$/);assert.equal(second.visualTurnId,first.visualTurnId);
  assert.deepEqual([first.visualSentenceIndex,second.visualSentenceIndex],[0,1]);
});
