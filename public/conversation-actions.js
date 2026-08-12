const HIGH_ENERGY_ACTIONS=new Set(["wave_approval","clap","cheer","surprise","bow","shrug","cross","confident_arms_crossed","shy"]);
const DEFER_ON_SHORT_OPENER=new Set(["caring","thinking","shy","confident_arms_crossed"]);
const FALLBACK_ACTIONS={
  wave_approval:"happy",clap:"happy",cheer:"happy",surprise:"idle",bow:"idle",
  shrug:"thinking",cross:"idle",confident_arms_crossed:"idle",shy:"happy"
};
const EXPLICIT_ACTION_WORDS=/挥手|招手|点头|竖拇指|大拇指|点赞|点个赞|鼓掌|拍手|欢呼|庆祝|鞠躬|行礼|耸肩|摊手|交叉手势|做个叉|叉手|抱胸|双臂交叉|害羞|捂嘴|惊讶动作|做.{0,3}(?:动作|姿势)/;
const ACTION_BEHAVIOR={
  idle:{intensity:.08,gaze:"user",head:"neutral",holdMs:0},
  happy:{intensity:.28,gaze:"user",head:"neutral",holdMs:2200},
  nod:{intensity:.24,gaze:"user",head:"nod",holdMs:1300},
  caring:{intensity:.38,gaze:"user",head:"slight_tilt",holdMs:3200},
  thinking:{intensity:.32,gaze:"aside",head:"slight_tilt",holdMs:2800},
  shy:{intensity:.46,gaze:"down",head:"slight_tilt",holdMs:2600},
  wave_approval:{intensity:.58,gaze:"user",head:"neutral",holdMs:2200},
  thumbs_up:{intensity:.52,gaze:"user",head:"nod",holdMs:2100},
  clap:{intensity:.72,gaze:"user",head:"neutral",holdMs:3000},
  cheer:{intensity:.78,gaze:"user",head:"up",holdMs:2800},
  surprise:{intensity:.68,gaze:"user",head:"back",holdMs:2300},
  bow:{intensity:.56,gaze:"down",head:"down",holdMs:2600},
  shrug:{intensity:.46,gaze:"user",head:"slight_tilt",holdMs:2400},
  cross:{intensity:.5,gaze:"user",head:"neutral",holdMs:2400},
  confident_arms_crossed:{intensity:.5,gaze:"user",head:"slight_tilt",holdMs:2800}
};

function spokenLength(text){return String(text||"").replace(/[，,、。！？!?；;\s]/g,"").length;}

export class ConversationActionScheduler{
  constructor({cooldownMs=3000,clock=()=>Date.now()}={}){
    this.cooldownMs=cooldownMs;this.clock=clock;this.lastHighEnergyAt=-Infinity;this.reset();
  }
  reset(){this.primary="idle";this.requestedPrimary="idle";this.deferPrimary=false;this.secondaryUsed=false;this.explicit=false;this.started=false;this.emotion="calm";this.timeline=[];}
  resolveBudget(action,explicit=this.explicit){
    const now=this.clock();let resolved=String(action||"idle");
    if(HIGH_ENERGY_ACTIONS.has(resolved)&&!explicit&&now-this.lastHighEnergyAt<this.cooldownMs)resolved=FALLBACK_ACTIONS[resolved]||"idle";
    if(HIGH_ENERGY_ACTIONS.has(resolved))this.lastHighEnergyAt=now;
    return resolved;
  }
  startTurn({message="",action="idle",emotion="calm"}={}){
    this.explicit=EXPLICIT_ACTION_WORDS.test(String(message));this.requestedPrimary=String(action||"idle");
    this.primary=this.resolveBudget(this.requestedPrimary,this.explicit);this.deferPrimary=false;this.secondaryUsed=false;this.started=true;this.emotion=emotion;this.timeline=[];
    return this.plan(this.primary,{emotion,explicit:this.explicit});
  }
  plan(action,{emotion=this.emotion,index=0,text="",explicit=this.explicit,deferred=false}={}){
    const resolved=ACTION_BEHAVIOR[action]?action:"idle",behavior=ACTION_BEHAVIOR[resolved];
    const plan={action:resolved,emotion,intensity:behavior.intensity,gaze:behavior.gaze,head:behavior.head,startAtMs:index*650,holdMs:Math.max(behavior.holdMs,Math.min(5200,spokenLength(text)*115)),explicit:Boolean(explicit),deferred:Boolean(deferred)};
    this.timeline.push(plan);return plan;
  }
  planForSentence(text,index=0,candidateAction=this.requestedPrimary,emotion=this.emotion){
    if(!this.started)return this.plan("idle",{emotion,index,text});
    let proposed=String(candidateAction||"idle");
    if(proposed===this.requestedPrimary)proposed=this.primary;
    if(index===0){
      if(proposed!=="idle"&&proposed!==this.primary)this.primary=this.resolveBudget(proposed);
      this.deferPrimary=DEFER_ON_SHORT_OPENER.has(this.primary)&&spokenLength(text)<6;
      return this.plan(this.deferPrimary?"idle":this.primary,{emotion,index,text,deferred:this.deferPrimary});
    }
    if(index===1&&this.deferPrimary)return this.plan(this.primary,{emotion,index,text,deferred:true});
    if(!this.secondaryUsed&&proposed!=="idle"&&proposed!==this.primary){
      this.secondaryUsed=true;return this.plan(this.resolveBudget(proposed),{emotion,index,text});
    }
    return this.plan("idle",{emotion,index,text});
  }
  actionForSentence(text,index=0,candidateAction=this.requestedPrimary){return this.planForSentence(text,index,candidateAction).action;}
  getTimeline(){return this.timeline.map(item=>({...item}));}
  finishTurn(){this.reset();return "idle";}
}

export const conversationActionPolicy=Object.freeze({cooldownMs:3000,shortOpenerCharacters:6,behaviorActions:Object.keys(ACTION_BEHAVIOR)});
