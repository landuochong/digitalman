import test from "node:test";
import assert from "node:assert/strict";
import { ReplyTranscript } from "../public/reply-transcript.js";

test("exposes only sentences whose playback has started",()=>{
  const turn=new ReplyTranscript(),first=turn.receive("第一句。"),second=turn.receive("第二句。");
  assert.equal(turn.spokenText,"");assert.equal(turn.start(first),"第一句。");assert.equal(turn.start(second),"第一句。第二句。");
});
test("an interruption drops generated but unspoken sentences",()=>{
  const turn=new ReplyTranscript();turn.receive("已经开口。");turn.receive("仍在排队。");turn.start(0);
  assert.deepEqual(turn.interrupt(),{text:"已经开口。",interrupted:true,persist:true});assert.equal(turn.complete(),null);
});
test("an interruption before playback leaves no assistant history",()=>{
  const turn=new ReplyTranscript();turn.receive("尚未开口。");assert.deepEqual(turn.interrupt(),{text:"",interrupted:true,persist:false});
});
test("normal completion uses the provider final text",()=>{
  const turn=new ReplyTranscript();turn.receive("第一句。");turn.setFinal("第一句。完整结尾。");assert.deepEqual(turn.complete(),{text:"第一句。完整结尾。",interrupted:false,persist:true});
});
