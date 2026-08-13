import test from "node:test";
import assert from "node:assert/strict";
import { EphemeralPcmStore } from "../src/ephemeral-pcm-store.mjs";

test("publishes opaque short-lived PCM segments",()=>{
  let now=1000;const store=new EphemeralPcmStore({ttlMs:100,maxBytes:4096,now:()=>now});
  const published=store.put(Buffer.alloc(320),{streamId:"turn-1",sequence:2});
  assert.match(published.url,/^\/api\/dinet\/pcm\/[a-f0-9]{32}$/);assert.equal(published.bytes,320);
  assert.equal(store.get(published.token).sequence,2);assert.equal(store.snapshot().bytes,320);
  now=1101;assert.equal(store.get(published.token),null);assert.equal(store.snapshot().bytes,0);
});

test("bounds memory and can release a cancelled stream",()=>{
  const store=new EphemeralPcmStore({maxBytes:1024});
  const first=store.put(Buffer.alloc(600),{streamId:"a"});
  const second=store.put(Buffer.alloc(600),{streamId:"b"});
  assert.equal(store.get(first.token),null);assert.ok(store.get(second.token));
  assert.equal(store.deleteStream("b"),1);assert.equal(store.snapshot().entries,0);
  assert.equal(store.get("../../secret"),null);
});
