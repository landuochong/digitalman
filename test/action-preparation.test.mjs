import test from "node:test";
import assert from "node:assert/strict";
import { shouldPrepareAvatarAction } from "../src/action-preparation.mjs";

test("prepares only semantic avatar actions on the server",()=>{
  assert.equal(shouldPrepareAvatarAction("caring",{fastSpeech:true}),true);
  assert.equal(shouldPrepareAvatarAction("nod",{fastSpeech:true}),true);
  assert.equal(shouldPrepareAvatarAction("idle",{fastSpeech:true}),false);
  assert.equal(shouldPrepareAvatarAction("caring",{fastSpeech:false}),false);
});
