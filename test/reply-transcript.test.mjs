import test from "node:test";
import assert from "node:assert/strict";
import { ReplyTranscript } from "../public/reply-transcript.js";

test("exposes only sentences whose playback has started",()=>{
  const turn=new ReplyTranscript(),first=turn.receive("第一句。"),second=turn.receive("第二句。");
  assert.equal(turn.spokenText,"");assert.equal(turn.start(first),"第一句。");assert.equal(turn.start(second),"第一句。第二句。");
});
test("an interruption drops generated but unspoken sentences",()=>{
  const turn=new ReplyTranscript();turn.receive("已经说完。");turn.receive("刚刚开口。");turn.receive("仍在排队。");turn.start(0);turn.finish(0);turn.start(1);
  assert.deepEqual(turn.interrupt(),{text:"已经说完。刚刚开口。",historyText:"已经说完。",interrupted:true,persist:true});assert.equal(turn.complete(),null);
});
test("an interruption before playback leaves no assistant history",()=>{
  const turn=new ReplyTranscript();turn.receive("尚未开口。");assert.deepEqual(turn.interrupt(),{text:"",historyText:"",interrupted:true,persist:false});
});
test("an interruption during the first sentence does not commit it as completed history",()=>{
  const turn=new ReplyTranscript();const first=turn.receive("只说到一半。");turn.start(first);
  assert.deepEqual(turn.interrupt(),{text:"只说到一半。",historyText:"",interrupted:true,persist:false});
});
test("normal completion uses the provider final text",()=>{
  const turn=new ReplyTranscript();const first=turn.receive("第一句。");turn.start(first);turn.finish(first);turn.setFinal("第一句。完整结尾。");assert.deepEqual(turn.complete(),{text:"第一句。完整结尾。",interrupted:false,persist:true});
});
test("normal settlement is downgraded when playback did not finish",()=>{
  const turn=new ReplyTranscript();const first=turn.receive("还没有说完。");turn.start(first);turn.setFinal("还没有说完。");
  assert.deepEqual(turn.complete(),{text:"还没有说完。",historyText:"",interrupted:true,persist:false});
});
test("completed history remains a contiguous spoken prefix",()=>{
  const turn=new ReplyTranscript(),first=turn.receive("第一句。"),second=turn.receive("第二句。");turn.start(first);turn.start(second);turn.finish(second);
  assert.equal(turn.completedText,"");turn.finish(first);assert.equal(turn.completedText,"第一句。第二句。");
});
