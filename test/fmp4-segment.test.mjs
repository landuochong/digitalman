import test from "node:test";
import assert from "node:assert/strict";
import { bufferedVideoAhead,removableVideoRange,splitFragmentedMp4 } from "../public/fmp4-segment.js";

function box(type,payload=[]){const result=Buffer.alloc(8+payload.length);result.writeUInt32BE(result.length,0);result.write(type,4);Buffer.from(payload).copy(result,8);return result;}

test("splits a fragmented MP4 into initialization and media bytes",()=>{
  const input=Buffer.concat([box("ftyp",[1]),box("moov",[2,3]),box("moof",[4]),box("mdat",[5,6])]);
  const result=splitFragmentedMp4(input);
  assert.deepEqual(result.boxes,["ftyp","moov","moof","mdat"]);
  assert.equal(Buffer.from(result.init).length,19);assert.equal(Buffer.from(result.media).length,19);
  assert.equal(Buffer.from(result.media).toString("ascii",4,8),"moof");
});

test("measures only the buffered range containing the playhead",()=>{
  const buffered={length:2,start:index=>index?5:0,end:index=>index?9:2};
  assert.equal(bufferedVideoAhead(buffered,1),1);
  assert.equal(bufferedVideoAhead(buffered,6.5),2.5);
  assert.equal(bufferedVideoAhead(buffered,3),0);
});

test("rejects regular MP4 and truncated boxes",()=>{
  assert.equal(splitFragmentedMp4(Buffer.concat([box("ftyp"),box("moov"),box("mdat")])),null);
  const truncated=box("moof");truncated.writeUInt32BE(99,0);assert.equal(splitFragmentedMp4(truncated),null);
});

test("prunes only video safely behind the current playback point",()=>{
  const buffered={length:1,start:()=>0,end:()=>12};
  assert.deepEqual(removableVideoRange(buffered,10),{start:0,end:7});
  assert.equal(removableVideoRange(buffered,3.2),null);
  assert.equal(removableVideoRange({length:0},10),null);
});
