const HIGH_ENERGY_ACTIONS=new Set(["wave_approval","clap","cheer","surprise","bow","shrug","cross","confident_arms_crossed","shy"]);
const DEFER_ON_SHORT_OPENER=new Set(["caring","thinking","shy","confident_arms_crossed"]);
const FALLBACK_ACTIONS={
  wave_approval:"happy",clap:"happy",cheer:"happy",surprise:"idle",bow:"idle",
  shrug:"thinking",cross:"idle",confident_arms_crossed:"idle",shy:"happy"
};
const EXPLICIT_ACTION_WORDS=/挥手|招手|点头|鼓掌|拍手|欢呼|庆祝|鞠躬|行礼|耸肩|摊手|交叉手势|做个叉|叉手|抱胸|双臂交叉|害羞|捂嘴|惊讶动作|做.{0,3}(?:动作|姿势)/;

function spokenLength(text){return String(text||"").replace(/[，,、。！？!?；;\s]/g,"").length;}

export class ConversationActionScheduler{
  constructor({cooldownMs=3000,clock=()=>Date.now()}={}){
    this.cooldownMs=cooldownMs;this.clock=clock;this.lastHighEnergyAt=-Infinity;this.reset();
  }
  reset(){this.primary="idle";this.deferPrimary=false;this.started=false;}
  startTurn({message="",action="idle",emotion="calm"}={}){
    const now=this.clock(),explicit=EXPLICIT_ACTION_WORDS.test(String(message));
    let primary=String(action||"idle");
    if(HIGH_ENERGY_ACTIONS.has(primary)&&!explicit&&now-this.lastHighEnergyAt<this.cooldownMs)primary=FALLBACK_ACTIONS[primary]||"idle";
    if(HIGH_ENERGY_ACTIONS.has(primary))this.lastHighEnergyAt=now;
    this.primary=primary;this.deferPrimary=false;this.started=true;
    return {action:primary,emotion,explicit};
  }
  actionForSentence(text,index=0){
    if(!this.started)return "idle";
    if(index===0){
      this.deferPrimary=DEFER_ON_SHORT_OPENER.has(this.primary)&&spokenLength(text)<6;
      return this.deferPrimary?"idle":this.primary;
    }
    if(index===1&&this.deferPrimary)return this.primary;
    return "idle";
  }
  finishTurn(){this.reset();return "idle";}
}

export const conversationActionPolicy=Object.freeze({cooldownMs:3000,shortOpenerCharacters:6});
