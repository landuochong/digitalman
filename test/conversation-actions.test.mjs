import test from "node:test";
import assert from "node:assert/strict";
import { ConversationActionScheduler, conversationActionPolicy } from "../public/conversation-actions.js";

test("moves a subtle gesture after an unnaturally short spoken opener",()=>{
  const scheduler=new ConversationActionScheduler();
  assert.equal(scheduler.startTurn({message:"今天有点累",action:"caring"}).action,"caring");
  assert.equal(scheduler.actionForSentence("辛苦了，",0),"idle");
  assert.equal(scheduler.actionForSentence("今天早点休息吧。",1),"caring");
  assert.equal(scheduler.actionForSentence("我会陪着你。",2),"caring");
});

test("plays a complete first-sentence gesture immediately",()=>{
  const scheduler=new ConversationActionScheduler();
  scheduler.startTurn({message:"帮我分析一下",action:"thinking"});
  assert.equal(scheduler.actionForSentence("我先想想这件事。",0),"thinking");
  assert.equal(scheduler.actionForSentence("重点有两个。",1),"thinking");
});

test("accepts one reply-derived micro gesture during a neutral turn",()=>{
  const scheduler=new ConversationActionScheduler();
  scheduler.startTurn({message:"我把事情做完了",action:"idle"});
  assert.equal(scheduler.actionForSentence("这件事处理得很稳。",0,"idle"),"idle");
  assert.equal(scheduler.actionForSentence("你做得很好。",1,"nod"),"nod");
  assert.equal(scheduler.actionForSentence("继续保持。",2,"caring"),"idle");
});

test("limits repeated large inferred gestures but preserves explicit requests",()=>{
  let now=1000;
  const scheduler=new ConversationActionScheduler({clock:()=>now});
  assert.equal(scheduler.startTurn({message:"我成功了",action:"clap"}).action,"clap");
  scheduler.finishTurn();now+=1000;
  assert.equal(scheduler.startTurn({message:"又有一个好消息",action:"clap"}).action,"happy");
  scheduler.finishTurn();now+=100;
  assert.equal(scheduler.startTurn({message:"给我鼓掌",action:"clap"}).action,"clap");
  assert.equal(conversationActionPolicy.cooldownMs,3000);
});

test("builds an observable behavior timeline without another model call",()=>{
  const scheduler=new ConversationActionScheduler();
  const turn=scheduler.startTurn({message:"我今天有点累",action:"caring",emotion:"caring"});
  assert.deepEqual({action:turn.action,gaze:turn.gaze,head:turn.head},{action:"caring",gaze:"user",head:"slight_tilt"});
  assert.ok(turn.intensity>0&&turn.holdMs>=3000);
  const opener=scheduler.planForSentence("辛苦了，",0,"caring","caring");
  const body=scheduler.planForSentence("慢慢来，我陪你。",1,"caring","caring");
  assert.equal(opener.action,"idle");assert.equal(opener.deferred,true);
  assert.equal(body.action,"caring");assert.equal(body.deferred,true);
  const continuation=scheduler.planForSentence("我一直都在。",2,"idle","caring");
  assert.equal(continuation.action,"caring");assert.equal(continuation.continuation,true);assert.ok(continuation.frameOffset>0);
  assert.deepEqual(scheduler.getTimeline().map(item=>item.action),["caring","idle","caring","caring"]);
  assert.ok(conversationActionPolicy.behaviorActions.includes("nod"));
});
