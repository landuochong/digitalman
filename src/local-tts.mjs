export async function synthesizeLocalSpeech({text,format="wav",baseUrl="http://127.0.0.1:8020",signal,fetchImpl=fetch}={}){
  const timeout=AbortSignal.timeout(180_000);
  const combined=signal?AbortSignal.any([signal,timeout]):timeout;
  const response=await fetchImpl(`${baseUrl.replace(/\/$/,"")}/synthesize`,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,format}),signal:combined
  });
  if(!response.ok)throw new Error(`本地 Qwen3-TTS 合成失败 (${response.status})`);
  const audio=Buffer.from(await response.arrayBuffer());
  if(!audio.length||(format==="pcm"&&audio.length%2))throw new Error("本地 TTS 返回了无效音频");
  if(format==="wav"&&(audio.toString("ascii",0,4)!=="RIFF"||audio.toString("ascii",8,12)!=="WAVE"))throw new Error("本地 TTS 未返回 WAV 音频");
  return{audio,contentType:format==="pcm"?"application/octet-stream":"audio/wav",generationMs:Number(response.headers.get("x-generation-ms"))||0};
}
