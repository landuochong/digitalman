export class VisualTurnGate {
  constructor({ retentionMs=60_000 }={}) {
    this.retentionMs=Math.max(1000,Number(retentionMs)||60_000);
    this.turns=new Map();
  }

  wait(turnId,index,{signal}={}) {
    turnId=String(turnId||"");
    index=Number(index);
    if(!turnId||!Number.isSafeInteger(index)||index<0)return Promise.resolve();
    if(signal?.aborted)return Promise.reject(abortError());
    const turn=this.#turn(turnId);if(index<=turn.next)return Promise.resolve();
    return new Promise((resolve,reject)=>{
      const waiter={index,resolve:()=>{cleanup();resolve();}};
      const abort=()=>{cleanup();reject(abortError());};
      const cleanup=()=>{turn.waiters.delete(waiter);signal?.removeEventListener("abort",abort);};
      turn.waiters.add(waiter);signal?.addEventListener("abort",abort,{once:true});
    });
  }

  finish(turnId,index) {
    turnId=String(turnId||"");index=Number(index);if(!turnId||!Number.isSafeInteger(index)||index<0)return;
    const turn=this.#turn(turnId);turn.finished.add(index);
    if(index<turn.next){turn.finished.delete(index);this.#retain(turnId,turn);return;}
    while(turn.finished.has(turn.next)){turn.finished.delete(turn.next);turn.next++;}
    for(const waiter of [...turn.waiters])if(waiter.index<=turn.next)waiter.resolve();
    this.#retain(turnId,turn);
  }

  close(turnId) {
    turnId=String(turnId||"");const turn=this.turns.get(turnId);if(!turn)return;
    for(const waiter of [...turn.waiters])waiter.resolve();
    clearTimeout(turn.timer);this.turns.delete(turnId);
  }

  #turn(id) {
    let turn=this.turns.get(id);
    if(!turn){turn={next:0,finished:new Set(),waiters:new Set(),timer:null};this.turns.set(id,turn);}
    this.#retain(id,turn);return turn;
  }

  #retain(id,turn) {
    clearTimeout(turn.timer);turn.timer=setTimeout(()=>this.close(id),this.retentionMs);turn.timer.unref?.();
  }
}

function abortError(){return Object.assign(new Error("cancelled"),{name:"AbortError"});}
