const HIGH_ENERGY_ACTIONS=new Set(["wave_approval","clap","cheer","surprise","bow","shrug","cross","confident_arms_crossed","shy"]);
const DEFER_ON_SHORT_OPENER=new Set(["caring","thinking","shy","confident_arms_crossed"]);
const FALLBACK_ACTIONS={
  wave_approval:"happy",clap:"happy",cheer:"happy",surprise:"idle",bow:"idle",
  shrug:"thinking",cross:"idle",confident_arms_crossed:"idle",shy:"happy"
};
const EXPLICIT_ACTION_WORDS=/挥手|招手|点头|竖拇指|大拇指|点赞|点个赞|鼓掌|拍手|欢呼|庆祝|鞠躬|行礼|耸肩|摊手|交叉手势|做个叉|叉手|抱胸|双臂交叉|害羞|捂嘴|惊讶动作|做.{0,3}(?:动作|姿势)/;

function spokenLength(text){return String(text||"").replace(/[，,、。！？!?；;\s]/g,"").length;}

export class ConversationActionScheduler{
  constructor({cooldownMs=3000,clock=()=>Date.now()}={}){
    this.cooldownMs=cooldownMs;this.clock=clock;this.lastHighEnergyAt=-Infinity;this.reset();
  }
  reset(){this.primary="idle";this.requestedPrimary="idle";this.deferPrimary=false;this.secondaryUsed=false;this.explicit=false;this.started=false;}
  resolveBudget(action,explicit=this.explicit){
    const now=this.clock();let resolved=String(action||"idle");
    if(HIGH_ENERGY_ACTIONS.has(resolved)&&!explicit&&now-this.lastHighEnergyAt<this.cooldownMs)resolved=FALLBACK_ACTIONS[resolved]||"idle";
    if(HIGH_ENERGY_ACTIONS.has(resolved))this.lastHighEnergyAt=now;
    return resolved;
  }
  startTurn({message="",action="idle",emotion="calm"}={}){
    this.explicit=EXPLICIT_ACTION_WORDS.test(String(message));this.requestedPrimary=String(action||"idle");
    this.primary=this.resolveBudget(this.requestedPrimary,this.explicit);this.deferPrimary=false;this.secondaryUsed=false;this.started=true;
    return {action:this.primary,emotion,explicit:this.explicit};
  }
  actionForSentence(text,index=0,candidateAction=this.requestedPrimary){
    if(!this.started)return "idle";
    let proposed=String(candidateAction||"idle");
    if(proposed===this.requestedPrimary)proposed=this.primary;
    if(index===0){
      if(proposed!=="idle"&&proposed!==this.primary)this.primary=this.resolveBudget(proposed);
      this.deferPrimary=DEFER_ON_SHORT_OPENER.has(this.primary)&&spokenLength(text)<6;
      return this.deferPrimary?"idle":this.primary;
    }
    if(index===1&&this.deferPrimary)return this.primary;
    if(!this.secondaryUsed&&proposed!=="idle"&&proposed!==this.primary){
      this.secondaryUsed=true;return this.resolveBudget(proposed);
    }
    return "idle";
  }
  finishTurn(){this.reset();return "idle";}
}

export const conversationActionPolicy=Object.freeze({cooldownMs:3000,shortOpenerCharacters:6});
