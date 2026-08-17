export function normalizeAsrBaseUrl(value="http://127.0.0.1:8010"){
  const url=new URL(String(value||"http://127.0.0.1:8010"));
  if(!["http:","https:"].includes(url.protocol))throw new Error("本地 ASR 地址只支持 HTTP 或 HTTPS");
  url.pathname=url.pathname.replace(/\/$/,"");
  return url.toString().replace(/\/$/,"");
}

export function localAsrEndpoint(baseUrl,path="/api/asr/transcribe"){
  const normalizedPath=`/${String(path||"").replace(/^\/+/,"")}`;
  return `${normalizeAsrBaseUrl(baseUrl)}${normalizedPath}`;
}

export async function transcribeLocalAudio(audio,{
  baseUrl="http://127.0.0.1:8010",
  path="/api/asr/transcribe",
  language="zh-CN",
  timeoutMs=30_000,
  fetchImpl=fetch
}={}){
  if(!audio?.length)throw Object.assign(new Error("语音内容不能为空"),{status:400});
  const form=new FormData();
  form.append("audio",new Blob([audio],{type:"audio/wav"}),"voice.wav");
  form.append("language",language);
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),Math.max(1000,Number(timeoutMs)||30_000));timer.unref?.();
  try{
    const startedAt=performance.now();
    const response=await fetchImpl(localAsrEndpoint(baseUrl,path),{method:"POST",body:form,signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(payload.detail||payload.error||`本地语音识别失败 (${response.status})`),{status:502});
    const text=String(payload.text||"").trim();
    if(!text)throw Object.assign(new Error("本地语音识别没有返回文字"),{status:502});
    return{text,provider:String(payload.provider||payload.asr_provider||"local_sherpa"),durationMs:Number(payload.duration_ms)||Math.round(performance.now()-startedAt)};
  }catch(error){
    if(error.name==="AbortError")throw Object.assign(new Error("本地语音识别超时"),{status:504});
    throw error;
  }finally{clearTimeout(timer);}
}

export async function readLocalAsrHealth({baseUrl="http://127.0.0.1:8010",timeoutMs=1500,fetchImpl=fetch}={}){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);timer.unref?.();
  try{
    const response=await fetchImpl(`${normalizeAsrBaseUrl(baseUrl)}/health`,{signal:controller.signal});
    const payload=await response.json().catch(()=>({}));
    return{ready:response.ok&&payload.ok!==false,provider:String(payload.asr_provider||"local_sherpa")};
  }catch{return{ready:false,provider:"local_sherpa"};}
  finally{clearTimeout(timer);}
}
