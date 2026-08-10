import test from "node:test";
import assert from "node:assert/strict";
import { BoundedAsyncCache } from "../src/audio-cache.mjs";

test("deduplicates speech work and evicts the oldest entry",async()=>{
  const cache=new BoundedAsyncCache(2);
  let calls=0;
  const first=cache.getOrCreate("a",async()=>{calls++;return "audio-a";});
  const repeated=cache.getOrCreate("a",async()=>{calls++;return "wrong";});
  assert.equal(first.hit,false);
  assert.equal(repeated.hit,true);
  assert.equal(await repeated.value,"audio-a");
  assert.equal(calls,1);
  cache.getOrCreate("b",async()=>"audio-b");
  cache.getOrCreate("c",async()=>"audio-c");
  assert.equal(cache.getOrCreate("a",async()=>"new-a").hit,false);
});

test("does not retain failed speech work",async()=>{
  const cache=new BoundedAsyncCache();
  const failed=cache.getOrCreate("a",async()=>{throw new Error("failed");});
  await assert.rejects(failed.value,/failed/);
  assert.equal(cache.getOrCreate("a",async()=>"recovered").hit,false);
});
