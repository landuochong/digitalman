import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("streamed speech sentences carry their own emotion and action",async()=>{
  const source=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(source,/const sentenceResult=buildMiniMaxReply\(sentence,message,companionState,history,\{allowEmpty:true\}\)/);
  assert.match(source,/if\(!safeSentence\)\{trace\.filteredSentenceCount=.*continue;\}/);
  assert.match(source,/text:safeSentence,emotion:sentenceResult\.emotion,action:sentenceResult\.action/);
  assert.match(source,/const sentenceLimit=conversationalSentenceLimit\(message\)/);
});
