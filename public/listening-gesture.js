export class ListeningGestureGate{
  constructor({delayMs=()=>1400+Math.random()*700,schedule=setTimeout,cancelSchedule=clearTimeout}={}){
    this.delayMs=delayMs;this.scheduleTimer=schedule;this.cancelTimer=cancelSchedule;this.timer=0;this.triggered=false;
  }
  schedule({canRun=()=>true,onTrigger}={}){
    if(this.timer||this.triggered)return false;
    this.timer=this.scheduleTimer(()=>{
      this.timer=0;
      if(this.triggered||!canRun())return;
      this.triggered=true;onTrigger?.();
    },Math.max(0,Number(this.delayMs())||0));
    this.timer?.unref?.();return true;
  }
  cancel(){if(this.timer)this.cancelTimer(this.timer);this.timer=0;}
  reset(){this.cancel();this.triggered=false;}
  snapshot(){return{scheduled:Boolean(this.timer),triggered:this.triggered};}
}
