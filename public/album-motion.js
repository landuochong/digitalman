// Matches DINet's 25 source frames followed by those same frames reversed.
export function albumSourceFrame(phase) {
  const frame = ((Math.floor(phase) % 50) + 50) % 50;
  return frame < 25 ? frame : 49 - frame;
}

export function albumReturnFrames(nextFrame, sourceFrames=null) {
  if(sourceFrames){
    const phase=Number.isFinite(nextFrame)?((Math.floor(nextFrame)%sourceFrames.length)+sourceFrames.length)%sourceFrames.length:0;
    const remaining=phase%50?50-phase%50:0;
    return Array.from({length:remaining},(_,i)=>sourceFrames[(phase+i)%sourceFrames.length]);
  }
  const phase = Number.isFinite(nextFrame) ? ((Math.floor(nextFrame) % 50) + 50) % 50 : 0;
  return Array.from({length: phase ? 50-phase : 0}, (_, i) => albumSourceFrame(phase+i));
}

export class AlbumMotion {
  constructor({seek, show, sourceFrames=null, wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)), onState=()=>{}}) {
    this.sourceFrames=sourceFrames;this.seek=seek;this.show=show;this.wait=wait;this.onState=onState;
    this.generation=0;this.nextFrame=0;this.sequence=-1;
  }
  cancel(){this.generation++;}
  begin(){this.cancel();this.onState('speaking');}
  complete(sequence,nextFrame){
    if(sequence<this.sequence)return;
    this.sequence=sequence;
    this.nextFrame=Number.isFinite(nextFrame)?nextFrame:0;
  }
  async freeze(){
    const generation=++this.generation;
    this.nextFrame=0;this.sequence=-1;
    await this.seek((this.sourceFrames?.[0]??0)/25);
    if(generation!==this.generation)return false;
    this.show();this.onState('static');
    return true;
  }
  async settle(){
    const generation=++this.generation;
    const frames=albumReturnFrames(this.nextFrame,this.sourceFrames);
    this.onState('settling');
    // Preserve the remainder of this cycle, speed up only long remainders.
    const interval=Math.min(40,1000/Math.max(1,frames.length));
    for(const frame of frames){
      if(generation!==this.generation)return false;
      await this.seek(frame/25);
      if(generation!==this.generation)return false;
      this.show();await this.wait(interval);
    }
    if(generation!==this.generation)return false;
    return this.freeze();
  }
}
