import test from "node:test";
import assert from "node:assert/strict";
import { createClientTimingReporter } from "../public/client-timing-reporter.js";

test("retries a transient timing delivery without changing the payload",async()=>{
  const calls=[],waits=[];
  const report=createClientTimingReporter({
    fetchImpl:async(url,options)=>{calls.push({url,options});return calls.length===1?{ok:false,status:503}:{ok:true,status:202};},
    retryDelaysMs:[0,120,480],sleep:async ms=>waits.push(ms)
  });
  const payload={traceId:"trace-1",event:"formal-speech",requestToEventMs:1800};
  assert.deepEqual(await report(payload),{ok:true,attempts:2,status:202});
  assert.deepEqual(waits,[120]);
  assert.equal(calls.length,2);
  assert.equal(calls[0].url,"/api/chat/debug/client-timing");
  assert.equal(calls[0].options.keepalive,true);
  assert.deepEqual(JSON.parse(calls[0].options.body),payload);
  assert.equal(calls[0].options.body,calls[1].options.body);
});

test("does not retry a permanently invalid timing payload",async()=>{
  let calls=0;
  const report=createClientTimingReporter({fetchImpl:async()=>{calls++;return{ok:false,status:400};},retryDelaysMs:[0,10,20],sleep:async()=>{}});
  assert.deepEqual(await report({event:"bad"}),{ok:false,attempts:1,status:400});
  assert.equal(calls,1);
});

test("bounds network retries and reports failure without throwing",async()=>{
  let calls=0;
  const report=createClientTimingReporter({fetchImpl:async()=>{calls++;throw new Error("offline");},retryDelaysMs:[0,10,20],sleep:async()=>{}});
  assert.deepEqual(await report({event:"formal-speech"}),{ok:false,attempts:3,status:0});
  assert.equal(calls,3);
});
