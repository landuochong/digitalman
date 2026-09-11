import test from "node:test";
import assert from "node:assert/strict";
import { ConversationSessionStore, ConversationTurn, TURN_STATES } from "../src/conversation-session.mjs";

test("conversation turns emit ordered provider-neutral lifecycle events",()=>{
  let now=100;
  const turn=new ConversationTurn({sessionId:"user-1",turnId:"turn-1",now:()=>now});
  turn.transition(TURN_STATES.THINKING,{provider:"minimax"});now=145;
  turn.transition(TURN_STATES.PREPARING_SPEECH);turn.commitPlayback({audioMs:240});
  turn.transition(TURN_STATES.SPEAKING);turn.complete();
  assert.deepEqual(turn.events.map(event=>event.sequence),[0,1,2,3,4]);
  assert.equal(turn.events[1].elapsedMs,45);
  assert.equal(turn.state,"completed");
  assert.equal(turn.playbackCommitted,true);
});

test("interrupt aborts pending work and terminal turns reject stale events",()=>{
  const turn=new ConversationTurn({turnId:"turn-2"});
  turn.transition(TURN_STATES.THINKING);
  assert.equal(turn.interrupt("user-spoke"),true);
  assert.equal(turn.signal.aborted,true);
  assert.equal(turn.signal.reason,"user-spoke");
  assert.throws(()=>turn.transition(TURN_STATES.SPEAKING),/已经结束/);
});

test("session store interrupts older turns for the same conversation",()=>{
  const store=new ConversationSessionStore();
  const first=store.start({sessionId:"same",turnId:"one"});first.transition(TURN_STATES.THINKING);
  const other=store.start({sessionId:"other",turnId:"two"});other.transition(TURN_STATES.THINKING);
  assert.equal(store.interruptSession("same"),1);
  assert.equal(first.state,"interrupted");assert.equal(other.state,"thinking");
});
