import test from "node:test";
import assert from "node:assert/strict";
import { ConversationActionScheduler, continueActionPlan, conversationActionPolicy, preparedPreviewCanStart } from "../public/conversation-actions.js";

test("continues a matching action from its visible source frame",()=>{
  const plan={action:"caring",frameOffset:0,deferred:false};
  assert.deepEqual(continueActionPlan(plan,{action:"caring",baseFrameOffset:40,elapsedMs:800,leadMs:200}),{...plan,continuation:true,frameOffset:65});
  assert.equal(continueActionPlan(plan,{action:"thinking",elapsedMs:800}),plan);
  assert.equal(continueActionPlan({...plan,deferred:true},{action:"caring",elapsedMs:800}).deferred,true);
  assert.equal(continueActionPlan(plan,{action:"caring",baseFrameOffset:220,elapsedMs:200}).frameOffset,3);
});

test("starts an asynchronously prepared preview only before speech and while still current",()=>{
  const preview={action:"nod"};
  assert.equal(preparedPreviewCanStart(preview,{activePreview:preview}),true);
  assert.equal(preparedPreviewCanStart(preview,{activePreview:{action:"nod"}}),false);
  assert.equal(preparedPreviewCanStart(preview,{activePreview:preview,spokenSentenceCount:1}),false);
  assert.equal(preparedPreviewCanStart(preview,{activePreview:preview,aborted:true}),false);
});

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
  // Advance to the cadence's deliberately quiet turn so this test continues
  // to cover a reply-derived gesture rather than the turn-level micro gesture.
  scheduler.startTurn({message:"上一轮普通聊天",action:"idle"});
  scheduler.finishTurn();
  scheduler.startTurn({message:"我把事情做完了",action:"idle"});
  assert.equal(scheduler.actionForSentence("这件事处理得很稳。",0,"idle"),"idle");
  assert.equal(scheduler.actionForSentence("你做得很好。",1,"nod"),"nod");
  assert.equal(scheduler.actionForSentence("继续保持。",2,"caring"),"idle");
});

test("keeps one dominant celebration gesture across a praise reply",()=>{
  const scheduler=new ConversationActionScheduler();
  scheduler.startTurn({message:"我刚完成了一项很难的工作，夸夸我",action:"clap",emotion:"excited"});
  const first=scheduler.planForSentence("辛苦了，你真的很厉害！",0,"thumbs_up","happy");
  const second=scheduler.planForSentence("这份成果值得好好骄傲一下。",1,"clap","excited");
  assert.equal(first.action,"clap");
  assert.equal(second.action,"idle");
  assert.equal(scheduler.secondaryUsed,false);
  assert.ok(conversationActionPolicy.intentGroups.some(group=>group.includes("clap")&&group.includes("thumbs_up")));
});

test("still allows one genuinely different secondary intent",()=>{
  const scheduler=new ConversationActionScheduler();
  scheduler.startTurn({message:"告诉你一个好消息",action:"clap",emotion:"excited"});
  assert.equal(scheduler.planForSentence("太好了，恭喜你。",0,"thumbs_up").action,"clap");
  assert.equal(scheduler.planForSentence("不过下一步要认真想想。",1,"thinking").action,"thinking");
  assert.equal(scheduler.secondaryUsed,true);
});

test("gives ordinary conversation a restrained three-in-four micro-gesture cadence",()=>{
  const scheduler=new ConversationActionScheduler();
  const actions=[];
  for(let index=0;index<4;index+=1){
    const preview=scheduler.startTurn({message:`普通聊天 ${index}`,action:"idle",emotion:"calm"});
    actions.push(preview.action);
    assert.equal(preview.cadenceManaged,true);
    assert.equal(preview.implicitMicroGesture,preview.action!=="idle"?true:undefined);
    assert.equal(scheduler.planForSentence("我在认真听你说。",0,"idle").action,preview.action);
    scheduler.finishTurn();
  }
  assert.deepEqual(actions,["nod","idle","happy","nod"]);
  assert.equal(conversationActionPolicy.microGestureCadence.filter(action=>action!=="idle").length,3);
});

test("never replaces an explicit or semantic primary action with cadence",()=>{
  const scheduler=new ConversationActionScheduler();
  const explicit=scheduler.startTurn({message:"给我鼓掌",action:"clap"});assert.equal(explicit.action,"clap");assert.equal(explicit.cadenceManaged,undefined);
  scheduler.finishTurn();
  const semantic=scheduler.startTurn({message:"我今天很累",action:"caring"});assert.equal(semantic.action,"caring");assert.equal(semantic.cadenceManaged,undefined);
});

test("counts only neutral turns in the micro-gesture cadence",()=>{
  const scheduler=new ConversationActionScheduler();
  assert.equal(scheduler.startTurn({message:"普通聊天",action:"idle"}).action,"nod");
  scheduler.finishTurn();
  assert.equal(scheduler.startTurn({message:"我今天很累",action:"caring"}).action,"caring");
  scheduler.finishTurn();
  assert.equal(scheduler.startTurn({message:"继续闲聊",action:"idle"}).action,"idle");
});

test("keeps ordinary idle sentences on one source-video timeline",()=>{
  const scheduler=new ConversationActionScheduler();
  scheduler.startTurn({message:"随便聊聊",action:"idle"});
  const first=scheduler.planForSentence("今天天气不错。",0,"idle");
  const second=scheduler.planForSentence("适合出去走走。",1,"idle");
  assert.equal(first.frameOffset,0);
  assert.ok(second.frameOffset>0);
  assert.equal(second.startAtMs,first.durationMs);
});

test("keeps gestures within one authored motion cycle",()=>{
  const scheduler=new ConversationActionScheduler();
  scheduler.startTurn({message:"我今天有点累",action:"caring"});
  const first=scheduler.planForSentence("我知道你今天确实已经辛苦很久很久了，所以现在就先安心停下来好好休息。",0,"caring");
  const second=scheduler.planForSentence("现在先休息一下吧。",1,"caring");
  assert.ok(first.holdMs>conversationActionPolicy.naturalGestureCycleMs);
  assert.equal(first.maxContinuousMs,conversationActionPolicy.naturalGestureCycleMs);
  assert.equal(second.action,"idle");
  assert.ok(first.frameOffset<conversationActionPolicy.sourceFrames);
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

test("keeps an explicit user gesture on the first sentence",()=>{
  const clap=new ConversationActionScheduler();
  assert.equal(clap.startTurn({message:"我很累，给我鼓掌鼓励一下",action:"clap"}).explicit,true);
  assert.equal(clap.planForSentence("你已经很棒了。",0,"thumbs_up").action,"clap");
  const shy=new ConversationActionScheduler();
  shy.startTurn({message:"请做个害羞动作",action:"shy"});
  const opener=shy.planForSentence("好呀。",0,"happy");
  assert.equal(opener.action,"shy");assert.equal(opener.deferred,false);
});

test("preserves every supported explicit gesture against reply-derived candidates",()=>{
  const cases=[
    ["给我鼓鼓掌","clap"],["请欢呼一下","cheer"],["做个惊讶动作","surprise"],["给我鞠个躬","bow"],
    ["请耸肩摊手","shrug"],["做个交叉手势","cross"],["摆个抱胸姿势","confident_arms_crossed"],
    ["请做个害羞动作","shy"],["给我竖个大拇指","thumbs_up"],["请点点头","nod"],
    ["向我挥挥手","wave_approval"],["请笑一个","happy"],["做个思考动作","thinking"],["做个关心动作","caring"]
  ];
  for(const[message,action]of cases){
    const scheduler=new ConversationActionScheduler();scheduler.startTurn({message,action});
    const plan=scheduler.planForSentence("好呀。",0,action==="thumbs_up"?"clap":"thumbs_up");
    assert.equal(plan.action,action,message);assert.equal(plan.explicit,true,message);assert.equal(plan.deferred,false,message);
  }
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
