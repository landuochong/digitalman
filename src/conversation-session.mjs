import { randomUUID } from "node:crypto";

export const TURN_STATES=Object.freeze({
  IDLE:"idle",LISTENING:"listening",TRANSCRIBING:"transcribing",THINKING:"thinking",
  PREPARING_SPEECH:"preparing_speech",SPEAKING:"speaking",INTERRUPTED:"interrupted",
  COMPLETED:"completed",FAILED:"failed"
});

const TERMINAL_STATES=new Set([TURN_STATES.INTERRUPTED,TURN_STATES.COMPLETED,TURN_STATES.FAILED]);
const ALLOWED_TRANSITIONS=new Map([
  [TURN_STATES.IDLE,new Set([TURN_STATES.LISTENING,TURN_STATES.TRANSCRIBING,TURN_STATES.THINKING,TURN_STATES.FAILED])],
  [TURN_STATES.LISTENING,new Set([TURN_STATES.TRANSCRIBING,TURN_STATES.THINKING,TURN_STATES.INTERRUPTED,TURN_STATES.FAILED])],
  [TURN_STATES.TRANSCRIBING,new Set([TURN_STATES.THINKING,TURN_STATES.INTERRUPTED,TURN_STATES.FAILED])],
  [TURN_STATES.THINKING,new Set([TURN_STATES.PREPARING_SPEECH,TURN_STATES.SPEAKING,TURN_STATES.INTERRUPTED,TURN_STATES.COMPLETED,TURN_STATES.FAILED])],
  [TURN_STATES.PREPARING_SPEECH,new Set([TURN_STATES.SPEAKING,TURN_STATES.INTERRUPTED,TURN_STATES.COMPLETED,TURN_STATES.FAILED])],
  [TURN_STATES.SPEAKING,new Set([TURN_STATES.PREPARING_SPEECH,TURN_STATES.INTERRUPTED,TURN_STATES.COMPLETED,TURN_STATES.FAILED])]
]);

function normalizeId(value,fallback){
  const id=String(value||"").trim();
  return /^[a-zA-Z0-9:_-]{1,96}$/.test(id)?id:fallback;
}

export class ConversationTurn {
  constructor({sessionId,turnId,now=()=>performance.now()}={}){
    this.sessionId=normalizeId(sessionId,`session-${randomUUID()}`);
    this.turnId=normalizeId(turnId,`turn-${randomUUID()}`);
    this.state=TURN_STATES.IDLE;
    this.sequence=0;
    this.startedAt=now();
    this.updatedAt=this.startedAt;
    this.playbackCommitted=false;
    this.abortController=new AbortController();
    this.events=[];
    this._now=now;
  }

  transition(next,metadata={}){
    if(next===this.state)return this.event("state",{state:next,...metadata});
    if(TERMINAL_STATES.has(this.state))throw new Error(`轮次 ${this.turnId} 已经结束，不能进入 ${next}`);
    if(!ALLOWED_TRANSITIONS.get(this.state)?.has(next))throw new Error(`轮次状态不能从 ${this.state} 进入 ${next}`);
    this.state=next;
    this.updatedAt=this._now();
    if(next===TURN_STATES.INTERRUPTED&&!this.abortController.signal.aborted)this.abortController.abort(metadata.reason||"interrupted");
    return this.event("state",{state:next,...metadata});
  }

  event(type,payload={}){
    const entry={sessionId:this.sessionId,turnId:this.turnId,sequence:this.sequence++,type:String(type),state:this.state,elapsedMs:Math.max(0,Math.round(this._now()-this.startedAt)),...payload};
    this.events.push(entry);
    if(this.events.length>64)this.events.shift();
    return entry;
  }

  commitPlayback(metadata={}){
    this.playbackCommitted=true;
    return this.event("playback-committed",metadata);
  }

  interrupt(reason="interrupted"){
    if(TERMINAL_STATES.has(this.state))return false;
    this.transition(TURN_STATES.INTERRUPTED,{reason});
    return true;
  }

  complete(metadata={}){return this.transition(TURN_STATES.COMPLETED,metadata);}
  fail(error){return this.transition(TURN_STATES.FAILED,{error:String(error?.message||error||"unknown")});}
  get signal(){return this.abortController.signal;}
  snapshot(){return{sessionId:this.sessionId,turnId:this.turnId,state:this.state,sequence:this.sequence,playbackCommitted:this.playbackCommitted,events:[...this.events]};}
}

export class ConversationSessionStore {
  constructor({limit=64}={}){this.limit=Math.max(1,Number(limit)||64);this.turns=new Map();}
  start(options={}){
    const turn=new ConversationTurn(options);
    this.turns.set(turn.turnId,turn);
    while(this.turns.size>this.limit)this.turns.delete(this.turns.keys().next().value);
    return turn;
  }
  get(turnId){return this.turns.get(String(turnId||""))||null;}
  finish(turnId){const turn=this.get(turnId);if(turn&&TERMINAL_STATES.has(turn.state))this.turns.delete(turn.turnId);return turn;}
  interruptSession(sessionId,reason="superseded"){
    let count=0;
    for(const turn of this.turns.values())if(turn.sessionId===sessionId&&turn.interrupt(reason))count++;
    return count;
  }
}
