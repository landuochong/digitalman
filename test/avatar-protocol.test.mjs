import test from "node:test";
import assert from "node:assert/strict";
import { buildWav2LipPlaybackMessage } from "../public/avatar-protocol.js";

test("forwards streamed PCM metadata to the avatar iframe",()=>{
  const segment={sequence:2,audioMs:800,audio:{encoding:"pcm_s16le",sampleRate:16000,channels:1,data:"AAAA"}};
  assert.deepEqual(buildWav2LipPlaybackMessage({url:"/segment.mp4",segment},"request-1",{enqueue:true}),{
    type:"wav2lip-enqueue",url:"/segment.mp4",requestId:"request-1",segment
  });
});

test("keeps whole-video playback messages free of absent stream metadata",()=>{
  assert.deepEqual(buildWav2LipPlaybackMessage({url:"/whole.mp4"},"request-2"),{
    type:"wav2lip-play",url:"/whole.mp4",requestId:"request-2"
  });
});

test("marks a video-only segment so audio failure cannot become silent playback",()=>{
  assert.deepEqual(buildWav2LipPlaybackMessage({url:"/silent.mp4",videoOnly:true,segment:{sequence:0}},"request-3",{enqueue:true}),{
    type:"wav2lip-enqueue",url:"/silent.mp4",requestId:"request-3",videoOnly:true,segment:{sequence:0}
  });
});
