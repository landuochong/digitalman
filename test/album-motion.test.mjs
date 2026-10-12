import test from 'node:test';
import assert from 'node:assert/strict';
import {AlbumMotion,albumReturnFrames,albumSourceFrame} from '../public/album-motion.js';
import {buildWav2LipPlaybackMessage} from '../public/avatar-protocol.js';

test('audio ends at any phase: finish current short cycle and return to frame zero',async()=>{
  for(let phase=0;phase<50;phase++){
    const seeks=[],states=[];
    const motion=new AlbumMotion({seek:async t=>seeks.push(t),show:()=>{},wait:async()=>{},onState:s=>states.push(s)});
    motion.begin();motion.complete(0,phase);
    assert.equal(await motion.settle(),true);
    assert.deepEqual(seeks,[...albumReturnFrames(phase).map(f=>f/25),0]);
    assert.equal(states.at(-1),'static');
    assert.ok(seeks.every(t=>t>=0&&t<1));
  }
});

test('new speech cancels an in-flight return without hiding the new answer',async()=>{
  let release;let shows=0;
  const motion=new AlbumMotion({seek:()=>new Promise(r=>release=r),show:()=>shows++,wait:async()=>{}});
  motion.complete(1,38);
  const returning=motion.settle();
  motion.begin();release();
  assert.equal(await returning,false);assert.equal(shows,0);
});

test('interrupt clears motion; delayed old segment completion cannot rewind current phase',async()=>{
  const seeks=[];
  const motion=new AlbumMotion({seek:async t=>seeks.push(t),show:()=>{}});
  motion.complete(5,38);motion.complete(4,10);
  assert.equal(motion.nextFrame,38);
  await motion.freeze();assert.equal(motion.nextFrame,0);assert.deepEqual(seeks,[0]);
});

test('short cycle closes without a source frame jump and metadata survives transport',()=>{
  assert.equal(albumSourceFrame(49),0);assert.equal(albumSourceFrame(50),0);
  assert.equal(albumSourceFrame(24),albumSourceFrame(25));
  const message=buildWav2LipPlaybackMessage({url:'/a.mp4',metrics:{nextSourceFrameOffset:38}},'a',{enqueue:true});
  assert.equal(message.motionEndFrame,38);
});

test('xiaotao blinks once per eight seconds and settles only the current short cycle',async()=>{
  const {readFile}=await import('node:fs/promises');
  const plan=JSON.parse(await readFile(new URL('../public/album-motion-plan.json',import.meta.url),'utf8'));
  const frames=plan.characters.xiaotao.sourceFrames;
  assert.equal(frames.length,200);
  assert.deepEqual(frames.slice(0,25),Array.from({length:25},(_,i)=>25+i));
  for(const boundary of [49,99,149,199])assert.equal(frames[boundary],25);
  assert.ok(frames.slice(0,150).every(f=>f>=25&&f<=49));
  assert.deepEqual(frames.slice(151,177),Array.from({length:26},(_,i)=>i));
  assert.ok(frames.slice(177).every(f=>f>=25&&f<=36));
  for(let phase=0;phase<200;phase++){
    const seeks=[];
    const motion=new AlbumMotion({sourceFrames:frames,seek:async t=>seeks.push(t),show:()=>{},wait:async()=>{}});
    motion.complete(0,phase);await motion.settle();
    const end=phase%50?Math.ceil(phase/50)*50:phase;
    assert.deepEqual(seeks,[...frames.slice(phase,end).map(f=>f/25),1]);
    assert.ok(seeks.length<=50);
    assert.equal(seeks.at(-1),1);
  }
  assert.deepEqual(plan.characters.lumi.sourceFrames,Array.from({length:50},(_,i)=>albumSourceFrame(i)));
});
