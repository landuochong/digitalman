import assert from "node:assert/strict";
import test from "node:test";
import { createCodexSession } from "../public/codex-session.js";

test("orders user and assistant final text before ending",async()=>{
  const calls=[];
  const values=new Map();
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const sessionId=`ses_${"b".repeat(32)}`;
  const fetchImpl=async(path,options)=>{
    calls.push({path,body:JSON.parse(options.body)});
    return new Response(JSON.stringify(path.endsWith("/start")?{session_id:sessionId}:{ok:true}),{status:path.endsWith("/start")?201:200});
  };
  const session=createCodexSession({fetchImpl,storage});
  session.recordUser("你好","typed");
  session.recordAssistant("晚上好");
  await session.end();
  assert.deepEqual(calls.map(call=>call.path),[
    "/api/codex-session/start",
    "/api/codex-session/message",
    "/api/codex-session/message",
    "/api/codex-session/end"
  ]);
  assert.deepEqual(calls.slice(1,3).map(call=>call.body.source),["typed","assistant-final"]);
});

test("replaces an expired session and retries the final text once",async()=>{
  const oldId=`ses_${"c".repeat(32)}`,newId=`ses_${"d".repeat(32)}`;
  const values=new Map([["lumi-codex-session-id",oldId]]),calls=[];
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const fetchImpl=async(path,options)=>{
    const body=JSON.parse(options.body);calls.push({path,body});
    if(path.endsWith("/message")&&body.sessionId===oldId)return new Response(JSON.stringify({error:"Session not found"}),{status:404});
    return new Response(JSON.stringify(path.endsWith("/start")?{session_id:newId}:{ok:true}),{status:path.endsWith("/start")?201:200});
  };
  const session=createCodexSession({fetchImpl,storage});
  await session.recordUser("重新开始","typed");
  assert.deepEqual(calls.map(call=>call.path),["/api/codex-session/message","/api/codex-session/start","/api/codex-session/message"]);
  assert.equal(calls.at(-1).body.sessionId,newId);
});

test("accepts the launcher's pre-created session without exposing a token",async()=>{
  const sessionId=`ses_${"e".repeat(32)}`,calls=[],values=new Map();
  const storage={getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  const session=createCodexSession({initialSessionId:sessionId,storage,fetchImpl:async(path,options)=>{calls.push({path,body:JSON.parse(options.body)});return new Response(JSON.stringify({ok:true}),{status:200});}});
  await session.recordUser("已打开","typed");
  assert.equal(calls.length,1);
  assert.equal(calls[0].body.sessionId,sessionId);
  assert.equal(values.get("lumi-codex-session-id"),sessionId);
});
