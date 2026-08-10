import test from "node:test";
import assert from "node:assert/strict";
import { ConversationActionScheduler, conversationActionPolicy } from "../public/conversation-actions.js";

test("moves a subtle gesture after an unnaturally short spoken opener",()=>{
  const scheduler=new ConversationActionScheduler();
  assert.equal(scheduler.startTurn({message:"今天有点累",action:"caring"}).action,"caring");
  assert.equal(scheduler.actionForSentence("辛苦了，",0),"idle");
  assert.equal(scheduler.actionForSentence("今天早点休息吧。",1),"caring");
  assert.equal(scheduler.actionForSentence("我会陪着你。",2),"idle");
});

test("plays a complete first-sentence gesture immediately",()=>{
  const scheduler=new ConversationActionScheduler();
  scheduler.startTurn({message:"帮我分析一下",action:"thinking"});
  assert.equal(scheduler.actionForSentence("我先想想这件事。",0),"thinking");
  assert.equal(scheduler.actionForSentence("重点有两个。",1),"idle");
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
