import test from "node:test";
import assert from "node:assert/strict";
import { loadPcmBytes } from "../public/pcm-segment.js";

test("loads an opaque PCM URL without caching",async()=>{
  const calls=[];
  const bytes=await loadPcmBytes({url:"/api/dinet/pcm/aabb",bytes:4},{
    fetchImpl:async(...args)=>{calls.push(args);return{ok:true,arrayBuffer:async()=>Uint8Array.from([1,2,3,4]).buffer};}
  });
  assert.deepEqual([...bytes],[1,2,3,4]);
  assert.deepEqual(calls,[["/api/dinet/pcm/aabb",{cache:"no-store"}]]);
});

test("keeps embedded base64 compatibility and rejects truncated PCM",async()=>{
  const decoded=await loadPcmBytes({data:"ignored"},{decodeBase64:()=>Uint8Array.from([5,6])});
  assert.deepEqual([...decoded],[5,6]);
  const truncated=await loadPcmBytes({url:"/pcm",bytes:4},{fetchImpl:async()=>({ok:true,arrayBuffer:async()=>Uint8Array.from([1,2]).buffer})});
  assert.equal(truncated,null);
});
