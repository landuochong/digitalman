import test from "node:test";
import assert from "node:assert/strict";
import { shouldEmitFormalSentence } from "../src/backchannel-dedup.mjs";

test("does not suppress a fast formal sentence before the backchannel is offered",()=>{
  const backchannel={text:"我在。"};
  assert.equal(shouldEmitFormalSentence("我在。",backchannel,{offered:false}),true);
});

test("deduplicates only a backchannel that the user actually heard",()=>{
  const backchannel={text:"我想想。"};
  assert.equal(shouldEmitFormalSentence("我想想。",backchannel,{offered:true}),false);
  assert.equal(shouldEmitFormalSentence("我想想办法。",backchannel,{offered:true}),true);
});
