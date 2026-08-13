import test from "node:test";
import assert from "node:assert/strict";
import { VIDEO_PRESTART_LEAD_MS,continuousVideoSync,videoBoundaryDelayMs,videoCatchupSeconds,videoPrestartDelayMs } from "../public/avatar-video-timing.js";

test("prestarts video decoding before but reveals at the audio boundary",()=>{
  assert.equal(VIDEO_PRESTART_LEAD_MS,32);
  assert.ok(Math.abs(videoPrestartDelayMs(10.1,10)-68)<1e-9);
  assert.ok(Math.abs(videoBoundaryDelayMs(10.1,10.08)-20)<1e-9);
  assert.equal(videoBoundaryDelayMs(10.1,10.12),0);
});

test("continuous video only catches up when it falls behind the PCM clock",()=>{
  assert.deepEqual(continuousVideoSync(10,11,.99,3),{expected:1,driftMs:10,seekTo:null});
  assert.deepEqual(continuousVideoSync(10,11.2,1.1,3),{expected:1.1999999999999993,driftMs:100,seekTo:1.1999999999999993});
  assert.deepEqual(continuousVideoSync(10,14,2.8,3),{expected:4,driftMs:1200,seekTo:2.99});
});

test("seeks only when a video segment is materially late",()=>{
  assert.equal(videoCatchupSeconds(10,10.02,.8),0);
  assert.ok(Math.abs(videoCatchupSeconds(10,10.12,.8)-.12)<1e-9);
  assert.equal(videoCatchupSeconds(10,11,.8),.76);
});
