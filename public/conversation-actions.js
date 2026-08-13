const HIGH_ENERGY_ACTIONS=new Set(["wave_approval","clap","cheer","surprise","bow","shrug","cross","confident_arms_crossed","shy"]);
const DEFER_ON_SHORT_OPENER=new Set(["caring","thinking","shy","confident_arms_crossed"]);
const HOLD_ACROSS_SENTENCES=new Set(["happy","caring","thinking"]);
// Ordinary conversation should not look frozen, but applying a gesture to
// every turn is just as mechanical. This restrained four-turn cadence gives
// three low-amplitude responses and one genuinely quiet turn.
const MICRO_GESTURE_CADENCE=["nod","idle","happy","nod"];
const ACTION_INTENT_GROUPS=[
  new Set(["happy","nod","thumbs_up","clap","cheer"]),
  new Set(["thinking","shrug"]),
  new Set(["caring","shy"])
];
const FALLBACK_ACTIONS={
  wave_approval:"happy",clap:"happy",cheer:"happy",surprise:"idle",bow:"idle",
  shrug:"thinking",cross:"idle",confident_arms_crossed:"idle",shy:"happy"
};
const EXPLICIT_ACTION_WORDS=/(?:给我|帮我|请|做|来|摆|表演|可以|能不能|能否|想看你|让我看|向我).{0,8}(?:挥手|招手|点头|竖拇指|大拇指|点赞|赞|鼓掌|拍手|欢呼|庆祝|鞠(?:个)?躬|行礼|耸肩|摊手|交叉|叉手|抱胸|害羞|脸红|捂嘴|惊讶|吃惊|微笑|笑|思考|想想|关心|祈祷|动作|姿势)/;
const REAL_SOURCE_FRAMES=222;
const REAL_SOURCE_FPS=25;
const REAL_SOURCE_LOOP_MS=REAL_SOURCE_FRAMES/REAL_SOURCE_FPS*1000;
// The generated clips contain two restrained repetitions in one seamless
// 8.88 s loop. Keep a conversational gesture to one authored half-loop; the
// renderer may still cross the physical clip boundary without a visible jump.
const NATURAL_GESTURE_CYCLE_MS=REAL_SOURCE_LOOP_MS/2;
const ACTION_BEHAVIOR={
  idle:{intensity:.08,gaze:"user",head:"neutral",holdMs:0,maxContinuousMs:REAL_SOURCE_LOOP_MS},
  happy:{intensity:.28,gaze:"user",head:"neutral",holdMs:2200,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  nod:{intensity:.24,gaze:"user",head:"nod",holdMs:1300,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  caring:{intensity:.38,gaze:"user",head:"slight_tilt",holdMs:3200,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  thinking:{intensity:.32,gaze:"aside",head:"slight_tilt",holdMs:2800,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  shy:{intensity:.46,gaze:"down",head:"slight_tilt",holdMs:2600,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  wave_approval:{intensity:.58,gaze:"user",head:"neutral",holdMs:2200,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  thumbs_up:{intensity:.52,gaze:"user",head:"nod",holdMs:2100,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  clap:{intensity:.72,gaze:"user",head:"neutral",holdMs:3000,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  cheer:{intensity:.78,gaze:"user",head:"up",holdMs:2800,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  surprise:{intensity:.68,gaze:"user",head:"back",holdMs:2300,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  bow:{intensity:.56,gaze:"down",head:"down",holdMs:2600,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  shrug:{intensity:.46,gaze:"user",head:"slight_tilt",holdMs:2400,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  cross:{intensity:.5,gaze:"user",head:"neutral",holdMs:2400,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS},
  confident_arms_crossed:{intensity:.5,gaze:"user",head:"slight_tilt",holdMs:2800,maxContinuousMs:NATURAL_GESTURE_CYCLE_MS}
};

function spokenLength(text){return String(text||"").replace(/[，,、。！？!?；;\s]/g,"").length;}
function estimatedSpeechMs(text){return Math.max(650,Math.min(5200,spokenLength(text)*180));}
function sameActionIntent(first,second){return first===second||ACTION_INTENT_GROUPS.some(group=>group.has(first)&&group.has(second));}
function normalizeSourceFrame(value){
  const frame=Math.max(0,Math.round(Number(value)||0));
  return frame%REAL_SOURCE_FRAMES;
}

export function continueActionPlan(plan,{action,baseFrameOffset=0,elapsedMs=0,leadMs=0,fps=25}={}){
  if(!plan||plan.deferred||plan.action!==action)return plan;
  const frameMs=1000/Math.max(1,Number(fps)||25);
  const continuationOffset=Math.max(0,Number(baseFrameOffset)||0)+Math.max(0,Math.round((Math.max(0,Number(elapsedMs)||0)+Math.max(0,Number(leadMs)||0))/frameMs));
  return{...plan,continuation:true,frameOffset:normalizeSourceFrame(Math.max(Math.max(0,Number(plan.frameOffset)||0),continuationOffset))};
}

export function preparedPreviewCanStart(candidate,{activePreview,aborted=false,spokenSentenceCount=0}={}){
  return Boolean(candidate&&candidate===activePreview&&!aborted&&Number(spokenSentenceCount)===0);
}

export class ConversationActionScheduler{
  constructor({cooldownMs=3000,clock=()=>Date.now()}={}){
    this.cooldownMs=cooldownMs;this.clock=clock;this.lastHighEnergyAt=-Infinity;this.microTurnSequence=0;this.reset();
  }
  reset(){this.primary="idle";this.requestedPrimary="idle";this.deferPrimary=false;this.secondaryUsed=false;this.explicit=false;this.cadenceManaged=false;this.implicitMicroGesture=false;this.started=false;this.emotion="calm";this.timeline=[];this.cursorMs=0;this.activeAction="idle";this.activeStartedAtMs=0;this.activeUntilMs=0;}
  resolveBudget(action,explicit=this.explicit){
    const now=this.clock();let resolved=String(action||"idle");
    if(HIGH_ENERGY_ACTIONS.has(resolved)&&!explicit&&now-this.lastHighEnergyAt<this.cooldownMs)resolved=FALLBACK_ACTIONS[resolved]||"idle";
    if(HIGH_ENERGY_ACTIONS.has(resolved))this.lastHighEnergyAt=now;
    return resolved;
  }
  startTurn({message="",action="idle",emotion="calm"}={}){
    this.explicit=EXPLICIT_ACTION_WORDS.test(String(message));this.requestedPrimary=String(action||"idle");
    const useCadence=!this.explicit&&this.requestedPrimary==="idle";
    this.cadenceManaged=useCadence;
    const cadenceAction=useCadence?MICRO_GESTURE_CADENCE[this.microTurnSequence++%MICRO_GESTURE_CADENCE.length]:this.requestedPrimary;
    this.implicitMicroGesture=useCadence&&cadenceAction!==this.requestedPrimary;
    this.primary=this.resolveBudget(cadenceAction,this.explicit);this.deferPrimary=false;this.secondaryUsed=false;this.started=true;this.emotion=emotion;this.timeline=[];
    return this.plan(this.primary,{emotion,explicit:this.explicit,preview:true});
  }
  plan(action,{emotion=this.emotion,index=0,text="",explicit=this.explicit,deferred=false,preview=false,continuation=false}={}){
    const resolved=ACTION_BEHAVIOR[action]?action:"idle",behavior=ACTION_BEHAVIOR[resolved];
    const startAtMs=this.cursorMs,durationMs=estimatedSpeechMs(text);
    const continuing=continuation&&resolved===this.activeAction&&startAtMs<this.activeUntilMs;
    if(!preview&&resolved!=="idle"&&!continuing){
      this.activeAction=resolved;this.activeStartedAtMs=startAtMs;
      this.activeUntilMs=startAtMs+Math.min(Math.max(behavior.holdMs,durationMs),behavior.maxContinuousMs);
    }
    // Idle clips share the turn clock so ordinary multi-sentence replies do not
    // restart the body from frame zero at every punctuation boundary. A newly
    // selected gesture still starts at its authored entry pose; continuations
    // advance within that gesture's own timeline.
    const frameOffset=resolved==="idle"
      ?normalizeSourceFrame(startAtMs/40)
      :continuing?normalizeSourceFrame((startAtMs-this.activeStartedAtMs)/40):0;
    const plan={action:resolved,emotion,intensity:behavior.intensity,gaze:behavior.gaze,head:behavior.head,startAtMs,holdMs:Math.max(behavior.holdMs,durationMs),maxContinuousMs:behavior.maxContinuousMs,durationMs,frameOffset,continuation:continuing,explicit:Boolean(explicit),deferred:Boolean(deferred),...(this.cadenceManaged&&resolved===this.primary?{cadenceManaged:true}:{}),...(this.implicitMicroGesture&&resolved===this.primary?{implicitMicroGesture:true}:{})};
    if(!preview)this.cursorMs+=durationMs;
    this.timeline.push(plan);return plan;
  }
  planForSentence(text,index=0,candidateAction=this.requestedPrimary,emotion=this.emotion){
    if(!this.started)return this.plan("idle",{emotion,index,text});
    let proposed=String(candidateAction||"idle");
    if(proposed===this.requestedPrimary)proposed=this.primary;
    if(index===0){
      if(!this.explicit&&proposed!=="idle"&&!sameActionIntent(proposed,this.primary)){this.primary=this.resolveBudget(proposed);this.cadenceManaged=false;this.implicitMicroGesture=false;}
      this.deferPrimary=!this.explicit&&DEFER_ON_SHORT_OPENER.has(this.primary)&&spokenLength(text)<6;
      return this.plan(this.deferPrimary?"idle":this.primary,{emotion,index,text,deferred:this.deferPrimary});
    }
    if(index===1&&this.deferPrimary)return this.plan(this.primary,{emotion,index,text,deferred:true});
    if(!this.secondaryUsed&&proposed!=="idle"&&!sameActionIntent(proposed,this.primary)){
      this.secondaryUsed=true;return this.plan(this.resolveBudget(proposed),{emotion,index,text});
    }
    if(HOLD_ACROSS_SENTENCES.has(this.activeAction)&&this.cursorMs<this.activeUntilMs){
      return this.plan(this.activeAction,{emotion,index,text,continuation:true});
    }
    return this.plan("idle",{emotion,index,text});
  }
  actionForSentence(text,index=0,candidateAction=this.requestedPrimary){return this.planForSentence(text,index,candidateAction).action;}
  getTimeline(){return this.timeline.map(item=>({...item}));}
  finishTurn(){this.reset();return "idle";}
}

export const conversationActionPolicy=Object.freeze({cooldownMs:3000,shortOpenerCharacters:6,sourceFrames:REAL_SOURCE_FRAMES,sourceFps:REAL_SOURCE_FPS,sourceLoopMs:REAL_SOURCE_LOOP_MS,naturalGestureCycleMs:NATURAL_GESTURE_CYCLE_MS,holdAcrossSentences:[...HOLD_ACROSS_SENTENCES],microGestureCadence:[...MICRO_GESTURE_CADENCE],intentGroups:ACTION_INTENT_GROUPS.map(group=>[...group]),behaviorActions:Object.keys(ACTION_BEHAVIOR)});
