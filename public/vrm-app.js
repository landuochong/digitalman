import { VrmCompanion } from "./vrm-avatar.js?v=20260806-63";

const $=selector=>document.querySelector(selector);
const mic=$("#micButton"),caption=$("#caption"),prompt=$("#voicePrompt"),detail=$("#detailText"),wave=$("#wave");
const memoryResetVersion="20260806-identity-reset-1";
if(localStorage.getItem("lumi-memory-reset")!==memoryResetVersion){
  localStorage.removeItem("lumi-vrm-history");localStorage.removeItem("lumiUserId");
  localStorage.setItem("lumi-memory-reset",memoryResetVersion);
}
const userId=localStorage.lumiUserId||globalThis.crypto?.randomUUID?.()||`local-${Date.now()}-${Math.random().toString(36).slice(2)}`;localStorage.lumiUserId=userId;
const personaPresets={
  warm:{name:"露米",relationship:"可信赖的朋友",style:"自然、温暖、有边界感"},
  lively:{name:"小晴",relationship:"元气聊天伙伴",style:"活泼、简短、有幽默感，但不过度夸张"},
  calm:{name:"知夏",relationship:"冷静知己",style:"沉稳、理性、善于倾听，回答清楚直接"},
};
function readStored(key,fallback){try{return JSON.parse(localStorage.getItem(key)||"")||fallback;}catch{return fallback;}}
function cleanPersona(value={}){return{name:String(value.name||"露米").trim().slice(0,20)||"露米",relationship:String(value.relationship||"可信赖的朋友").trim().slice(0,40)||"可信赖的朋友",style:String(value.style||"自然、温暖、有边界感").trim().slice(0,160)||"自然、温暖、有边界感"};}
let storedPersona=readStored("lumi-vrm-persona",personaPresets.warm);if(storedPersona?.relationship==="可信赖的虚拟好友")storedPersona={...storedPersona,relationship:"可信赖的朋友"};
let persona=cleanPersona(storedPersona);
const personaForm=$("#personaForm"),personaPreset=$("#personaPreset"),personaName=$("#personaName"),personaRelationship=$("#personaRelationship"),personaStyle=$("#personaStyle");
function matchingPreset(){return Object.entries(personaPresets).find(([,value])=>value.name===persona.name&&value.relationship===persona.relationship&&value.style===persona.style)?.[0]||"custom";}
function renderPersona(){
  personaName.value=persona.name;personaRelationship.value=persona.relationship;personaStyle.value=persona.style;personaPreset.value=matchingPreset();
  $("#brandName").textContent=`${persona.name} · VRM`;$("#brandInitial").textContent=persona.name.slice(0,1).toUpperCase();document.title=`${persona.name} · VRM 动漫数字人实验`;
}
personaPreset.addEventListener("change",()=>{const preset=personaPresets[personaPreset.value];if(!preset)return;persona={...preset};renderPersona();});
[personaName,personaRelationship,personaStyle].forEach(field=>field.addEventListener("input",()=>{personaPreset.value="custom";}));
personaForm.addEventListener("submit",event=>{event.preventDefault();persona=cleanPersona({name:personaName.value,relationship:personaRelationship.value,style:personaStyle.value});localStorage.setItem("lumi-vrm-persona",JSON.stringify(persona));renderPersona();$("#personaSettings").removeAttribute("open");caption.textContent=`角色设定已保存：${persona.name}`;});
renderPersona();
const looks={
  classic:{url:"/vrm/models/lumi-cc0.vrm",label:"简约短发 · 黑白装"},
  soft:{url:"/vrm/models/avatar-sample-a.vrm",label:"学院日常 · 齐肩短发"},
  vivid:{url:"/vrm/models/avatar-sample-b.vrm",label:"暗色潮流 · 紫色长发"},
  nike1:{url:"/vrm/models/nikechan_v1.vrm",label:"Nike-chan v1 · 经典造型"},
  nike2:{url:"/vrm/models/nikechan_v2.vrm",label:"Nike-chan v2 · 新版造型"},
};
let activeLook=localStorage.getItem("lumi-vrm-look")||"classic";if(!looks[activeLook])activeLook="classic";
let activeRest=localStorage.getItem("lumi-vrm-rest-pose")||"natural";if(!["natural","touch","crossed"].includes(activeRest))activeRest="natural";
let history=readStored("lumi-vrm-history",[]);if(!Array.isArray(history))history=[];let mode="demo",audioContext,activeAudio,activeResolve;
let replyController,speechBatch=0,speechQueue=Promise.resolve();
const labels={neutral:"认真听你说",happy:"很高兴见到你",caring:"温柔陪伴中",curious:"正在想一想",excited:"替你开心",calm:"安静陪伴中"};
const avatar=new VrmCompanion($("#avatarCanvas"),{
  modelUrl:looks[activeLook].url,
  restPose:activeRest,
  onReady:()=>{$("#avatarStatus").textContent=`${looks[activeLook].label}已就绪`;document.querySelectorAll(".looks button").forEach(button=>button.disabled=false);},
  onError:error=>{$("#avatarStatus").textContent=`模型加载失败：${error.message}`;document.querySelectorAll(".looks button").forEach(button=>button.disabled=false);}
});

const canvas=$("#avatarCanvas"),viewButtons=[...document.querySelectorAll("[data-view-angle]")];
function showViewAngle(angle){
  viewButtons.forEach(button=>button.classList.toggle("active",Math.abs(Number(button.dataset.viewAngle)-angle)<2));
}
viewButtons.forEach(button=>button.addEventListener("click",()=>{const angle=Number(button.dataset.viewAngle);avatar.setViewAngle(angle);showViewAngle(angle);}));
canvas.addEventListener("pointerdown",()=>showViewAngle(Number.NaN));
canvas.addEventListener("dblclick",()=>{avatar.resetView();showViewAngle(0);});
showViewAngle(0);

const restButtons=[...document.querySelectorAll("[data-rest-pose]")];
restButtons.forEach(button=>{
  button.classList.toggle("active",button.dataset.restPose===activeRest);
  button.addEventListener("click",async()=>{
    const next=button.dataset.restPose;if(next===activeRest)return;
    restButtons.forEach(item=>item.disabled=true);
    const ok=await avatar.setRestPose(next);
    if(ok){activeRest=next;localStorage.setItem("lumi-vrm-rest-pose",next);restButtons.forEach(item=>item.classList.toggle("active",item.dataset.restPose===next));}
    restButtons.forEach(item=>item.disabled=false);
  });
});

document.querySelectorAll(".looks button").forEach(button=>{
  button.classList.toggle("active",button.dataset.look===activeLook);
  button.addEventListener("click",async()=>{
    const next=button.dataset.look;if(next===activeLook)return;stopAll();
    document.querySelectorAll(".looks button").forEach(item=>item.disabled=true);$("#avatarStatus").textContent=`正在更换${looks[next].label}…`;
    const previous=activeLook,ok=await avatar.switchModel(looks[next].url);
    if(ok){activeLook=next;localStorage.setItem("lumi-vrm-look",next);document.querySelectorAll(".looks button").forEach(item=>item.classList.toggle("active",item.dataset.look===next));$("#avatarStatus").textContent=`${looks[next].label}已就绪`;}
    else{$("#avatarStatus").textContent=`${looks[previous].label}仍在陪伴中`;}
    document.querySelectorAll(".looks button").forEach(item=>item.disabled=false);
  });
});

const actionPreviews={wave_approval:{emotion:"happy",label:"挥手"},clap:{emotion:"excited",label:"鼓掌"},shy:{emotion:"happy",label:"害羞"},thinking:{emotion:"curious",label:"思考"},caring:{emotion:"caring",label:"关心"},surprise:{emotion:"excited",label:"惊讶"}};
document.querySelectorAll("[data-action-preview]").forEach(button=>button.addEventListener("click",()=>{
  const action=button.dataset.actionPreview,preview=actionPreviews[action];avatar.setBehavior(preview.emotion,action,true);$("#expressionLabel").textContent=`动作测试：${preview.label}`;
}));

const calibrationBones={
  leftShoulder:"左肩",leftUpperArm:"左上臂",leftLowerArm:"左前臂",leftHand:"左手腕",
  rightShoulder:"右肩",rightUpperArm:"右上臂",rightLowerArm:"右前臂",rightHand:"右手腕",
};
const calibrationFrame=$("#calibrationFrame"),calibrationBone=$("#calibrationBone"),calibrationOutput=$("#calibrationOutput");
const calibrationInputs=[...document.querySelectorAll("[data-calibration-axis]")];
const calibrationValues=Object.fromEntries(Object.keys(calibrationBones).map(name=>[name,{x:0,y:0,z:0}]));
for(const [value,label] of Object.entries(calibrationBones))calibrationBone.add(new Option(label,value));
function showCalibrationBone(){const values=calibrationValues[calibrationBone.value];calibrationInputs.forEach(input=>input.value=values[input.dataset.calibrationAxis]);}
function applyCalibrationBone(){
  const values=calibrationValues[calibrationBone.value];
  calibrationInputs.forEach(input=>values[input.dataset.calibrationAxis]=Number(input.value)||0);
  avatar.setPoseCalibrationOffset(calibrationBone.value,values);
}
calibrationBone.addEventListener("change",showCalibrationBone);
calibrationInputs.forEach(input=>input.addEventListener("input",applyCalibrationBone));
$("#calibrationStart").addEventListener("click",async()=>{
  stopAll();for(const values of Object.values(calibrationValues))values.x=values.y=values.z=0;showCalibrationBone();
  const ok=await avatar.startPoseCalibration(Number(calibrationFrame.value));
  calibrationOutput.value=ok?"正在标定：调整骨骼角度后导出 JSON":"标定启动失败";
});
$("#calibrationReset").addEventListener("click",()=>{for(const values of Object.values(calibrationValues))values.x=values.y=values.z=0;showCalibrationBone();avatar.resetPoseCalibration();});
$("#calibrationStop").addEventListener("click",()=>{avatar.stopPoseCalibration();calibrationOutput.value="";});
$("#calibrationExport").addEventListener("click",async()=>{
  const pose=avatar.exportPoseCalibration();if(!pose){calibrationOutput.value="请先开始标定";return;}
  const text=JSON.stringify(pose,null,2);calibrationOutput.value=text;
  try{await navigator.clipboard.writeText(text);}catch{}
});
showCalibrationBone();

function setState(state,text){mic.classList.remove("listening","thinking","speaking");if(state!=="idle")mic.classList.add(state);mic.disabled=state==="thinking";if(text)prompt.textContent=text;wave.classList.toggle("active",state==="speaking");avatar.setSpeaking(state==="speaking");}
function stopAll(){speechBatch++;speechQueue=Promise.resolve();replyController?.abort();replyController=null;if(activeAudio){activeAudio.pause();activeAudio.removeAttribute("src");activeAudio=null;}activeResolve?.();activeResolve=null;window.speechSynthesis?.cancel();avatar.setSpeaking(false);avatar.setAudioLevel(0);avatar.finishGesture();setState("idle","点击麦克风继续说话");}
async function consumeEvents(response,onEvent){const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";while(true){const{value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()||"";for(const block of blocks){const event=block.match(/^event:\s*(.+)$/m)?.[1],raw=block.match(/^data:\s*(.+)$/m)?.[1];if(raw)await onEvent(event,JSON.parse(raw));}if(done)break;}}
async function browserSpeech(text,onStart){if(!("speechSynthesis" in window))return;await new Promise(resolve=>{const u=new SpeechSynthesisUtterance(text);u.lang="zh-CN";u.rate=.97;u.pitch=1.08;u.onstart=()=>{onStart?.();setState("speaking",`${persona.name}正在回答`);};u.onend=u.onerror=()=>{avatar.setAudioLevel(0);resolve();};window.speechSynthesis.speak(u);});}
async function cloudSpeech(text,emotion,batch,onStart){
  const response=await fetch("/api/speech",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,emotion})});
  if(batch!==speechBatch)return;if(!response.ok)return browserSpeech(text,onStart);
  const buffer=await response.arrayBuffer();if(batch!==speechBatch)return;
  const url=URL.createObjectURL(new Blob([buffer],{type:response.headers.get("content-type")||"audio/wav"})),audio=new Audio(url);activeAudio=audio;
  audioContext||=new AudioContext();if(audioContext.state==="suspended")await audioContext.resume();
  const source=audioContext.createMediaElementSource(audio),analyser=audioContext.createAnalyser();analyser.fftSize=256;source.connect(analyser);analyser.connect(audioContext.destination);const bins=new Uint8Array(analyser.frequencyBinCount);
  let done=false,raf;const finish=()=>{if(done)return;done=true;cancelAnimationFrame(raf);avatar.setAudioLevel(0);if(activeAudio===audio)activeAudio=null;URL.revokeObjectURL(url);activeResolve=null;};
  const frame=()=>{if(done)return;analyser.getByteFrequencyData(bins);let sum=0;for(let i=2;i<45;i++)sum+=bins[i];avatar.setAudioLevel(sum/43/255);raf=requestAnimationFrame(frame);};
  setState("speaking",`${persona.name}正在回答`);
  await new Promise((resolve,reject)=>{activeResolve=()=>{finish();resolve();};audio.onplay=()=>{onStart?.();frame();};audio.onended=()=>{finish();resolve();};audio.onerror=()=>{finish();resolve();};audio.play().catch(error=>{finish();reject(error);});});
}
function queueSpeech(text,emotion,batch,behavior){
  let started=false,gestureStarted=false;const onStart=()=>{if(started||batch!==speechBatch)return;started=true;if(behavior)gestureStarted=avatar.setBehavior(behavior.emotion,behavior.action,false,true);};
  speechQueue=speechQueue.then(async()=>{if(batch!==speechBatch)return;try{await cloudSpeech(text,emotion,batch,onStart);}catch{await browserSpeech(text,onStart);}finally{if(gestureStarted&&batch===speechBatch)avatar.finishGesture();}});return speechQueue;
}
async function reply(message){
  setState("thinking",`${persona.name}正在想…`);caption.textContent="正在理解你刚才说的话";const controller=new AbortController();replyController=controller;const batch=speechBatch;let finalText="",emotion="calm",behavior=null,behaviorQueued=false;
  try{
    const response=await fetch("/api/chat/stream",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message,history:history.slice(-10),persona,userId}),signal:controller.signal});if(!response.ok||!response.body)throw new Error("连接失败");
    await consumeEvents(response,async(event,data)=>{if(event==="meta"){mode=data.mode;emotion=data.emotion||"calm";behavior={emotion,action:data.action||"idle"};avatar.setBehavior(emotion,"idle");$("#expressionLabel").textContent=labels[emotion]||labels.calm;}if(event==="sentence"){finalText+=data.text;caption.textContent=finalText;const firstBehavior=behaviorQueued?null:behavior;behaviorQueued=true;queueSpeech(data.text,emotion,batch,firstBehavior);}if(event==="done"){finalText=data.reply||finalText;caption.textContent=finalText;emotion=data.emotion||emotion;}if(event==="error")throw new Error(data.error||"回答中断");});
    const completedQueue=speechQueue;
    completedQueue.then(()=>{if(batch===speechBatch&&speechQueue===completedQueue)setState("idle","点击麦克风继续说话");});
    if(finalText){history.push({role:"user",content:message},{role:"assistant",content:finalText});history=history.slice(-20);localStorage.setItem("lumi-vrm-history",JSON.stringify(history));}
  }catch(error){if(error.name!=="AbortError"){caption.textContent=`连接不稳定：${error.message}`;avatar.setBehavior("caring","caring");}}
  finally{if(replyController===controller)replyController=null;mic.disabled=false;}
}

const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
if(Recognition){const recognition=new Recognition();recognition.lang="zh-CN";recognition.interimResults=true;recognition.continuous=false;let text="",failed=false;
  recognition.onstart=()=>{stopAll();text="";failed=false;setState("listening","我在听…");caption.textContent="请自然说话";avatar.setBehavior("curious","idle");};
  recognition.onresult=event=>{text=Array.from(event.results).map(result=>result[0].transcript).join("").trim();caption.textContent=text||"我在听…";};
  recognition.onerror=event=>{failed=true;setState("idle","点击麦克风重试");caption.textContent=event.error==="not-allowed"?"请允许浏览器使用麦克风":"没有听清楚，请再试一次";};
  recognition.onend=()=>{if(text&&!failed)reply(text);else if(!failed)setState("idle","点击麦克风继续说话");};
  mic.onclick=()=>{try{recognition.start();}catch{caption.textContent="麦克风正在启动";}};
}else{mic.disabled=true;prompt.textContent="当前浏览器不支持语音识别";detail.textContent="请使用最新版 Chrome 或 Edge";}

fetch("/api/health").then(r=>r.json()).then(data=>{mode=data.mode;detail.textContent=`${mode==="minimax"?"MiniMax":"本地"} 流式回答 · VRMA 自然动作与表情`;}).catch(()=>{});
