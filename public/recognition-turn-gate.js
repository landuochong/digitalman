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

// ASR engines commonly hallucinate a bare hesitation from room noise. A lone
// filler is not enough to start a conversational turn; keep listening instead.
export function isIncidentalFillerTranscript(text){
  const raw=String(text||"").trim();
  if(!raw)return false;
  const value=raw.replace(/[\s，。！？、,.!?；;：:～~]/g,"");
  return !value
    ||/^(?:嗯+|啊+|呃+|额+|唔+|哦+|哼+)$/.test(value)
    ||/^(?:i|a|the|you|uh|um|hmm)$/i.test(value);
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
    this.endpointSilenceMs=null;
    this.startedAt=this.now();
  }

  update(text,{final=false,endpointSilenceMs=null}={}){
    this.text=String(text||"").trim();
    // In non-continuous Web Speech mode, isFinal is already the browser's
    // utterance boundary. Waiting for a second VAD silence window adds
    // 340–430 ms without yielding another transcript correction.
    if(final){const measured=finiteNonNegative(endpointSilenceMs);if(measured!==null)this.endpointSilenceMs=measured;this.stopRequestedAt??=this.now();return this.commit("final-result");}
    return false;
  }

  requestStop({final=false,endpointSilenceMs=null}={}){
    if(this.failed||this.committed||this.stopRequestedAt!==null)return false;
    this.endpointSilenceMs=finiteNonNegative(endpointSilenceMs);
    this.stopRequestedAt=this.now();
    if(final){this.commit("vad-final");return true;}
    this.timer=this.setTimer(()=>{this.timer=0;this.commit("vad-timeout");},this.finalizeDelayMs);
    return true;
  }

  end(){return this.commit("recognition-end");}

  fail(){this.failed=true;this.cancel();}

  cancel(){if(this.timer)this.clearTimer(this.timer);this.timer=0;}

  commit(trigger){
    if(this.failed||this.committed||!this.text||isIncidentalFillerTranscript(this.text))return false;
    this.committed=true;
    this.cancel();
    const committedAt=this.now();
    void this.onCommit(this.text,{
      trigger,
      turnMs:Math.round(committedAt-this.startedAt),
      stopToCommitMs:this.stopRequestedAt===null?null:Math.round(committedAt-this.stopRequestedAt),
      ...(this.endpointSilenceMs===null?{}:{endpointSilenceMs:Math.round(this.endpointSilenceMs)})
    });
    return true;
  }
}

function finiteNonNegative(value){
  const number=Number(value);return value===null||value===""||!Number.isFinite(number)?null:Math.max(0,number);
}
