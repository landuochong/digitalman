import test from 'node:test';
import assert from 'node:assert/strict';
import {synthesizeLocalSpeech} from '../src/local-tts.mjs';

test('local PCM adapter sends text to the local service without cloud credentials',async()=>{
  const pcm=Buffer.from([1,0,2,0]);
  const result=await synthesizeLocalSpeech({text:'你好',format:'pcm',baseUrl:'http://127.0.0.1:8020/',fetchImpl:async(url,options)=>{
    assert.equal(url,'http://127.0.0.1:8020/synthesize');
    assert.deepEqual(JSON.parse(options.body),{text:'你好',format:'pcm'});
    assert.equal(options.headers.authorization,undefined);
    return new Response(pcm,{headers:{'x-generation-ms':'125'}});
  }});
  assert.deepEqual(result.audio,pcm);assert.equal(result.generationMs,125);
});
test('local adapter rejects failed services and malformed audio instead of playing errors',async()=>{
  await assert.rejects(synthesizeLocalSpeech({text:'你好',fetchImpl:async()=>new Response('error',{status:503})}),/503/);
  await assert.rejects(synthesizeLocalSpeech({text:'你好',fetchImpl:async()=>new Response('{}')}),/WAV/);
  await assert.rejects(synthesizeLocalSpeech({text:'你好',format:'pcm',fetchImpl:async()=>new Response('x')}),/无效/);
});
test('caller cancellation reaches the local model HTTP request',async()=>{
  const controller=new AbortController();controller.abort();
  await synthesizeLocalSpeech({text:'你好',format:'pcm',signal:controller.signal,fetchImpl:async(_,options)=>{
    assert.equal(options.signal.aborted,true);
    return new Response(new Uint8Array([0,0]));
  }});
});
