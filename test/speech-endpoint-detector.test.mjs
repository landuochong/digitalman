import test from "node:test";
import assert from "node:assert/strict";
import { SpeechEndpointDetector } from "../public/speech-endpoint-detector.js";

test("detects quiet-room silence after real speech",()=>{
  const detector=new SpeechEndpointDetector({warmupMs:200});detector.reset(0);
  for(let at=0;at<=400;at+=40)detector.sample(at<280?.07:.01,at,{hasTranscript:at>=160});
  assert.equal(detector.sample(.01,600,{hasTranscript:true}).silenceMs,320);
});

test("treats stable high room noise as silence after louder speech",()=>{
  const detector=new SpeechEndpointDetector({warmupMs:320});detector.reset(0);
  for(let at=0;at<=320;at+=40)detector.sample(.035,at);
  for(let at=360;at<=600;at+=40)detector.sample(.08,at,{hasTranscript:true});
  detector.sample(.035,640,{hasTranscript:true});
  const endpoint=detector.sample(.035,1000,{hasTranscript:true});
  assert.equal(endpoint.threshold,.045);
  assert.equal(endpoint.silenceMs,360);
});

test("an immediate voice does not raise the endpoint above the voice",()=>{
  const detector=new SpeechEndpointDetector({warmupMs:320});detector.reset(0);
  for(let at=0;at<=320;at+=40){const endpoint=detector.sample(.08,at,{hasTranscript:at>=160});assert.ok(endpoint.threshold<=.045);assert.equal(endpoint.silenceMs,0);}
  detector.sample(.012,360,{hasTranscript:true});
  assert.equal(detector.sample(.012,720,{hasTranscript:true}).silenceMs,360);
});

test("ongoing speech clears a pending silence interval",()=>{
  const detector=new SpeechEndpointDetector({warmupMs:0});detector.reset(0);
  detector.sample(.07,0,{hasTranscript:true});
  assert.equal(detector.sample(.01,200,{hasTranscript:true}).silenceMs,0);
  assert.equal(detector.sample(.01,400,{hasTranscript:true}).silenceMs,200);
  assert.equal(detector.sample(.07,440,{hasTranscript:true}).silenceMs,0);
});
