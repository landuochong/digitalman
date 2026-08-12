import { ConversationActionScheduler } from "./conversation-actions.js?v=20260810-conversation-actions-v2";

const $ = (selector) => document.querySelector(selector);
const portrait = $("#portrait"), wave = $("#soundWave"), messages = $("#messages");
const input = $("#messageInput"), form = $("#chatForm"), sendButton = $("#sendButton");
const micButton = $("#micButton"), modeBanner = $("#modeBanner"), statusText = $("#statusText");
const voiceButton = $("#voiceButton"), voicePrompt = $("#voicePrompt"), liveTranscript = $("#liveTranscript"), captionButton = $("#captionButton");
const digitalHumanFrame = $("#digitalHumanFrame");
const avatarRuntimeVersion="20260812-stream-v3";
const avatarRuntimeUrl=path=>`${path}?v=${avatarRuntimeVersion}`;
const avatarProfile = new URLSearchParams(location.search).get("profile");
const selfRecordedProfile = avatarProfile === "self";
const minimaxGeneratedProfile = avatarProfile === "minimax";
const lakesideGeneratedProfile = avatarProfile === "lakeside";
const cleanAvatarProfile = avatarProfile === "clean";
const wav2LipAvatarProfile = avatarProfile === "wav2lip";
const dinetAvatarProfile = avatarProfile === "dinet";
const fixedExperimentProfile = selfRecordedProfile || minimaxGeneratedProfile || lakesideGeneratedProfile || cleanAvatarProfile || wav2LipAvatarProfile;
const switchableAvatarProfile = !fixedExperimentProfile;
let avatarMode = switchableAvatarProfile
  ? (avatarProfile === "anime" ? "anime" : localStorage.getItem("lumi-avatar-mode") || "real")
  : "experiment";
if(!["real","anime","experiment"].includes(avatarMode))avatarMode="real";
let neuralAvatarProfile = wav2LipAvatarProfile || (switchableAvatarProfile && avatarMode === "real");
const neuralRenderEndpoint = wav2LipAvatarProfile ? "/api/wav2lip/render" : "/api/dinet/render";
const streamingAvatarExperiment = new URLSearchParams(location.search).get("streaming") !== "0";
const silentNeuralActions={
  bow:"/real-actions/bedroom_bow_silent.mp4",
  surprise:"/real-actions/bedroom_surprise_silent.mp4"
};
const animeLooks={soft:"学院日常",vivid:"暗色潮流",nike1:"Nike-chan v1",nike2:"Nike-chan v2",classic:"简约短发"};
const animeLookSchema="20260807-unified-look-v2";
let animeLook=localStorage.getItem("lumi-vrm-look")||"nike1";
if(!animeLooks[animeLook])animeLook="nike1";
if(localStorage.getItem("lumi-vrm-look-schema")!==animeLookSchema){
  if(animeLook==="classic")animeLook="nike1";
  localStorage.setItem("lumi-vrm-look",animeLook);localStorage.setItem("lumi-vrm-look-schema",animeLookSchema);
}
const selfRecordedActions = {
  idle:"self_idle", happy:"self_smile", smile:"self_smile", shy:"self_smile", clap:"self_smile", cheer:"self_smile",
  wave_approval:"self_agree", nod:"self_agree", thumbs_up:"self_agree", bow:"self_agree",
  caring:"self_idle", thinking:"self_idle", surprise:"self_idle", shrug:"self_idle", confident_arms_crossed:"self_idle", cross:"self_idle"
};
const minimaxGeneratedActions = {
  idle:"minimax_idle_test", happy:"minimax_smile_test", smile:"minimax_smile_test", shy:"minimax_smile_test",
  wave_approval:"minimax_agree_test", nod:"minimax_agree_test", thumbs_up:"minimax_agree_test", bow:"minimax_agree_test",
  caring:"minimax_idle_test", thinking:"minimax_idle_test", surprise:"minimax_idle_test", clap:"minimax_smile_test",
  cheer:"minimax_smile_test", shrug:"minimax_idle_test", confident_arms_crossed:"minimax_idle_test", cross:"minimax_idle_test"
};
const lakesideGeneratedActions = {
  idle:"lakeside_idle_test", happy:"lakeside_smile_test", smile:"lakeside_smile_test", shy:"lakeside_shy",
  wave_approval:"lakeside_wave", nod:"lakeside_agree_test", thumbs_up:"lakeside_agree_test", bow:"lakeside_agree_test",
  caring:"lakeside_caring", thinking:"lakeside_thinking", surprise:"lakeside_surprise", clap:"lakeside_clap",
  cheer:"lakeside_cheer", shrug:"lakeside_shrug", confident_arms_crossed:"lakeside_arms_crossed", cross:"lakeside_cross"
};
const cleanAvatarActions = {
  idle:"idle", happy:"smile", smile:"smile", shy:"smile", wave_approval:"agree", nod:"agree", thumbs_up:"agree", bow:"agree",
  caring:"idle", thinking:"idle", surprise:"idle", clap:"smile", cheer:"smile", shrug:"idle",
  confident_arms_crossed:"idle", cross:"idle"
};
if (switchableAvatarProfile && digitalHumanFrame) {
  digitalHumanFrame.src = avatarRuntimeUrl(avatarMode === "anime" ? "/vrm-embed.html" : "/wav2lip-avatar/avatar.html");
  portrait.dataset.avatarMode=avatarMode;
  const note=document.querySelector(".avatar-note");
  if(note)note.textContent=avatarMode==="anime"?"动漫陪伴 · 自然表情与动作":"真人陪伴 · 自然中文语音";
} else if ((selfRecordedProfile || minimaxGeneratedProfile || lakesideGeneratedProfile || cleanAvatarProfile || neuralAvatarProfile) && digitalHumanFrame) {
  const initialAction = cleanAvatarProfile ? "idle" : lakesideGeneratedProfile ? "lakeside_idle_test" : minimaxGeneratedProfile ? "minimax_idle_test" : "self_idle";
  digitalHumanFrame.src = neuralAvatarProfile
    ? avatarRuntimeUrl("/wav2lip-avatar/avatar.html")
    : cleanAvatarProfile
    ? `/clean-avatar/avatar.html?action=${initialAction}`
    : `/dh-live/avatar.html?action=${initialAction}`;
  const note = document.querySelector(".avatar-note");
  if (note) note.textContent = "真人陪伴 · 自然表情与语音";
}
const avatarModeSwitch=$("#avatarModeSwitch");
if(avatarModeSwitch)avatarModeSwitch.hidden=!switchableAvatarProfile;
const animeLookControl=$("#animeLookControl"),animeLookSelect=$("#animeLookSelect");
const animeViewControls=$("#animeViewControls"),animeViewButtons=[...document.querySelectorAll("[data-view-angle]")];
if(animeLookSelect)animeLookSelect.value=animeLook;
if(animeLookControl)animeLookControl.hidden=!switchableAvatarProfile||avatarMode!=="anime";
if(animeViewControls)animeViewControls.hidden=!switchableAvatarProfile||avatarMode!=="anime";
const historySchema="20260807-user-reset-v6";
if(localStorage.getItem("lumi-history-schema")!==historySchema){localStorage.removeItem("lumi-history");localStorage.removeItem("lumi-vrm-history");localStorage.setItem("lumi-history-schema",historySchema);}
let history = JSON.parse(localStorage.getItem("lumi-history") || "[]");
let mode = "demo", speakingToken = 0, audioContext, activeAudio, activeSpeechResolve, speechTimer, actionRequestId = 0;
const activeStreamingSpeech=new Set();
let speechQueue = Promise.resolve(), speechBatch = 0, activeReplyController;
const conversationActions=new ConversationActionScheduler();
let voiceCallActive = false;
const pendingActions = new Map();
const pendingWav2LipPlaybacks = new Map();
const userId = localStorage.lumiUserId ||= crypto.randomUUID();
const personaPresets={
  warm:{name:"露米",relationship:"可信赖的朋友",style:"自然、温暖、有边界感",background:"喜欢傍晚的湖边、轻音乐和生活里细小的好消息，擅长安静倾听，也愿意认真陪你一起想办法"},
  lively:{name:"小晴",relationship:"元气聊天伙伴",style:"活泼、简短、有幽默感，但不过度夸张",background:"喜欢明亮的颜色、轻快音乐和新鲜小事，善于为好消息庆祝，也会在你没精神时温柔打气"},
  calm:{name:"知夏",relationship:"冷静知己",style:"沉稳、理性、善于倾听，回答清楚直接",background:"喜欢安静阅读、整理思路和夜晚的微风，遇到复杂问题时习惯先分清重点，再陪你慢慢解决"},
};
function cleanPersona(value={}){return{name:String(value.name||"露米").trim().slice(0,20)||"露米",relationship:String(value.relationship||"可信赖的朋友").trim().slice(0,40)||"可信赖的朋友",style:String(value.style||"自然、温暖、有边界感").trim().slice(0,160)||"自然、温暖、有边界感",background:String(value.background||personaPresets.warm.background).trim().slice(0,240)||personaPresets.warm.background};}
let storedPersona;
try{storedPersona=JSON.parse(localStorage.getItem("lumi-vrm-persona")||"null");}catch{storedPersona=null;}
const personaSchema="20260807-real-self-v1";
if(localStorage.getItem("lumi-persona-schema")!==personaSchema&&storedPersona){
  storedPersona={...storedPersona,relationship:String(storedPersona.relationship||"").replace(/虚拟伙伴/g,"朋友").replace(/虚拟知己/g,"知己")||"可信赖的朋友"};
  localStorage.setItem("lumi-vrm-persona",JSON.stringify(storedPersona));localStorage.setItem("lumi-persona-schema",personaSchema);
}
let persona=cleanPersona(storedPersona||personaPresets.warm);
let voiceProfile=localStorage.getItem("lumi-voice-profile")||"";
const personaForm=$("#personaForm"),personaPreset=$("#personaPreset"),personaName=$("#personaName"),personaRelationship=$("#personaRelationship"),personaStyle=$("#personaStyle"),personaBackground=$("#personaBackground"),personaVoice=$("#personaVoice");
function matchingPersonaPreset(){return Object.entries(personaPresets).find(([,value])=>value.name===persona.name&&value.relationship===persona.relationship&&value.style===persona.style&&value.background===persona.background)?.[0]||"custom";}
function renderPersona(){
  personaName.value=persona.name;personaRelationship.value=persona.relationship;personaStyle.value=persona.style;personaBackground.value=persona.background;personaPreset.value=matchingPersonaPreset();
  document.querySelector(".brand>span:last-child").textContent=persona.name;document.querySelector(".brand-mark").textContent=persona.name.slice(0,1).toUpperCase();
  document.querySelectorAll(".message.assistant span").forEach(label=>label.textContent=persona.name);
  const welcomeMessage=$("#welcomeMessage");if(welcomeMessage)welcomeMessage.textContent=`嗨，我是${persona.name}。很高兴见到你！无论是想分享一件小事，还是只想找个人说说话，我都在。`;
  input.placeholder=`和${persona.name}说点什么…`;document.title=`${persona.name} · 你的好友`;
}
personaPreset?.addEventListener("change",()=>{const preset=personaPresets[personaPreset.value];if(preset){persona={...preset};renderPersona();}});
[personaName,personaRelationship,personaStyle,personaBackground].forEach(field=>field?.addEventListener("input",()=>{personaPreset.value="custom";}));
personaForm?.addEventListener("submit",event=>{event.preventDefault();persona=cleanPersona({name:personaName.value,relationship:personaRelationship.value,style:personaStyle.value,background:personaBackground.value});voiceProfile=personaVoice?.value||voiceProfile;localStorage.setItem("lumi-vrm-persona",JSON.stringify(persona));if(voiceProfile)localStorage.setItem("lumi-voice-profile",voiceProfile);renderPersona();$("#personaSettings")?.removeAttribute("open");liveTranscript.textContent=`人物设置已保存：${persona.name}`;});
renderPersona();
const emotionText = { neutral:"认真听你说", happy:"很高兴见到你", caring:"我会陪着你", curious:"正在好奇", excited:"替你开心", calm:"安静陪伴中" };

function applyAvatarMode(next,{interrupt=true}={}){
  if(!switchableAvatarProfile||!["real","anime"].includes(next)||next===avatarMode)return;
  if(interrupt)stopSpeech();
  avatarMode=next;neuralAvatarProfile=next==="real";
  localStorage.setItem("lumi-avatar-mode",next);
  portrait.dataset.avatarMode=next;portrait.classList.remove("dh-live-ready");
  digitalHumanFrame.title=next==="real"?"露米的真人形象":"露米的动漫形象";
  digitalHumanFrame.src=avatarRuntimeUrl(next==="real"?"/wav2lip-avatar/avatar.html":"/vrm-embed.html");
  if(animeLookControl)animeLookControl.hidden=next!=="anime";
  if(animeViewControls)animeViewControls.hidden=next!=="anime";
  avatarModeSwitch?.querySelectorAll("[data-avatar-mode]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.avatarMode===next)));
  const note=document.querySelector(".avatar-note");
  if(note)note.textContent=next==="anime"?"动漫陪伴 · 自然表情与动作":"真人陪伴 · 自然中文语音";
  statusText.textContent=next==="anime"?"正在准备动漫形象…":"正在准备真人形象…";
}
avatarModeSwitch?.querySelectorAll("[data-avatar-mode]").forEach(button=>{
  button.setAttribute("aria-pressed",String(button.dataset.avatarMode===avatarMode));
  button.addEventListener("click",()=>applyAvatarMode(button.dataset.avatarMode));
});
animeLookSelect?.addEventListener("change",()=>{
  const next=animeLookSelect.value;if(!animeLooks[next]||next===animeLook)return;
  stopSpeech();animeLook=next;localStorage.setItem("lumi-vrm-look",next);
  statusText.textContent=`正在更换${animeLooks[next]}…`;
  digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-look",look:next},location.origin);
});
function showAnimeViewAngle(angle){animeViewButtons.forEach(button=>button.classList.toggle("active",Number(button.dataset.viewAngle)===angle));}
animeViewButtons.forEach(button=>button.addEventListener("click",()=>{
  const angle=Number(button.dataset.viewAngle);showAnimeViewAngle(angle);
  digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-view-angle",angle},location.origin);
}));

function setEmotion(emotion = "neutral") {
  portrait.dataset.emotion = emotion;
  $("#emotionLabel").textContent = emotionText[emotion] || emotionText.neutral;
}
function setDigitalHumanAction(action = "idle",{force=false,hold=true}={}) {
  if (!digitalHumanFrame?.contentWindow) return Promise.resolve();
  if (switchableAvatarProfile && avatarMode === "anime") {
    digitalHumanFrame.contentWindow.postMessage({type:"vrm-behavior",emotion:portrait.dataset.emotion||"calm",action,force,hold},location.origin);
    return Promise.resolve();
  }
  if (neuralAvatarProfile) return Promise.resolve();
  action = cleanAvatarProfile
    ? (cleanAvatarActions[action] || "idle")
    : lakesideGeneratedProfile
    ? (lakesideGeneratedActions[action] || "lakeside_idle_test")
    : minimaxGeneratedProfile
    ? (minimaxGeneratedActions[action] || "minimax_idle_test")
    : selfRecordedProfile ? (selfRecordedActions[action] || "self_idle") : action;
  const requestId = ++actionRequestId;
  return new Promise(resolve => {
    const timer = setTimeout(() => { pendingActions.delete(requestId); resolve(); }, 3500);
    pendingActions.set(requestId, () => { clearTimeout(timer); resolve(); });
    digitalHumanFrame.contentWindow.postMessage({ type:"dh-live-action", action, requestId }, location.origin);
  });
}
function mouth(open = 0, width = .5) {
  portrait.style.setProperty("--mouth-h", `${Math.max(5, 5 + open * 26)}px`);
  portrait.style.setProperty("--mouth-w", `${22 + width * 13}px`);
  portrait.style.setProperty("--real-mouth-h", `${Math.max(4, 4 + open * 25)}px`);
  portrait.style.setProperty("--real-mouth-w", `${58 + width * 14}px`);
}
function speaking(active) {
  portrait.classList.toggle("speaking", active); wave.classList.toggle("active", active);
  statusText.textContent = active ? "正在和你说话" : "在线 · 随时听你说";
  if (active) voiceButton.classList.remove("listening", "thinking");
  voiceButton.classList.toggle("speaking", active);
  voiceButton.disabled = false;
  voiceButton.setAttribute("aria-label", voiceCallActive ? "结束通话" : "开始通话");
  if (active) { voicePrompt.textContent=`${persona.name}正在回答`; liveTranscript.textContent=voiceCallActive?"回答后会自动继续听你说":"正在播放回答"; }
  else if (!voiceButton.classList.contains("listening") && !voiceButton.classList.contains("thinking")) { voicePrompt.textContent=voiceCallActive?"正在继续通话…":"点击麦克风开始通话"; liveTranscript.textContent=voiceCallActive?"我会自动继续听你说":"通话中会自动轮流说话"; }
  if (!active) mouth(0, .5);
  if(switchableAvatarProfile&&avatarMode==="anime")digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-speaking",active},location.origin);
}
function setVoiceState(state, detail) {
  voiceButton.classList.remove("listening","thinking","speaking");
  voiceButton.disabled = false;
  voiceButton.setAttribute("aria-label", voiceCallActive ? "结束通话" : "开始通话");
  if (state === "listening") { voiceButton.classList.add("listening"); voicePrompt.textContent="我在听…"; }
  if (state === "thinking") { voiceButton.classList.add("thinking"); voicePrompt.textContent=`${persona.name}正在想…`; }
  if (state === "idle") { voicePrompt.textContent=voiceCallActive?"正在继续通话…":"点击麦克风开始通话"; }
  if (detail) liveTranscript.textContent=detail;
}
function stopSpeech() {
  speakingToken++;
  speechBatch++;
  speechQueue = Promise.resolve();
  activeReplyController?.abort(); activeReplyController = null;
  for(const stream of activeStreamingSpeech)stream.cancel();activeStreamingSpeech.clear();
  clearInterval(speechTimer);
  window.speechSynthesis?.cancel();
  if (activeAudio) { activeAudio.pause(); activeAudio.removeAttribute("src"); activeAudio = null; }
  for(const finish of [...pendingWav2LipPlaybacks.values()])finish();pendingWav2LipPlaybacks.clear();
  activeSpeechResolve?.(); activeSpeechResolve = null;
  digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-clear" }, location.origin);
  digitalHumanFrame?.contentWindow?.postMessage({ type:"wav2lip-clear" }, location.origin);
  digitalHumanFrame?.contentWindow?.postMessage({ type:"vrm-clear" }, location.origin);
  conversationActions.finishTurn();
  speaking(false);
}
function addMessage(role, content, persist = true) {
  const article = document.createElement("article"); article.className = `message ${role}`;
  article.innerHTML = role === "assistant"
    ? `<div class="mini-avatar"></div><div><span></span><p></p></div>`
    : `<div><span>你</span><p></p></div>`;
  if(role==="assistant"){article.querySelector(".mini-avatar").textContent=persona.name.slice(0,1).toUpperCase();article.querySelector("span").textContent=persona.name;}
  article.querySelector("p").textContent = content; messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  if (persist) { history.push({ role, content }); history = history.slice(-20); localStorage.setItem("lumi-history", JSON.stringify(history)); }
  return article;
}
function showTyping() {
  const el = document.createElement("article"); el.className = "message assistant typing"; el.id = "typing";
  el.innerHTML = `<div class="mini-avatar"></div><div><span></span><p><i></i><i></i><i></i></p></div>`;el.querySelector(".mini-avatar").textContent=persona.name.slice(0,1).toUpperCase();el.querySelector("span").textContent=`${persona.name}正在想`; messages.append(el); messages.scrollTop = messages.scrollHeight;
}
function animateBrowserSpeech(text) {
  const token = ++speakingToken;
  if (!("speechSynthesis" in window)) return Promise.resolve();
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN"; utterance.rate = .98; utterance.pitch = 1.08;
  const voices = speechSynthesis.getVoices(); utterance.voice = voices.find(v => /zh|Chinese|Ting|Meijia|Sinji/i.test(`${v.lang} ${v.name}`)) || null;
  utterance.onstart = () => { speaking(true); speechTimer = setInterval(() => { const t = performance.now()/110; mouth(.18 + Math.abs(Math.sin(t)*.65 + Math.sin(t*1.9)*.17), .35 + Math.abs(Math.sin(t*.37))*.55); }, 70); };
  utterance.onboundary = () => mouth(.75, Math.random());
  return new Promise(resolve => {
    utterance.onend = utterance.onerror = () => { clearInterval(speechTimer); if (token === speakingToken) speaking(false); resolve(); };
    speechSynthesis.speak(utterance);
  });
}
async function playCloudSpeech(text, emotion) {
  const requestToken = ++speakingToken;
  const response = await fetch("/api/speech", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ text, emotion, voice:voiceProfile }) });
  if (requestToken !== speakingToken) return;
  if (!response.ok) return animateBrowserSpeech(text);
  const speechBuffer = await response.arrayBuffer();
  if (neuralAvatarProfile) {
    statusText.textContent = "正在准备回答…";
    const renderResponse = await fetch(neuralRenderEndpoint, {
      method:"POST",
      headers:{ "content-type":response.headers.get("content-type") || "application/octet-stream" },
      body:speechBuffer
    });
    if (!renderResponse.ok) {
      const error = await renderResponse.json().catch(() => ({}));
      throw new Error(error.error || "回答准备失败");
    }
    const rendered = await renderResponse.json();
    if (requestToken !== speakingToken) return;
    const requestId = crypto.randomUUID();
    speaking(true);
    digitalHumanFrame.contentWindow.postMessage({ type:"wav2lip-play", url:rendered.url, requestId }, location.origin);
    return await new Promise(resolve => {
      const timer = setTimeout(() => { pendingWav2LipPlaybacks.delete(requestId); speaking(false); resolve(); }, 180_000);
      const finish = () => { clearTimeout(timer); pendingWav2LipPlaybacks.delete(requestId); if(requestToken===speakingToken)speaking(false); activeSpeechResolve=null; resolve(); };
      pendingWav2LipPlaybacks.set(requestId, finish);
      activeSpeechResolve = finish;
    });
  }
  const rendererBuffer = speechBuffer.slice(0);
  const url = URL.createObjectURL(new Blob([speechBuffer], { type:response.headers.get("content-type") || "audio/mpeg" })), audio = new Audio(url);
  if (requestToken !== speakingToken) { URL.revokeObjectURL(url); return; }
  activeAudio = audio;
  audioContext ||= new AudioContext(); if (audioContext.state === "suspended") await audioContext.resume();
  const source = audioContext.createMediaElementSource(audio), analyser = audioContext.createAnalyser(); analyser.fftSize = 256;
  source.connect(analyser); analyser.connect(audioContext.destination); const data = new Uint8Array(analyser.frequencyBinCount);
  const token = requestToken; let smoothOpen = 0, smoothWidth = .5; speaking(true);
  function frame() { if (audio.paused || audio.ended || token !== speakingToken) return; analyser.getByteFrequencyData(data); const low = data.slice(2,18).reduce((a,b)=>a+b,0)/16/255; const mid = data.slice(18,55).reduce((a,b)=>a+b,0)/37/255; const targetOpen = low < .06 ? 0 : Math.min(1, low*1.65); const targetWidth = Math.min(1, .25+mid*1.2); smoothOpen += (targetOpen-smoothOpen)*(targetOpen>smoothOpen?.48:.22); smoothWidth += (targetWidth-smoothWidth)*.2; mouth(smoothOpen,smoothWidth); if(switchableAvatarProfile&&avatarMode==="anime")digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-audio-level",level:Math.max(low,mid*.85)},location.origin); requestAnimationFrame(frame); }
  let finished = false;
  const finish = () => { if (finished) return; finished=true; if(activeAudio===audio) activeAudio=null; if(token===speakingToken) speaking(false); URL.revokeObjectURL(url); activeSpeechResolve=null; };
  audio.onplay = frame; audio.onended = finish; audio.onerror = finish;
  if(!(switchableAvatarProfile&&avatarMode==="anime")){
    digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-clear" }, location.origin);
    digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-audio", audio:rendererBuffer }, location.origin, [rendererBuffer]);
  }
  await new Promise((resolve, reject) => {
    activeSpeechResolve = () => { finish(); resolve(); };
    audio.onended = () => { finish(); resolve(); };
    audio.onerror = () => { finish(); resolve(); };
    audio.play().catch(error => { finish(); reject(error); });
  });
}

async function prepareNeuralSpeech(text, emotion, batch, action="idle") {
  const response = await fetch("/api/speech", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ text, emotion, voice:voiceProfile }) });
  if (!response.ok) throw new Error("语音生成失败");
  const speechBuffer = await response.arrayBuffer();
  if (batch !== speechBatch) return null;
  const renderEndpoint=dinetAvatarProfile||(!wav2LipAvatarProfile&&switchableAvatarProfile)?`${neuralRenderEndpoint}?action=${encodeURIComponent(action)}`:neuralRenderEndpoint;
  const renderResponse = await fetch(renderEndpoint, {
    method:"POST",
    headers:{ "content-type":response.headers.get("content-type") || "application/octet-stream" },
    body:speechBuffer
  });
  if (!renderResponse.ok) {
    const error = await renderResponse.json().catch(() => ({}));
    throw new Error(error.error || "回答准备失败");
  }
  return renderResponse.json();
}

function prepareStreamingNeuralSpeech(text,emotion,batch,action="idle"){
  const queue=[],waiters=[];let ended=false,failure=null;
  const wake=()=>{while(waiters.length&&(queue.length||ended||failure))waiters.shift()();};
  const controller=new AbortController();
  const consume=(async()=>{
    const response=await fetch("/api/dinet/speech-stream",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,emotion,voice:voiceProfile,action}),signal:controller.signal});
    if(!response.ok||!response.body){const data=await response.json().catch(()=>({}));throw new Error(data.error||"流式回答准备失败");}
    await consumeEventStream(response,async(event,data)=>{
      if(batch!==speechBatch){controller.abort();return;}
      if(event==="segment"){queue.push(data);wake();}
      if(event==="error")throw new Error(data.error||"流式回答准备失败");
      if(event==="done"){ended=true;wake();}
    });
    ended=true;wake();
  })().catch(error=>{failure=error;ended=true;wake();});
  const stream={
    cancel(){controller.abort();activeStreamingSpeech.delete(stream);},
    async next(){
      while(!queue.length&&!ended&&!failure)await new Promise(resolve=>waiters.push(resolve));
      if(failure)throw failure;
      if(queue.length)return{value:queue.shift(),done:false};
      await consume;activeStreamingSpeech.delete(stream);return{done:true};
    }
  };
  activeStreamingSpeech.add(stream);return stream;
}

async function playStreamingNeuralSpeech(stream,batch){
  const playbacks=[];
  try{
    while(batch===speechBatch){
      const item=await stream.next();if(item.done)break;
      playbacks.push(playPreparedNeuralSpeech(item.value,batch,{enqueue:true}));
    }
  }finally{
    if(batch===speechBatch)digitalHumanFrame.contentWindow.postMessage({type:"wav2lip-stream-end"},location.origin);
  }
  await Promise.all(playbacks);
  if(batch===speechBatch)speaking(false);
}

async function playPreparedNeuralSpeech(rendered, batch, {enqueue=false}={}) {
  if (!rendered || batch !== speechBatch) return;
  const requestId = crypto.randomUUID();
  speaking(true);
  digitalHumanFrame.contentWindow.postMessage({ type:enqueue?"wav2lip-enqueue":"wav2lip-play", url:rendered.url, requestId }, location.origin);
  await new Promise(resolve => {
    const timer = setTimeout(() => { pendingWav2LipPlaybacks.delete(requestId); speaking(false); resolve(); }, 180_000);
    const finish = () => { clearTimeout(timer); pendingWav2LipPlaybacks.delete(requestId); if(!enqueue&&batch===speechBatch)speaking(false); activeSpeechResolve=null; resolve(); };
    pendingWav2LipPlaybacks.set(requestId, finish);
    activeSpeechResolve = finish;
  });
}

async function playSilentNeuralAction(url,batch){
  if(!url||batch!==speechBatch)return;
  const requestId=crypto.randomUUID();
  statusText.textContent="正在做出回应…";
  digitalHumanFrame.contentWindow.postMessage({type:"wav2lip-action",url,requestId},location.origin);
  await new Promise(resolve=>{
    const timer=setTimeout(()=>{pendingWav2LipPlaybacks.delete(requestId);resolve();},15_000);
    const finish=()=>{clearTimeout(timer);pendingWav2LipPlaybacks.delete(requestId);activeSpeechResolve=null;resolve();};
    pendingWav2LipPlaybacks.set(requestId,finish);
    activeSpeechResolve=finish;
  });
}

function enqueueSpeech(text, emotion, batch, action="idle") {
  if (neuralAvatarProfile) {
    // Start TTS and rendering immediately for every completed sentence. Playback
    // stays ordered, while later sentences prepare during the current sentence.
    const silentAction=silentNeuralActions[action];
    const preparation = streamingAvatarExperiment&&!silentAction
      ? prepareStreamingNeuralSpeech(text,emotion,batch,action)
      : prepareNeuralSpeech(text, emotion, batch,silentAction?"idle":action);
    speechQueue = speechQueue.then(async () => {
      if (batch !== speechBatch) return;
      try {
        if(silentAction)await playSilentNeuralAction(silentAction,batch);
        if(streamingAvatarExperiment&&!silentAction)await playStreamingNeuralSpeech(preparation,batch);
        else await playPreparedNeuralSpeech(await preparation, batch);
      }
      catch (error) {
        if (batch !== speechBatch) return;
        speaking(false);
        statusText.textContent = error?.message || "回答准备失败";
        liveTranscript.textContent = "回答准备失败，请重试";
      }
    });
    return speechQueue;
  }
  speechQueue = speechQueue.then(async () => {
    if (batch !== speechBatch) return;
    try { await playCloudSpeech(text, emotion); }
    catch (error) {
      if (batch !== speechBatch) return;
      if (!neuralAvatarProfile) return await animateBrowserSpeech(text);
      speaking(false);
      statusText.textContent = error?.message || "回答准备失败";
      liveTranscript.textContent = "回答准备失败，请重试";
    }
  });
  return speechQueue;
}

async function consumeEventStream(response, onEvent) {
  const reader = response.body.getReader(), decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream:!done });
    const blocks = buffer.split(/\r?\n\r?\n/);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      let event = "message", data = "";
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith("event:")) event = line.slice(6).trim();
        if (line.startsWith("data:")) data += line.slice(5).trim();
      }
      if (data) await onEvent(event, JSON.parse(data));
    }
    if (done) break;
  }
}

async function reply(message) {
  sendButton.disabled = true; showTyping(); setEmotion("curious"); setVoiceState("thinking","正在理解你刚才说的话"); statusText.textContent = "正在想…";
  const controller = new AbortController(); activeReplyController = controller;
  const batch = speechBatch; let article, streamedText = "", currentEmotion = "calm",currentAction="idle",spokenSentenceCount=0;
  try {
    const response = await fetch("/api/chat/stream", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ message, history:history.slice(0,-1), userId, persona, fastSpeech:neuralAvatarProfile }), signal:controller.signal });
    if (!response.ok || !response.body) { const data=await response.json().catch(()=>({})); throw new Error(data.error || "连接失败"); }
    await consumeEventStream(response, async (event, data) => {
      if (controller.signal.aborted) return;
      if (event === "meta") {
        mode=data.mode; currentEmotion=data.emotion || "calm"; setEmotion(currentEmotion);
        const plan=conversationActions.startTurn({message,emotion:currentEmotion,action:data.action||"idle"});
        currentAction=plan.action;
      }
      if (event === "sentence") {
        $("#typing")?.remove(); streamedText += data.text;
        article ||= addMessage("assistant", "", false);
        article.querySelector("p").textContent = streamedText;
        if(data.emotion){currentEmotion=data.emotion;setEmotion(currentEmotion);}
        const sentenceIndex=spokenSentenceCount++;
        const sentenceAction=conversationActions.actionForSentence(data.text,sentenceIndex,data.action||currentAction);
        if(sentenceAction!=="idle")setDigitalHumanAction(sentenceAction,{force:true,hold:true}).catch(()=>{});
        enqueueSpeech(data.text,currentEmotion,batch,sentenceAction);
      }
      if (event === "error") throw new Error(data.error || "回答中断");
      if (event === "done") {
        mode=data.mode; currentEmotion=data.emotion || currentEmotion; setEmotion(currentEmotion);
        const finalText=data.reply || streamedText || "我在听。";
        $("#typing")?.remove(); article ||= addMessage("assistant", "", false);
        article.querySelector("p").textContent=finalText;
        streamedText=finalText;
      }
    });
    if (streamedText) { history.push({role:"assistant",content:streamedText}); history=history.slice(-20); localStorage.setItem("lumi-history",JSON.stringify(history)); }
    const completedQueue=speechQueue;
    completedQueue.finally(()=>{if(batch===speechBatch){conversationActions.finishTurn();if(switchableAvatarProfile&&avatarMode==="anime")digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-finish-gesture"},location.origin);}});
  } catch (error) {
    $("#typing")?.remove();
    if (error.name !== "AbortError") { addMessage("assistant", `刚才的连接有点不稳定：${error.message}。再试一次好吗？`, false); setEmotion("caring"); speaking(false); setVoiceState("idle","连接不稳定，请点击麦克风重试"); }
  } finally { if(activeReplyController===controller)activeReplyController=null; sendButton.disabled=false; if(!form.hidden)input.focus(); }
}
async function submit(text) { const message = text.trim(); if (!message || sendButton.disabled) return; stopSpeech(); input.value=""; resize(); addMessage("user", message); await reply(message); }
form.addEventListener("submit", e => { e.preventDefault(); submit(input.value); });
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
function resize(){ input.style.height="auto"; input.style.height=`${Math.min(input.scrollHeight,110)}px`; } input.addEventListener("input",resize);
$("#clearButton").addEventListener("click",async()=>{
  stopSpeech();history=[];localStorage.removeItem("lumi-history");messages.querySelectorAll(".message").forEach((m,i)=>i&&m.remove());setEmotion("happy");
  try{
    const response=await fetch("/api/chat/memory/clear",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId})});
    if(!response.ok)throw new Error("服务端记忆清理失败");
    setVoiceState("idle","聊天记录和人物记忆已经清空，可以重新开始");
  }catch(error){setVoiceState("idle","聊天记录已清空，但人物记忆清理失败，请稍后重试");}
});
captionButton.addEventListener("click",()=>{ const visible=!document.body.classList.contains("show-captions");document.body.classList.toggle("show-captions",visible);captionButton.setAttribute("aria-pressed",String(visible));captionButton.title=visible?"隐藏右侧聊天记录":"显示右侧聊天记录";if(visible)messages.scrollTop=messages.scrollHeight;});
window.addEventListener("message",event=>{
  if(event.origin!==location.origin||event.source!==digitalHumanFrame?.contentWindow)return;
  if(event.data?.type==="dh-live-ready"){portrait.classList.add("dh-live-ready");statusText.textContent="真人形象已就绪";}
  if(event.data?.type==="vrm-ready"){
    portrait.classList.add("dh-live-ready");
    if(animeLooks[event.data.look]){animeLook=event.data.look;animeLookSelect.value=animeLook;}
    statusText.textContent=`${animeLooks[animeLook]||"动漫形象"}已就绪`;
  }
  if(event.data?.type==="vrm-behavior-accepted"){portrait.dataset.vrmAction=event.data.action;portrait.dataset.vrmActionStarted=String(Boolean(event.data.started));}
  if(event.data?.type==="dh-live-audio-accepted") portrait.dataset.dhAudioBytes=String(event.data.bytes||0);
  if(event.data?.type==="wav2lip-ended"||event.data?.type==="wav2lip-error") pendingWav2LipPlaybacks.get(event.data.requestId)?.();
  if(event.data?.type==="dh-live-action-ready"||event.data?.type==="dh-live-action-error"){
    pendingActions.get(event.data.requestId)?.(); pendingActions.delete(event.data.requestId);
    if(event.data?.type==="dh-live-action-ready") portrait.dataset.dhAction=event.data.action;
  }
});


const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) { const recognition = new Recognition(); recognition.lang="zh-CN"; recognition.interimResults=true; recognition.continuous=false; let recognizedText="", recognitionFailed=false, recognitionRunning=false, restartListeningTimer,listeningGestureTimer,vadStream,vadContext,vadAnalyser,vadSamples,vadFrame;
  const updateCallButton=()=>{voiceButton.classList.toggle("call-active",voiceCallActive);voiceButton.setAttribute("aria-pressed",String(voiceCallActive));voiceButton.setAttribute("aria-label",voiceCallActive?"结束通话":"开始通话");micButton.setAttribute("aria-label",voiceCallActive?"结束通话":"开始通话");micButton.title=voiceCallActive?"结束通话":"开始通话";};
  const stopVadLoop=()=>{if(vadFrame)cancelAnimationFrame(vadFrame);vadFrame=0;};
  const releaseVad=()=>{stopVadLoop();vadStream?.getTracks().forEach(track=>track.stop());vadStream=null;vadAnalyser=null;vadSamples=null;vadContext?.close().catch(()=>{});vadContext=null;};
  const ensureVad=async()=>{if(vadAnalyser)return true;if(!navigator.mediaDevices?.getUserMedia)return false;vadStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!voiceCallActive){vadStream.getTracks().forEach(track=>track.stop());vadStream=null;return false;}vadContext=new AudioContext();await vadContext.resume().catch(()=>{});vadAnalyser=vadContext.createAnalyser();vadAnalyser.fftSize=1024;vadAnalyser.smoothingTimeConstant=0;vadSamples=new Float32Array(vadAnalyser.fftSize);vadContext.createMediaStreamSource(vadStream).connect(vadAnalyser);return true;};
  const startVadLoop=()=>{stopVadLoop();if(!vadAnalyser)return;let noiseFloor=.008,hasSpeech=false,silenceStarted=0;const warmupUntil=performance.now()+320;const inspect=()=>{if(!voiceCallActive||!recognitionRunning||!vadAnalyser){vadFrame=0;return;}vadAnalyser.getFloatTimeDomainData(vadSamples);let energy=0;for(const value of vadSamples)energy+=value*value;const rms=Math.sqrt(energy/vadSamples.length),now=performance.now();if(now<warmupUntil&&rms<.025)noiseFloor=noiseFloor*.82+rms*.18;const threshold=Math.max(.016,noiseFloor*2.35);if(rms>threshold){hasSpeech=true;silenceStarted=0;}else if(hasSpeech&&recognizedText){silenceStarted ||= now;if(now-silenceStarted>=650){stopVadLoop();try{recognition.stop();}catch{}return;}}vadFrame=requestAnimationFrame(inspect);};vadFrame=requestAnimationFrame(inspect);};
  const startListening=()=>{if(!voiceCallActive||recognitionRunning)return;clearTimeout(restartListeningTimer);try{recognition.start()}catch{restartListeningTimer=setTimeout(startListening,350)}};
  const scheduleListening=(delay=350)=>{clearTimeout(restartListeningTimer);if(voiceCallActive)restartListeningTimer=setTimeout(startListening,delay);};
  const clearListeningGesture=()=>{clearTimeout(listeningGestureTimer);listeningGestureTimer=0;};
  const scheduleListeningGesture=()=>{if(listeningGestureTimer||avatarMode!=="anime")return;listeningGestureTimer=setTimeout(()=>{listeningGestureTimer=0;if(voiceCallActive&&recognitionRunning&&recognizedText)setDigitalHumanAction("nod",{force:true,hold:false}).catch(()=>{});},1400+Math.random()*700);};
  const endCall=()=>{voiceCallActive=false;clearTimeout(restartListeningTimer);clearListeningGesture();if(recognitionRunning)recognition.abort();releaseVad();stopSpeech();micButton.classList.remove("listening");voiceButton.classList.remove("listening","thinking","speaking");updateCallButton();setVoiceState("idle","通话已结束");statusText.textContent="在线 · 随时听你说";};
  const beginCall=async()=>{if(voiceCallActive)return;voiceCallActive=true;stopSpeech();updateCallButton();setVoiceState("idle","正在准备麦克风…");try{await ensureVad();}catch{}if(voiceCallActive){setVoiceState("idle","通话已开始，请自然说话");scheduleListening(80);}};
  const toggleCall=()=>voiceCallActive?endCall():beginCall();
  recognition.onstart=()=>{recognitionRunning=true;recognizedText="";recognitionFailed=false;clearListeningGesture();conversationActions.finishTurn();digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-finish-gesture"},location.origin);micButton.classList.add("listening");setVoiceState("listening","请自然说话，停顿后我会立即回答");setEmotion("curious");statusText.textContent="我在听…";startVadLoop();};
  recognition.onresult=e=>{recognizedText=Array.from(e.results).map(r=>r[0].transcript).join("").trim();if(recognizedText)scheduleListeningGesture();};
  recognition.onend=async()=>{stopVadLoop();clearListeningGesture();recognitionRunning=false;micButton.classList.remove("listening");voiceButton.classList.remove("listening");const text=recognizedText;recognizedText="";if(!voiceCallActive)return;if(text&&!recognitionFailed){setVoiceState("thinking",`${persona.name}正在回应`);await submit(text);const completedQueue=speechQueue;await completedQueue.catch(()=>{});if(voiceCallActive){setVoiceState("idle","请继续说话");scheduleListening(180);}}else if(!recognitionFailed){setVoiceState("idle","我还在听，请继续说");scheduleListening(350)}};
  recognition.onerror=e=>{stopVadLoop();clearListeningGesture();recognitionFailed=true;micButton.classList.remove("listening");voiceButton.classList.remove("listening");const denied=e.error==="not-allowed"||e.error==="service-not-allowed";if(denied){voiceCallActive=false;releaseVad();updateCallButton();setVoiceState("idle","请允许浏览器使用麦克风后重试");}else if(voiceCallActive){setVoiceState("idle","没有听清楚，正在继续聆听");scheduleListening(500)}};
  micButton.onclick=toggleCall;voiceButton.onclick=toggleCall;updateCallButton();
} else { micButton.disabled=true;voiceButton.disabled=true;voicePrompt.textContent="当前浏览器不支持语音识别";liveTranscript.textContent="请使用最新版 Chrome 或 Edge"; }

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const pupils = $(".pupils");
  const wander = () => { if (!portrait.classList.contains("speaking")) { const x=(Math.random()-.5)*8, y=(Math.random()-.5)*4; pupils.style.transform=`translate(${x}px,${y}px)`; } setTimeout(wander,1800+Math.random()*2600); };
  setTimeout(wander,1200);
}

async function boot(){
  history.forEach(item=>addMessage(item.role,item.content,false));
  const [health,voiceData]=await Promise.all([
    fetch("/api/health").then(r=>r.json()).catch(()=>({mode:"demo"})),
    fetch("/api/voices").then(r=>r.json()).catch(()=>({defaultKey:"",voices:[]}))
  ]);
  mode=health.mode;
  if(personaVoice){
    personaVoice.replaceChildren(...voiceData.voices.map(item=>{const option=document.createElement("option");option.value=item.key;option.textContent=`${item.label} · ${item.description}`;return option;}));
    const available=voiceData.voices.some(item=>item.key===voiceProfile);voiceProfile=available?voiceProfile:voiceData.defaultKey||voiceData.voices[0]?.key||"";
    if(voiceProfile){personaVoice.value=voiceProfile;localStorage.setItem("lumi-voice-profile",voiceProfile);}
    personaVoice.disabled=!voiceData.voices.length;
    if(!voiceData.voices.length){const option=document.createElement("option");option.textContent="演示模式使用浏览器声音";personaVoice.append(option);}
  }
  modeBanner.textContent=mode!=="demo"?"语音对话已连接":"体验模式已就绪";statusText.textContent="在线 · 随时听你说";setTimeout(()=>modeBanner.style.opacity=".55",2800);
}
boot();
