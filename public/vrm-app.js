import { VrmCompanion } from "./vrm-avatar.js";

const $=selector=>document.querySelector(selector);
const mic=$("#micButton"),caption=$("#caption"),prompt=$("#voicePrompt"),detail=$("#detailText"),wave=$("#wave");
const looks={classic:{url:"/vrm/models/lumi-cc0.vrm",label:"简约短发 · 黑白装"},soft:{url:"/vrm/models/avatar-sample-a.vrm",label:"学院日常 · 齐肩短发"},vivid:{url:"/vrm/models/avatar-sample-b.vrm",label:"暗色潮流 · 紫色长发"}};
let activeLook=localStorage.getItem("lumi-vrm-look")||"classic";if(!looks[activeLook])activeLook="classic";
let history=JSON.parse(localStorage.getItem("lumi-vrm-history")||"[]"),mode="demo",audioContext,activeAudio,activeResolve;
let replyController,speechBatch=0,speechQueue=Promise.resolve();
const labels={neutral:"认真听你说",happy:"很高兴见到你",caring:"温柔陪伴中",curious:"正在想一想",excited:"替你开心",calm:"安静陪伴中"};
const avatar=new VrmCompanion($("#avatarCanvas"),{
  modelUrl:looks[activeLook].url,
  onReady:()=>{$("#avatarStatus").textContent=`${looks[activeLook].label}已就绪`;document.querySelectorAll(".looks button").forEach(button=>button.disabled=false);},
  onError:error=>{$("#avatarStatus").textContent=`模型加载失败：${error.message}`;document.querySelectorAll(".looks button").forEach(button=>button.disabled=false);}
});

const canvas=$("#avatarCanvas"),viewButtons=[...document.querySelectorAll("[data-view-angle]")];
function showViewAngle(angle){
  viewButtons.forEach(button=>button.classList.toggle("active",Math.abs(Number(button.dataset.viewAngle)-angle)<2));
}
viewButtons.forEach(button=>button.addEventListener("click",()=>{const angle=Number(button.dataset.viewAngle);avatar.setViewAngle(angle);showViewAngle(angle);}));
let viewDrag=null;
canvas.addEventListener("pointerdown",event=>{viewDrag={x:event.clientX,angle:avatar.getViewAngle()};canvas.setPointerCapture(event.pointerId);});
canvas.addEventListener("pointermove",event=>{if(!viewDrag)return;const angle=viewDrag.angle+(event.clientX-viewDrag.x)*.28;avatar.setViewAngle(angle);showViewAngle(avatar.getViewAngle());});
canvas.addEventListener("pointerup",()=>{viewDrag=null;});
canvas.addEventListener("pointercancel",()=>{viewDrag=null;});
canvas.addEventListener("dblclick",()=>{avatar.setViewAngle(0);showViewAngle(0);});
showViewAngle(0);

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

const actionPreviews={wave_approval:{emotion:"happy",label:"挥手"},clap:{emotion:"excited",label:"鼓掌"},thinking:{emotion:"curious",label:"思考"},caring:{emotion:"caring",label:"关心"},surprise:{emotion:"excited",label:"惊讶"}};
document.querySelectorAll("[data-action-preview]").forEach(button=>button.addEventListener("click",()=>{
  const action=button.dataset.actionPreview,preview=actionPreviews[action];avatar.setBehavior(preview.emotion,action,true);$("#expressionLabel").textContent=`动作测试：${preview.label}`;
}));

function setState(state,text){mic.classList.remove("listening","thinking","speaking");if(state!=="idle")mic.classList.add(state);mic.disabled=state==="thinking";if(text)prompt.textContent=text;wave.classList.toggle("active",state==="speaking");avatar.setSpeaking(state==="speaking");}
function stopAll(){speechBatch++;speechQueue=Promise.resolve();replyController?.abort();replyController=null;if(activeAudio){activeAudio.pause();activeAudio.removeAttribute("src");activeAudio=null;}activeResolve?.();activeResolve=null;window.speechSynthesis?.cancel();avatar.setSpeaking(false);avatar.setAudioLevel(0);setState("idle","点击麦克风继续说话");}
async function consumeEvents(response,onEvent){const reader=response.body.getReader(),decoder=new TextDecoder();let buffer="";while(true){const{value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const blocks=buffer.split(/\r?\n\r?\n/);buffer=blocks.pop()||"";for(const block of blocks){const event=block.match(/^event:\s*(.+)$/m)?.[1],raw=block.match(/^data:\s*(.+)$/m)?.[1];if(raw)await onEvent(event,JSON.parse(raw));}if(done)break;}}
async function browserSpeech(text,onStart){if(!("speechSynthesis" in window))return;await new Promise(resolve=>{const u=new SpeechSynthesisUtterance(text);u.lang="zh-CN";u.rate=.97;u.pitch=1.08;u.onstart=()=>{onStart?.();setState("speaking","露米正在回答");};u.onend=u.onerror=()=>{avatar.setAudioLevel(0);resolve();};window.speechSynthesis.speak(u);});}
async function cloudSpeech(text,emotion,batch,onStart){
  const response=await fetch("/api/speech",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,emotion})});
  if(batch!==speechBatch)return;if(!response.ok)return browserSpeech(text,onStart);
  const buffer=await response.arrayBuffer();if(batch!==speechBatch)return;
  const url=URL.createObjectURL(new Blob([buffer],{type:response.headers.get("content-type")||"audio/wav"})),audio=new Audio(url);activeAudio=audio;
  audioContext||=new AudioContext();if(audioContext.state==="suspended")await audioContext.resume();
  const source=audioContext.createMediaElementSource(audio),analyser=audioContext.createAnalyser();analyser.fftSize=256;source.connect(analyser);analyser.connect(audioContext.destination);const bins=new Uint8Array(analyser.frequencyBinCount);
  let done=false,raf;const finish=()=>{if(done)return;done=true;cancelAnimationFrame(raf);avatar.setAudioLevel(0);if(activeAudio===audio)activeAudio=null;URL.revokeObjectURL(url);activeResolve=null;};
  const frame=()=>{if(done)return;analyser.getByteFrequencyData(bins);let sum=0;for(let i=2;i<45;i++)sum+=bins[i];avatar.setAudioLevel(sum/43/255);raf=requestAnimationFrame(frame);};
  setState("speaking","露米正在回答");
  await new Promise((resolve,reject)=>{activeResolve=()=>{finish();resolve();};audio.onplay=()=>{onStart?.();frame();};audio.onended=()=>{finish();resolve();};audio.onerror=()=>{finish();resolve();};audio.play().catch(error=>{finish();reject(error);});});
}
function queueSpeech(text,emotion,batch,behavior){
  let started=false;const onStart=()=>{if(started||batch!==speechBatch)return;started=true;if(behavior)avatar.setBehavior(behavior.emotion,behavior.action);};
  speechQueue=speechQueue.then(async()=>{if(batch!==speechBatch)return;try{await cloudSpeech(text,emotion,batch,onStart);}catch{await browserSpeech(text,onStart);}});return speechQueue;
}
async function reply(message){
  setState("thinking","露米正在想…");caption.textContent="正在理解你刚才说的话";const controller=new AbortController();replyController=controller;const batch=speechBatch;let finalText="",emotion="calm",behavior=null,behaviorQueued=false;
  try{
    const response=await fetch("/api/chat/stream",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message,history:history.slice(-10)}),signal:controller.signal});if(!response.ok||!response.body)throw new Error("连接失败");
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
