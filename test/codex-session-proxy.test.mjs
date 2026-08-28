import assert from "node:assert/strict";
import test from "node:test";
import { createCodexSessionProxy } from "../src/codex-session-proxy.mjs";

test("forwards normalized final text with the private bridge token",async()=>{
  const calls=[];
  const proxy=createCodexSessionProxy({baseUrl:"http://127.0.0.1:4321",token:"private",fetchImpl:async(url,options)=>{
    calls.push({url,options});return new Response(JSON.stringify({message_id:"msg_1"}),{status:201});
  }});
  await proxy.message({sessionId:`ses_${"a".repeat(32)}`,role:"user",text:"你好",source:"speech-final"});
  assert.equal(calls[0].url,`http://127.0.0.1:4321/v1/sessions/ses_${"a".repeat(32)}/messages`);
  assert.equal(calls[0].options.headers.authorization,"Bearer private");
});

test("rejects non-final and mismatched message sources",async()=>{
  const proxy=createCodexSessionProxy({baseUrl:"http://127.0.0.1:4321",token:"private"});
  await assert.rejects(()=>proxy.message({sessionId:`ses_${"a".repeat(32)}`,role:"assistant",text:"x",source:"speech-final"}),/Invalid message/);
});

test("is explicitly unavailable without launcher configuration",async()=>{
  const proxy=createCodexSessionProxy({});
  assert.equal(proxy.enabled,false);
  await assert.rejects(()=>proxy.start(),error=>error.status===503);
});
