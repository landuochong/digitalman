import { ConversationActionScheduler, continueActionPlan, preparedPreviewCanStart } from "./conversation-actions.js?v=20260813-restrained-action-v21";
import { buildWav2LipPlaybackMessage } from "./avatar-protocol.js?v=20260813-video-handoff-v11";
import { AvatarStreamTurn } from "./avatar-stream-turn.js?v=20260813-video-handoff-v11";
import { RecognitionTurnGate,isIncidentalFillerTranscript,recognitionResumeDelayMs,recognitionSilenceMs } from "./recognition-turn-gate.js?v=20260831-noise-text-v25";
import { SpeechEndpointDetector } from "./speech-endpoint-detector.js?v=20260814-noise-endpoint-v1";
import { BargeInDetector } from "./barge-in-detector.js?v=20260814-complete-reply-v3";
import { ReplyTranscript } from "./reply-transcript.js?v=20260813-spoken-history-v1";
import { createCodexSession } from "./codex-session.js?v=20260827-codex-session-v1";
import { BackchannelGate,BackchannelPlayback,backchannelVisualElapsedMs,remainingAfterSpokenBackchannel } from "./backchannel-gate.js?v=20260814-visible-clock-v36";
import { BACKCHANNEL_GRACE_MS } from "./backchannel-timing.js?v=20260814-long-wait-v3";
import { ListeningGestureGate } from "./listening-gesture.js?v=20260814-listening-nod-v1";
import { createClientTimingReporter } from "./client-timing-reporter.js?v=20260814-reliable-timing-v1";
import { REAL_AVATAR_CHARACTERS,normalizeRealAvatarCharacter,resolveRealActionAsset,resolveSilentRealAction,resolveWaitingActionPreview } from "./real-action-catalog.js?v=20260815-shared-real-actions-v1";
import { LocalAsrRecorder } from "./local-asr-recorder.js?v=20260816-local-sherpa-v4";

const $ = (selector) => document.querySelector(selector);
const portrait = $("#portrait"), wave = $("#soundWave"), messages = $("#messages");
const input = $("#messageInput"), form = $("#chatForm"), sendButton = $("#sendButton");
const micButton = $("#micButton"), modeBanner = $("#modeBanner"), statusText = $("#statusText");
const voiceButton = $("#voiceButton"), voicePrompt = $("#voicePrompt"), liveTranscript = $("#liveTranscript"), captionButton = $("#captionButton");
const digitalHumanFrame = $("#digitalHumanFrame");
const postClientTiming=createClientTimingReporter();
const AVATAR_FIRST_SEGMENT_LEAD_MS=240;
const avatarRuntimeVersion="20260815-real-character-v46";
const avatarRuntimeUrl=(path,parameters={})=>{
  const url=new URL(path,location.origin);url.searchParams.set("v",avatarRuntimeVersion);
  for(const[key,value]of Object.entries(parameters))if(value!==undefined&&value!==null&&value!=="")url.searchParams.set(key,String(value));
  return `${url.pathname}${url.search}`;
};
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
const realAvatarCharacters=REAL_AVATAR_CHARACTERS;
let realAvatarCharacter=normalizeRealAvatarCharacter(localStorage.getItem("lumi-real-character"));
let listeningPreviewActive=false;
const neuralRenderEndpoint = wav2LipAvatarProfile ? "/api/wav2lip/render" : "/api/dinet/render";
const streamingAvatarExperiment = new URLSearchParams(location.search).get("streaming") !== "0";
const continuousVideoExperiment = new URLSearchParams(location.search).get("continuous") !== "0";
function realActionAsset(action){return resolveRealActionAsset(action,realAvatarCharacter);}
function silentNeuralAction(action){return resolveSilentRealAction(action,realAvatarCharacter);}
function rawActionTestUrl(action){
  return action==="shy"?resolveWaitingActionPreview(action,realAvatarCharacter)?.url||null:null;
}
const actionTestLabels={idle:"待机",happy:"微笑",shy:"害羞",wave_approval:"挥手",nod:"点头",thumbs_up:"点赞",clap:"鼓掌",cheer:"欢呼",bow:"鞠躬",caring:"关心",thinking:"思考",surprise:"惊讶",shrug:"耸肩",cross:"拒绝",confident_arms_crossed:"抱臂"};
const animeLooks={soft:"学院日常",vivid:"暗色潮流",nike1:"Nike-chan v1",nike2:"Nike-chan v2",classic:"简约短发"};
const animeLookSchema="20260828-anime-looks-v4";
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
  digitalHumanFrame.src = avatarMode === "anime"?avatarRuntimeUrl("/vrm-embed.html"):avatarRuntimeUrl("/wav2lip-avatar/avatar.html",{character:realAvatarCharacter});
  portrait.dataset.avatarMode=avatarMode;
  const note=document.querySelector(".avatar-note");
  if(note)note.textContent=avatarMode==="anime"?"动漫陪伴 · 自然表情与动作":"真人陪伴 · 自然中文语音";
} else if ((selfRecordedProfile || minimaxGeneratedProfile || lakesideGeneratedProfile || cleanAvatarProfile || neuralAvatarProfile) && digitalHumanFrame) {
  const initialAction = cleanAvatarProfile ? "idle" : lakesideGeneratedProfile ? "lakeside_idle_test" : minimaxGeneratedProfile ? "minimax_idle_test" : "self_idle";
  digitalHumanFrame.src = neuralAvatarProfile
    ? avatarRuntimeUrl("/wav2lip-avatar/avatar.html",{character:realAvatarCharacter})
    : cleanAvatarProfile
    ? `/clean-avatar/avatar.html?action=${initialAction}`
    : `/dh-live/avatar.html?action=${initialAction}`;
  const note = document.querySelector(".avatar-note");
  if (note) note.textContent = "真人陪伴 · 自然表情与语音";
}
const avatarModeSwitch=$("#avatarModeSwitch");
if(avatarModeSwitch)avatarModeSwitch.hidden=!switchableAvatarProfile;
const animeLookControl=$("#animeLookControl"),animeLookSelect=$("#animeLookSelect");
const realCharacterControl=$("#realCharacterControl"),realCharacterSelect=$("#realCharacterSelect");
const animeViewControls=$("#animeViewControls"),animeViewButtons=[...document.querySelectorAll("[data-view-angle]")];
if(animeLookSelect)animeLookSelect.value=animeLook;
if(animeLookControl)animeLookControl.hidden=!switchableAvatarProfile||avatarMode!=="anime";
if(animeViewControls)animeViewControls.hidden=!switchableAvatarProfile||avatarMode!=="anime";
if(realCharacterSelect)realCharacterSelect.value=realAvatarCharacter;
if(realCharacterControl)realCharacterControl.hidden=!switchableAvatarProfile||avatarMode!=="real";
const historySchema="20260807-user-reset-v6";
if(localStorage.getItem("lumi-history-schema")!==historySchema){localStorage.removeItem("lumi-history");localStorage.removeItem("lumi-vrm-history");localStorage.setItem("lumi-history-schema",historySchema);}
let history = JSON.parse(localStorage.getItem("lumi-history") || "[]");
let mode = "demo", speakingToken = 0, audioContext, activeAudio, activeSpeechResolve, speechTimer, actionRequestId = 0;
const activeStreamingSpeech=new Set();
let avatarAudioContext=null;
let avatarPcmReady=false;
let avatarFragmentedVideoReady=false;

function unlockAvatarAudio(){
  const Context=window.AudioContext||window.webkitAudioContext;
  if(!Context)return Promise.resolve(null);
  try{avatarAudioContext||=new Context({sampleRate:16000});}catch{return Promise.resolve(null);}
  window.__lumiAvatarAudioContext=avatarAudioContext;
  if(avatarAudioContext.state==="running")return Promise.resolve(avatarAudioContext);
  return avatarAudioContext.resume().then(()=>avatarAudioContext).catch(()=>null);
}
document.addEventListener("pointerdown",()=>void unlockAvatarAudio(),{once:true,capture:true});
let realSpeechTimelineMs=0;
let speechQueue = Promise.resolve(), speechBatch = 0, activeReplyController,activeAvatarStreamTurn=null,activeReplyStartedAt=0,activeWaitingPreview=null,activeReplyTranscript=null;
const conversationActions=new ConversationActionScheduler();
let voiceCallActive = false;
const pendingActions = new Map();
const pendingWav2LipPlaybacks = new Map();
const pendingWav2LipStarts = new Map();
const userId = localStorage.lumiUserId ||= crypto.randomUUID();
const codexSession=createCodexSession();
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
  avatarMode=next;neuralAvatarProfile=next==="real";avatarPcmReady=false;avatarFragmentedVideoReady=false;
  localStorage.setItem("lumi-avatar-mode",next);
  portrait.dataset.avatarMode=next;portrait.classList.remove("dh-live-ready");
  digitalHumanFrame.title=next==="real"?"露米的真人形象":"露米的动漫形象";
  digitalHumanFrame.src=next==="real"?avatarRuntimeUrl("/wav2lip-avatar/avatar.html",{character:realAvatarCharacter}):avatarRuntimeUrl("/vrm-embed.html");
  if(animeLookControl)animeLookControl.hidden=next!=="anime";
  if(animeViewControls)animeViewControls.hidden=next!=="anime";
  if(realCharacterControl)realCharacterControl.hidden=next!=="real";
  avatarModeSwitch?.querySelectorAll("[data-avatar-mode]").forEach(button=>button.setAttribute("aria-pressed",String(button.dataset.avatarMode===next)));
  const note=document.querySelector(".avatar-note");
  if(note)note.textContent=next==="anime"?"动漫陪伴 · 自然表情与动作":"真人陪伴 · 自然中文语音";
  statusText.textContent=next==="anime"?"正在准备动漫形象…":"正在准备真人形象…";
}
avatarModeSwitch?.querySelectorAll("[data-avatar-mode]").forEach(button=>{
  button.setAttribute("aria-pressed",String(button.dataset.avatarMode===avatarMode));
  button.addEventListener("click",()=>applyAvatarMode(button.dataset.avatarMode));
});
realCharacterSelect?.addEventListener("change",()=>{
  const next=realCharacterSelect.value;if(!realAvatarCharacters[next]||next===realAvatarCharacter)return;
  stopSpeech();realAvatarCharacter=next;localStorage.setItem("lumi-real-character",next);
  portrait.dataset.realCharacter=next;portrait.classList.remove("dh-live-ready");
  statusText.textContent=`正在准备${realAvatarCharacters[next].label}…`;
  digitalHumanFrame.src=avatarRuntimeUrl("/wav2lip-avatar/avatar.html",{character:next});
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
function setDigitalHumanAction(action = "idle",{force=false,hold=true,behavior=null}={}) {
  if (!digitalHumanFrame?.contentWindow) return Promise.resolve();
  if (switchableAvatarProfile && avatarMode === "anime") {
    digitalHumanFrame.contentWindow.postMessage({type:"vrm-behavior",emotion:portrait.dataset.emotion||"calm",action,force,hold,behavior},location.origin);
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

const actionTestPanel=$("#actionTestPanel"),actionTestButtons=[...document.querySelectorAll("[data-action-test]")];
const localActionTestHost=["localhost","127.0.0.1","::1"].includes(location.hostname);
if(actionTestPanel)actionTestPanel.hidden=!localActionTestHost;
function clearActionTestSelection(){actionTestButtons.forEach(button=>button.removeAttribute("aria-pressed"));}
function previewActionForTest(action){
  if(!localActionTestHost||!actionTestLabels[action])return;
  if(voiceCallActive){statusText.textContent="请先结束通话，再测试动作";return;}
  stopSpeech();clearActionTestSelection();
  const button=actionTestButtons.find(item=>item.dataset.actionTest===action);button?.setAttribute("aria-pressed","true");
  if(action==="idle"){
    digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview-clear"},location.origin);
    digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-finish-gesture"},location.origin);
    statusText.textContent="动作测试：待机";return;
  }
  statusText.textContent=`动作测试：${actionTestLabels[action]}`;
  if(avatarMode==="anime"){
    setDigitalHumanAction(action,{force:true,hold:false,behavior:{purpose:"action-test",intensity:.55,holdMs:4200}}).catch(()=>{});
    return;
  }
  const url=rawActionTestUrl(action)||silentNeuralAction(action)||(`/dh-live/actions/${realActionAsset(action)}/01.mp4?v=${avatarRuntimeVersion}`);
  digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview",action,url,purpose:"action-test",loop:false,durationMs:5000},location.origin);
}
actionTestButtons.forEach(button=>button.addEventListener("click",()=>previewActionForTest(button.dataset.actionTest)));
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
  if (active) { voicePrompt.textContent=`${persona.name}正在回答`; liveTranscript.textContent=voiceCallActive?"你可以随时开口打断":"正在播放回答"; }
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
  settleActiveTranscript(true);
  speakingToken++;
  speechBatch++;
  speechQueue = Promise.resolve();
  if(activeAvatarStreamTurn)closeVisualTurn(activeAvatarStreamTurn.id);
  activeAvatarStreamTurn=null;
  if(activeWaitingPreview){digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview-clear"},location.origin);activeWaitingPreview=null;delete portrait.dataset.waitingPreview;}
  activeReplyController?.abort(); activeReplyController = null;
  for(const stream of activeStreamingSpeech)stream.cancel();activeStreamingSpeech.clear();
  clearInterval(speechTimer);
  window.speechSynthesis?.cancel();
  if (activeAudio) { activeAudio.pause(); activeAudio.removeAttribute("src"); activeAudio = null; }
  for(const finish of [...pendingWav2LipPlaybacks.values()])finish();pendingWav2LipPlaybacks.clear();
  pendingWav2LipStarts.clear();
  activeSpeechResolve?.(); activeSpeechResolve = null;
  digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-clear" }, location.origin);
  digitalHumanFrame?.contentWindow?.postMessage({ type:"wav2lip-clear" }, location.origin);
  digitalHumanFrame?.contentWindow?.postMessage({ type:"vrm-clear" }, location.origin);
  conversationActions.finishTurn();
  realSpeechTimelineMs=0;
  speaking(false);
}
function persistAssistantText(text){if(!text)return;history.push({role:"assistant",content:text});history=history.slice(-20);localStorage.setItem("lumi-history",JSON.stringify(history));}
function settleActiveTranscript(interrupted=false){
  const active=activeReplyTranscript;if(!active)return null;
  const result=interrupted?active.transcript.interrupt():active.transcript.complete();if(!result)return null;
  $("#typing")?.remove();
  if(result.text){active.article ||= addMessage("assistant","",false);active.article.querySelector("p").textContent=result.text;if(result.interrupted)active.article.dataset.interrupted="true";}
  else active.article?.remove();
  if(result.persist){const persistedText=result.historyText??result.text;persistAssistantText(persistedText);void codexSession.recordAssistant(persistedText);}
  if(activeReplyTranscript===active)activeReplyTranscript=null;
  return result;
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
function animateBrowserSpeech(text,onStart,cancellation) {
  const token = ++speakingToken;
  if (!("speechSynthesis" in window)||cancellation?.cancelled) return Promise.resolve(false);
  speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN"; utterance.rate = .98; utterance.pitch = 1.08;
  const voices = speechSynthesis.getVoices(); utterance.voice = voices.find(v => /zh|Chinese|Ting|Meijia|Sinji/i.test(`${v.lang} ${v.name}`)) || null;
  utterance.onstart = () => { onStart?.();speaking(true); speechTimer = setInterval(() => { const t = performance.now()/110; mouth(.18 + Math.abs(Math.sin(t)*.65 + Math.sin(t*1.9)*.17), .35 + Math.abs(Math.sin(t*.37))*.55); }, 70); };
  utterance.onboundary = () => mouth(.75, Math.random());
  return new Promise(resolve => {
    const unregister=cancellation?.onCancel(()=>{speechSynthesis.cancel();resolve(false);});
    utterance.onend = () => { unregister?.();clearInterval(speechTimer); if (token === speakingToken) speaking(false); resolve(true); };
    utterance.onerror = () => { unregister?.();clearInterval(speechTimer); if (token === speakingToken) speaking(false); resolve(false); };
    speechSynthesis.speak(utterance);
  });
}
async function playCloudSpeech(text, emotion, onStart, cancellation) {
  if(cancellation?.cancelled)return false;
  const requestToken = ++speakingToken;
  const response = await fetch("/api/speech", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ text, emotion, voice:voiceProfile }) });
  if (requestToken !== speakingToken) return;
  if (!response.ok) return animateBrowserSpeech(text,onStart,cancellation);
  const speechBuffer = await response.arrayBuffer();
  if(cancellation?.cancelled)return false;
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
    speaking(true);pendingWav2LipStarts.set(requestId,onStart);
    digitalHumanFrame.contentWindow.postMessage({ type:"wav2lip-play", url:rendered.url, requestId }, location.origin);
    return await new Promise(resolve => {
      const timer = setTimeout(() => { pendingWav2LipPlaybacks.delete(requestId);pendingWav2LipStarts.delete(requestId); speaking(false); resolve(false); }, 180_000);
      const finish = (completed=false) => { clearTimeout(timer); pendingWav2LipPlaybacks.delete(requestId);pendingWav2LipStarts.delete(requestId); if(requestToken===speakingToken)speaking(false); activeSpeechResolve=null; resolve(completed); };
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
  audio.onplay = () => {onStart?.();frame();}; audio.onended = finish; audio.onerror = finish;
  if(!(switchableAvatarProfile&&avatarMode==="anime")){
    digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-clear" }, location.origin);
    digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-audio", audio:rendererBuffer }, location.origin, [rendererBuffer]);
  }
  return await new Promise((resolve, reject) => {
    activeSpeechResolve = () => { finish(); resolve(false); };
    audio.onended = () => { finish(); resolve(true); };
    audio.onerror = () => { finish(); resolve(false); };
    audio.play().catch(error => { finish(); reject(error); });
  });
}

async function prepareNeuralSpeech(text, emotion, batch, action="idle") {
  const response = await fetch("/api/speech", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ text, emotion, voice:voiceProfile }) });
  if (!response.ok) throw new Error("语音生成失败");
  const speechBuffer = await response.arrayBuffer();
  if (batch !== speechBatch) return null;
  const renderEndpoint=dinetAvatarProfile||(!wav2LipAvatarProfile&&switchableAvatarProfile)?`${neuralRenderEndpoint}?action=${encodeURIComponent(action)}&character=${encodeURIComponent(realAvatarCharacter)}`:neuralRenderEndpoint;
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

function prepareStreamingNeuralSpeech(text,emotion,batch,behavior={action:"idle"},options={}){
  const pipelineStartedAt=performance.now();
  const action=typeof behavior==="string"?behavior:behavior?.action||"idle";
  const frameOffset=typeof behavior==="object"?Math.max(0,Number(behavior?.frameOffset)||0):0;
  const externalAudio=avatarPcmReady&&avatarAudioContext?.state==="running";
  const fragmentedVideo=externalAudio&&avatarFragmentedVideoReady&&continuousVideoExperiment;
  const queue=[],waiters=[];let ended=false,failure=null,firstSegmentObserved=false,firstSegmentReadyAt=null,serverStreamId=null,commitRequested=false,receivedAudioMs=0,expectedAudioMs=0;
  const wake=()=>{while(waiters.length&&(queue.length||ended||failure))waiters.shift()();};
  const controller=new AbortController();
  const skipVisualSentence=()=>{
    if(!options.speculative||!behavior?.visualTurnId||!Number.isSafeInteger(Number(behavior?.visualSentenceIndex)))return;
    fetch(`/api/dinet/visual-turn/${encodeURIComponent(behavior.visualTurnId)}/skip`,{method:"POST",keepalive:true,headers:{"content-type":"application/json"},body:JSON.stringify({index:Number(behavior.visualSentenceIndex)})}).catch(()=>{});
  };
  const consume=(async()=>{
    const response=await fetch("/api/dinet/speech-stream",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text,emotion,voice:voiceProfile,action,character:realAvatarCharacter,frameOffset,externalAudio,binaryAudio:externalAudio,fragmentedVideo,renderBackpressure:fragmentedVideo,preferPrewarmed:options.preferPrewarmed===true,speculative:options.speculative===true,ttsConnectionId:options.ttsConnectionId,visualTurnId:behavior?.visualTurnId,visualSentenceIndex:behavior?.visualSentenceIndex}),signal:controller.signal});
    if(!response.ok||!response.body){const data=await response.json().catch(()=>({}));throw new Error(data.error||"流式回答准备失败");}
    await consumeEventStream(response,async(event,data)=>{
      if(batch!==speechBatch){controller.abort();return;}
      if(event==="started"){
        serverStreamId=data.id||null;
        if(commitRequested&&serverStreamId)fetch(`/api/dinet/stream/${encodeURIComponent(serverStreamId)}/commit`,{method:"POST"}).catch(()=>{});
      }
      if(event==="audio-ready")expectedAudioMs=Math.max(0,Number(data.audioMs)||0);
      if(event==="tts-first-audio"&&!options.speculative&&!portrait.dataset.ttsFirstAudioMs){portrait.dataset.ttsFirstAudioMs=String(data.firstAudioMs??"");portrait.dataset.ttsRequestSetupMs=String(data.requestSetupMs??"");portrait.dataset.ttsConnectionMs=String(data.connectionMs??"");portrait.dataset.ttsTaskMs=String(data.taskMs??"");portrait.dataset.ttsSynthesisMs=String(data.synthesisMs??"");}
      if(event==="segment"){
        if(!firstSegmentObserved){firstSegmentObserved=true;firstSegmentReadyAt=performance.now();if(!options.speculative&&!portrait.dataset.avatarFirstSegmentMs){const avatarPipelineMs=Math.round(firstSegmentReadyAt-pipelineStartedAt),ttsFirstAudioMs=Math.max(0,Number(portrait.dataset.ttsFirstAudioMs)||0),pcmBufferingMs=Math.max(0,Number(data?.firstSegmentTiming?.pcmBufferingMs)||0),renderMs=Math.max(0,Number(data?.segment?.renderMs)||0);portrait.dataset.avatarFirstSegmentMs=String(Math.round(firstSegmentReadyAt-activeReplyStartedAt));portrait.dataset.avatarPipelineMs=String(avatarPipelineMs);portrait.dataset.avatarPcmBufferingMs=String(pcmBufferingMs);portrait.dataset.avatarRenderMs=String(renderMs);portrait.dataset.avatarTransportMs=String(Math.max(0,avatarPipelineMs-ttsFirstAudioMs-pcmBufferingMs-renderMs));}}
        receivedAudioMs+=Math.max(0,Number(data?.segment?.audioMs)||0);
        queue.push(data);wake();
      }
      if(event==="done"&&!options.speculative){if(data.pipeline){if(!portrait.dataset.ttsFirstAudioMs)portrait.dataset.ttsFirstAudioMs=String(data.pipeline.ttsFirstAudioMs??"");if(!portrait.dataset.avatarPipelineMs)portrait.dataset.avatarPipelineMs=String(data.pipeline.firstSegmentMs??"");}portrait.dataset.ttsConnectionReused=String(Boolean(data.tts?.connectionReused));portrait.dataset.ttsTaskPrimed=String(Boolean(data.tts?.taskPrimed));portrait.dataset.ttsConnectionLeadMs=String(data.tts?.connectionLeadMs??"");}
      if(event==="error")throw new Error(data.error||"流式回答准备失败");
      if(event==="done"){ended=true;wake();}
    });
    ended=true;wake();
  })().catch(error=>{failure=error;ended=true;wake();});
  const stream={
    get firstSegmentReadyAt(){return firstSegmentReadyAt;},
    get receivedAudioMs(){return receivedAudioMs;},
    get expectedAudioMs(){return expectedAudioMs;},
    commit(){commitRequested=true;if(serverStreamId)fetch(`/api/dinet/stream/${encodeURIComponent(serverStreamId)}/commit`,{method:"POST"}).catch(()=>{});},
    cancel(){controller.abort();skipVisualSentence();if(serverStreamId)fetch(`/api/dinet/stream/${encodeURIComponent(serverStreamId)}/cancel`,{method:"POST",keepalive:true}).catch(()=>{});activeStreamingSpeech.delete(stream);},
    async next(){
      while(!queue.length&&!ended&&!failure)await new Promise(resolve=>waiters.push(resolve));
      if(failure)throw failure;
      if(queue.length)return{value:queue.shift(),done:false};
      await consume;activeStreamingSpeech.delete(stream);return{done:true};
    }
  };
  activeStreamingSpeech.add(stream);return stream;
}

async function enqueueStreamingNeuralSpeech(stream,batch,behavior,turn,onStart,onComplete,cancellation){
  const action=typeof behavior==="string"?behavior:behavior?.action||"idle";
  const lingerMs=action==="idle"?120:Math.min(360,Math.max(180,Number(behavior?.holdMs||0)*.1));
  let lastPlayback=null;
  while(batch===speechBatch&&!cancellation?.cancelled){
    const item=await stream.next();if(item.done)break;
    lastPlayback=playPreparedNeuralSpeech(item.value,batch,{enqueue:true,onStart,cancellation});turn.trackSegment(lastPlayback,item.value?.segment?.audioMs,lingerMs);onStart=null;
  }
  lastPlayback?.then(completed=>{if(completed&&batch===speechBatch)onComplete?.();});
}

async function playPreparedNeuralSpeech(rendered, batch, {enqueue=false,onStart,cancellation}={}) {
  if (!rendered || batch !== speechBatch||cancellation?.cancelled) return false;
  const requestId = crypto.randomUUID();
  speaking(true);pendingWav2LipStarts.set(requestId,onStart);
  digitalHumanFrame.contentWindow.postMessage(buildWav2LipPlaybackMessage(rendered,requestId,{enqueue}),location.origin);
  return await new Promise(resolve => {
    const timer = setTimeout(() => { pendingWav2LipPlaybacks.delete(requestId);pendingWav2LipStarts.delete(requestId); speaking(false); resolve(false); }, 180_000);
    let unregister;const finish = (completed=false) => { unregister?.();clearTimeout(timer); pendingWav2LipPlaybacks.delete(requestId);pendingWav2LipStarts.delete(requestId); if(!enqueue&&batch===speechBatch)speaking(false); activeSpeechResolve=null; resolve(completed); };
    unregister=cancellation?.onCancel(()=>{digitalHumanFrame.contentWindow.postMessage({type:"wav2lip-cancel",requestId},location.origin);finish(false);});
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

function prepareSpeechWork(text,emotion,batch,behavior,streamTurn,options={}){
  const action=typeof behavior==="string"?behavior:behavior?.action||"idle";
  const silentAction=typeof behavior==="object"&&behavior?.explicit===true?silentNeuralAction(action):null;
  const visualSentence=streamingAvatarExperiment&&!silentAction&&streamTurn?streamTurn.allocateSentence():null;
  const preparedBehavior=visualSentence?{...(typeof behavior==="object"?behavior:{action}),...visualSentence}:behavior;
  const preparation=streamingAvatarExperiment&&!silentAction
    ? prepareStreamingNeuralSpeech(text,emotion,batch,preparedBehavior,options)
    : prepareNeuralSpeech(text,emotion,batch,silentAction?"idle":action);
  return{action,silentAction,preparedBehavior,preparation};
}

function enqueueSpeech(text, emotion, batch, behavior={action:"idle"},streamTurn=activeAvatarStreamTurn,options={}) {
  if (neuralAvatarProfile) {
    // Start TTS and rendering immediately for every completed sentence. Playback
    // stays ordered, while later sentences prepare during the current sentence.
    const work=options.preparedWork||prepareSpeechWork(text,emotion,batch,behavior,streamTurn,options);
    const{silentAction,preparedBehavior,preparation}=work;
    const schedule=streamTurn
      ? task=>streamTurn.enqueue(task)
      : task=>speechQueue=speechQueue.then(task);
    const scheduled=schedule(async () => {
      if (batch !== speechBatch) return;
      try {
        if(silentAction){
          if(streamTurn)await streamTurn.waitForPlayback();
          await playSilentNeuralAction(silentAction,batch);
          if(batch===speechBatch){
            const completed=await playPreparedNeuralSpeech(await preparation,batch,{onStart:options.onStart,cancellation:options.cancellation});
            if(completed&&batch===speechBatch)options.onComplete?.();
          }
        }
        if(streamingAvatarExperiment&&!silentAction)await enqueueStreamingNeuralSpeech(preparation,batch,preparedBehavior,streamTurn,options.onStart,options.onComplete,options.cancellation);
        else if(!silentAction){const completed=await playPreparedNeuralSpeech(await preparation,batch,{onStart:options.onStart,cancellation:options.cancellation});if(completed&&batch===speechBatch)options.onComplete?.();}
      }
      catch (error) {
        if (batch !== speechBatch||options.cancellation?.cancelled) return;
        speaking(false);
        statusText.textContent = error?.message || "回答准备失败";
        liveTranscript.textContent = "回答准备失败，请重试";
      }
    });
    if(streamTurn)speechQueue=streamTurn.finishPromise||streamTurn.enqueueQueue;
    return scheduled;
  }
  speechQueue = speechQueue.then(async () => {
    if (batch !== speechBatch) return;
    try { const completed=await playCloudSpeech(text,emotion,options.onStart,options.cancellation);if(completed&&batch===speechBatch)options.onComplete?.(); }
    catch (error) {
      if (batch !== speechBatch) return;
      if (!neuralAvatarProfile) {const completed=await animateBrowserSpeech(text,options.onStart,options.cancellation);if(completed&&batch===speechBatch)options.onComplete?.();return;}
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

function closeVisualTurn(id){
  if(!id)return;
  fetch(`/api/dinet/visual-turn/${encodeURIComponent(id)}/finish`,{method:"POST",keepalive:true}).catch(()=>{});
}

function compactUploadedHistoryContent(value,limit=600){
  const content=String(value||"").trim();if(content.length<=limit)return content;
  const head=Math.round((limit-1)*.62),tail=limit-head-1;
  return `${content.slice(0,head)}…${content.slice(-tail)}`;
}

async function reply(message,{recognitionMetrics=null}={}) {
  sendButton.disabled = true; showTyping(); setEmotion("curious"); setVoiceState("thinking","正在理解你刚才说的话"); statusText.textContent = "正在想…";
  const controller = new AbortController(); activeReplyController = controller;
  const batch = speechBatch,transcript=new ReplyTranscript(); activeReplyStartedAt=performance.now();realSpeechTimelineMs=0;delete portrait.dataset.chatFirstSentenceMs;delete portrait.dataset.avatarFirstSegmentMs;delete portrait.dataset.avatarTransportMs;delete portrait.dataset.avatarPcmBufferingMs;delete portrait.dataset.avatarRenderMs;delete portrait.dataset.ttsFirstAudioMs;delete portrait.dataset.ttsRequestSetupMs;delete portrait.dataset.ttsConnectionMs;delete portrait.dataset.ttsTaskMs;delete portrait.dataset.ttsSynthesisMs;delete portrait.dataset.avatarPipelineMs;delete portrait.dataset.videoFirstFrameMs;delete portrait.dataset.videoHandoffLateMs;delete portrait.dataset.latencyReportStatus;delete portrait.dataset.latencyReportAttempts;delete portrait.dataset.ttsConnectionReused;delete portrait.dataset.ttsTaskPrimed;delete portrait.dataset.ttsConnectionLeadMs;delete portrait.dataset.backchannelContinuation;delete portrait.dataset.backchannelContinuationMs;delete portrait.dataset.backchannelStartedMs;delete portrait.dataset.backchannelCompleted;delete portrait.dataset.backchannelCompletedMs;delete portrait.dataset.longWaitBackchannelMs;delete portrait.dataset.avatarGapIdleMs;delete portrait.dataset.avatarGapIdleSourceMs;delete portrait.dataset.avatarGapMode;delete portrait.dataset.avatarGapAction;let article, streamedText = "", currentEmotion = "calm",currentAction="idle",spokenSentenceCount=0,firstTtsConnectionId="",waitingPreview=null,backchannelVisual=null,backchannelPlayback=null,actionFrameBias=0,biasedAction="",chatTraceId="",firstSpeechReported=false,formalSpeechReported=false;
  const numericDataset=key=>{const raw=portrait.dataset[key];if(raw===undefined||raw.trim()==="")return undefined;const value=Number(raw);return Number.isFinite(value)?value:undefined;};
  const reportClientTiming=(event,speechKind)=>{
    if(!chatTraceId)return;
    const requestToEventMs=Math.round(performance.now()-activeReplyStartedAt),rawStopToCommitMs=recognitionMetrics?.stopToCommitMs,stopToCommitMs=rawStopToCommitMs===null||rawStopToCommitMs===undefined?NaN:Number(rawStopToCommitMs),endpointSilenceMs=Number(recognitionMetrics?.endpointSilenceMs),commitObservedAt=Number(recognitionMetrics?.commitObservedAt),recognitionCommitToRequestMs=Number.isFinite(commitObservedAt)?Math.max(0,Math.round(activeReplyStartedAt-commitObservedAt)):0,stopToSubmitMs=Number.isFinite(stopToCommitMs)?stopToCommitMs+recognitionCommitToRequestMs:NaN,speechEndpointMs=Number.isFinite(endpointSilenceMs)&&Number.isFinite(stopToSubmitMs)?endpointSilenceMs+stopToSubmitMs:NaN;
    const payload={traceId:chatTraceId,event,speechKind,avatarMode,requestToEventMs,recognitionTrigger:recognitionMetrics?.trigger||"text",recognitionTurnMs:recognitionMetrics?.turnMs,
      ...(Number.isFinite(stopToSubmitMs)?{vadStopToSubmitMs:stopToSubmitMs,vadStopToEventMs:(Number.isFinite(speechEndpointMs)?speechEndpointMs:stopToSubmitMs)+requestToEventMs,recognitionCommitToRequestMs}:{}),
      ...(Number.isFinite(speechEndpointMs)?{speechEndpointMs}:{}),
      chatFirstSentenceMs:numericDataset("chatFirstSentenceMs"),avatarFirstSegmentMs:numericDataset("avatarFirstSegmentMs"),ttsFirstAudioMs:numericDataset("ttsFirstAudioMs"),ttsRequestSetupMs:numericDataset("ttsRequestSetupMs"),ttsConnectionMs:numericDataset("ttsConnectionMs"),ttsTaskMs:numericDataset("ttsTaskMs"),ttsSynthesisMs:numericDataset("ttsSynthesisMs"),avatarPipelineMs:numericDataset("avatarPipelineMs"),avatarTransportMs:numericDataset("avatarTransportMs"),avatarPcmBufferingMs:numericDataset("avatarPcmBufferingMs"),avatarRenderMs:numericDataset("avatarRenderMs"),videoFirstFrameMs:numericDataset("videoFirstFrameMs"),videoHandoffLateMs:numericDataset("videoHandoffLateMs"),backchannelCompletedMs:numericDataset("backchannelCompletedMs")};
    void postClientTiming(payload).then(result=>{portrait.dataset.latencyReportStatus=result.ok?"saved":`failed-${result.status||"network"}`;portrait.dataset.latencyReportAttempts=String(result.attempts);});
  };
  const reportSpeechStart=speechKind=>{if(!firstSpeechReported){firstSpeechReported=true;reportClientTiming("first-speech",speechKind);}if(speechKind==="formal"&&!formalSpeechReported){formalSpeechReported=true;reportClientTiming("formal-speech",speechKind);}};
  const transcriptState={transcript,get article(){return article;},set article(value){article=value;}};activeReplyTranscript=transcriptState;
  const revealSentence=sentenceIndex=>{if(batch!==speechBatch)return;const spoken=transcript.start(sentenceIndex);if(!spoken)return;$("#typing")?.remove();article ||= addMessage("assistant","",false);article.querySelector("p").textContent=spoken;};
  const finishSentence=sentenceIndex=>{if(batch===speechBatch)transcript.finish(sentenceIndex);};
  const streamTurn=streamingAvatarExperiment&&neuralAvatarProfile?new AvatarStreamTurn({
    isCurrent:()=>batch===speechBatch,
    onEnd:({audioMs,lingerMs})=>{
      realSpeechTimelineMs+=audioMs;
      digitalHumanFrame.contentWindow.postMessage({type:"wav2lip-stream-end",lingerMs,idleTimeMs:realSpeechTimelineMs},location.origin);
      closeVisualTurn(streamTurn.id);
    }
  }):null;
  const backchannelPlan=data=>({action:data.action||"nod",emotion:data.emotion||currentEmotion,intensity:.35,head:data.action==="thinking"?"slight-left":"center",gaze:"user",holdMs:Math.max(1400,Number(data.audioMs)||0),frameOffset:0,continuation:false});
  const beginWaitingPreview=(plan,descriptor,{pending=false}={})=>{
    const preview={action:plan.action,startedAt:performance.now(),mediaTimeMs:0,observedAt:0,pending};
    waitingPreview=preview;activeWaitingPreview=preview;portrait.dataset.waitingPreview=plan.action;
    if(switchableAvatarProfile&&avatarMode==="anime"){
      preview.pending=false;
      setDigitalHumanAction(plan.action,{force:true,hold:true,behavior:{...plan,intensity:Math.min(.28,plan.intensity)}}).catch(()=>{});
    }else if(descriptor?.url){
      preview.pending=false;preview.startedAt=performance.now();
      digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview",...descriptor},location.origin);
    }
    return preview;
  };
  const backchannelGate=new BackchannelGate({delayMs:BACKCHANNEL_GRACE_MS,
    onPrepare:data=>{
      if(batch!==speechBatch||!neuralAvatarProfile||!streamingAvatarExperiment)return null;
      let plan=backchannelPlan(data);
      if(waitingPreview&&!waitingPreview.pending&&avatarMode!=="anime"){
        const previewTimeMs=waitingPreview.observedAt
          ?waitingPreview.mediaTimeMs+performance.now()-waitingPreview.observedAt
          :performance.now()-waitingPreview.startedAt;
        plan=continueActionPlan(plan,{action:waitingPreview.action,elapsedMs:previewTimeMs,leadMs:AVATAR_FIRST_SEGMENT_LEAD_MS});
      }
      else if(data.kind==="long-wait"&&backchannelVisual&&avatarMode!=="anime"){
        const elapsedMs=backchannelVisualElapsedMs(backchannelVisual);
        plan=continueActionPlan(plan,{action:backchannelVisual.action,baseFrameOffset:backchannelVisual.frameOffset,elapsedMs,leadMs:AVATAR_FIRST_SEGMENT_LEAD_MS});
      }
      return{plan,work:prepareSpeechWork(data.text,plan.emotion,batch,plan,streamTurn,{preferPrewarmed:true,speculative:true})};
    },
    onCancel:(_data,prepared)=>prepared?.work?.preparation?.cancel?.(),
    onSpeak:(data,prepared)=>{
    if(batch!==speechBatch){prepared?.work?.preparation?.cancel?.();return;}
    if(waitingPreview){waitingPreview=null;activeWaitingPreview=null;delete portrait.dataset.waitingPreview;}
    const plan=prepared?.plan||backchannelPlan(data);
    prepared?.work?.preparation?.commit?.();
    const visual=plan.continuation&&avatarMode!=="anime"?{action:plan.action,frameOffset:plan.frameOffset,stream:prepared?.work?.preparation,startedAt:0}:null;
    if(visual)backchannelVisual=visual;
    const readyAt=prepared?.work?.preparation?.firstSegmentReadyAt;
    if(readyAt)portrait.dataset.backchannelPreparedLeadMs=String(Math.max(0,Math.round(performance.now()-readyAt)));
    portrait.dataset.backchannel=JSON.stringify({text:data.text,atMs:Math.round(performance.now()-activeReplyStartedAt),...plan});
    backchannelPlayback?.close();
    const playback=new BackchannelPlayback(data.text);backchannelPlayback=playback;playback.onCancel(()=>prepared?.work?.preparation?.cancel?.());
    if(data.kind==="long-wait")portrait.dataset.longWaitBackchannelMs=String(Math.round(performance.now()-activeReplyStartedAt));
    enqueueSpeech(data.text,plan.emotion,batch,plan,streamTurn,{preferPrewarmed:true,preparedWork:prepared?.work,cancellation:playback,
      onStart:()=>{if(visual&&!visual.startedAt)visual.startedAt=performance.now();portrait.dataset.backchannelStartedMs=String(Math.round(performance.now()-activeReplyStartedAt));reportSpeechStart(data.kind==="long-wait"?"long-wait":"backchannel");playback.start();},
      onComplete:()=>{portrait.dataset.backchannelCompleted="true";portrait.dataset.backchannelCompletedMs=String(Math.round(performance.now()-activeReplyStartedAt));playback.complete();}
    });
  }});
  activeAvatarStreamTurn=streamTurn;
  try {
    const response = await fetch("/api/chat/stream", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ message, history:history.slice(0,-1).slice(-6).map(item=>({...item,content:compactUploadedHistoryContent(item.content)})), userId, persona, voice:voiceProfile, realAvatarCharacter, fastSpeech:neuralAvatarProfile, responsiveSpeech:true, prewarmPcm:mode==="minimax" }), signal:controller.signal });
    if (!response.ok || !response.body) { const data=await response.json().catch(()=>({})); throw new Error(data.error || "连接失败"); }
    await consumeEventStream(response, async (event, data) => {
      if (controller.signal.aborted) return;
      if (event === "meta") {
        mode=data.mode;chatTraceId=String(data.traceId||""); currentEmotion=data.emotion || "calm"; setEmotion(currentEmotion);
        firstTtsConnectionId=String(data.ttsConnectionId||"");
        const plan=conversationActions.startTurn({message,emotion:currentEmotion,action:data.action||"idle"});
        currentAction=plan.action;portrait.dataset.behavior=JSON.stringify(plan);
        // The server can preheat semantic actions before emitting meta, while
        // cadence gestures are chosen locally across neutral turns. Preload the
        // latter immediately so its asset switch remains hidden behind M3.
        if(plan.cadenceManaged){
          const localPreview=plan.implicitMicroGesture?beginWaitingPreview(plan,null,{pending:avatarMode!=="anime"}):null;
          if(avatarMode!=="anime")fetch("/api/dinet/prepare-action",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:plan.action,character:realAvatarCharacter}),signal:controller.signal})
            .then(response=>response.ok?response.json():null)
            .then(result=>{
              if(!localPreview)return;
              if(!result?.preview?.url||!preparedPreviewCanStart(localPreview,{activePreview:waitingPreview,aborted:controller.signal.aborted,spokenSentenceCount}))return;
              localPreview.pending=false;localPreview.startedAt=performance.now();
              digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview",...result.preview},location.origin);
            }).catch(()=>{});
        }
        if(data.waitingPreview?.url&&data.waitingPreview.action===plan.action){
          beginWaitingPreview(plan,data.waitingPreview);
        }
      }
      if(event==="speech-ready")firstTtsConnectionId=String(data.ttsConnectionId||"");
      if (event === "sentence") {
        backchannelGate.cancel();
        if(!spokenSentenceCount)portrait.dataset.chatFirstSentenceMs=String(Math.round(performance.now()-activeReplyStartedAt));
        streamedText += data.text;
        const transcriptIndex=transcript.receive(data.text);
        const reusedBackchannel=backchannelPlayback?.claim(data.text,{onStart:()=>revealSentence(transcriptIndex),onComplete:()=>finishSentence(transcriptIndex)})===true;
        let speechText=data.text,continuedBackchannel=false;
        if(backchannelPlayback&&!reusedBackchannel){
          const remainder=backchannelPlayback.started?remainingAfterSpokenBackchannel(backchannelPlayback.text,data.text):null;
          if(remainder){speechText=remainder;continuedBackchannel=true;}
          else backchannelPlayback.cancelBeforeStart();
          backchannelPlayback.close();backchannelPlayback=null;
        }
        if(data.emotion){currentEmotion=data.emotion;setEmotion(currentEmotion);}
        const sentenceIndex=spokenSentenceCount++;
        let sentencePlan=conversationActions.planForSentence(data.text,sentenceIndex,data.action||currentAction,currentEmotion);
        if(sentenceIndex===0&&waitingPreview){
          const continuesPreview=!waitingPreview.pending&&!sentencePlan.deferred&&sentencePlan.action===waitingPreview.action;
          if(continuesPreview){
            const previewTimeMs=waitingPreview.observedAt
              ?waitingPreview.mediaTimeMs+performance.now()-waitingPreview.observedAt
              :performance.now()-waitingPreview.startedAt;
            sentencePlan=avatarMode!=="anime"?continueActionPlan(sentencePlan,{action:waitingPreview.action,elapsedMs:previewTimeMs,leadMs:AVATAR_FIRST_SEGMENT_LEAD_MS}):{...sentencePlan,continuation:true};
            if(avatarMode!=="anime"){actionFrameBias=sentencePlan.frameOffset;biasedAction=sentencePlan.action;}
          }
          else digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview-clear"},location.origin);
          waitingPreview=null;activeWaitingPreview=null;delete portrait.dataset.waitingPreview;
        }
        else if(sentenceIndex===0&&backchannelVisual&&avatarMode!=="anime"){
          const elapsedMs=backchannelVisualElapsedMs(backchannelVisual);
          portrait.dataset.backchannelContinuationMs=String(elapsedMs);
          sentencePlan=continueActionPlan(sentencePlan,{action:backchannelVisual.action,baseFrameOffset:backchannelVisual.frameOffset,elapsedMs,leadMs:AVATAR_FIRST_SEGMENT_LEAD_MS});
          if(sentencePlan.continuation){actionFrameBias=sentencePlan.frameOffset;biasedAction=sentencePlan.action;}
          backchannelVisual=null;
        }
        else if(actionFrameBias&&sentencePlan.continuation&&sentencePlan.action===biasedAction){
          sentencePlan={...sentencePlan,frameOffset:sentencePlan.frameOffset+actionFrameBias};
        }
        else if(sentencePlan.action!==biasedAction){actionFrameBias=0;biasedAction="";}
        const sentenceAction=sentencePlan.action;portrait.dataset.behavior=JSON.stringify(sentencePlan);
        if(!reusedBackchannel&&sentenceAction!=="idle"&&!sentencePlan.continuation)setDigitalHumanAction(sentenceAction,{force:true,hold:true,behavior:sentencePlan}).catch(()=>{});
        const ttsConnectionId=sentenceIndex===0?firstTtsConnectionId:"";
        firstTtsConnectionId="";
        const sentenceHasSpeech=true;
        if(!reusedBackchannel)enqueueSpeech(speechText,currentEmotion,batch,sentencePlan,streamTurn,{ttsConnectionId,onStart:()=>{if(sentenceHasSpeech)reportSpeechStart("formal");revealSentence(transcriptIndex);},onComplete:()=>finishSentence(transcriptIndex)});
        if(continuedBackchannel)portrait.dataset.backchannelContinuation=speechText;
      }
      if(event==="backchannel"&&data.text)backchannelGate.offer(data);
      if (event === "error") throw new Error(data.error || "回答中断");
      if (event === "done") {
        mode=data.mode; currentEmotion=data.emotion || currentEmotion; setEmotion(currentEmotion);
        const finalText=data.reply || streamedText || "我在听。";
        transcript.setFinal(finalText);streamedText=finalText;
      }
    });
    const completedQueue=streamTurn?streamTurn.finish():speechQueue;
    if(streamTurn)speechQueue=completedQueue;
    completedQueue.finally(()=>{if(batch===speechBatch){const settlement=settleActiveTranscript(false);if(settlement&&!settlement.interrupted)reportClientTiming("playback-ended");if(streamTurn)speaking(false);if(activeAvatarStreamTurn===streamTurn)activeAvatarStreamTurn=null;conversationActions.finishTurn();if(switchableAvatarProfile&&avatarMode==="anime")digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-finish-gesture"},location.origin);}});
  } catch (error) {
    backchannelGate.cancel();
    $("#typing")?.remove();
    if (error.name !== "AbortError") { stopSpeech();addMessage("assistant", `刚才的连接有点不稳定：${error.message}。再试一次好吗？`, false); setEmotion("caring"); speaking(false); setVoiceState("idle","连接不稳定，请点击麦克风重试"); }
  } finally { if(waitingPreview)digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview-clear"},location.origin);if(activeWaitingPreview===waitingPreview)activeWaitingPreview=null;if(activeReplyController===controller)activeReplyController=null; sendButton.disabled=false; if(!form.hidden)input.focus(); }
}
async function submit(text,options={}) { const message = text.trim(); if (!message || sendButton.disabled) return; stopSpeech(); input.value=""; resize(); addMessage("user", message);void codexSession.recordUser(message,options.recognitionMetrics?"speech-final":"typed"); await reply(message,options); }
form.addEventListener("submit", e => { e.preventDefault(); submit(input.value); });
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
function resize(){ input.style.height="auto"; input.style.height=`${Math.min(input.scrollHeight,110)}px`; } input.addEventListener("input",resize);
$("#clearButton").addEventListener("click",async()=>{
  stopSpeech();void codexSession.end();history=[];localStorage.removeItem("lumi-history");messages.querySelectorAll(".message").forEach((m,i)=>i&&m.remove());setEmotion("happy");
  try{
    const response=await fetch("/api/chat/memory/clear",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({userId})});
    if(!response.ok)throw new Error("服务端记忆清理失败");
    setVoiceState("idle","聊天记录和人物记忆已经清空，可以重新开始");
  }catch(error){setVoiceState("idle","聊天记录已清空，但人物记忆清理失败，请稍后重试");}
});
captionButton.addEventListener("click",()=>{ const visible=!document.body.classList.contains("show-captions");document.body.classList.toggle("show-captions",visible);captionButton.setAttribute("aria-pressed",String(visible));captionButton.title=visible?"隐藏右侧聊天记录":"显示右侧聊天记录";if(visible)messages.scrollTop=messages.scrollHeight;});
window.addEventListener("message",event=>{
  if(event.origin!==location.origin||event.source!==digitalHumanFrame?.contentWindow)return;
  if(event.data?.type==="dh-live-ready"){portrait.classList.add("dh-live-ready");statusText.textContent="真人形象已就绪";if(voiceCallActive)digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-audio-unlock"},location.origin);}
  if(event.data?.type==="vrm-ready"){
    portrait.classList.add("dh-live-ready");
    if(animeLooks[event.data.look]){animeLook=event.data.look;animeLookSelect.value=animeLook;}
    statusText.textContent=`${animeLooks[animeLook]||"动漫形象"}已就绪`;
  }
  if(event.data?.type==="vrm-behavior-accepted"){portrait.dataset.vrmAction=event.data.action;portrait.dataset.vrmActionStarted=String(Boolean(event.data.started));}
  if(event.data?.type==="dh-live-audio-accepted") portrait.dataset.dhAudioBytes=String(event.data.bytes||0);
  if(event.data?.type==="wav2lip-audio-mode"){portrait.dataset.audioMode=event.data.mode;portrait.dataset.audioGapMs=String(event.data.gapMs||0);avatarPcmReady=event.data.mode==="pcm-ready"||event.data.mode==="pcm";avatarFragmentedVideoReady=event.data.fragmentedVideo===true;portrait.dataset.fragmentedVideo=String(avatarFragmentedVideoReady);}
  if(event.data?.type==="wav2lip-preview-started"&&activeWaitingPreview?.action===event.data.action){activeWaitingPreview.mediaTimeMs=Math.max(0,Number(event.data.currentTime)||0)*1000;activeWaitingPreview.observedAt=performance.now();portrait.dataset.waitingPreviewStarted="true";}
  if(event.data?.type==="wav2lip-preview-started"&&event.data.purpose==="listening"){portrait.dataset.listeningGesture="started";}
  if(event.data?.type==="wav2lip-preview-ended"&&event.data.purpose==="listening"){listeningPreviewActive=false;portrait.dataset.listeningGesture="completed";}
  if(event.data?.type==="wav2lip-started"){
    if(Number.isFinite(Number(event.data.handoffLateMs))){portrait.dataset.videoFirstFrameMs=String(event.data.firstFrameMs||0);portrait.dataset.videoHandoffLateMs=String(event.data.handoffLateMs||0);}
    const start=pendingWav2LipStarts.get(event.data.requestId);pendingWav2LipStarts.delete(event.data.requestId);start?.();
  }
  if(event.data?.type==="wav2lip-video-sync"){portrait.dataset.videoDriftMs=String(event.data.driftMs||0);portrait.dataset.videoMaxDriftMs=String(event.data.maxDriftMs||0);}
  if(event.data?.type==="wav2lip-gap-idle"){portrait.dataset.avatarGapMode="idle";portrait.dataset.avatarGapIdleMs=String(event.data.gapMs||0);portrait.dataset.avatarGapIdleSourceMs=String(event.data.sourceTimeMs||0);}
  if(event.data?.type==="wav2lip-gap-preview"){portrait.dataset.avatarGapMode="preview";portrait.dataset.avatarGapAction=String(event.data.action||"");portrait.dataset.avatarGapIdleMs=String(event.data.gapMs||0);portrait.dataset.avatarGapIdleSourceMs=String(event.data.sourceTimeMs||0);}
  if(event.data?.type==="wav2lip-video-buffer"){portrait.dataset.videoAheadSeconds=String(event.data.aheadSeconds||0);portrait.dataset.videoBufferStart=String(event.data.bufferStart||0);portrait.dataset.videoPrunedSeconds=String(event.data.prunedSeconds||0);}
  if(event.data?.type==="wav2lip-media-gate")portrait.dataset.videoAudioGateMs=String(event.data.mediaReadyMs||0);
  if(event.data?.type==="wav2lip-audio-buffer"){portrait.dataset.audioAheadSeconds=String(event.data.aheadSeconds||0);portrait.dataset.audioSources=String(event.data.sources||0);}
  if(event.data?.type==="wav2lip-ended"&&event.data.streamId&&Number.isSafeInteger(Number(event.data.sequence))){
    fetch(`/api/dinet/stream/${encodeURIComponent(event.data.streamId)}/ack`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sequence:Number(event.data.sequence)})}).then(response=>response.ok?response.json():null).then(data=>{if(data?.acknowledged)portrait.dataset.renderUnacknowledged=String(data.unacknowledged||0);}).catch(()=>{});
  }
  if(event.data?.type==="wav2lip-error"&&event.data.streamId){
    fetch(`/api/dinet/stream/${encodeURIComponent(event.data.streamId)}/cancel`,{method:"POST"}).catch(()=>{});
  }
  if(event.data?.type==="wav2lip-ended"||event.data?.type==="wav2lip-error") pendingWav2LipPlaybacks.get(event.data.requestId)?.(event.data.type==="wav2lip-ended");
  if(event.data?.type==="dh-live-action-ready"||event.data?.type==="dh-live-action-error"){
    pendingActions.get(event.data.requestId)?.(); pendingActions.delete(event.data.requestId);
    if(event.data?.type==="dh-live-action-ready") portrait.dataset.dhAction=event.data.action;
  }
});


const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) { const recognition = new Recognition(); recognition.lang="zh-CN"; recognition.interimResults=true; recognition.continuous=false; let recognizedText="",recognitionFailed=false, recognitionRunning=false, restartListeningTimer,vadStream,vadContext,vadAnalyser,vadSamples,vadFrame,bargeInFrame=0,answerGeneration=0,answerPlaybackEndedAt=0,latestEndpointSilenceMs=0;const listeningGesture=new ListeningGestureGate();
  const updateCallButton=()=>{voiceButton.classList.toggle("call-active",voiceCallActive);voiceButton.setAttribute("aria-pressed",String(voiceCallActive));voiceButton.setAttribute("aria-label",voiceCallActive?"结束通话":"开始通话");micButton.setAttribute("aria-label",voiceCallActive?"结束通话":"开始通话");micButton.title=voiceCallActive?"结束通话":"开始通话";};
  const stopVadLoop=()=>{if(vadFrame)cancelAnimationFrame(vadFrame);vadFrame=0;};
  const stopBargeInLoop=()=>{if(bargeInFrame)cancelAnimationFrame(bargeInFrame);bargeInFrame=0;};
  const markRecognitionStopped=()=>{recognitionRunning=false;micButton.classList.remove("listening");voiceButton.classList.remove("listening");};
  const releaseVad=()=>{stopVadLoop();stopBargeInLoop();vadStream?.getTracks().forEach(track=>track.stop());vadStream=null;vadAnalyser=null;vadSamples=null;vadContext?.close().catch(()=>{});vadContext=null;};
  const ensureVad=async()=>{if(vadAnalyser)return true;if(!navigator.mediaDevices?.getUserMedia)return false;vadStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!voiceCallActive){vadStream.getTracks().forEach(track=>track.stop());vadStream=null;return false;}vadContext=new AudioContext();await vadContext.resume().catch(()=>{});vadAnalyser=vadContext.createAnalyser();vadAnalyser.fftSize=1024;vadAnalyser.smoothingTimeConstant=0;vadSamples=new Float32Array(vadAnalyser.fftSize);vadContext.createMediaStreamSource(vadStream).connect(vadAnalyser);return true;};
  const startBargeInLoop=generation=>{stopBargeInLoop();if(!vadAnalyser)return;const detector=new BargeInDetector();let answerAudioStarted=false;const inspect=()=>{if(!voiceCallActive||generation!==answerGeneration){bargeInFrame=0;return;}if(recognitionRunning){bargeInFrame=requestAnimationFrame(inspect);return;}const answerSpeaking=portrait.classList.contains("speaking");if(!answerAudioStarted&&!answerSpeaking){bargeInFrame=requestAnimationFrame(inspect);return;}const now=performance.now();if(!answerAudioStarted){answerAudioStarted=true;detector.reset(now);}vadAnalyser.getFloatTimeDomainData(vadSamples);let energy=0;for(const value of vadSamples)energy+=value*value;const rms=Math.sqrt(energy/vadSamples.length);portrait.dataset.bargeInLevel=rms.toFixed(4);portrait.dataset.bargeInBaseline=detector.baseline.toFixed(4);if(detector.sample(rms,now)){bargeInFrame=0;answerGeneration++;portrait.dataset.bargeInDetectedMs=String(Math.round(now-detector.startedAt));stopSpeech();setVoiceState("idle","已暂停，我在听");scheduleListening(60);return;}bargeInFrame=requestAnimationFrame(inspect);};bargeInFrame=requestAnimationFrame(inspect);};
  const commitRecognizedTurn=async(text,metrics)=>{recognizedText="";const generation=++answerGeneration;portrait.dataset.recognitionCommitTrigger=metrics.trigger;portrait.dataset.recognitionTurnMs=String(metrics.turnMs);const endpointMs=Number(metrics.endpointSilenceMs),finalizeMs=Number(metrics.stopToCommitMs);portrait.dataset.vadStopToSubmitMs=Number.isFinite(finalizeMs)?String(Math.round((Number.isFinite(endpointMs)?endpointMs:0)+finalizeMs)):"";if(!voiceCallActive)return;setVoiceState("thinking",`${persona.name}正在回应`);startBargeInLoop(generation);await submit(text,{recognitionMetrics:{...metrics,commitObservedAt:performance.now()}});const completedQueue=speechQueue;await completedQueue.catch(()=>{});if(generation!==answerGeneration)return;stopBargeInLoop();if(voiceCallActive){answerPlaybackEndedAt=performance.now();const outputLatencyMs=((avatarAudioContext?.outputLatency||avatarAudioContext?.baseLatency)||0)*1000;const resumeDelayMs=recognitionResumeDelayMs({preciseAudioTail:neuralAvatarProfile&&avatarPcmReady,outputLatencyMs});portrait.dataset.listenResumeDelayMs=String(resumeDelayMs);portrait.dataset.audioOutputLatencyMs=String(Math.round(outputLatencyMs));setVoiceState("idle","请继续说话");scheduleListening(resumeDelayMs);}};
  const turnGate=new RecognitionTurnGate({onCommit:commitRecognizedTurn,finalizeDelayMs:90});
  const startVadLoop=()=>{stopVadLoop();if(!vadAnalyser)return;const detector=new SpeechEndpointDetector();latestEndpointSilenceMs=0;let lastDiagnosticAt=0;const inspect=()=>{if(!voiceCallActive||!recognitionRunning||!vadAnalyser){vadFrame=0;return;}vadAnalyser.getFloatTimeDomainData(vadSamples);let energy=0;for(const value of vadSamples)energy+=value*value;const rms=Math.sqrt(energy/vadSamples.length),now=performance.now(),endpoint=detector.sample(rms,now,{hasTranscript:Boolean(recognizedText)});latestEndpointSilenceMs=endpoint.silenceMs;if(now-lastDiagnosticAt>=250){lastDiagnosticAt=now;portrait.dataset.vadNoiseFloor=endpoint.noiseFloor.toFixed(4);portrait.dataset.vadThreshold=endpoint.threshold.toFixed(4);}if(recognizedText){const silenceTargetMs=recognitionSilenceMs({text:recognizedText});if(endpoint.silenceMs>=silenceTargetMs){portrait.dataset.vadSilenceMs=String(Math.round(endpoint.silenceMs));portrait.dataset.vadSilenceTargetMs=String(silenceTargetMs);stopVadLoop();markRecognitionStopped();turnGate.requestStop({endpointSilenceMs:endpoint.silenceMs});try{recognition.stop();}catch{}return;}}vadFrame=requestAnimationFrame(inspect);};vadFrame=requestAnimationFrame(inspect);};
  const startListening=()=>{if(!voiceCallActive)return;clearTimeout(restartListeningTimer);if(recognitionRunning){restartListeningTimer=setTimeout(startListening,100);return;}try{recognition.start()}catch{restartListeningTimer=setTimeout(startListening,350)}};
  const scheduleListening=(delay=350)=>{clearTimeout(restartListeningTimer);if(voiceCallActive)restartListeningTimer=setTimeout(startListening,delay);};
  const clearListeningGesture=()=>{listeningGesture.cancel();if(listeningPreviewActive)digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview-clear"},location.origin);listeningPreviewActive=false;if(["scheduled","triggered","started"].includes(portrait.dataset.listeningGesture))portrait.dataset.listeningGesture="cancelled";};
  const scheduleListeningGesture=()=>{
    if(listeningGesture.schedule({canRun:()=>Boolean(voiceCallActive&&recognitionRunning&&recognizedText),onTrigger:()=>{
      portrait.dataset.listeningGesture="triggered";
      if(avatarMode==="anime"){portrait.dataset.listeningGesture="started";setDigitalHumanAction("nod",{force:true,hold:false,behavior:{purpose:"listening",intensity:.2,holdMs:1300}}).catch(()=>{});}
      else if(neuralAvatarProfile){
        listeningPreviewActive=true;
        digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview",action:"nod",url:`/dh-live/actions/${realAvatarCharacter==="xiaotao"?"xiaotao_nod":"bedroom_agree_test"}/01.mp4`,purpose:"listening",loop:false,durationMs:3600},location.origin);
      }
    }}))portrait.dataset.listeningGesture="scheduled";
  };
  const endCall=()=>{voiceCallActive=false;answerGeneration++;clearTimeout(restartListeningTimer);clearListeningGesture();turnGate.cancel();if(recognitionRunning)recognition.abort();markRecognitionStopped();releaseVad();stopSpeech();void codexSession.end();voiceButton.classList.remove("thinking","speaking");updateCallButton();setVoiceState("idle","通话已结束");statusText.textContent="在线 · 随时听你说";};
  const beginCall=async()=>{if(voiceCallActive)return;voiceCallActive=true;stopSpeech();void unlockAvatarAudio();digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-audio-unlock"},location.origin);updateCallButton();setVoiceState("idle","正在准备麦克风…");try{await ensureVad();}catch{}if(voiceCallActive){setVoiceState("idle","通话已开始，请自然说话");scheduleListening(80);}};
  const toggleCall=()=>voiceCallActive?endCall():beginCall();
  recognition.onstart=()=>{recognitionRunning=true;stopBargeInLoop();if(answerPlaybackEndedAt){portrait.dataset.answerEndToListeningMs=String(Math.round(performance.now()-answerPlaybackEndedAt));answerPlaybackEndedAt=0;}recognizedText="";recognitionFailed=false;latestEndpointSilenceMs=0;turnGate.begin();delete portrait.dataset.vadSilenceMs;delete portrait.dataset.vadSilenceTargetMs;delete portrait.dataset.vadNoiseFloor;delete portrait.dataset.vadThreshold;delete portrait.dataset.vadStopToSubmitMs;delete portrait.dataset.recognitionCommitTrigger;clearListeningGesture();listeningGesture.reset();delete portrait.dataset.listeningGesture;conversationActions.finishTurn();digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-finish-gesture"},location.origin);micButton.classList.add("listening");setVoiceState("listening","请自然说话，停顿后我会立即回答");setEmotion("curious");statusText.textContent="我在听…";startVadLoop();};
  recognition.onresult=e=>{const results=Array.from(e.results);recognizedText=results.map(r=>r[0].transcript).join("").trim();const final=Boolean(results.at(-1)?.isFinal);if(turnGate.update(recognizedText,{final,endpointSilenceMs:latestEndpointSilenceMs})){stopVadLoop();clearListeningGesture();markRecognitionStopped();try{recognition.stop();}catch{}return;}if(recognizedText)scheduleListeningGesture();};
  recognition.onend=()=>{stopVadLoop();clearListeningGesture();markRecognitionStopped();if(!voiceCallActive)return;if(turnGate.committed)return;if(turnGate.end())return;recognizedText="";if(!recognitionFailed){setVoiceState("idle","我还在听，请继续说");scheduleListening(350)}};
  recognition.onerror=e=>{stopVadLoop();clearListeningGesture();markRecognitionStopped();if(turnGate.committed)return;recognitionFailed=true;turnGate.fail();const denied=e.error==="not-allowed"||e.error==="service-not-allowed";if(denied){voiceCallActive=false;releaseVad();updateCallButton();setVoiceState("idle","请允许浏览器使用麦克风后重试");}else if(voiceCallActive){setVoiceState("idle","没有听清楚，正在继续聆听");scheduleListening(500)}};
  micButton.onclick=toggleCall;voiceButton.onclick=toggleCall;updateCallButton();
} else { micButton.disabled=true;voiceButton.disabled=true;voicePrompt.textContent="当前浏览器不支持语音识别";liveTranscript.textContent="请使用最新版 Chrome 或 Edge"; }

async function setupLocalAsr(){
  const status=await fetch("/api/asr/status").then(response=>response.ok?response.json():null).catch(()=>null);
  if(status?.provider!=="local_sherpa"||!status.ready)return;
  const browserMicHandler=micButton.onclick,browserVoiceHandler=voiceButton.onclick;
  let stream,context,analyser,samples,recorder,listening=false,vadFrame=0,bargeFrame=0,restartTimer=0,forceSubmitTimer=0,answerGeneration=0,answerPlaybackEndedAt=0,listenStartedAt=0,speechStartedAt=0,lastNoInputPromptAt=0;
  const listeningGesture=new ListeningGestureGate();
  const updateButton=()=>{voiceButton.classList.toggle("call-active",voiceCallActive);voiceButton.setAttribute("aria-pressed",String(voiceCallActive));voiceButton.setAttribute("aria-label",voiceCallActive?"结束通话":"开始通话");micButton.setAttribute("aria-label",voiceCallActive?"结束通话":"开始通话");micButton.title=voiceCallActive?"结束通话":"开始通话";};
  const stopVad=()=>{if(vadFrame)cancelAnimationFrame(vadFrame);vadFrame=0;};
  const stopBarge=()=>{if(bargeFrame)cancelAnimationFrame(bargeFrame);bargeFrame=0;};
  const stopListening=()=>{listening=false;clearTimeout(forceSubmitTimer);forceSubmitTimer=0;stopVad();micButton.classList.remove("listening");voiceButton.classList.remove("listening");};
  const clearGesture=()=>{listeningGesture.cancel();if(listeningPreviewActive)digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview-clear"},location.origin);listeningPreviewActive=false;if(["scheduled","triggered","started"].includes(portrait.dataset.listeningGesture))portrait.dataset.listeningGesture="cancelled";};
  const scheduleGesture=()=>{if(listeningGesture.schedule({canRun:()=>Boolean(voiceCallActive&&listening&&speechStartedAt),onTrigger:()=>{portrait.dataset.listeningGesture="triggered";if(avatarMode==="anime"){portrait.dataset.listeningGesture="started";setDigitalHumanAction("nod",{force:true,hold:false,behavior:{purpose:"listening",intensity:.2,holdMs:1300}}).catch(()=>{});}else if(neuralAvatarProfile){listeningPreviewActive=true;digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-preview",action:"nod",url:`/dh-live/actions/${realAvatarCharacter==="xiaotao"?"xiaotao_nod":"bedroom_agree_test"}/01.mp4`,purpose:"listening",loop:false,durationMs:3600},location.origin);}}}))portrait.dataset.listeningGesture="scheduled";};
  const release=()=>{stopVad();stopBarge();recorder?.close();recorder=null;stream?.getTracks().forEach(track=>track.stop());stream=null;analyser=null;samples=null;context?.close().catch(()=>{});context=null;};
  const ensureCapture=async()=>{if(recorder)return true;if(!navigator.mediaDevices?.getUserMedia)return false;stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});if(!voiceCallActive){stream.getTracks().forEach(track=>track.stop());stream=null;return false;}const Context=window.AudioContext||window.webkitAudioContext;if(!Context)return false;context=new Context();await context.resume();analyser=context.createAnalyser();analyser.fftSize=1024;analyser.smoothingTimeConstant=0;samples=new Float32Array(analyser.fftSize);context.createMediaStreamSource(stream).connect(analyser);recorder=new LocalAsrRecorder(context,stream);return true;};
  const scheduleListening=(delay=180)=>{clearTimeout(restartTimer);if(voiceCallActive)restartTimer=setTimeout(startListening,delay);};
  const startBarge=generation=>{stopBarge();if(!analyser)return;const detector=new BargeInDetector();let answerStarted=false;const inspect=()=>{if(!voiceCallActive||generation!==answerGeneration){bargeFrame=0;return;}if(listening){bargeFrame=requestAnimationFrame(inspect);return;}const speaking=portrait.classList.contains("speaking");if(!answerStarted&&!speaking){bargeFrame=requestAnimationFrame(inspect);return;}const now=performance.now();if(!answerStarted){answerStarted=true;detector.reset(now);}analyser.getFloatTimeDomainData(samples);let energy=0;for(const value of samples)energy+=value*value;const rms=Math.sqrt(energy/samples.length);if(detector.sample(rms,now)){bargeFrame=0;answerGeneration++;stopSpeech();setVoiceState("idle","已暂停，我在听");scheduleListening(60);return;}bargeFrame=requestAnimationFrame(inspect);};bargeFrame=requestAnimationFrame(inspect);};
  const commit=async(text,metrics)=>{const generation=++answerGeneration;portrait.dataset.recognitionCommitTrigger="local-asr";portrait.dataset.recognitionTurnMs=String(metrics.turnMs);portrait.dataset.vadStopToSubmitMs=String(metrics.endpointSilenceMs||0);if(!voiceCallActive)return;setVoiceState("thinking",`${persona.name}正在回应`);startBarge(generation);await submit(text,{recognitionMetrics:{...metrics,trigger:"local-asr",commitObservedAt:performance.now()}});const completed=speechQueue;await completed.catch(()=>{});if(generation!==answerGeneration)return;stopBarge();if(voiceCallActive){answerPlaybackEndedAt=performance.now();const outputLatencyMs=((avatarAudioContext?.outputLatency||avatarAudioContext?.baseLatency)||0)*1000;scheduleListening(recognitionResumeDelayMs({preciseAudioTail:neuralAvatarProfile&&avatarPcmReady,outputLatencyMs}));}};
  const restoreBrowserFallback=()=>{endCall();micButton.onclick=browserMicHandler;voiceButton.onclick=browserVoiceHandler;voicePrompt.textContent="本地识别暂不可用，已切换浏览器识别";liveTranscript.textContent="请重新开始通话";};
  const transcribe=async(endpoint)=>{stopListening();clearGesture();const recorded=recorder.stop();if(recorded.durationMs<250){scheduleListening(160);return;}setVoiceState("thinking","正在识别…");const startedAt=performance.now();try{const response=await fetch("/api/asr/transcribe",{method:"POST",headers:{"content-type":"audio/wav","x-asr-language":"zh-CN"},body:recorded.blob});const payload=await response.json().catch(()=>({}));if(!response.ok)throw new Error(payload.error||"本地语音识别失败");const text=String(payload.text||"").trim();if(!text||isIncidentalFillerTranscript(text)){portrait.dataset.localAsrIgnoredFiller=text;scheduleListening(180);return;}portrait.dataset.asrMs=String(Math.round(performance.now()-startedAt));liveTranscript.textContent=text;await commit(text,{trigger:"local-asr",turnMs:Math.round(performance.now()-listenStartedAt),endpointSilenceMs:Math.round(endpoint.silenceMs),stopToCommitMs:Math.round(performance.now()-startedAt)});}catch(error){console.warn(error);if(status.fallback)restoreBrowserFallback();else{setVoiceState("idle","本地语音识别暂不可用");scheduleListening(800);}}};
  function startListening(){
    if(!voiceCallActive||listening)return;
    stopBarge();listening=true;listenStartedAt=performance.now();speechStartedAt=0;recorder.start();
    if(answerPlaybackEndedAt){portrait.dataset.answerEndToListeningMs=String(Math.round(performance.now()-answerPlaybackEndedAt));answerPlaybackEndedAt=0;}
    clearGesture();listeningGesture.reset();conversationActions.finishTurn();digitalHumanFrame?.contentWindow?.postMessage({type:"vrm-finish-gesture"},location.origin);
    micButton.classList.add("listening");voiceButton.classList.add("listening");setVoiceState("listening","请自然说话，停顿后我会立即回答");setEmotion("curious");statusText.textContent="我在听…";
    const detector=new SpeechEndpointDetector({absoluteThreshold:.01,maxSilenceThreshold:.032,noiseMultiplier:1.75}),silenceTargetMs=620,forcedWindowMs=4200;let lastDiagnosticAt=0,lastResetAt=listenStartedAt,activityStartedAt=0,lastActiveAt=0,peakRms=0;
    const forceSubmit=()=>{if(!voiceCallActive||!listening)return;const now=performance.now(),enoughInput=Boolean(speechStartedAt);if(enoughInput){portrait.dataset.localAsrForcedSubmit="true";void transcribe({silenceMs:lastActiveAt?now-lastActiveAt:0,forced:true});return;}recorder.cancel();recorder.start();detector.reset(now);listenStartedAt=now;activityStartedAt=0;lastActiveAt=0;peakRms=0;lastResetAt=now;if(!lastNoInputPromptAt||now-lastNoInputPromptAt>20_000){liveTranscript.textContent="我还在听";lastNoInputPromptAt=now;}portrait.dataset.localAsrNoInput="true";forceSubmitTimer=setTimeout(forceSubmit,forcedWindowMs);};
    forceSubmitTimer=setTimeout(forceSubmit,forcedWindowMs);
    const inspect=()=>{if(!voiceCallActive||!listening||!analyser){vadFrame=0;return;}analyser.getFloatTimeDomainData(samples);let energy=0;for(const value of samples)energy+=value*value;const rms=Math.sqrt(energy/samples.length),now=performance.now(),endpoint=detector.sample(rms,now,{hasTranscript:detector.hasSpeech});peakRms=Math.max(peakRms,rms);const activeThreshold=Math.max(.006,Math.min(.026,endpoint.noiseFloor*1.55));if(rms>=activeThreshold){activityStartedAt||=now;lastActiveAt=now;}else if(activityStartedAt&&!speechStartedAt&&now-activityStartedAt>320){activityStartedAt=0;}if((endpoint.hasSpeech||activityStartedAt&&now-activityStartedAt>=160)&&!speechStartedAt){speechStartedAt=activityStartedAt||now;scheduleGesture();portrait.dataset.localAsrSpeechStarted="true";}if(now-lastDiagnosticAt>=250){lastDiagnosticAt=now;portrait.dataset.vadNoiseFloor=endpoint.noiseFloor.toFixed(4);portrait.dataset.vadThreshold=endpoint.threshold.toFixed(4);portrait.dataset.localAsrLevel=rms.toFixed(4);portrait.dataset.localAsrPeak=peakRms.toFixed(4);portrait.dataset.localAsrActiveThreshold=activeThreshold.toFixed(4);portrait.dataset.localAsrListeningMs=String(Math.round(now-listenStartedAt));}const activitySilenceMs=lastActiveAt?now-lastActiveAt:0;if(speechStartedAt&&(endpoint.silenceMs>=silenceTargetMs||activitySilenceMs>=silenceTargetMs||now-speechStartedAt>=18_000)){portrait.dataset.vadSilenceMs=String(Math.round(Math.max(endpoint.silenceMs,activitySilenceMs)));portrait.dataset.vadSilenceTargetMs=String(silenceTargetMs);void transcribe({...endpoint,silenceMs:Math.max(endpoint.silenceMs,activitySilenceMs)});return;}if(!speechStartedAt&&now-lastResetAt>=7000){recorder.cancel();recorder.start();detector.reset(now);activityStartedAt=0;lastActiveAt=0;peakRms=0;lastResetAt=now;portrait.dataset.localAsrResetAt=String(Math.round(now));}vadFrame=requestAnimationFrame(inspect);};vadFrame=requestAnimationFrame(inspect);
  }
  function endCall(){voiceCallActive=false;answerGeneration++;clearTimeout(restartTimer);clearGesture();recorder?.cancel();stopListening();release();stopSpeech();void codexSession.end();voiceButton.classList.remove("thinking","speaking");updateButton();setVoiceState("idle","通话已结束");statusText.textContent="在线 · 随时听你说";}
  const beginCall=async()=>{if(voiceCallActive)return;voiceCallActive=true;stopSpeech();void unlockAvatarAudio();digitalHumanFrame?.contentWindow?.postMessage({type:"wav2lip-audio-unlock"},location.origin);updateButton();setVoiceState("idle","正在准备本地语音识别…");try{if(!await ensureCapture())throw new Error("无法访问麦克风");}catch(error){voiceCallActive=false;release();updateButton();setVoiceState("idle","请允许浏览器使用麦克风后重试");return;}if(voiceCallActive){setVoiceState("idle","本地识别已就绪，请自然说话");scheduleListening(80);}};
  const toggle=()=>voiceCallActive?endCall():void beginCall();
  micButton.disabled=false;voiceButton.disabled=false;micButton.onclick=toggle;voiceButton.onclick=toggle;voicePrompt.textContent="本地语音识别已就绪";portrait.dataset.asrProvider="local_sherpa";updateButton();
}
void setupLocalAsr();

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
