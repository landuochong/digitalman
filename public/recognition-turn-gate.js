export function recognitionSilenceMs({final=false,text=""}={}){
  const value=String(text||"").trim(),characters=[...value.replace(/[\s，。！？、,.!?；;：:～~]/g,"")].length;
  if(final)return characters<=2?430:340;
  if(characters<=3)return 650;
  if(/(?:然后|但是|因为|如果|所以|就是|我想|我觉得|可能|要是|虽然|不过|还有|比如)$/.test(value))return 700;
  if(/[。！？!?]$/.test(value))return 420;
  if(characters>=12)return 500;
  return 560;
}
export function recognitionResumeDelayMs({preciseAudioTail=false,outputLatencyMs=0}={}){
  if(!preciseAudioTail)return 180;
  return Math.min(180,Math.max(80,Math.ceil(Math.max(0,Number(outputLatencyMs)||0)+40)));
}

export class RecognitionTurnGate {
  constructor({onCommit=()=>{},finalizeDelayMs=90,now=()=>performance.now(),setTimer=setTimeout,clearTimer=clearTimeout}={}){
    this.onCommit=onCommit;
    this.finalizeDelayMs=finalizeDelayMs;
    this.now=now;
    this.setTimer=setTimer;
    this.clearTimer=clearTimer;
    this.timer=0;
    this.begin();
  }

  begin(){
    this.cancel();
    this.text="";
    this.failed=false;
    this.committed=false;
    this.stopRequestedAt=null;
    this.startedAt=this.now();
  }

  update(text,{final=false}={}){
    this.text=String(text||"").trim();
    if(final&&this.stopRequestedAt!==null)this.commit("final-result");
  }

  requestStop({final=false}={}){
    if(this.failed||this.committed||this.stopRequestedAt!==null)return false;
    this.stopRequestedAt=this.now();
    if(final){this.commit("vad-final");return true;}
    this.timer=this.setTimer(()=>{this.timer=0;this.commit("vad-timeout");},this.finalizeDelayMs);
    return true;
  }

  end(){return this.commit("recognition-end");}

  fail(){this.failed=true;this.cancel();}

  cancel(){if(this.timer)this.clearTimer(this.timer);this.timer=0;}

  commit(trigger){
    if(this.failed||this.committed||!this.text)return false;
    this.committed=true;
    this.cancel();
    const committedAt=this.now();
    void this.onCommit(this.text,{
      trigger,
      turnMs:Math.round(committedAt-this.startedAt),
      stopToCommitMs:this.stopRequestedAt===null?null:Math.round(committedAt-this.stopRequestedAt)
    });
    return true;
  }
}
