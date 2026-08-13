export class AvatarStreamTurn {
  constructor({isCurrent=()=>true,onEnd=()=>{}}={}){
    this.id=crypto.randomUUID();
    this.nextSentenceIndex=0;
    this.isCurrent=isCurrent;
    this.onEnd=onEnd;
    this.enqueueQueue=Promise.resolve();
    this.playbacks=[];
    this.audioMs=0;
    this.lingerMs=120;
    this.segmentCount=0;
    this.finishPromise=null;
  }

  allocateSentence(){return{visualTurnId:this.id,visualSentenceIndex:this.nextSentenceIndex++};}

  enqueue(task){
    const run=this.enqueueQueue.then(()=>this.isCurrent()?task(this):undefined);
    this.enqueueQueue=run.catch(()=>{});
    return run;
  }

  trackSegment(playback,audioMs=0,lingerMs=120){
    this.segmentCount++;
    this.audioMs+=Math.max(0,Number(audioMs)||0);
    this.lingerMs=Math.max(this.lingerMs,Math.max(0,Number(lingerMs)||0));
    this.playbacks.push(Promise.resolve(playback));
  }

  waitForPlayback(){return Promise.all([...this.playbacks]);}

  finish(){
    if(this.finishPromise)return this.finishPromise;
    this.finishPromise=this.enqueueQueue.then(async()=>{
      if(!this.isCurrent())return;
      if(this.segmentCount)this.onEnd({audioMs:this.audioMs,lingerMs:this.lingerMs,segments:this.segmentCount});
      await Promise.all(this.playbacks);
    });
    return this.finishPromise;
  }
}
