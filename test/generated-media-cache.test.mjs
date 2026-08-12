import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp,readFile,stat,utimes,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { GeneratedMediaCache } from "../src/generated-media-cache.mjs";

const name=index=>`${index.toString(16).padStart(24,"0")}.mp4`;

test("evicts oldest generated MP4 files to both count and byte limits",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"lumi-media-cache-")),now=1_800_000_000_000;
  for(let index=1;index<=5;index++){
    const path=join(directory,name(index));await writeFile(path,Buffer.alloc(100,index));
    const time=new Date(now-(10-index)*1000);await utimes(path,time,time);
  }
  await writeFile(join(directory,"keep.txt"),"project file");
  const cache=new GeneratedMediaCache({directory,maxFiles:3,maxBytes:250,minAgeMs:0,now:()=>now});
  const result=await cache.prune();
  assert.deepEqual(result.before,{files:5,bytes:500});
  assert.deepEqual(result.after,{files:2,bytes:200});
  assert.equal(result.removedFiles,3);assert.equal(result.overLimit,false);
  assert.equal(await readFile(join(directory,"keep.txt"),"utf8"),"project file");
  await assert.rejects(stat(join(directory,name(1))),error=>error.code==="ENOENT");
  assert.equal((await stat(join(directory,name(5)))).size,100);
});

test("protects recent and explicitly in-use outputs even while over limit",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"lumi-media-cache-")),now=1_800_000_000_000;
  const old=join(directory,name(1)),protectedPath=join(directory,name(2)),recent=join(directory,name(3));
  for(const path of [old,protectedPath,recent])await writeFile(path,Buffer.alloc(100));
  await utimes(old,new Date(now-60_000),new Date(now-60_000));
  await utimes(protectedPath,new Date(now-60_000),new Date(now-60_000));
  await utimes(recent,new Date(now-500),new Date(now-500));
  const cache=new GeneratedMediaCache({directory,maxFiles:0,maxBytes:0,minAgeMs:10_000,now:()=>now});
  const result=await cache.prune({protectedPaths:[protectedPath]});
  assert.equal(result.removedFiles,1);assert.equal(result.overLimit,true);
  await assert.rejects(stat(old),error=>error.code==="ENOENT");
  assert.equal((await stat(protectedPath)).size,100);assert.equal((await stat(recent)).size,100);
});

test("use atomically confirms and promotes a cache hit before later eviction",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"lumi-media-cache-")),now=1_800_000_000_000;
  const hit=join(directory,name(1)),other=join(directory,name(2));
  await writeFile(hit,Buffer.alloc(10));await writeFile(other,Buffer.alloc(10));
  await utimes(hit,new Date(now-20_000),new Date(now-20_000));await utimes(other,new Date(now-10_000),new Date(now-10_000));
  const cache=new GeneratedMediaCache({directory,maxFiles:1,maxBytes:100,minAgeMs:0,now:()=>now});
  assert.equal((await cache.use(hit)).size,10);await cache.prune();
  assert.equal((await stat(hit)).size,10);await assert.rejects(stat(other),error=>error.code==="ENOENT");
  assert.equal(await cache.use(join(directory,name(9))),null);
});

test("reports cache limits and whether protected files leave it temporarily over limit",async()=>{
  const directory=await mkdtemp(join(tmpdir(),"lumi-media-cache-"));
  await writeFile(join(directory,name(1)),Buffer.alloc(80));await writeFile(join(directory,name(2)),Buffer.alloc(80));
  const cache=new GeneratedMediaCache({directory,maxFiles:1,maxBytes:100,minAgeMs:60_000});
  assert.deepEqual(await cache.snapshot(),{files:2,bytes:160,maxFiles:1,maxBytes:100,minAgeMs:60_000,overLimit:true});
});
