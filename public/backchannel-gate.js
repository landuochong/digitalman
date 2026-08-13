export class BackchannelGate{
  constructor({delayMs=500,onSpeak=()=>{}}={}){this.delayMs=delayMs;this.onSpeak=onSpeak;this.pending=null;this.timer=0;}
  offer(value){this.cancel();this.pending=value;this.timer=setTimeout(()=>{const current=this.pending;this.pending=null;this.timer=0;if(current)this.onSpeak(current);},this.delayMs);}
  cancel(){clearTimeout(this.timer);this.timer=0;this.pending=null;}
}
