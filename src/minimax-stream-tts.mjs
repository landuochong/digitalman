import WebSocket from "ws";

const SUPPORTED_TTS_EMOTIONS=new Set(["happy","sad","angry","fearful","disgusted","surprised","neutral"]);
export function normalizeMiniMaxTtsEmotion(emotion){return SUPPORTED_TTS_EMOTIONS.has(String(emotion||"").toLowerCase())?String(emotion).toLowerCase():"";}

function decodeAudio(value) {
  const text=String(value||"");
  return /^[0-9a-f]+$/i.test(text)&&text.length%2===0 ? Buffer.from(text,"hex") : Buffer.from(text,"base64");
}

function messageInbox(socket) {
  const queue=[];const waiters=[];let ended=false,failure=null;
  const wake=()=>{while(waiters.length&&(queue.length||ended||failure))waiters.shift()();};
  const push=data=>{queue.push(data);wake();},close=()=>{ended=true;wake();},fail=error=>{failure=error;ended=true;wake();};
  if(typeof socket.on==="function"){
    socket.on("message",push);socket.on("close",close);socket.on("error",fail);
  }else if(typeof socket[Symbol.asyncIterator]==="function"){
    void(async()=>{try{for await(const data of socket)push(data);close();}catch(error){fail(error);}})();
  }else fail(new Error("MiniMax TTS WebSocket 不支持消息读取"));
  return{async next(){
    while(!queue.length&&!ended&&!failure)await new Promise(resolve=>waiters.push(resolve));
    if(failure)throw failure;
    return queue.length?{value:queue.shift(),done:false}:{done:true};
  }};
}

async function nextMessage(connection) {
  const item=await connection.inbox.next();
  if(item.done)throw new Error("MiniMax TTS 连接提前关闭");
  const message=JSON.parse(String(item.value));
  const code=message?.base_resp?.status_code;
  if(code&&code!==0)throw new Error(message?.base_resp?.status_msg||`MiniMax TTS 失败 (${code})`);
  return message;
}

export function prepareMiniMaxTtsConnection({
  apiKey,url="wss://api.minimaxi.com/ws/v1/t2a_v2",WebSocketImpl=WebSocket
}={}) {
  if(!apiKey)throw new Error("缺少 MiniMax API Key");
  const socket=new WebSocketImpl(url,{headers:{Authorization:`Bearer ${apiKey}`}}),inbox=messageInbox(socket),startedAt=performance.now();
  const connection={socket,inbox,startedAt,ready:null,used:false,WebSocketImpl};
  connection.ready=(async()=>{
    while(true){
      const message=await nextMessage(connection);
      if(message.event==="connected_success")return{connectedAt:performance.now(),sessionId:message.session_id||""};
      if(message.event==="task_failed")throw new Error(message?.base_resp?.status_msg||"MiniMax TTS 连接失败");
    }
  })();
  // A caller may prepare speculatively and never consume it. Keep a rejected
  // connection from becoming an unhandled promise while preserving rejection
  // for the eventual consumer.
  connection.ready.catch(()=>{});
  connection.close=()=>{if(socket.readyState===WebSocketImpl.OPEN)socket.close(1000,"unused");};
  return connection;
}

export async function streamMiniMaxPcm({
  apiKey,text,model="speech-2.8-turbo",voice,emotion,
  url="wss://api.minimaxi.com/ws/v1/t2a_v2",signal,onAudio,onEvent,WebSocketImpl=WebSocket,connection=null
}) {
  if(!apiKey)throw new Error("缺少 MiniMax API Key");
  const prepared=connection||prepareMiniMaxTtsConnection({apiKey,url,WebSocketImpl});
  if(prepared.used)throw new Error("MiniMax TTS 预连接已经使用");
  prepared.used=true;
  const socket=prepared.socket;
  const startedAt=performance.now();let firstAudioAt=null,totalBytes=0,connectionReadyAt=null;
  const abort=()=>socket.close(1000,"cancelled");
  signal?.addEventListener("abort",abort,{once:true});
  try{
    const ready=await prepared.ready;connectionReadyAt=ready.connectedAt;
    const speechEmotion=normalizeMiniMaxTtsEmotion(emotion);
    socket.send(JSON.stringify({
      event:"task_start",model,language_boost:"Chinese",
      voice_setting:{voice_id:voice,speed:1,vol:1,pitch:0,...(speechEmotion?{emotion:speechEmotion}: {})},
      audio_setting:{sample_rate:16000,bitrate:256000,format:"pcm",channel:1}
    }));
    while(true){
      const message=await nextMessage(prepared);
      onEvent?.(message.event||"audio",message);
      if(message.event==="task_started"){
        socket.send(JSON.stringify({event:"task_continue",text}));
        socket.send(JSON.stringify({event:"task_finish"}));
      }
      const encoded=message?.data?.audio;
      if(encoded){
        const pcm=decodeAudio(encoded);
        if(pcm.length){firstAudioAt??=performance.now();totalBytes+=pcm.length;await onAudio?.(pcm,message);}
      }
      if(message.event==="task_finished")break;
      if(message.event==="task_failed")throw new Error(message?.base_resp?.status_msg||"MiniMax TTS 任务失败");
    }
  }finally{
    signal?.removeEventListener("abort",abort);
    if(socket.readyState===WebSocketImpl.OPEN)socket.close();
  }
  const completedAt=performance.now();
  return {bytes:totalBytes,audioMs:Math.round(totalBytes/32),firstAudioMs:firstAudioAt?Math.round(firstAudioAt-startedAt):null,totalMs:Math.round(completedAt-startedAt),connectionReused:Boolean(connection),connectionWaitMs:connectionReadyAt?Math.max(0,Math.round(connectionReadyAt-startedAt)):null,connectionLeadMs:connectionReadyAt?Math.max(0,Math.round(startedAt-connectionReadyAt)):null};
}
