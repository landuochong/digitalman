import WebSocket from "ws";

function decodeAudio(value) {
  const text=String(value||"");
  return /^[0-9a-f]+$/i.test(text)&&text.length%2===0 ? Buffer.from(text,"hex") : Buffer.from(text,"base64");
}

async function* messages(socket) {
  if (typeof socket[Symbol.asyncIterator] === "function") {
    yield* socket;
    return;
  }
  const queue=[];const waiters=[];let ended=false,failure=null;
  const wake=()=>{while(waiters.length&&(queue.length||ended||failure))waiters.shift()();};
  socket.on("message",data=>{queue.push(data);wake();});
  socket.on("close",()=>{ended=true;wake();});
  socket.on("error",error=>{failure=error;ended=true;wake();});
  while(true){
    while(!queue.length&&!ended&&!failure)await new Promise(resolve=>waiters.push(resolve));
    if(failure)throw failure;
    if(queue.length){yield queue.shift();continue;}
    break;
  }
}

export async function streamMiniMaxPcm({
  apiKey,text,model="speech-2.8-turbo",voice,emotion,
  url="wss://api.minimaxi.com/ws/v1/t2a_v2",signal,onAudio,onEvent,WebSocketImpl=WebSocket
}) {
  if(!apiKey)throw new Error("缺少 MiniMax API Key");
  const socket=new WebSocketImpl(url,{headers:{Authorization:`Bearer ${apiKey}`}});
  const startedAt=performance.now();let firstAudioAt=null,totalBytes=0;
  const abort=()=>socket.close(1000,"cancelled");
  signal?.addEventListener("abort",abort,{once:true});
  try{
    for await(const raw of messages(socket)){
      const message=JSON.parse(String(raw));
      const code=message?.base_resp?.status_code;
      if(code&&code!==0)throw new Error(message?.base_resp?.status_msg||`MiniMax TTS 失败 (${code})`);
      onEvent?.(message.event||"audio",message);
      if(message.event==="connected_success"){
        socket.send(JSON.stringify({
          event:"task_start",model,language_boost:"Chinese",
          voice_setting:{voice_id:voice,speed:1,vol:1,pitch:0,...(emotion?{emotion}: {})},
          audio_setting:{sample_rate:16000,bitrate:256000,format:"pcm",channel:1}
        }));
      }else if(message.event==="task_started"){
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
  return {bytes:totalBytes,audioMs:Math.round(totalBytes/32),firstAudioMs:firstAudioAt?Math.round(firstAudioAt-startedAt):null,totalMs:Math.round(completedAt-startedAt)};
}
