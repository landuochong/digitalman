import test from "node:test";
import assert from "node:assert/strict";
import { BargeInDetector } from "../public/barge-in-detector.js";

test("default interruption waits for sustained near-field speech after speaker warmup",()=>{
  const detector=new BargeInDetector();detector.reset(0);
  for(let at=0;at<=700;at+=40)assert.equal(detector.sample(.003,at),false);
  for(let at=720;at<=880;at+=40)assert.equal(detector.sample(.012,at),false);
  assert.equal(detector.sample(.003,920),false,"a short transient must reset");
  for(let at=960;at<1240;at+=40)assert.equal(detector.sample(.012,at),false);
  assert.equal(detector.sample(.012,1240),true);
  assert.equal(detector.triggerMs,260);
  assert.equal(detector.warmupMs,700);
  assert.equal(detector.absoluteThreshold,.0065);
  assert.equal(detector.relativeThreshold,2.2);
});

test("a clear near-field voice can interrupt during speaker calibration",()=>{
  const detector=new BargeInDetector();detector.reset(0);
  for(let at=0;at<=80;at+=40)assert.equal(detector.sample(.0025,at),false);
  for(let at=120;at<320;at+=40)assert.equal(detector.sample(.012,at),false);
  assert.equal(detector.sample(.012,320),true);
});

test("a short loud sound during calibration does not interrupt",()=>{
  const detector=new BargeInDetector();detector.reset(0);
  for(let at=0;at<=80;at+=40)detector.sample(.0025,at);
  assert.equal(detector.sample(.015,120),false);
  assert.equal(detector.sample(.015,240),false);
  assert.equal(detector.sample(.0025,280),false);
  for(let at=320;at<=680;at+=40)assert.equal(detector.sample(.0055,at),false);
});

test("does not cancel a reply for louder speaker leakage after warmup",()=>{
  const detector=new BargeInDetector();detector.reset(0);
  for(let at=0;at<=700;at+=40)detector.sample(.0025,at);
  for(let at=720;at<=3000;at+=40)assert.equal(detector.sample(.0055,at),false);
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
  for(let at=0;at<=200;at+=40)detector.sample(.0025,at);
  for(let at=240;at<=1200;at+=40)assert.equal(detector.sample(.0055,at),false);
  assert.ok(detector.baseline>.0025);
});
