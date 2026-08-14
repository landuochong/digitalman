import test from "node:test";
import assert from "node:assert/strict";
import { ListeningGestureGate } from "../public/listening-gesture.js";

test("allows at most one listening gesture during one user turn",()=>{
  let timerId=0;const timers=new Map(),events=[];
  const gate=new ListeningGestureGate({delayMs:()=>1600,schedule:fn=>{const id=++timerId;timers.set(id,fn);return id;},cancelSchedule:id=>timers.delete(id)});
  assert.equal(gate.schedule({onTrigger:()=>events.push("nod")}),true);
  assert.equal(gate.schedule({onTrigger:()=>events.push("duplicate")}),false);
  timers.get(1)();
  assert.deepEqual(events,["nod"]);assert.deepEqual(gate.snapshot(),{scheduled:false,triggered:true});
  assert.equal(gate.schedule({onTrigger:()=>events.push("late")}),false);
});

test("cancels stale listening feedback and resets for the next turn",()=>{
  let timerId=0;const timers=new Map(),events=[];
  const gate=new ListeningGestureGate({delayMs:()=>1400,schedule:fn=>{const id=++timerId;timers.set(id,fn);return id;},cancelSchedule:id=>timers.delete(id)});
  gate.schedule({canRun:()=>false,onTrigger:()=>events.push("stale")});timers.get(1)();
  assert.deepEqual(events,[]);assert.deepEqual(gate.snapshot(),{scheduled:false,triggered:false});
  gate.schedule({onTrigger:()=>events.push("cancelled")});gate.cancel();assert.equal(timers.has(2),false);
  gate.reset();gate.schedule({onTrigger:()=>events.push("next")});timers.get(3)();assert.deepEqual(events,["next"]);
});
