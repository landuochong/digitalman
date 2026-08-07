const $ = (selector) => document.querySelector(selector);
const portrait = $("#portrait"), wave = $("#soundWave"), messages = $("#messages");
const input = $("#messageInput"), form = $("#chatForm"), sendButton = $("#sendButton");
const micButton = $("#micButton"), modeBanner = $("#modeBanner"), statusText = $("#statusText");
const voiceButton = $("#voiceButton"), voicePrompt = $("#voicePrompt"), liveTranscript = $("#liveTranscript"), captionButton = $("#captionButton");
const digitalHumanFrame = $("#digitalHumanFrame");
const avatarProfile = new URLSearchParams(location.search).get("profile");
const selfRecordedProfile = avatarProfile === "self";
const minimaxGeneratedProfile = avatarProfile === "minimax";
const lakesideGeneratedProfile = avatarProfile === "lakeside";
const cleanAvatarProfile = avatarProfile === "clean";
const wav2LipAvatarProfile = avatarProfile === "wav2lip";
const dinetAvatarProfile = avatarProfile === "dinet";
const neuralAvatarProfile = wav2LipAvatarProfile || dinetAvatarProfile;
const neuralRenderEndpoint = dinetAvatarProfile ? "/api/dinet/render" : "/api/wav2lip/render";
const selfRecordedActions = {
  idle:"self_idle", happy:"self_smile", smile:"self_smile", shy:"self_smile", clap:"self_smile", cheer:"self_smile",
  wave_approval:"self_agree", bow:"self_agree",
  caring:"self_idle", thinking:"self_idle", surprise:"self_idle", shrug:"self_idle", confident_arms_crossed:"self_idle", cross:"self_idle"
};
const minimaxGeneratedActions = {
  idle:"minimax_idle_test", happy:"minimax_smile_test", smile:"minimax_smile_test", shy:"minimax_smile_test",
  wave_approval:"minimax_agree_test", bow:"minimax_agree_test",
  caring:"minimax_idle_test", thinking:"minimax_idle_test", surprise:"minimax_idle_test", clap:"minimax_smile_test",
  cheer:"minimax_smile_test", shrug:"minimax_idle_test", confident_arms_crossed:"minimax_idle_test", cross:"minimax_idle_test"
};
const lakesideGeneratedActions = {
  idle:"lakeside_idle_test", happy:"lakeside_smile_test", smile:"lakeside_smile_test", shy:"lakeside_smile_test",
  wave_approval:"lakeside_agree_test", bow:"lakeside_agree_test",
  caring:"lakeside_idle_test", thinking:"lakeside_idle_test", surprise:"lakeside_idle_test", clap:"lakeside_smile_test",
  cheer:"lakeside_smile_test", shrug:"lakeside_idle_test", confident_arms_crossed:"lakeside_idle_test", cross:"lakeside_idle_test"
};
const cleanAvatarActions = {
  idle:"idle", happy:"smile", smile:"smile", shy:"smile", wave_approval:"agree", bow:"agree",
  caring:"idle", thinking:"idle", surprise:"idle", clap:"smile", cheer:"smile", shrug:"idle",
  confident_arms_crossed:"idle", cross:"idle"
};
if ((selfRecordedProfile || minimaxGeneratedProfile || lakesideGeneratedProfile || cleanAvatarProfile || neuralAvatarProfile) && digitalHumanFrame) {
  const initialAction = cleanAvatarProfile ? "idle" : lakesideGeneratedProfile ? "lakeside_idle_test" : minimaxGeneratedProfile ? "minimax_idle_test" : "self_idle";
  digitalHumanFrame.src = neuralAvatarProfile
    ? "/wav2lip-avatar/avatar.html"
    : cleanAvatarProfile
    ? `/clean-avatar/avatar.html?action=${initialAction}`
    : `/dh-live/avatar.html?action=${initialAction}`;
  const note = document.querySelector(".avatar-note");
  if (note) note.textContent = neuralAvatarProfile
    ? dinetAvatarProfile
      ? "湖畔真人 · Audio2BlendShape + DINet 中文口型"
      : "湖畔真人 · Wav2Lip256 中文神经口型"
    : cleanAvatarProfile
    ? "自研洁净口型实验 · 当前贴片方案未通过"
    : lakesideGeneratedProfile
    ? "湖畔可爱真人测试 · MiniMax H3 + DH_live 实时口型"
    : minimaxGeneratedProfile ? "MiniMax H3 真人测试 · DH_live 实时口型" : "自录真人测试 · DH_live 实时口型";
}
let history = JSON.parse(localStorage.getItem("lumi-history") || "[]");
let mode = "demo", speakingToken = 0, audioContext, activeAudio, activeSpeechResolve, speechTimer, actionRequestId = 0;
let speechQueue = Promise.resolve(), speechBatch = 0, activeReplyController;
const pendingActions = new Map();
const pendingWav2LipPlaybacks = new Map();
const userId = localStorage.lumiUserId ||= crypto.randomUUID();
const emotionText = { neutral:"认真听你说", happy:"很高兴见到你", caring:"我会陪着你", curious:"正在好奇", excited:"替你开心", calm:"安静陪伴中" };

function setEmotion(emotion = "neutral") {
  portrait.dataset.emotion = emotion;
  $("#emotionLabel").textContent = emotionText[emotion] || emotionText.neutral;
}
function setDigitalHumanAction(action = "idle") {
  if (!digitalHumanFrame?.contentWindow) return Promise.resolve();
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
  voiceButton.setAttribute("aria-label", active ? "打断回答并开始说话" : "开始语音对话");
  if (active) { voicePrompt.textContent="露米正在回答"; liveTranscript.textContent="再次点击麦克风可以打断"; }
  else if (!voiceButton.classList.contains("listening") && !voiceButton.classList.contains("thinking")) { voicePrompt.textContent="点击麦克风继续说话"; liveTranscript.textContent="我会在你说完后自动回答"; }
  if (!active) mouth(0, .5);
}
function setVoiceState(state, detail) {
  voiceButton.classList.remove("listening","thinking","speaking");
  voiceButton.disabled = state === "thinking";
  voiceButton.setAttribute("aria-label", state === "listening" ? "正在聆听" : state === "thinking" ? "正在思考" : "开始语音对话");
  if (state === "listening") { voiceButton.classList.add("listening"); voicePrompt.textContent="我在听…"; }
  if (state === "thinking") { voiceButton.classList.add("thinking"); voicePrompt.textContent="露米正在想…"; }
  if (state === "idle") { voicePrompt.textContent="点击麦克风继续说话"; }
  if (detail) liveTranscript.textContent=detail;
}
function stopSpeech() {
  speakingToken++;
  speechBatch++;
  speechQueue = Promise.resolve();
  activeReplyController?.abort(); activeReplyController = null;
  clearInterval(speechTimer);
  window.speechSynthesis?.cancel();
  if (activeAudio) { activeAudio.pause(); activeAudio.removeAttribute("src"); activeAudio = null; }
  activeSpeechResolve?.(); activeSpeechResolve = null;
  digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-clear" }, location.origin);
  digitalHumanFrame?.contentWindow?.postMessage({ type:"wav2lip-clear" }, location.origin);
  speaking(false);
}
function addMessage(role, content, persist = true) {
  const article = document.createElement("article"); article.className = `message ${role}`;
  article.innerHTML = role === "assistant"
    ? `<div class="mini-avatar">L</div><div><span>露米</span><p></p></div>`
    : `<div><span>你</span><p></p></div>`;
  article.querySelector("p").textContent = content; messages.append(article);
  messages.scrollTop = messages.scrollHeight;
  if (persist) { history.push({ role, content }); history = history.slice(-20); localStorage.setItem("lumi-history", JSON.stringify(history)); }
  return article;
}
function showTyping() {
  const el = document.createElement("article"); el.className = "message assistant typing"; el.id = "typing";
  el.innerHTML = `<div class="mini-avatar">L</div><div><span>露米正在想</span><p><i></i><i></i><i></i></p></div>`; messages.append(el); messages.scrollTop = messages.scrollHeight;
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
  const response = await fetch("/api/speech", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ text, emotion }) });
  if (requestToken !== speakingToken) return;
  if (!response.ok) return animateBrowserSpeech(text);
  const speechBuffer = await response.arrayBuffer();
  if (neuralAvatarProfile) {
    statusText.textContent = "正在生成中文神经口型…";
    const renderResponse = await fetch(neuralRenderEndpoint, {
      method:"POST",
      headers:{ "content-type":response.headers.get("content-type") || "application/octet-stream" },
      body:speechBuffer
    });
    if (!renderResponse.ok) {
      const error = await renderResponse.json().catch(() => ({}));
      throw new Error(error.error || "神经口型生成失败");
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
  function frame() { if (audio.paused || audio.ended || token !== speakingToken) return; analyser.getByteFrequencyData(data); const low = data.slice(2,18).reduce((a,b)=>a+b,0)/16/255; const mid = data.slice(18,55).reduce((a,b)=>a+b,0)/37/255; const targetOpen = low < .06 ? 0 : Math.min(1, low*1.65); const targetWidth = Math.min(1, .25+mid*1.2); smoothOpen += (targetOpen-smoothOpen)*(targetOpen>smoothOpen?.48:.22); smoothWidth += (targetWidth-smoothWidth)*.2; mouth(smoothOpen,smoothWidth); requestAnimationFrame(frame); }
  let finished = false;
  const finish = () => { if (finished) return; finished=true; if(activeAudio===audio) activeAudio=null; if(token===speakingToken) speaking(false); URL.revokeObjectURL(url); activeSpeechResolve=null; };
  audio.onplay = frame; audio.onended = finish; audio.onerror = finish;
  digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-clear" }, location.origin);
  digitalHumanFrame?.contentWindow?.postMessage({ type:"dh-live-audio", audio:rendererBuffer }, location.origin, [rendererBuffer]);
  await new Promise((resolve, reject) => {
    activeSpeechResolve = () => { finish(); resolve(); };
    audio.onended = () => { finish(); resolve(); };
    audio.onerror = () => { finish(); resolve(); };
    audio.play().catch(error => { finish(); reject(error); });
  });
}

async function prepareNeuralSpeech(text, emotion, batch) {
  const response = await fetch("/api/speech", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ text, emotion }) });
  if (!response.ok) throw new Error("语音生成失败");
  const speechBuffer = await response.arrayBuffer();
  if (batch !== speechBatch) return null;
  const renderResponse = await fetch(neuralRenderEndpoint, {
    method:"POST",
    headers:{ "content-type":response.headers.get("content-type") || "application/octet-stream" },
    body:speechBuffer
  });
  if (!renderResponse.ok) {
    const error = await renderResponse.json().catch(() => ({}));
    throw new Error(error.error || "神经口型生成失败");
  }
  return renderResponse.json();
}

async function playPreparedNeuralSpeech(rendered, batch) {
  if (!rendered || batch !== speechBatch) return;
  const requestId = crypto.randomUUID();
  speaking(true);
  digitalHumanFrame.contentWindow.postMessage({ type:"wav2lip-play", url:rendered.url, requestId }, location.origin);
  await new Promise(resolve => {
    const timer = setTimeout(() => { pendingWav2LipPlaybacks.delete(requestId); speaking(false); resolve(); }, 180_000);
    const finish = () => { clearTimeout(timer); pendingWav2LipPlaybacks.delete(requestId); if(batch===speechBatch)speaking(false); activeSpeechResolve=null; resolve(); };
    pendingWav2LipPlaybacks.set(requestId, finish);
    activeSpeechResolve = finish;
  });
}

function enqueueSpeech(text, emotion, batch) {
  if (neuralAvatarProfile) {
    // Start TTS and rendering immediately for every completed sentence. Playback
    // stays ordered, while later sentences prepare during the current sentence.
    const preparation = prepareNeuralSpeech(text, emotion, batch);
    speechQueue = speechQueue.then(async () => {
      if (batch !== speechBatch) return;
      try { await playPreparedNeuralSpeech(await preparation, batch); }
      catch (error) {
        if (batch !== speechBatch) return;
        speaking(false);
        statusText.textContent = error?.message || "神经口型生成失败";
        liveTranscript.textContent = "口型生成失败，请重试";
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
      statusText.textContent = error?.message || "神经口型生成失败";
      liveTranscript.textContent = "口型生成失败，请重试";
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
  const batch = speechBatch; let article, streamedText = "", currentEmotion = "calm";
  try {
    const response = await fetch("/api/chat/stream", { method:"POST", headers:{"content-type":"application/json"}, body:JSON.stringify({ message, history:history.slice(0,-1), userId, fastSpeech:neuralAvatarProfile }), signal:controller.signal });
    if (!response.ok || !response.body) { const data=await response.json().catch(()=>({})); throw new Error(data.error || "连接失败"); }
    await consumeEventStream(response, async (event, data) => {
      if (controller.signal.aborted) return;
      if (event === "meta") {
        mode=data.mode; currentEmotion=data.emotion || "calm"; setEmotion(currentEmotion);
        setDigitalHumanAction(data.action).catch(()=>{});
      }
      if (event === "sentence") {
        $("#typing")?.remove(); streamedText += data.text;
        article ||= addMessage("assistant", "", false);
        article.querySelector("p").textContent = streamedText;
        enqueueSpeech(data.text,currentEmotion,batch);
      }
      if (event === "error") throw new Error(data.error || "流式回答中断");
      if (event === "done") {
        mode=data.mode; currentEmotion=data.emotion || currentEmotion; setEmotion(currentEmotion);
        const finalText=data.reply || streamedText || "我在听。";
        $("#typing")?.remove(); article ||= addMessage("assistant", "", false);
        article.querySelector("p").textContent=finalText;
        streamedText=finalText;
      }
    });
    if (streamedText) { history.push({role:"assistant",content:streamedText}); history=history.slice(-20); localStorage.setItem("lumi-history",JSON.stringify(history)); }
  } catch (error) {
    $("#typing")?.remove();
    if (error.name !== "AbortError") { addMessage("assistant", `刚才的连接有点不稳定：${error.message}。再试一次好吗？`, false); setEmotion("caring"); speaking(false); setVoiceState("idle","连接不稳定，请点击麦克风重试"); }
  } finally { if(activeReplyController===controller)activeReplyController=null; sendButton.disabled=false; if(!form.hidden)input.focus(); }
}
async function submit(text) { const message = text.trim(); if (!message || sendButton.disabled) return; stopSpeech(); input.value=""; resize(); addMessage("user", message); await reply(message); }
form.addEventListener("submit", e => { e.preventDefault(); submit(input.value); });
input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); form.requestSubmit(); } });
function resize(){ input.style.height="auto"; input.style.height=`${Math.min(input.scrollHeight,110)}px`; } input.addEventListener("input",resize);
$("#clearButton").addEventListener("click",()=>{ stopSpeech();history=[];localStorage.removeItem("lumi-history");messages.querySelectorAll(".message").forEach((m,i)=>i&&m.remove());setEmotion("happy");setVoiceState("idle","对话已经清空，可以重新开始");});
captionButton.addEventListener("click",()=>{ const visible=!document.body.classList.contains("show-captions");document.body.classList.toggle("show-captions",visible);captionButton.setAttribute("aria-pressed",String(visible));captionButton.title=visible?"隐藏字幕":"显示字幕";});
window.addEventListener("message",event=>{
  if(event.origin!==location.origin||event.source!==digitalHumanFrame?.contentWindow)return;
  if(event.data?.type==="dh-live-ready"){portrait.classList.add("dh-live-ready");statusText.textContent="真人数字人已就绪";}
  if(event.data?.type==="dh-live-audio-accepted") portrait.dataset.dhAudioBytes=String(event.data.bytes||0);
  if(event.data?.type==="wav2lip-ended"||event.data?.type==="wav2lip-error") pendingWav2LipPlaybacks.get(event.data.requestId)?.();
  if(event.data?.type==="dh-live-action-ready"||event.data?.type==="dh-live-action-error"){
    pendingActions.get(event.data.requestId)?.(); pendingActions.delete(event.data.requestId);
    if(event.data?.type==="dh-live-action-ready") portrait.dataset.dhAction=event.data.action;
  }
});


const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) { const recognition = new Recognition(); recognition.lang="zh-CN"; recognition.interimResults=true; recognition.continuous=false; let recognizedText="", recognitionFailed=false;
  recognition.onstart=()=>{stopSpeech();recognizedText="";recognitionFailed=false;micButton.classList.add("listening");setVoiceState("listening","请自然说话，说完后我会自动回答");setEmotion("curious");statusText.textContent="我在听…"};
  recognition.onresult=e=>{recognizedText=Array.from(e.results).map(r=>r[0].transcript).join("").trim();liveTranscript.textContent=recognizedText||"我在听…"};
  recognition.onend=()=>{micButton.classList.remove("listening");voiceButton.classList.remove("listening");statusText.textContent="在线 · 随时听你说";if(recognizedText&&!recognitionFailed)submit(recognizedText);else if(!recognitionFailed)setVoiceState("idle","没有听清楚，请再试一次")};
  recognition.onerror=e=>{recognitionFailed=true;micButton.classList.remove("listening");voiceButton.classList.remove("listening");const denied=e.error==="not-allowed"||e.error==="service-not-allowed";setVoiceState("idle",denied?"请允许浏览器使用麦克风后重试":"没有听清楚，请再试一次")};
  const startListening=()=>{try{recognition.start()}catch{setVoiceState("idle","麦克风正在启动，请稍候")}}; micButton.onclick=startListening; voiceButton.onclick=startListening;
} else { micButton.disabled=true;voiceButton.disabled=true;voicePrompt.textContent="当前浏览器不支持语音识别";liveTranscript.textContent="请使用最新版 Chrome 或 Edge"; }

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const pupils = $(".pupils");
  const wander = () => { if (!portrait.classList.contains("speaking")) { const x=(Math.random()-.5)*8, y=(Math.random()-.5)*4; pupils.style.transform=`translate(${x}px,${y}px)`; } setTimeout(wander,1800+Math.random()*2600); };
  setTimeout(wander,1200);
}

async function boot(){ history.forEach(item=>addMessage(item.role,item.content,false)); const health=await fetch("/api/health").then(r=>r.json()).catch(()=>({mode:"demo"})); mode=health.mode; modeBanner.textContent=mode!=="demo"?`${mode === "minimax" ? "MiniMax" : "OpenAI"} 语音对话已连接`:"本地演示模式"; statusText.textContent="在线 · 随时听你说"; setTimeout(()=>modeBanner.style.opacity=".55",2800); }
boot();
