import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMiniMaxTtsEmotion, streamMiniMaxPcm } from "../src/minimax-stream-tts.mjs";

class FakeWebSocket {
  static OPEN=1;
  constructor(_url,options){
    this.readyState=1;this.options=options;this.queue=[];this.waiters=[];
    this.push({event:"connected_success",base_resp:{status_code:0}});
  }
  push(message){const value=Buffer.from(JSON.stringify(message));const waiter=this.waiters.shift();if(waiter)waiter({value,done:false});else this.queue.push(value);}
  send(raw){
    const message=JSON.parse(raw);this.sent??=[];this.sent.push(message);
    if(message.event==="task_start")this.push({event:"task_started",base_resp:{status_code:0}});
    if(message.event==="task_continue")this.push({event:"task_continued",data:{audio:Buffer.alloc(3200,7).toString("hex")},base_resp:{status_code:0}});
    if(message.event==="task_finish")this.push({event:"task_finished",base_resp:{status_code:0}});
  }
  close(){this.readyState=3;const waiter=this.waiters.shift();if(waiter)waiter({done:true});}
  [Symbol.asyncIterator](){return{next:()=>this.queue.length?Promise.resolve({value:this.queue.shift(),done:false}):new Promise(resolve=>this.waiters.push(resolve))};}
}

test("MiniMax websocket TTS requests PCM and yields audio before task completion",async()=>{
  const chunks=[];
  const metrics=await streamMiniMaxPcm({apiKey:"secret",text:"你好",voice:"voice",WebSocketImpl:FakeWebSocket,onAudio:pcm=>chunks.push(pcm)});
  assert.equal(chunks.length,1);assert.equal(chunks[0].length,3200);
  assert.equal(metrics.audioMs,100);assert.ok(metrics.firstAudioMs>=0);
});

test("only sends MiniMax-supported speech emotions",async()=>{
  assert.equal(normalizeMiniMaxTtsEmotion("happy"),"happy");
  assert.equal(normalizeMiniMaxTtsEmotion("caring"),"");
  const sockets=[];
  class InspectSocket extends FakeWebSocket{constructor(...args){super(...args);sockets.push(this);}}
  await streamMiniMaxPcm({apiKey:"secret",text:"慢慢来",voice:"voice",emotion:"caring",WebSocketImpl:InspectSocket,onAudio:()=>{}});
  assert.equal("emotion" in sockets[0].sent.find(item=>item.event==="task_start").voice_setting,false);
});

class EventWebSocket {
  static OPEN=1;
  constructor(){this.readyState=1;this.handlers=new Map();queueMicrotask(()=>this.emit("message",Buffer.from(JSON.stringify({event:"connected_success",base_resp:{status_code:0}}))));}
  on(name,callback){const list=this.handlers.get(name)||[];list.push(callback);this.handlers.set(name,list);}
  emit(name,value){for(const callback of this.handlers.get(name)||[])callback(value);}
  send(raw){const message=JSON.parse(raw);if(message.event==="task_start")queueMicrotask(()=>this.emit("message",Buffer.from(JSON.stringify({event:"task_started",base_resp:{status_code:0}}))));if(message.event==="task_continue")queueMicrotask(()=>this.emit("message",Buffer.from(JSON.stringify({event:"task_continued",data:{audio:Buffer.alloc(320,2).toString("hex")},base_resp:{status_code:0}}))));if(message.event==="task_finish")queueMicrotask(()=>this.emit("message",Buffer.from(JSON.stringify({event:"task_finished",base_resp:{status_code:0}}))));}
  close(){this.readyState=3;this.emit("close");}
}

test("supports the event-emitter interface used by the real ws package",async()=>{
  let bytes=0;
  const result=await streamMiniMaxPcm({apiKey:"secret",text:"好",voice:"voice",WebSocketImpl:EventWebSocket,onAudio:pcm=>{bytes+=pcm.length;}});
  assert.equal(bytes,320);assert.equal(result.audioMs,10);
});
