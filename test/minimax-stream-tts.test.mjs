import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMiniMaxTtsEmotion, prepareMiniMaxTtsConnection, streamMiniMaxPcm } from "../src/minimax-stream-tts.mjs";

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
  assert.equal(normalizeMiniMaxTtsEmotion("excited"),"happy");
  assert.equal(normalizeMiniMaxTtsEmotion("caring"),"neutral");
  const sockets=[];
  class InspectSocket extends FakeWebSocket{constructor(...args){super(...args);sockets.push(this);}}
  await streamMiniMaxPcm({apiKey:"secret",text:"慢慢来",voice:"voice",emotion:"caring",WebSocketImpl:InspectSocket,onAudio:()=>{}});
  assert.equal(sockets[0].sent.find(item=>item.event==="task_start").voice_setting.emotion,"neutral");
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

test("reuses a connection established while reply text is still pending",async()=>{
  const connection=prepareMiniMaxTtsConnection({apiKey:"secret",WebSocketImpl:FakeWebSocket});
  await connection.ready;
  const chunks=[];
  const result=await streamMiniMaxPcm({apiKey:"secret",text:"你好",voice:"voice",WebSocketImpl:FakeWebSocket,connection,onAudio:pcm=>chunks.push(pcm)});
  assert.equal(chunks.length,1);
  assert.equal(result.connectionReused,true);
  assert.equal(result.connectionWaitMs,0);
  await assert.rejects(()=>streamMiniMaxPcm({apiKey:"secret",text:"重复",voice:"voice",connection,onAudio:()=>{}}),/已经使用/);
});

test("primes the TTS task while reply text is still pending",async()=>{
  const connection=prepareMiniMaxTtsConnection({apiKey:"secret",WebSocketImpl:FakeWebSocket,primeTask:true,model:"speech-2.8-turbo",voice:"voice",emotion:"happy"});
  await connection.taskReady;
  const result=await streamMiniMaxPcm({apiKey:"secret",text:"你好",model:"speech-2.8-turbo",voice:"voice",emotion:"happy",WebSocketImpl:FakeWebSocket,connection,onAudio:()=>{}});
  assert.equal(result.connectionReused,true);
  assert.equal(result.taskPrimed,true);
  assert.equal(result.connectionWaitMs,0);
  assert.equal(result.taskWaitMs,0);
  const taskStart=connection.socket.sent.find(item=>item.event==="task_start");
  assert.equal(taskStart.voice_setting.voice_id,"voice");
  assert.equal(taskStart.voice_setting.emotion,"happy");
  assert.deepEqual(connection.socket.sent.filter(item=>item.event==="task_start").length,1);
});

test("cancels a speculative connection before it starts speaking",async()=>{
  class WaitingSocket extends FakeWebSocket{
    constructor(...args){super(...args);this.queue=[];}
  }
  const controller=new AbortController(),work=streamMiniMaxPcm({apiKey:"secret",text:"我在。",voice:"voice",WebSocketImpl:WaitingSocket,signal:controller.signal,onAudio:()=>{}});
  controller.abort();
  await assert.rejects(work,/提前关闭|cancelled/);
});

test("can trim only the leading silence before publishing streamed PCM",async()=>{
  class PaddedSocket extends FakeWebSocket{
    send(raw){
      const message=JSON.parse(raw);this.sent??=[];this.sent.push(message);
      if(message.event==="task_start")this.push({event:"task_started",base_resp:{status_code:0}});
      if(message.event==="task_continue"){
        const padded=Buffer.alloc(9600);for(let offset=6400;offset<padded.length;offset+=2)padded.writeInt16LE(1800,offset);
        this.push({event:"task_continued",data:{audio:padded.toString("hex")},base_resp:{status_code:0}});
      }
      if(message.event==="task_finish")this.push({event:"task_finished",base_resp:{status_code:0}});
    }
  }
  const chunks=[],result=await streamMiniMaxPcm({apiKey:"secret",text:"你好",voice:"voice",WebSocketImpl:PaddedSocket,trimLeadingSilence:true,onAudio:pcm=>chunks.push(pcm)});
  assert.equal(result.trimmedLeadingMs,140);assert.equal(result.audioMs,160);assert.equal(Buffer.concat(chunks).length,5120);
});
