import test from "node:test";
import assert from "node:assert/strict";
import * as serverTiming from "../src/backchannel-timing.mjs";
import * as browserTiming from "../public/backchannel-timing.js";

test("prepares backchannels earlier without changing their speech decision point",()=>{
  assert.deepEqual(browserTiming,serverTiming);
  assert.equal(serverTiming.BACKCHANNEL_OFFER_MS,500);
  assert.equal(serverTiming.BACKCHANNEL_GRACE_MS,400);
  assert.equal(serverTiming.BACKCHANNEL_OFFER_MS+serverTiming.BACKCHANNEL_GRACE_MS,serverTiming.BACKCHANNEL_DECISION_MS);
});
