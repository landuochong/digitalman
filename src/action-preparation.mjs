export function shouldPrepareAvatarAction(action,{fastSpeech=false}={}){
  return Boolean(fastSpeech&&String(action||"idle")!=="idle");
}
