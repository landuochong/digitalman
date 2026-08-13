export class BackchannelGate{
  constructor({delayMs=500,onPrepare=()=>null,onSpeak=()=>{},onCancel=()=>{}}={}){
    this.delayMs=delayMs;this.onPrepare=onPrepare;this.onSpeak=onSpeak;this.onCancel=onCancel;this.pending=null;this.timer=0;
  }
  offer(value){
    this.cancel();
    const current={value,prepared:this.onPrepare(value)};this.pending=current;
    this.timer=setTimeout(()=>{if(this.pending!==current)return;this.pending=null;this.timer=0;this.onSpeak(current.value,current.prepared);},this.delayMs);
  }
  cancel(){
    clearTimeout(this.timer);this.timer=0;
    const current=this.pending;this.pending=null;
    if(current)this.onCancel(current.value,current.prepared);
  }
}

export function normalizeBackchannelText(value){return String(value||"").replace(/[，。！？!?；;、\s]/g,"");}

export class BackchannelPlayback{
  constructor(text){this.text=String(text||"");this.started=false;this.completed=false;this.claimed=false;this.startListeners=[];this.completeListeners=[];}
  start(){if(this.started)return;this.started=true;for(const listener of this.startListeners.splice(0))listener();}
  complete(){if(this.completed)return;this.completed=true;this.start();for(const listener of this.completeListeners.splice(0))listener();}
  claim(text,{onStart=()=>{},onComplete=()=>{}}={}){
    if(this.claimed||!normalizeBackchannelText(this.text)||normalizeBackchannelText(text)!==normalizeBackchannelText(this.text))return false;
    this.claimed=true;
    if(this.started)onStart();else this.startListeners.push(onStart);
    if(this.completed)onComplete();else this.completeListeners.push(onComplete);
    return true;
  }
}
