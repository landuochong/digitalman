import test from "node:test";
import assert from "node:assert/strict";
import { sanitizeClientTiming } from "../src/client-timing.mjs";

test("keeps only bounded allowlisted browser timing fields",()=>{
  assert.deepEqual(sanitizeClientTiming({event:"first-speech",speechKind:"backchannel",avatarMode:"real",recognitionTrigger:"vad-final",requestToEventMs:812.6,speechEndpointMs:531.7,vadStopToEventMs:999999,recognitionCommitToRequestMs:7.2,ttsConnectionMs:91.4,ttsTaskMs:22.2,ttsSynthesisMs:307.8,avatarTransportMs:18.9,avatarPcmBufferingMs:402.2,avatarRenderMs:168.4,backchannelCompletedMs:1040.4,traceId:"ignored",message:"private"}),{
    event:"first-speech",speechKind:"backchannel",avatarMode:"real",recognitionTrigger:"vad-final",requestToEventMs:813,speechEndpointMs:532,vadStopToEventMs:180000,recognitionCommitToRequestMs:7,ttsConnectionMs:91,ttsTaskMs:22,ttsSynthesisMs:308,avatarTransportMs:19,avatarPcmBufferingMs:402,avatarRenderMs:168,backchannelCompletedMs:1040
  });
});

test("rejects unknown events and drops invalid enums and numbers",()=>{
  assert.throws(()=>sanitizeClientTiming({event:"arbitrary"}),/未知/);
  assert.deepEqual(sanitizeClientTiming({event:"formal-speech",speechKind:"other",avatarMode:"vr",requestToEventMs:"bad",videoHandoffLateMs:-12}),{event:"formal-speech",videoHandoffLateMs:0});
});
