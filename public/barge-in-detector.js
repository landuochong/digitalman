export class BargeInDetector {
  constructor({warmupMs=1200,triggerMs=420,absoluteThreshold=.055,relativeThreshold=4,fastStartMs=140,fastTriggerMs=200,fastAbsoluteThreshold=.08,fastRelativeThreshold=5.5,now=()=>performance.now()}={}){
    this.warmupMs=warmupMs;
    this.triggerMs=triggerMs;
    this.absoluteThreshold=absoluteThreshold;
    this.relativeThreshold=relativeThreshold;
    this.fastStartMs=fastStartMs;
    this.fastTriggerMs=fastTriggerMs;
    this.fastAbsoluteThreshold=fastAbsoluteThreshold;
    this.fastRelativeThreshold=fastRelativeThreshold;
    this.now=now;
    this.reset();
  }

  reset(startedAt=this.now()){
    this.startedAt=startedAt;
    this.baseline=.008;
    this.aboveSince=0;
    this.fastAboveSince=0;
    this.triggered=false;
  }

  sample(rms,at=this.now()){
    if(this.triggered)return false;
    const level=Math.max(0,Number(rms)||0);
    if(at-this.startedAt<this.warmupMs){
      // A close, clearly dominant voice should be able to interrupt during the
      // echo-learning window. Requiring both a high absolute level and a large
      // ratio over the learned speaker leakage keeps ordinary playback from
      // taking this path.
      const fastThreshold=Math.max(this.fastAbsoluteThreshold,this.baseline*this.fastRelativeThreshold);
      if(at-this.startedAt>=this.fastStartMs&&level>=fastThreshold){
        this.fastAboveSince ||= at;
        if(at-this.fastAboveSince>=this.fastTriggerMs){this.triggered=true;return true;}
        return false;
      }
      this.fastAboveSince=0;
      // Learn the residual speaker/room level while the answer begins. The
      // microphone stream already requests browser echo cancellation.
      this.baseline=this.baseline*.78+level*.22;
      this.aboveSince=0;
      return false;
    }
    this.fastAboveSince=0;
    const threshold=Math.max(this.absoluteThreshold,this.baseline*this.relativeThreshold);
    if(level>=threshold){
      this.aboveSince ||= at;
      if(at-this.aboveSince>=this.triggerMs){this.triggered=true;return true;}
      return false;
    }
    this.aboveSince=0;
    // Follow slow room-noise changes, but never let a short voice burst raise
    // the baseline enough to hide the rest of the interruption.
    this.baseline=this.baseline*.97+level*.03;
    return false;
  }
}
