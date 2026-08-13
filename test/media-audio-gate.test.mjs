import test from "node:test";
import assert from "node:assert/strict";
import {scheduleAfterMediaReady} from "../public/media-audio-gate.js";

function deferred(){let resolve;return{promise:new Promise(done=>{resolve=done;}),resolve};}

test("does not put PCM on the audio clock until fragmented video is buffered",async()=>{
  const media=deferred(),events=[];
  const scheduled=scheduleAfterMediaReady({fragmentedVideo:true,fragmentReadyToPlay:media.promise,scheduleAudio:()=>{events.push("audio");return true;}});
  await Promise.resolve();assert.deepEqual(events,[]);
  media.resolve({buffered:true});assert.equal(await scheduled,true);assert.deepEqual(events,["audio"]);
});

test("keeps non-fragmented compatibility audio scheduling immediate",async()=>{
  let called=false;
  assert.equal(await scheduleAfterMediaReady({scheduleAudio:()=>{called=true;return true;}}),true);
  assert.equal(called,true);
  assert.equal(await scheduleAfterMediaReady({fragmentedVideo:true,fragmentReadyToPlay:Promise.resolve(null),scheduleAudio:()=>true}),false);
});
