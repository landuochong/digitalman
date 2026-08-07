const miniMaxBuiltins=[
  {key:"sweet",label:"甜美女声",description:"明亮甜美，适合日常陪伴",voiceId:"female-tianmei"},
  {key:"soft",label:"柔和少女",description:"轻柔克制，适合安静聊天",voiceId:"Chinese (Mandarin)_Soft_Girl"},
  {key:"warm",label:"温暖闺蜜",description:"亲切自然，情绪表达温暖",voiceId:"Chinese (Mandarin)_Warm_Bestie"},
  {key:"mature",label:"成熟女声",description:"稳重成熟，语气更有质感",voiceId:"female-chengshu"},
  {key:"elegant",label:"淡雅学姐",description:"清雅温柔，语速感受平稳",voiceId:"danya_xuejie"},
  {key:"cute",label:"嗲嗲学妹",description:"可爱嗲气，风格更活泼",voiceId:"diadia_xuemei"},
  {key:"yujie",label:"经典御姐",description:"成熟利落，气场清晰",voiceId:"female-yujie"},
  {key:"charming_yujie",label:"妩媚御姐",description:"妩媚从容，角色感更强",voiceId:"wumei_yujie"},
  {key:"tsundere_yujie",label:"傲娇御姐",description:"成熟自信，略带傲娇感",voiceId:"Chinese (Mandarin)_Mature_Woman"},
  {key:"assertive_miss",label:"强势小姐",description:"表达直接，气场更强",voiceId:"Arrogant_Miss"},
];

function clean(value,max=120){return String(value??"").replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim().slice(0,max);}
function cleanKey(value){return clean(value,40).replace(/[^a-zA-Z0-9_-]/g,"");}

function parseCustomVoices(value){
  if(!value)return[];
  let parsed;try{parsed=JSON.parse(value);}catch{return[];}
  if(!parsed||Array.isArray(parsed)||typeof parsed!=="object")return[];
  return Object.entries(parsed).map(([rawKey,item])=>{
    const key=cleanKey(rawKey),voiceId=clean(item?.voiceId,256),label=clean(item?.label,40),description=clean(item?.description,100);
    return key&&voiceId&&label?{key,label,description:description||"自定义音色",voiceId}:null;
  }).filter(Boolean);
}

export function buildVoiceCatalog({provider="demo",defaultVoice="",customJson=""}={}){
  let profiles=provider==="minimax"?miniMaxBuiltins.map(item=>({...item})):[];
  if(provider==="minimax"){
    const custom=parseCustomVoices(customJson);
    for(const item of custom){const index=profiles.findIndex(profile=>profile.key===item.key);if(index>=0)profiles[index]=item;else profiles.push(item);}
  }
  const fallback=clean(defaultVoice,256);
  if(fallback&&!profiles.some(item=>item.voiceId===fallback))profiles.unshift({key:"default",label:"当前默认音色",description:"由服务端环境变量配置",voiceId:fallback});
  if(!profiles.length&&fallback)profiles=[{key:"default",label:"默认音色",description:"由服务端环境变量配置",voiceId:fallback}];
  const defaultKey=profiles.find(item=>item.voiceId===fallback)?.key||profiles[0]?.key||"default";
  return{
    provider,defaultKey,
    voices:profiles.map(({key,label,description})=>({key,label,description})),
    resolve(key){return profiles.find(item=>item.key===cleanKey(key))?.voiceId||profiles.find(item=>item.key===defaultKey)?.voiceId||fallback;}
  };
}
