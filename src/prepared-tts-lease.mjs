export const PREPARED_TTS_REFRESH_MS=8_000;

export class PreparedTtsLease{
  constructor({prepare,discard,publish,refreshMs=PREPARED_TTS_REFRESH_MS,schedule=setTimeout,cancelSchedule=clearTimeout}={}){
    if(typeof prepare!=="function"||typeof discard!=="function"||typeof publish!=="function")throw new TypeError("TTS lease 缺少回调");
    this.prepare=prepare;
    this.discard=discard;
    this.publish=publish;
    this.refreshMs=refreshMs;
    this.schedule=schedule;
    this.cancelSchedule=cancelSchedule;
    this.currentId="";
    this.timer=null;
    this.active=false;
    this.frozen=false;
    this.issued=0;
  }

  start(){
    if(this.active||this.frozen)return this.currentId;
    this.active=true;
    return this.replace();
  }

  replace(){
    if(!this.active||this.frozen)return this.currentId;
    const previous=this.currentId;
    const next=this.prepare();
    this.currentId=next;
    this.issued+=1;
    this.publish(next,this.issued);
    if(previous)this.discard(previous);
    this.timer=this.schedule(()=>{
      this.timer=null;
      if(this.active&&!this.frozen){
        try{this.replace();}
        catch{this.cancel();}
      }
    },this.refreshMs);
    this.timer?.unref?.();
    return next;
  }

  freeze(){
    if(this.timer)this.cancelSchedule(this.timer);
    this.timer=null;
    this.active=false;
    this.frozen=true;
    return this.currentId;
  }

  cancel(){
    if(this.timer)this.cancelSchedule(this.timer);
    this.timer=null;
    this.active=false;
    this.frozen=true;
    const id=this.currentId;
    this.currentId="";
    if(id)this.discard(id);
    return id;
  }
}
