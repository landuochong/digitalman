import test from "node:test";
import assert from "node:assert/strict";
import { BargeInDetector } from "../public/barge-in-detector.js";

test("default interruption waits for sustained near-field speech after speaker warmup",()=>{
  const detector=new BargeInDetector();detector.reset(0);
  for(let at=0;at<=1200;at+=40)assert.equal(detector.sample(.014,at),false);
  for(let at=1240;at<=1480;at+=40)assert.equal(detector.sample(.09,at),false);
  assert.equal(detector.sample(.01,1520),false,"a sub-420 ms transient must reset");
  for(let at=1560;at<2000;at+=40)assert.equal(detector.sample(.09,at),false);
  assert.equal(detector.sample(.09,2000),true);
  assert.equal(detector.triggerMs,420);
  assert.equal(detector.warmupMs,1200);
  assert.equal(detector.absoluteThreshold,.055);
  assert.equal(detector.relativeThreshold,4);
});

test("does not cancel a reply for louder speaker leakage after warmup",()=>{
  const detector=new BargeInDetector();detector.reset(0);
  for(let at=0;at<=1200;at+=40)detector.sample(.014,at);
  for(let at=1240;at<=3000;at+=40)assert.equal(detector.sample(.045,at),false);
});

test("does not treat answer leakage learned during warmup as an interruption",()=>{
  const detector=new BargeInDetector({warmupMs:400,triggerMs:200});
  detector.reset(0);
  for(let at=0;at<=400;at+=40)assert.equal(detector.sample(.02,at),false);
  for(let at=440;at<=1000;at+=40)assert.equal(detector.sample(.021,at),false);
});

test("requires sustained near-field speech above the learned residual level",()=>{
  const detector=new BargeInDetector({warmupMs:400,triggerMs:200});
  detector.reset(0);
  for(let at=0;at<=400;at+=40)detector.sample(.012,at);
  assert.equal(detector.sample(.075,440),false);
  assert.equal(detector.sample(.01,520),false,"a short knock must reset the hold timer");
  for(let at=560;at<760;at+=40)assert.equal(detector.sample(.075,at),false);
  assert.equal(detector.sample(.075,760),true);
  assert.equal(detector.sample(.075,800),false,"one answer may be interrupted only once");
});

test("adapts slowly to changing room noise without triggering",()=>{
  const detector=new BargeInDetector({warmupMs:200,triggerMs:160});
  detector.reset(0);
  for(let at=0;at<=200;at+=40)detector.sample(.01,at);
  for(let at=240;at<=1200;at+=40)assert.equal(detector.sample(.018,at),false);
  assert.ok(detector.baseline>.01);
});
