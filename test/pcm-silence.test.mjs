import test from "node:test";
import assert from "node:assert/strict";
import { trimPcm16Silence } from "../src/pcm-silence.mjs";

const pcm=(sections)=>{
  const samples=sections.reduce((sum,item)=>sum+item.samples,0),buffer=Buffer.alloc(samples*2);let offset=0;
  for(const section of sections)for(let index=0;index<section.samples;index++,offset+=2)buffer.writeInt16LE(section.value,offset);
  return buffer;
};

test("trims provider padding while retaining a natural PCM lead and tail",()=>{
  const input=pcm([{samples:4800,value:0},{samples:8000,value:2200},{samples:5600,value:0}]);
  const result=trimPcm16Silence(input);
  assert.equal(result.trimmedLeadingMs,240);
  assert.equal(result.trimmedTrailingMs,250);
  assert.equal(result.pcm.length/32,660);
});

test("does not invent speech or over-trim short and silent PCM",()=>{
  const silence=Buffer.alloc(3200),short=pcm([{samples:160,value:0},{samples:3200,value:1800},{samples:160,value:0}]);
  assert.equal(trimPcm16Silence(silence).pcm,silence);
  assert.equal(trimPcm16Silence(short).pcm.length,short.length);
});
