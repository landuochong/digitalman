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
