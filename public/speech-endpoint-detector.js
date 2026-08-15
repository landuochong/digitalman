export class SpeechEndpointDetector {
  constructor({warmupMs=320,absoluteThreshold=.016,maxSilenceThreshold=.045,noiseMultiplier=2.35,now=()=>performance.now()}={}){
    this.warmupMs=Math.max(0,Number(warmupMs)||0);
    this.absoluteThreshold=Math.max(.001,Number(absoluteThreshold)||.016);
    this.maxSilenceThreshold=Math.max(this.absoluteThreshold,Number(maxSilenceThreshold)||.045);
    this.noiseMultiplier=Math.max(1,Number(noiseMultiplier)||2.35);
    this.now=now;
    this.reset();
  }

  reset(startedAt=this.now()){
    this.startedAt=startedAt;
    this.noiseFloor=.008;
    this.hasSpeech=false;
    this.silenceStartedAt=null;
  }

  sample(rms,at=this.now(),{hasTranscript=false}={}){
    const level=Math.max(0,Number(rms)||0),warming=at-this.startedAt<this.warmupMs;
    if(warming){
      // Learn loud rooms too, but cap what one early voice burst can teach.
      // The cap keeps immediate speech above the endpoint threshold.
      const learned=Math.min(level,this.maxSilenceThreshold*.88);
      this.noiseFloor=this.noiseFloor*.82+learned*.18;
    }
    const threshold=Math.min(this.maxSilenceThreshold,Math.max(this.absoluteThreshold,this.noiseFloor*this.noiseMultiplier));
    if(hasTranscript)this.hasSpeech=true;
    if(level>=threshold){
      this.hasSpeech=true;
      this.silenceStartedAt=null;
    }else{
      if(!warming)this.noiseFloor=this.noiseFloor*.97+Math.min(level,this.maxSilenceThreshold*.88)*.03;
      if(this.hasSpeech&&hasTranscript&&this.silenceStartedAt===null)this.silenceStartedAt=at;
    }
    return{
      level,noiseFloor:this.noiseFloor,threshold,
      silenceMs:this.silenceStartedAt===null?0:Math.max(0,at-this.silenceStartedAt),
      hasSpeech:this.hasSpeech,warming
    };
  }
}
