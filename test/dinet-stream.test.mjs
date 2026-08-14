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
  const cancelled=[],released=[];
  const store = new DINetStreamSessionStore({
    renderer:{ render:async()=>({}),cancelStream:async id=>cancelled.push(id) },
    releaseAudio:id=>released.push(id)
  });
  const session = store.start();
  store.append(session.id, 0, Buffer.alloc(320));
  assert.deepEqual(store.cancel(session.id), { id:session.id, cancelled:true });
  assert.deepEqual(cancelled,[session.id]);
  assert.deepEqual(released,[session.id]);
  assert.throws(() => store.append(session.id, 1, Buffer.alloc(320)), error => error.status === 404);
  assert.deepEqual(store.cancel(session.id), { id:session.id, cancelled:false });
});

test("expires abandoned open sessions and exposes bounded resource metrics",async()=>{
  let timerId=0;const timers=new Map(),cancelled=[],released=[];
  const store=new DINetStreamSessionStore({sessionIdleMs:1000,schedule:fn=>{const id=++timerId;timers.set(id,fn);return id;},cancelSchedule:id=>timers.delete(id),renderer:{render:async()=>({}),cancelStream:async id=>cancelled.push(id)},releaseAudio:id=>released.push(id)});
  const first=store.start();store.append(first.id,0,Buffer.alloc(3200));
  assert.deepEqual(store.snapshot(),{sessions:1,open:1,completed:0,bufferedBytes:3200,sessionIdleMs:1000,acknowledgementRetentionMs:60_000});
  const expiry=[...timers.values()].at(-1);expiry();await new Promise(resolve=>setImmediate(resolve));
  assert.deepEqual(store.snapshot(),{sessions:0,open:0,completed:0,bufferedBytes:0,sessionIdleMs:1000,acknowledgementRetentionMs:60_000});
  assert.deepEqual(cancelled,[first.id]);assert.deepEqual(released,[first.id]);
  assert.throws(()=>store.append(first.id,1,Buffer.alloc(320)),error=>error.status===404);
});

test("refreshes the idle deadline when audio continues arriving",()=>{
  let timerId=0;const timers=new Map();
  const store=new DINetStreamSessionStore({sessionIdleMs:1000,schedule:fn=>{const id=++timerId;timers.set(id,fn);return id;},cancelSchedule:id=>timers.delete(id),renderer:{render:async()=>({})}});
  const session=store.start(),firstTimer=[...timers.keys()].at(-1);
  store.append(session.id,0,Buffer.alloc(320));const secondTimer=[...timers.keys()].at(-1);
  assert.notEqual(firstTimer,secondTimer);assert.equal(timers.has(firstTimer),false);
  store.append(session.id,1,Buffer.alloc(320));assert.equal(timers.has(secondTimer),false);
  assert.equal(store.snapshot().sessions,1);store.cancel(session.id);
});

test("enforces the configured audio duration and PCM16 alignment", () => {
  const store = new DINetStreamSessionStore({ renderer:{ render:async()=>({}) }, maxAudioMs:10 });
  const first = store.start();
  assert.throws(() => store.append(first.id, 0, Buffer.alloc(321)), error => error.status === 400);
  const second = store.start();
  assert.throws(() => store.append(second.id, 0, Buffer.alloc(322)), error => error.status === 413);
});

test("drains 800 ms segments early and keeps the action frame clock continuous",async()=>{
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
    {bytes:25_600,action:"wave_approval",frameOffset:0,outputFrames:20,streamId:session.id,streamFinal:false,videoOnly:false,fragmentedVideo:false},
    {bytes:22_400,action:"wave_approval",frameOffset:25,outputFrames:18,streamId:session.id,streamFinal:true,videoOnly:false,fragmentedVideo:false},
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
  assert.deepEqual(segments.map(item=>item.segment.audioMode),["multiplexed","multiplexed"]);
  assert.deepEqual(calls.map(item=>item.outputFrames),[10,20]);
});

test("allows each continuous session to select a shorter aligned first window",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({
    firstSegmentMs:800,segmentMs:800,
    renderer:{render:async(wav,_action,options)=>{calls.push({bytes:wav.readUInt32LE(40),...options});return{url:`/${calls.length}.mp4`,metrics:{frames:options.outputFrames}};}}
  });
  const session=store.start({videoOnly:true,fragmentedVideo:true,firstSegmentMs:480});
  assert.equal(session.firstSegmentMs,480);
  store.append(session.id,0,Buffer.alloc(52_480));
  const segments=await store.drain(session.id);
  assert.deepEqual(segments.map(item=>item.segment.audioMs),[480,800]);
  assert.deepEqual(calls.map(item=>item.outputFrames),[12,20]);

  const compatibility=store.start();
  assert.equal(compatibility.firstSegmentMs,800);
  assert.throws(()=>store.start({firstSegmentMs:280}),error=>error.status===400);
  assert.throws(()=>store.start({firstSegmentMs:840}),error=>error.status===400);
});

test("starts a 320 ms continuous segment after retaining 160 ms of tail",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({
    firstSegmentMs:320,segmentMs:800,
    renderer:{render:async(wav,_action,options)=>{calls.push({bytes:wav.readUInt32LE(40),...options});return{url:"/first.mp4",metrics:{frames:options.outputFrames}};}}
  });
  const session=store.start({videoOnly:true,fragmentedVideo:true,minimumTailMs:160});
  store.append(session.id,0,Buffer.alloc(15_360));
  const [first]=await store.drain(session.id);
  assert.equal(first.segment.audioMs,320);
  assert.equal(calls[0].outputFrames,8);
  const [tail]=await store.drain(session.id,{final:true});
  assert.equal(tail.segment.audioMs,160);
  assert.equal(calls[1].outputFrames,4);
  assert.equal(store.start().minimumTailMs,240);
  assert.throws(()=>store.start({minimumTailMs:120}),error=>error.status===400);
});

test("renders video-only segments when external PCM playback is negotiated",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({
    firstSegmentMs:400,
    renderer:{render:async(_wav,_action,options)=>{calls.push(options);return{url:"/silent-video.mp4",videoOnly:true,metrics:{frames:options.outputFrames}};}}
  });
  const session=store.start({action:"caring",videoOnly:true});
  assert.equal(session.videoOnly,true);
  store.append(session.id,0,Buffer.alloc(20_480));
  const [segment]=await store.drain(session.id);
  assert.equal(calls[0].videoOnly,true);
  assert.equal(segment.videoOnly,true);
  assert.equal(segment.segment.audioMode,"external-pcm");
  assert.equal(Buffer.from(segment.segment.audio.data,"base64").length,12_800);
});

test("publishes binary PCM metadata without base64 when negotiated",async()=>{
  const published=[];
  const store=new DINetStreamSessionStore({
    firstSegmentMs:400,
    publishAudio:payload=>{published.push(payload);return{url:"/api/dinet/pcm/token",bytes:payload.pcm.length};},
    releaseAudio:()=>{},
    renderer:{render:async(_wav,_action,options)=>({url:"/silent.mp4",videoOnly:true,metrics:{frames:options.outputFrames}})}
  });
  const session=store.start({videoOnly:true,binaryAudio:true});store.append(session.id,0,Buffer.alloc(20_480));
  const [result]=await store.drain(session.id);
  assert.equal(published[0].pcm.length,12_800);assert.equal(published[0].streamId,session.id);
  assert.deepEqual(result.segment.audio,{encoding:"pcm_s16le",sampleRate:16000,channels:1,url:"/api/dinet/pcm/token",bytes:12_800});
  assert.equal("data" in result.segment.audio,false);
});

test("forwards fragmented-video negotiation only for video-only streams",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({firstSegmentMs:400,renderer:{render:async(_wav,_action,options)=>{calls.push(options);return{url:"/part.mp4",fragmentedVideo:options.fragmentedVideo,metrics:{frames:options.outputFrames}};}}});
  const session=store.start({videoOnly:true,fragmentedVideo:true});
  assert.equal(session.fragmentedVideo,true);
  store.append(session.id,0,Buffer.alloc(20_480));await store.drain(session.id);
  assert.equal(calls[0].fragmentedVideo,true);
  assert.equal(store.start({fragmentedVideo:true}).fragmentedVideo,false);
});

test("does not render beyond the acknowledged playback window",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({firstSegmentMs:400,segmentMs:400,maxUnacknowledgedSegments:2,renderer:{render:async(_wav,_action,options)=>{calls.push(options);return{url:`/${calls.length}.mp4`,metrics:{frames:options.outputFrames}};}}});
  const session=store.start({videoOnly:true,fragmentedVideo:true,renderBackpressure:true});
  assert.equal(session.renderBackpressure,true);assert.equal(session.maxUnacknowledgedSegments,2);
  store.append(session.id,0,Buffer.alloc(46_080));
  const draining=store.drain(session.id);await new Promise(resolve=>setImmediate(resolve));
  assert.equal(calls.length,2);
  assert.deepEqual(store.acknowledge(session.id,0),{id:session.id,acknowledged:true,sequence:0,unacknowledged:1});
  await draining;assert.equal(calls.length,3);
  assert.equal(store.acknowledge(session.id,99).sequence,2);
});

test("cancelling a backpressured stream wakes the blocked renderer",async()=>{
  const store=new DINetStreamSessionStore({firstSegmentMs:400,segmentMs:400,maxUnacknowledgedSegments:1,renderer:{render:async(_wav,_action,options)=>({url:"/part.mp4",metrics:{frames:options.outputFrames}})}});
  const session=store.start({videoOnly:true,fragmentedVideo:true,renderBackpressure:true});store.append(session.id,0,Buffer.alloc(33_280));
  const draining=store.drain(session.id);await new Promise(resolve=>setImmediate(resolve));store.cancel(session.id);
  await assert.rejects(draining,error=>error.status===409);
});

test("retains a completed backpressured session until final playback acknowledgement",async()=>{
  const released=[];
  const store=new DINetStreamSessionStore({firstSegmentMs:400,releaseAudio:id=>released.push(id),renderer:{render:async(_wav,_action,options)=>({url:"/part.mp4",metrics:{frames:options.outputFrames}})}});
  const session=store.start({videoOnly:true,fragmentedVideo:true,renderBackpressure:true});store.append(session.id,0,Buffer.alloc(20_480));
  await store.drain(session.id);assert.deepEqual(store.complete(session.id),{id:session.id,completed:true,segments:1,audioMs:400});
  assert.deepEqual(released,[]);
  assert.deepEqual(store.acknowledge(session.id,0),{id:session.id,acknowledged:true,sequence:0,unacknowledged:0});
  assert.deepEqual(released,[session.id]);assert.equal(store.acknowledge(session.id,0).acknowledged,false);
});

test("defaults to uniform 800 ms segments that preserve playback headroom",async()=>{
  const durations=[];
  const store=new DINetStreamSessionStore({
    renderer:{render:async(wav,_action,options)=>{durations.push(wav.readUInt32LE(40)/32);return{url:"/part.mp4",metrics:{frames:options.outputFrames}};}}
  });
  const session=store.start();
  store.append(session.id,0,Buffer.alloc(84_480));
  await store.drain(session.id);
  assert.deepEqual(durations,[800,800,800]);
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

test("forwards visual turn ordering to every rendered segment",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({firstSegmentMs:400,segmentMs:400,renderer:{render:async(_wav,_action,options)=>{calls.push(options);return{url:"/part.mp4",metrics:{frames:options.outputFrames}};}}});
  const session=store.start({visualTurnId:"turn-1",visualSentenceIndex:2});
  store.append(session.id,0,Buffer.alloc(33_280));await store.drain(session.id);
  assert.equal(calls.length,2);
  assert.deepEqual(calls.map(({visualTurnId,visualSentenceIndex})=>[visualTurnId,visualSentenceIndex]),[["turn-1",2],["turn-1",2]]);
});

test("can cap one drain without losing the buffered tail",async()=>{
  const calls=[];
  const store=new DINetStreamSessionStore({firstSegmentMs:400,segmentMs:400,renderer:{render:async(_wav,_action,options)=>{calls.push(options);return{url:"/part.mp4",metrics:{frames:options.outputFrames}};}}});
  const session=store.start();store.append(session.id,0,Buffer.alloc(33_280));
  await store.drain(session.id,{maxSegments:1});assert.equal(calls.length,1);
  await store.drain(session.id);assert.equal(calls.length,2);
});
