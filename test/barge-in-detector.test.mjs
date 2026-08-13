import test from "node:test";
import assert from "node:assert/strict";
import { BargeInDetector } from "../public/barge-in-detector.js";

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
