export function createCodexSession({ fetchImpl=fetch,storage=sessionStorage,initialSessionId }={}){
  const storageKey="lumi-codex-session-id";
  if(initialSessionId===undefined){try{initialSessionId=new URL(globalThis.location?.href||"http://127.0.0.1/").searchParams.get("codexSession")||"";}catch{initialSessionId="";}}
  let sessionId=/^ses_[a-f0-9]{32}$/.test(initialSessionId)?initialSessionId:storage.getItem(storageKey)||"";
  if(sessionId)storage.setItem(storageKey,sessionId);
  let pending=Promise.resolve();

  const post=async(path,body)=>{
    const response=await fetchImpl(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    const payload=await response.json().catch(()=>({}));
    if(!response.ok){const error=new Error(payload.error||"Codex session request failed");error.status=response.status;throw error;}
    return payload;
  };
  const ensure=async()=>{
    if(sessionId)return sessionId;
    const session=await post("/api/codex-session/start",{});
    sessionId=String(session.session_id||"");
    if(sessionId)storage.setItem(storageKey,sessionId);
    return sessionId;
  };
  const enqueue=work=>{
    pending=pending.then(work,work).catch(()=>{});
    return pending;
  };
  const record=(role,text,source)=>enqueue(async()=>{
    let id=await ensure();
    if(!id)return;
    try{await post("/api/codex-session/message",{sessionId:id,role,text,source});}
    catch(error){
      if(error.status!==404)throw error;
      sessionId="";storage.removeItem(storageKey);id=await ensure();
      if(id)await post("/api/codex-session/message",{sessionId:id,role,text,source});
    }
  });

  return {
    recordUser:(text,source="typed")=>record("user",text,source),
    recordAssistant:text=>record("assistant",text,"assistant-final"),
    end:()=>enqueue(async()=>{
      if(!sessionId)return;
      const endedId=sessionId;
      try{await post("/api/codex-session/end",{sessionId:endedId});}
      finally{sessionId="";storage.removeItem(storageKey);}
    })
  };
}
