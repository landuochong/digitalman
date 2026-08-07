import test from "node:test";
import assert from "node:assert/strict";
import { buildVoiceCatalog } from "../src/voices.mjs";

test("offers several allowlisted MiniMax voice types",()=>{
  const catalog=buildVoiceCatalog({provider:"minimax",defaultVoice:"female-tianmei"});
  assert.equal(catalog.defaultKey,"sweet");
  assert.ok(catalog.voices.length>=6);
  assert.equal(catalog.resolve("soft"),"Chinese (Mandarin)_Soft_Girl");
  assert.equal(catalog.resolve("unknown"),"female-tianmei");
});

test("adds configured custom voices without accepting arbitrary client IDs",()=>{
  const catalog=buildVoiceCatalog({provider:"minimax",defaultVoice:"female-tianmei",customJson:JSON.stringify({lili:{label:"丽丽专属",description:"本地配置",voiceId:"lili-cloned-voice"}})});
  assert.equal(catalog.resolve("lili"),"lili-cloned-voice");
  assert.equal(catalog.resolve("lili-cloned-voice"),"female-tianmei");
});
