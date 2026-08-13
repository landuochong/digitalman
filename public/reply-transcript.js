export class ReplyTranscript {
  constructor(){this.sentences=[];this.started=new Set();this.finalText="";this.settled=false;}
  receive(text){const value=String(text||"").trim();if(!value)return-1;this.sentences.push(value);return this.sentences.length-1;}
  start(index){if(this.settled||!Number.isSafeInteger(index)||index<0||index>=this.sentences.length)return this.spokenText;this.started.add(index);return this.spokenText;}
  setFinal(text){if(!this.settled)this.finalText=String(text||"").trim();}
  get spokenText(){return this.sentences.filter((_,index)=>this.started.has(index)).join("");}
  complete(){if(this.settled)return null;this.settled=true;const text=this.finalText||this.sentences.join("");return{text,interrupted:false,persist:Boolean(text)};}
  interrupt(){if(this.settled)return null;this.settled=true;const text=this.spokenText;return{text,interrupted:true,persist:Boolean(text)};}
}
