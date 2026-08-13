export function shouldEmitFormalSentence(sentence,backchannel,{offered=false}={}){
  const normalize=value=>String(value||"").replace(/[，。！？!?；;、\s]/g,"");
  return !offered||!backchannel?.text||normalize(sentence)!==normalize(backchannel.text);
}
