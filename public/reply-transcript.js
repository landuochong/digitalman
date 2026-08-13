export class ReplyTranscript {
  constructor(){this.sentences=[];this.started=new Set();this.completed=new Set();this.finalText="";this.settled=false;}
  receive(text){const value=String(text||"").trim();if(!value)return-1;this.sentences.push(value);return this.sentences.length-1;}
  start(index){if(this.settled||!Number.isSafeInteger(index)||index<0||index>=this.sentences.length)return this.spokenText;this.started.add(index);return this.spokenText;}
  finish(index){if(this.settled||!this.started.has(index))return this.completedText;this.completed.add(index);return this.completedText;}
  setFinal(text){if(!this.settled)this.finalText=String(text||"").trim();}
  get spokenText(){return this.sentences.filter((_,index)=>this.started.has(index)).join("");}
  get completedText(){let count=0;while(count<this.sentences.length&&this.completed.has(count))count++;return this.sentences.slice(0,count).join("");}
  complete(){if(this.settled)return null;if(this.sentences.length&&this.completed.size<this.sentences.length)return this.interrupt();this.settled=true;const text=this.finalText||this.sentences.join("");return{text,interrupted:false,persist:Boolean(text)};}
  interrupt(){if(this.settled)return null;this.settled=true;const text=this.spokenText,historyText=this.completedText;return{text,historyText,interrupted:true,persist:Boolean(historyText)};}
}
