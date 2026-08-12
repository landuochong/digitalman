import { VrmCompanion } from "./vrm-avatar.js?v=20260813-video-handoff-v11";

const looks={classic:"/vrm/models/lumi-cc0.vrm",soft:"/vrm/models/avatar-sample-a.vrm",vivid:"/vrm/models/avatar-sample-b.vrm",nike1:"/vrm/models/nikechan_v1.vrm",nike2:"/vrm/models/nikechan_v2.vrm"};
let activeLook=localStorage.getItem("lumi-vrm-look")||"nike1";
if(!looks[activeLook])activeLook="nike1";
let restPose=localStorage.getItem("lumi-vrm-rest-pose")||"natural";
if(!["natural","touch","crossed"].includes(restPose))restPose="natural";

const status=document.querySelector("#avatarStatus");
const avatar=new VrmCompanion(document.querySelector("#avatarCanvas"),{
  modelUrl:looks[activeLook],restPose,
  onReady:(_,url)=>{document.body.classList.add("ready");const look=Object.entries(looks).find(([,value])=>value===url)?.[0]||activeLook;parent.postMessage({type:"vrm-ready",look},location.origin);},
  onError:error=>{status.textContent=`动漫形象加载失败：${error.message}`;},
});

document.querySelector("#avatarCanvas").addEventListener("dblclick",()=>avatar.resetView());
window.addEventListener("message",async event=>{
  if(event.origin!==location.origin||event.source!==parent)return;
  const data=event.data||{};
  if(data.type==="vrm-behavior"){
    const started=avatar.setBehavior(data.emotion||"calm",data.action||"idle",Boolean(data.force),Boolean(data.hold),data.behavior||null);
    document.body.dataset.action=data.action||"idle";document.body.dataset.actionStarted=String(started);
    if(data.behavior)document.body.dataset.behavior=JSON.stringify(data.behavior);
    parent.postMessage({type:"vrm-behavior-accepted",action:data.action||"idle",started},location.origin);
  }
  if(data.type==="vrm-speaking"){
    avatar.setSpeaking(Boolean(data.active));
  }
  if(data.type==="vrm-audio-level")avatar.setAudioLevel(Number(data.level)||0);
  if(data.type==="vrm-clear"){avatar.setSpeaking(false);avatar.setAudioLevel(0);avatar.finishGesture();}
  if(data.type==="vrm-finish-gesture")avatar.finishGesture();
  if(data.type==="vrm-view-angle")avatar.setViewAngle(Number(data.angle)||0);
  if(data.type==="vrm-look"&&looks[data.look]&&data.look!==activeLook){
    const ok=await avatar.switchModel(looks[data.look]);
    if(ok){activeLook=data.look;localStorage.setItem("lumi-vrm-look",activeLook);}
  }
});
