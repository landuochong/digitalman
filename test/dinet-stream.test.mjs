import test from "node:test";
import assert from "node:assert/strict";
import { DINetStreamSessionStore, encodePcm16Wav } from "../src/dinet-stream.mjs";

test("encodes PCM16 as a valid mono 16 kHz WAV", () => {
  const wav = encodePcm16Wav(Buffer.alloc(3200));
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16000);
  assert.equal(wav.readUInt32LE(40), 3200);
});

test("accepts ordered chunks and renders the compatibility WAV on finish", async () => {
  let clock = 100;
  let received;
  const store = new DINetStreamSessionStore({
    now:() => clock,
    renderer:{ render:async (wav, action) => { received={ wav, action }; clock=460; return { url:"/result.mp4" }; } }
  });
  const session = store.start({ action:"caring" });
  clock=130;
  assert.equal(store.append(session.id, 0, Buffer.alloc(1600)).bufferedMs, 50);
  clock=180;
  store.append(session.id, 1, Buffer.alloc(1600));
  clock=200;
  const result = await store.finish(session.id);
  assert.equal(received.action, "caring");
  assert.equal(received.wav.readUInt32LE(40), 3200);
  assert.equal(result.stream.mode, "whole-wav-fallback");
  assert.equal(result.stream.audioMs, 100);
  assert.equal(result.stream.chunks, 2);
  assert.equal(result.stream.firstChunkDelayMs, 30);
  assert.equal(result.stream.finishToReadyMs, 260);
});

test("rejects out-of-order chunks without advancing the session", () => {
  const store = new DINetStreamSessionStore({ renderer:{ render:async()=>({}) } });
  const session = store.start();
  assert.throws(() => store.append(session.id, 1, Buffer.alloc(320)), error => error.status === 409);
  assert.equal(store.append(session.id, 0, Buffer.alloc(320)).nextSequence, 1);
});

test("cancel releases buffered audio and makes late chunks harmless", () => {
  const cancelled=[];
  const store = new DINetStreamSessionStore({ renderer:{ render:async()=>({}),cancelStream:async id=>cancelled.push(id) } });
  const session = store.start();
  store.append(session.id, 0, Buffer.alloc(320));
  assert.deepEqual(store.cancel(session.id), { id:session.id, cancelled:true });
  assert.deepEqual(cancelled,[session.id]);
  assert.throws(() => store.append(session.id, 1, Buffer.alloc(320)), error => error.status === 404);
  assert.deepEqual(store.cancel(session.id), { id:session.id, cancelled:false });
});

test("enforces the configured audio duration and PCM16 alignment", () => {
  const store = new DINetStreamSessionStore({ renderer:{ render:async()=>({}) }, maxAudioMs:10 });
  const first = store.start();
  assert.throws(() => store.append(first.id, 0, Buffer.alloc(321)), error => error.status === 400);
  const second = store.start();
  assert.throws(() => store.append(second.id, 0, Buffer.alloc(322)), error => error.status === 413);
});

test("drains one-second segments early and keeps the action frame clock continuous",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({
    segmentMs:800,firstSegmentMs:800,
    renderer:{render:async(wav,action,options)=>{
      calls.push({bytes:wav.readUInt32LE(40),action,...options});
      return{url:`/${calls.length}.mp4`,metrics:{frames:25}};
    }}
  });
  const session=store.start({action:"wave_approval"});
  store.append(session.id,0,Buffer.alloc(33_280));
  const first=await store.drain(session.id);
  assert.equal(first.length,1);assert.equal(first[0].segment.sequence,0);
  assert.equal(first[0].segment.audio.encoding,"pcm_s16le");
  assert.equal(first[0].segment.audio.sampleRate,16000);
  assert.equal(Buffer.from(first[0].segment.audio.data,"base64").length,25_600);
  store.append(session.id,1,Buffer.alloc(14_720));
  const tail=await store.drain(session.id,{final:true});
  assert.equal(tail.length,1);assert.equal(tail[0].segment.audioMs,700);
  assert.deepEqual(calls,[
    {bytes:25_600,action:"wave_approval",frameOffset:0,outputFrames:20,streamId:session.id,streamFinal:false},
    {bytes:22_400,action:"wave_approval",frameOffset:25,outputFrames:18,streamId:session.id,streamFinal:true},
  ]);
  assert.deepEqual(store.complete(session.id),{id:session.id,completed:true,segments:2,audioMs:1500});
});

test("emits a shorter first segment before returning to the steady window",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({
    firstSegmentMs:400,segmentMs:800,
    renderer:{render:async(wav,_action,options)=>{calls.push({bytes:wav.readUInt32LE(40),...options});return{url:`/${calls.length}.mp4`,metrics:{frames:options.outputFrames}};}}
  });
  const session=store.start();
  store.append(session.id,0,Buffer.alloc(46_080));
  const segments=await store.drain(session.id);
  assert.deepEqual(segments.map(item=>item.segment.audioMs),[400,800]);
  assert.deepEqual(segments.map(item=>item.segment.frameOffset),[0,10]);
  assert.deepEqual(segments.map(item=>item.segment.audioMode),["stateful","stateful"]);
  assert.deepEqual(calls.map(item=>item.outputFrames),[10,20]);
});

test("defaults to an 800 ms opener that covers steady-segment rendering",async()=>{
  const durations=[];
  const store=new DINetStreamSessionStore({
    renderer:{render:async(wav,_action,options)=>{durations.push(wav.readUInt32LE(40)/32);return{url:"/part.mp4",metrics:{frames:options.outputFrames}};}}
  });
  const session=store.start();
  store.append(session.id,0,Buffer.alloc(78_080));
  await store.drain(session.id);
  assert.deepEqual(durations,[800,1200]);
});

test("can continue an action from a later source frame across spoken sentences",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({firstSegmentMs:400,renderer:{render:async(_wav,_action,options)=>{calls.push(options);return{url:"/part.mp4",metrics:{frames:options.outputFrames}};}}});
  const session=store.start({action:"caring",frameOffset:37});
  assert.equal(session.frameOffset,37);
  store.append(session.id,0,Buffer.alloc(20_480));
  await store.drain(session.id);
  assert.equal(calls[0].frameOffset,37);
  assert.throws(()=>store.start({frameOffset:-1}),error=>error.status===400);
});
