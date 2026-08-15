import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile,rm,stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LatencySampleStore } from "../src/latency-sample-store.mjs";

test("persists only bounded anonymous latency samples across reloads",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"lumi-latency-")),file=join(directory,"samples.json");
  try{
    const store=new LatencySampleStore(file,{limit:3});
    await store.append({recordedAt:"2026-08-14T00:00:00Z",firstSpeechMs:700,message:"private",traceId:"secret"});
    await store.append({firstSpeechMs:800});await store.append({firstSpeechMs:900});await store.append({firstSpeechMs:1000});
    const reloaded=new LatencySampleStore(file,{limit:3}),samples=await reloaded.snapshot();
    assert.deepEqual(samples.map(item=>item.firstSpeechMs),[800,900,1000]);
    assert.doesNotMatch(await readFile(file,"utf8"),/private|secret|traceId|message|recordedAt|2026-08-14/);
    assert.equal((await stat(file)).mode&0o777,0o600);
  }finally{await rm(directory,{recursive:true,force:true});}
});
