import test from "node:test";
import assert from "node:assert/strict";
import {VisualTurnGate} from "../src/visual-turn-gate.mjs";

test("serializes sentence rendering within one visual turn",async()=>{
  const gate=new VisualTurnGate(),events=[];
  const second=gate.wait("turn",1).then(()=>events.push("second"));await Promise.resolve();assert.deepEqual(events,[]);
  await gate.wait("turn",0);events.push("first");gate.finish("turn",0);await second;
  assert.deepEqual(events,["first","second"]);gate.finish("turn",1);
});

test("keeps different visual turns independent and aborts waiters",async()=>{
  const gate=new VisualTurnGate();await gate.wait("a",0);await gate.wait("b",0);
  const controller=new AbortController(),waiting=gate.wait("a",2,{signal:controller.signal});controller.abort();
  await assert.rejects(waiting,error=>error.name==="AbortError");gate.close("a");gate.close("b");
});

test("remembers an earlier completion when requests arrive out of order",async()=>{
  const gate=new VisualTurnGate();gate.finish("turn",0);
  await gate.wait("turn",1);gate.finish("turn",1);gate.close("turn");
});
