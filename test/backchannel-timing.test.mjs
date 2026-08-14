import test from "node:test";
import assert from "node:assert/strict";
import * as serverTiming from "../src/backchannel-timing.mjs";
import * as browserTiming from "../public/backchannel-timing.js";

test("prepares backchannels before a 700 ms speech decision",()=>{
  assert.deepEqual(browserTiming,serverTiming);
  assert.equal(serverTiming.BACKCHANNEL_OFFER_MS,200);
  assert.equal(serverTiming.BACKCHANNEL_DECISION_MS,700);
  assert.equal(serverTiming.BACKCHANNEL_GRACE_MS,500);
  assert.equal(serverTiming.BACKCHANNEL_OFFER_MS+serverTiming.BACKCHANNEL_GRACE_MS,serverTiming.BACKCHANNEL_DECISION_MS);
});
