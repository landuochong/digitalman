import test from "node:test";
import assert from "node:assert/strict";
import { VIDEO_PRESTART_LEAD_MS,continuousVideoOriginAfterGap,continuousVideoSync,scheduledAudioAhead,videoBoundaryDelayMs,videoCatchupSeconds,videoPrestartDelayMs } from "../public/avatar-video-timing.js";

test("prestarts video decoding before but reveals at the audio boundary",()=>{
  assert.equal(VIDEO_PRESTART_LEAD_MS,60);
  assert.ok(Math.abs(videoPrestartDelayMs(10.1,10)-40)<1e-9);
  assert.ok(videoPrestartDelayMs(10.06,10)<1e-9);
  assert.ok(Math.abs(videoBoundaryDelayMs(10.1,10.08)-20)<1e-9);
  assert.equal(videoBoundaryDelayMs(10.1,10.12),0);
});

test("measures queued Web Audio duration against its monotonic clock",()=>{
  assert.ok(Math.abs(scheduledAudioAhead(12.3,8.1)-4.2)<1e-9);
  assert.equal(scheduledAudioAhead(8,9),0);
});

test("continuous video only catches up when it falls behind the PCM clock",()=>{
  assert.deepEqual(continuousVideoSync(10,11,.99,3),{expected:1,driftMs:10,seekTo:null});
  assert.deepEqual(continuousVideoSync(10,11.2,1.1,3),{expected:1.1999999999999993,driftMs:100,seekTo:1.1999999999999993});
  assert.deepEqual(continuousVideoSync(10,14,2.8,3),{expected:4,driftMs:1200,seekTo:2.99});
});

test("continuous video excludes real sentence gaps from its media timeline",()=>{
  assert.equal(continuousVideoOriginAfterGap(10,.0),10);
  assert.equal(continuousVideoOriginAfterGap(10,400),10.4);
  const origin=continuousVideoOriginAfterGap(10,400);
  const sync=continuousVideoSync(origin,11.2,.8,1.6);
  assert.ok(Math.abs(sync.expected-.8)<1e-9);
  assert.equal(Math.abs(sync.driftMs),0);
  assert.equal(sync.seekTo,null);
});

test("seeks only when a video segment is materially late",()=>{
  assert.equal(videoCatchupSeconds(10,10.02,.8),0);
  assert.ok(Math.abs(videoCatchupSeconds(10,10.12,.8)-.12)<1e-9);
  assert.equal(videoCatchupSeconds(10,11,.8),.76);
});
