import http from "node:http";
import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { createReadStream, readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatPayload, buildMiniMaxChatPayload, buildMiniMaxReply, buildMiniMaxSpeechPayload, buildResponsiveBackchannel, buildSpeechPayload, companionIdentityReply, companionPresenceReply, completedReplySentenceCount, decodeMiniMaxAudio, demoReply, extractMiniMaxChatText, extractResponseText, inferCompanionState, isRedundantClosingQuestion, normalizePersona, parseCompanionReply, requestedSentenceLimit, sanitizeReplyText, takeCompleteSentences } from "./src/companion.mjs";
import { CompanionMemoryStore } from "./src/memory.mjs";
import { buildVoiceCatalog } from "./src/voices.mjs";
import { DhActionTaskStore, isLoopbackAddress, saveActionVideo } from "./src/dh-action-studio.mjs";
import { Wav2LipRenderStore } from "./src/wav2lip-render.mjs";
import { DINetRenderStore } from "./src/dinet-render.mjs";
import { DINetStreamSessionStore, encodePcm16Wav } from "./src/dinet-stream.mjs";
import { normalizeMiniMaxTtsEmotion, prepareMiniMaxTtsConnection, streamMiniMaxPcm } from "./src/minimax-stream-tts.mjs";
import { BoundedAsyncCache } from "./src/audio-cache.mjs";
import { cacheControlForStaticPath, parseByteRange } from "./src/static-media.mjs";
import { EphemeralPcmStore } from "./src/ephemeral-pcm-store.mjs";
import { VisualTurnGate } from "./src/visual-turn-gate.mjs";
import { BACKCHANNEL_OFFER_MS } from "./src/backchannel-timing.mjs";
import { resolveWaitingActionPreview } from "./src/real-actions.mjs";
import { bindClientAbort } from "./src/client-abort.mjs";

function loadLocalEnv() {
  try {
    const contents = readFileSync(new URL("./.env", import.meta.url), "utf8");
    for (const raw of contents.split(/\r?\n/)) {
      const line = raw.trim(); if (!line || line.startsWith("#")) continue;
      const index = line.indexOf("="); if (index < 1) continue;
      const key = line.slice(0,index).trim(); let value = line.slice(index+1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value=value.slice(1,-1);
      if (process.env[key] === undefined) process.env[key]=value;
    }
  } catch (error) { if (error.code !== "ENOENT") console.warn("读取 .env 失败：", error.message); }
}
loadLocalEnv();

const root = fileURLToPath(new URL("./public", import.meta.url));
const memoryFile = process.env.MEMORY_FILE || fileURLToPath(new URL("./data/companion-memory.json", import.meta.url));
const memoryStore = new CompanionMemoryStore(memoryFile);
const projectRoot = fileURLToPath(new URL(".", import.meta.url));
const actionUploadDir = fileURLToPath(new URL("./data/dh-action-uploads", import.meta.url));
const actionTasks = new DhActionTaskStore({ projectRoot });
const wav2lipRenders = new Wav2LipRenderStore({ projectRoot });
const dinetRenders = new DINetRenderStore({ projectRoot });
const ephemeralPcm=new EphemeralPcmStore();
const visualTurns=new VisualTurnGate();
const speculativeStreams=new Map();
const visualSkipTasks=new Map();
const preparedTtsConnections=new Map();
const CONTINUOUS_FIRST_SEGMENT_MS=400;
const CONTINUOUS_MINIMUM_TAIL_MS=160;
const dinetStreams = new DINetStreamSessionStore({
  renderer:dinetRenders,
  publishAudio:payload=>ephemeralPcm.put(payload.pcm,payload),
  releaseAudio:streamId=>ephemeralPcm.deleteStream(streamId)
});
const port = Number(process.env.PORT || 3000);
const provider = process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : process.env.MINIMAX_API_KEY ? "minimax" : "demo");
const apiKey = provider === "minimax" ? process.env.MINIMAX_API_KEY : process.env.OPENAI_API_KEY;
const textModel = process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna";
const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1";
const ttsVoice = process.env.OPENAI_TTS_VOICE || "nova";
const miniMaxBaseUrl = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/$/, "");
const miniMaxTtsBaseUrl = (process.env.MINIMAX_TTS_BASE_URL || "https://api-bj.minimaxi.com/v1").replace(/\/$/, "");
const miniMaxTextModel = process.env.MINIMAX_TEXT_MODEL || "MiniMax-M3";
const miniMaxTtsModel = process.env.MINIMAX_TTS_MODEL || "speech-2.8-turbo";
const miniMaxTtsVoice = process.env.MINIMAX_TTS_VOICE || "female-tianmei";
const miniMaxTtsWsUrl = process.env.MINIMAX_TTS_WS_URL || "wss://api.minimaxi.com/ws/v1/t2a_v2";
const miniMaxChatWarmup = process.env.MINIMAX_CHAT_WARMUP !== "0";
const voiceCatalog=buildVoiceCatalog({
  provider:apiKey?provider:"demo",
  defaultVoice:provider==="minimax"?miniMaxTtsVoice:ttsVoice,
  customJson:provider==="minimax"?process.env.MINIMAX_TTS_VOICES_JSON:""
});
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".mp4": "video/mp4", ".vrm": "model/gltf-binary", ".gz": "application/gzip" };
const recentChatTraces=[];
const miniMaxSpeechCache=new BoundedAsyncCache(64);
const miniMaxPcmCache=new BoundedAsyncCache(64);
let chatTraceSequence=0;

function skipVisualSentence(turnId,index){
  const key=`${turnId}:${index}`;
  if(visualSkipTasks.has(key))return visualSkipTasks.get(key);
  const task=(async()=>{
    // Clearing and releasing are one ordered operation: a real sentence must
    // never enter the worker before the unseen speculative frame is removed.
    await dinetRenders.closeVisualTurn?.(turnId);
    visualTurns.finish(turnId,index);
    return{id:turnId,index,skipped:true};
  })();
  visualSkipTasks.set(key,task);
  const timer=setTimeout(()=>visualSkipTasks.delete(key),60_000);timer.unref?.();
  return task;
}

function miniMaxPcmCacheKey({text,voice,emotion}){
  return JSON.stringify([miniMaxTtsModel,voice,normalizeMiniMaxTtsEmotion(emotion),String(text||"").trim()]);
}

function prepareTtsConnection({voice,emotion}={}){
  while(preparedTtsConnections.size>=16){
    const [oldestId,oldest]=preparedTtsConnections.entries().next().value;
    preparedTtsConnections.delete(oldestId);clearTimeout(oldest.timer);oldest.connection.close();
  }
  const id=randomUUID(),connection=prepareMiniMaxTtsConnection({apiKey,url:miniMaxTtsWsUrl,primeTask:true,model:miniMaxTtsModel,voice:voiceCatalog.resolve(voice),emotion});
  const timer=setTimeout(()=>{if(preparedTtsConnections.delete(id))connection.close();},15_000);timer.unref?.();
  preparedTtsConnections.set(id,{connection,timer});
  return id;
}

function takeTtsConnection(id){
  const entry=preparedTtsConnections.get(String(id||""));
  if(!entry)return null;
  preparedTtsConnections.delete(String(id));clearTimeout(entry.timer);
  return entry.connection;
}

function discardTtsConnection(id){
  const entry=preparedTtsConnections.get(String(id||""));
  if(!entry)return false;
  preparedTtsConnections.delete(String(id));clearTimeout(entry.timer);entry.connection.close();
  return true;
}

function miniMaxSpeechCacheKey({text,voice,emotion}){
  return JSON.stringify([miniMaxTtsModel,voice,String(emotion||""),String(text||"").trim()]);
}

function collectMiniMaxPcm({text,voice,emotion,signal}={}){
  const chunks=[];
  return streamMiniMaxPcm({
    apiKey,text,model:miniMaxTtsModel,voice,emotion,url:miniMaxTtsWsUrl,signal,
    onAudio:pcm=>chunks.push(Buffer.from(pcm))
  }).then(metrics=>({pcm:Buffer.concat(chunks),metrics}));
}

function prewarmMiniMaxPcm({text,voice,emotion,signal}){
  const resolvedVoice=voiceCatalog.resolve(voice),key=miniMaxPcmCacheKey({text,voice:resolvedVoice,emotion});
  const cached=miniMaxPcmCache.getOrCreate(key,()=>collectMiniMaxPcm({text,voice:resolvedVoice,emotion,signal}));
  void cached.value.then(({pcm})=>miniMaxSpeechCache.set(miniMaxSpeechCacheKey({text,voice:resolvedVoice,emotion}),encodePcm16Wav(pcm))).catch(()=>{});
  return {key,resolvedVoice,...cached};
}

function startChatTrace(endpoint,{ message,history,userId,persona,fastSpeech }){
  const startedMs=performance.now();
  const trace={
    id:`chat-${Date.now()}-${++chatTraceSequence}`,
    startedAt:new Date().toISOString(),endpoint,provider:apiKey?provider:"demo",
    input:{message,userId:String(userId||"").slice(0,24),history,persona,fastSpeech:Boolean(fastSpeech)},
    memories:[],companionState:null,status:"started",timings:{}
  };
  Object.defineProperty(trace,"_startedMs",{value:startedMs});
  recentChatTraces.push(trace);
  if(recentChatTraces.length>20)recentChatTraces.splice(0,recentChatTraces.length-20);
  return trace;
}

function finishChatTrace(trace,result,source){
  trace.finishedAt=new Date().toISOString();trace.status="done";trace.source=source;trace.final=result;
  trace.timings.totalMs=Math.round(performance.now()-trace._startedMs);
}

function prepareAvatarAction(action,trace){
  const prepareStartedAt=performance.now();
  void dinetRenders.prepareAction(action).then(result=>{
    trace.timings.assetPrepareMs=Math.round(performance.now()-prepareStartedAt);
    trace.assetPreparation={action,changed:Boolean(result.changed),loadMs:Number(result.loadMs)||0};
  }).catch(error=>{trace.assetPreparation={action,error:error.message};});
}

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function body(req, limit = 64_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("请求内容过大"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("JSON 格式无效"), { status: 400 }); }
}

async function binaryBody(req, limit = 4_000_000) {
  const chunks=[]; let size=0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("音频文件过大"), { status:413 });
    chunks.push(chunk);
  }
  if (!size) throw Object.assign(new Error("音频内容不能为空"), { status:400 });
  return Buffer.concat(chunks);
}

async function openAIChat(message, history, userId, persona, memories, companionState) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildChatPayload({ model:textModel, message, history, userId:userId || "anonymous", persona, memories, companionState }))
  });
  if (!response.ok) throw new Error(`OpenAI 文案接口失败 (${response.status})`);
  return parseCompanionReply(extractResponseText(await response.json()));
}

async function miniMaxChat(message, history, persona, memories, companionState, trace) {
  const requestPayload=buildMiniMaxChatPayload({ model:miniMaxTextModel, message, history, persona, memories, companionState });
  trace.providerRequest={url:`${miniMaxBaseUrl}/chat/completions`,payload:requestPayload};
  const response = await fetch(`${miniMaxBaseUrl}/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${apiKey}`, "content-type":"application/json" },
    body:JSON.stringify(requestPayload)
  });
  trace.timings.upstreamConnectedMs=Math.round(performance.now()-trace._startedMs);
  const payload = await response.json().catch(() => ({}));
  trace.providerResponse=payload;
  if (!response.ok || payload?.base_resp?.status_code > 0) throw new Error(payload?.base_resp?.status_msg || `MiniMax 文案接口失败 (${response.status})`);
  trace.rawModelText=extractMiniMaxChatText(payload);
  return buildMiniMaxReply(trace.rawModelText, message, companionState,history);
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function warmupMiniMaxChat() {
  if (provider !== "minimax" || !apiKey || !miniMaxChatWarmup) return;
  const payload=buildMiniMaxChatPayload({model:miniMaxTextModel,message:"你好",stream:true});
  payload.max_completion_tokens=16;
  payload.temperature=0.1;
  const response = await fetch(`${miniMaxBaseUrl}/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${apiKey}`, "content-type":"application/json" },
    body:JSON.stringify(payload),
    signal:AbortSignal.timeout(8_000)
  });
  if (!response.ok || !response.body) throw new Error(`MiniMax 文案预热失败 (${response.status})`);
  const reader=response.body.getReader();
  await reader.read();
  await reader.cancel();
}

async function miniMaxChatStream(message, history, persona, memories, companionState, userId, res, fastSpeech = false, responsiveSpeech = false, prewarmPcm = false, voice = "", trace) {
  const client=bindClientAbort(res);
  let backchannelTimer=null;
  const initialState=inferCompanionState(message,"",companionState);
  const waitingPreview=fastSpeech?resolveWaitingActionPreview(initialState.action):null;
  if(fastSpeech)prepareAvatarAction(initialState.action,trace);
  let ttsConnectionId="";
  client.signal.addEventListener("abort",()=>{
    if(backchannelTimer)clearTimeout(backchannelTimer);
    discardTtsConnection(ttsConnectionId);
    trace.status="cancelled";trace.finishedAt=new Date().toISOString();trace.timings.cancelledMs=Math.round(performance.now()-trace._startedMs);
  },{once:true});
  const requestPayload=buildMiniMaxChatPayload({ model:miniMaxTextModel, message, history, stream:true, persona, memories, companionState });
  trace.providerRequest={url:`${miniMaxBaseUrl}/chat/completions`,payload:requestPayload};
  res.writeHead(200, {
    "content-type":"text/event-stream; charset=utf-8",
    "cache-control":"no-cache, no-transform",
    connection:"keep-alive",
    "x-accel-buffering":"no"
  });
  res.flushHeaders?.();
  sendEvent(res, "meta", { ...initialState, mode:"minimax", ...(waitingPreview?{waitingPreview}:{}) });
  let firstSentenceEmitted=false,backchannel=responsiveSpeech?buildResponsiveBackchannel(message,initialState):null,backchannelWarmup=null;
  if(backchannel&&prewarmPcm){
    const pcmWarmup=prewarmMiniMaxPcm({text:backchannel.text,voice,emotion:backchannel.emotion,signal:client.signal});
    trace.backchannelPcm={voice:pcmWarmup.resolvedVoice,cacheHit:pcmWarmup.hit,status:"preparing"};
    backchannelWarmup=pcmWarmup.value.then(result=>{
      trace.backchannelPcm={...trace.backchannelPcm,status:"ready",audioMs:result.metrics.audioMs,readyMs:Math.round(performance.now()-trace._startedMs)};
      return result;
    }).catch(error=>{trace.backchannelPcm={...trace.backchannelPcm,status:client.signal.aborted?"cancelled":"failed",...(client.signal.aborted?{}:{error:error.message})};return null;});
  }
  backchannelTimer=responsiveSpeech?setTimeout(()=>{
    if(firstSentenceEmitted||res.writableEnded||client.signal.aborted)return;
    if(!backchannel)return;
    // Do not wait for the PCM warmup here. The avatar's speculative request
    // reads the same in-flight cache promise, so sending the semantic cue now
    // overlaps the remaining TTS work with request setup and action planning.
    // Waiting used to move a nominal 500 ms offer to 1 s or later on a slow
    // TTS first packet, defeating early preparation without avoiding any work.
    trace.timings.backchannelMs=Math.round(performance.now()-trace._startedMs);
    trace.backchannel=backchannel;
    sendEvent(res,"backchannel",backchannel);
  },BACKCHANNEL_OFFER_MS):null;
  const response = await fetch(`${miniMaxBaseUrl}/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${apiKey}`, "content-type":"application/json" },
    body:JSON.stringify(requestPayload),
    signal:client.signal
  });
  trace.timings.upstreamConnectedMs=Math.round(performance.now()-trace._startedMs);
  if (!response.ok || !response.body) throw new Error(`MiniMax 流式文案接口失败 (${response.status})`);
  if(fastSpeech&&!client.signal.aborted){
    ttsConnectionId=prepareTtsConnection({voice,emotion:initialState.emotion});
    trace.timings.ttsTaskPrepareMs=Math.round(performance.now()-trace._startedMs);
    sendEvent(res,"speech-ready",{ttsConnectionId});
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let upstream = "", rawText = "", observedCleanLength = 0, sentenceBuffer = "";
  let reasoningCharacters=0,finishReason=null,streamUsage=null,replyBudgetReached=false;
  const sentenceLimit=requestedSentenceLimit(message);
  trace.emittedSentences=[];

  const emitAvailable = (flush = false) => {
    const clean = sanitizeReplyText(rawText);
    if (clean.length < observedCleanLength) {
      observedCleanLength = 0;
      sentenceBuffer = "";
    }
    sentenceBuffer += clean.slice(observedCleanLength);
    observedCleanLength = clean.length;
    const includeClauses=fastSpeech&&!trace.emittedSentences.length;
    const { sentences, remainder } = takeCompleteSentences(sentenceBuffer,flush,includeClauses,9);
    for (const sentence of sentences) {
      if(sentenceLimit&&completedReplySentenceCount(trace.emittedSentences.join(""))>=sentenceLimit){replyBudgetReached=true;break;}
      const sentenceResult=buildMiniMaxReply(sentence,message,companionState,history);
      const safeSentence=sentenceResult.reply;
      if(isRedundantClosingQuestion(message,safeSentence,trace.emittedSentences.length>0))continue;
      if(trace.emittedSentences.at(-1)===safeSentence&&safeSentence!==sentence)continue;
      firstSentenceEmitted=true;if(backchannelTimer)clearTimeout(backchannelTimer);
      trace.timings.firstSentenceMs??=Math.round(performance.now()-trace._startedMs);
      trace.emittedSentences.push(safeSentence);
      if(!client.signal.aborted)sendEvent(res,"sentence",{text:safeSentence,emotion:sentenceResult.emotion,action:sentenceResult.action});
      if(sentenceLimit&&completedReplySentenceCount(trace.emittedSentences.join(""))>=sentenceLimit){replyBudgetReached=true;trace.timings.localLengthReachedMs=Math.round(performance.now()-trace._startedMs);break;}
    }
    sentenceBuffer = remainder;
  };

  while (true) {
    const { value, done } = await reader.read();
    upstream += decoder.decode(value || new Uint8Array(), { stream:!done });
    const lines = upstream.split(/\r?\n/);
    upstream = lines.pop() || "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const chunk = JSON.parse(data);
        const choice=chunk?.choices?.[0];
        const delta = choice?.delta?.content;
        const reasoning=choice?.delta?.reasoning_content;
        if(typeof reasoning==="string")reasoningCharacters+=reasoning.length;
        if(choice?.finish_reason)finishReason=choice.finish_reason;
        if(chunk?.usage)streamUsage=chunk.usage;
        if (typeof delta === "string") {
          if(delta&&!trace.timings.firstTextDeltaMs)trace.timings.firstTextDeltaMs=Math.round(performance.now()-trace._startedMs);
          rawText += delta;
          if(!trace.timings.firstCleanTextMs&&sanitizeReplyText(rawText))trace.timings.firstCleanTextMs=Math.round(performance.now()-trace._startedMs);
        }
      } catch {}
    }
    emitAvailable(false);
    if(replyBudgetReached){finishReason="local-length";void reader.cancel().catch(()=>{});break;}
    if (done) break;
  }

  if(!replyBudgetReached)emitAvailable(true);
  if(client.signal.aborted)return;
  trace.rawModelText=rawText;
  trace.providerStream={
    finishReason,
    textCharacters:rawText.length,
    reasoningCharacters,
    ...(streamUsage?{
      promptTokens:Number(streamUsage.prompt_tokens)||0,
      completionTokens:Number(streamUsage.completion_tokens)||0,
      reasoningTokens:Number(streamUsage.completion_tokens_details?.reasoning_tokens)||0
    }:{})
  };
  const streamedReply=trace.emittedSentences.join("");
  const result = buildMiniMaxReply(streamedReply||rawText,message,companionState,history);
  if(backchannelTimer)clearTimeout(backchannelTimer);
  finishChatTrace(trace,result,"minimax-stream");
  sendEvent(res, "done", { ...result, mode:"minimax" });
  client.complete();
  res.end();
  void memoryStore.remember(userId,message);
  void memoryStore.updateCompanionState(userId,result.emotion);
}

async function chat(req, res) {
  const data = await body(req);
  const message = String(data.message || "").trim();
  if (!message) return json(res, 400, { error: "请输入聊天内容" });
  if (message.length > 2000) return json(res, 400, { error: "单条消息不能超过 2000 字" });
  const history = Array.isArray(data.history) ? data.history : [];
  const persona = normalizePersona(data.persona);
  const trace=startChatTrace("/api/chat",{message,history,userId:data.userId,persona,fastSpeech:false});
  const [memories,companionState] = await Promise.all([
    memoryStore.recall(data.userId,message),
    memoryStore.getCompanionState(data.userId)
  ]);
  trace.timings.contextMs=Math.round(performance.now()-trace._startedMs);
  trace.memories=memories;trace.companionState=companionState;
  const groundedResult=companionIdentityReply(message,persona) || companionPresenceReply(message,persona);
  const result = groundedResult
    || (provider === "minimax" && apiKey ? await miniMaxChat(message,history,persona,memories,companionState,trace)
    : provider === "openai" && apiKey ? await openAIChat(message,history,data.userId,persona,memories,companionState)
    : demoReply(message,persona));
  finishChatTrace(trace,result,groundedResult?"grounded":apiKey?provider:"demo");
  json(res, 200, { ...result, mode:apiKey ? provider : "demo" });
  void memoryStore.remember(data.userId,message);
  void memoryStore.updateCompanionState(data.userId,result.emotion);
}

async function chatStream(req, res) {
  const data = await body(req);
  const message = String(data.message || "").trim();
  if (!message) return json(res, 400, { error:"请输入聊天内容" });
  if (message.length > 2000) return json(res, 400, { error:"单条消息不能超过 2000 字" });
  const history = Array.isArray(data.history) ? data.history : [];
  const persona = normalizePersona(data.persona);
  const trace=startChatTrace("/api/chat/stream",{message,history,userId:data.userId,persona,fastSpeech:data.fastSpeech});
  const [memories,companionState] = await Promise.all([
    memoryStore.recall(data.userId,message),
    memoryStore.getCompanionState(data.userId)
  ]);
  trace.timings.contextMs=Math.round(performance.now()-trace._startedMs);
  trace.memories=memories;trace.companionState=companionState;
  const groundedResult = companionIdentityReply(message,persona) || companionPresenceReply(message,persona);
  if(groundedResult){
    if(data.fastSpeech)prepareAvatarAction(groundedResult.action,trace);
    res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8", "cache-control":"no-cache, no-transform" });
    sendEvent(res,"meta",{emotion:groundedResult.emotion,action:groundedResult.action,mode:apiKey?provider:"demo"});
    sendEvent(res,"sentence",{text:groundedResult.reply});
    sendEvent(res,"done",{...groundedResult,mode:apiKey?provider:"demo"});
    res.end();
    finishChatTrace(trace,groundedResult,"grounded");
    void memoryStore.updateCompanionState(data.userId,groundedResult.emotion);
    return;
  }
  if (provider === "minimax" && apiKey) return miniMaxChatStream(message, history, persona, memories, companionState, data.userId, res, Boolean(data.fastSpeech),Boolean(data.responsiveSpeech),Boolean(data.prewarmPcm),String(data.voice||""),trace);
  const result = provider === "openai" && apiKey
    ? await openAIChat(message, history, data.userId, persona, memories,companionState)
    : demoReply(message, persona);
  if(data.fastSpeech)prepareAvatarAction(result.action,trace);
  res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8", "cache-control":"no-cache, no-transform" });
  sendEvent(res, "meta", { emotion:result.emotion, action:result.action, mode:apiKey ? provider : "demo" });
  for (const sentence of takeCompleteSentences(result.reply, true, Boolean(data.fastSpeech)).sentences) sendEvent(res, "sentence", { text:sentence });
  sendEvent(res, "done", { ...result, mode:apiKey ? provider : "demo" });
  res.end();
  finishChatTrace(trace,result,apiKey?provider:"demo");
  void memoryStore.remember(data.userId,message);
  void memoryStore.updateCompanionState(data.userId,result.emotion);
}

async function speech(req, res) {
  if (!apiKey) return json(res, 503, { error: "演示模式使用浏览器本地语音", code: "DEMO_MODE" });
  const data = await body(req);
  const input = String(data.text || "").trim().slice(0, 1800);
  if (!input) return json(res, 400, { error: "语音内容不能为空" });
  if (provider === "minimax") {
    const selectedVoice=voiceCatalog.resolve(data.voice);
    const cacheKey=miniMaxSpeechCacheKey({text:input,voice:selectedVoice,emotion:data.emotion});
    const cached=miniMaxSpeechCache.getOrCreate(cacheKey,async()=>{
      const response = await fetch(`${miniMaxTtsBaseUrl}/t2a_v2`, {
        method:"POST",
        headers:{ authorization:`Bearer ${apiKey}`, "content-type":"application/json" },
        body:JSON.stringify(buildMiniMaxSpeechPayload({ model:miniMaxTtsModel, voice:selectedVoice, text:input, emotion:data.emotion }))
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.base_resp?.status_msg || `MiniMax 语音接口失败 (${response.status})`);
      return decodeMiniMaxAudio(payload);
    });
    const audio = await cached.value;
    res.writeHead(200, { "content-type":"audio/wav", "content-length":audio.length, "cache-control":"no-store", "x-speech-cache":cached.hit?"hit":"miss" });
    return res.end(audio);
  }
  const selectedVoice=voiceCatalog.resolve(data.voice);
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildSpeechPayload({ model:ttsModel, voice:selectedVoice, text:input }))
  });
  if (!response.ok) throw new Error(`OpenAI 语音接口失败 (${response.status})`);
  res.writeHead(200, { "content-type": "audio/mpeg", "cache-control": "no-store" });
  res.end(Buffer.from(await response.arrayBuffer()));
}

async function staticFile(req, res) {
  const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  const relative = urlPath === "/" ? "index.html" : normalize(urlPath).replace(/^[/\\]+/, "");
  const path = join(root, relative);
  if (!path.startsWith(root)) return json(res, 403, { error: "禁止访问" });
  try {
    const metadata = await stat(path);
    if (!metadata.isFile()) throw Object.assign(new Error("不是文件"), { code:"ENOENT" });
    const extension=extname(path);
    const headers = {
      "content-type": mime[extension] || "application/octet-stream",
      "cache-control": cacheControlForStaticPath(urlPath, extension),
      "content-length": metadata.size
    };
    if (extension === ".mp4") headers["accept-ranges"] = "bytes";

    let range = null;
    if (extension === ".mp4" && req.headers.range) {
      try { range = parseByteRange(req.headers.range, metadata.size); }
      catch (error) {
        if (error.code !== "INVALID_RANGE") throw error;
        res.writeHead(416, { ...headers, "content-length":0, "content-range":`bytes */${metadata.size}` });
        return res.end();
      }
    }
    if (range) {
      headers["content-length"] = range.length;
      headers["content-range"] = `bytes ${range.start}-${range.end}/${metadata.size}`;
    }
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") return res.end();

    const stream = createReadStream(path, range ? { start:range.start, end:range.end } : undefined);
    stream.on("error", error => {
      console.error(`静态文件读取失败：${error.message}`);
      if (!res.destroyed) res.destroy(error);
    });
    stream.pipe(res);
  } catch { json(res, 404, { error: "页面不存在" }); }
}

export const server = http.createServer(async (req, res) => {
  try {
    const requestUrl = new URL(req.url, "http://localhost");
    const pathname = requestUrl.pathname;
    if (pathname.startsWith("/api/dh-actions/")) {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"真人动作制作接口仅允许本机访问" });
      if (req.method === "POST" && pathname === "/api/dh-actions/uploads") {
        const upload = await saveActionVideo(req, { uploadDir:actionUploadDir, filename:requestUrl.searchParams.get("filename") || "action.mp4" });
        return json(res, 201, actionTasks.addUpload(upload));
      }
      if (req.method === "POST" && pathname === "/api/dh-actions/tasks") {
        const data = await body(req);
        return json(res, 202, actionTasks.createTask(data.uploadId, data));
      }
      const taskMatch = pathname.match(/^\/api\/dh-actions\/tasks\/([0-9a-f-]+)$/i);
      if (req.method === "GET" && taskMatch) {
        const task = actionTasks.getTask(taskMatch[1]);
        return task ? json(res, 200, task) : json(res, 404, { error:"找不到这个动作任务" });
      }
      return json(res, 404, { error:"动作制作接口不存在" });
    }
    if (pathname === "/api/wav2lip/status" && req.method === "GET") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"本地神经口型接口仅允许本机访问" });
      return json(res, 200, await wav2lipRenders.readiness());
    }
    if (pathname === "/api/wav2lip/render" && req.method === "POST") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"本地神经口型接口仅允许本机访问" });
      const result = await wav2lipRenders.render(await binaryBody(req));
      return json(res, 200, result);
    }
    if (pathname === "/api/dinet/status" && req.method === "GET") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"本地 DINet 口型接口仅允许本机访问" });
      return json(res, 200, {...await dinetRenders.readiness(),cache:await dinetRenders.cacheStatus(),pcm:ephemeralPcm.snapshot()});
    }
    const pcmMatch=pathname.match(/^\/api\/dinet\/pcm\/([a-f0-9]{32})$/);
    if(pcmMatch&&req.method==="GET"){
      if(!isLoopbackAddress(req.socket.remoteAddress))return json(res,403,{error:"本地 PCM 分片仅允许本机访问"});
      const entry=ephemeralPcm.get(pcmMatch[1]);if(!entry)return json(res,404,{error:"PCM 分片已过期"});
      res.writeHead(200,{"content-type":"application/octet-stream","content-length":entry.pcm.length,"cache-control":"no-store","x-pcm-sample-rate":entry.sampleRate,"x-pcm-channels":entry.channels,"x-pcm-sequence":entry.sequence});
      return res.end(entry.pcm);
    }
    if(pathname==="/api/dinet/prepare-action"&&req.method==="POST"){
      if(!isLoopbackAddress(req.socket.remoteAddress))return json(res,403,{error:"本地 DINet 动作预热仅允许本机访问"});
      const data=await body(req);
      const action=String(data.action||"idle"),prepared=await dinetRenders.prepareAction(action);
      return json(res,200,{...prepared,preview:resolveWaitingActionPreview(action)});
    }
    if (pathname === "/api/dinet/render" && req.method === "POST") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"本地 DINet 口型接口仅允许本机访问" });
      const result = await dinetRenders.render(await binaryBody(req),requestUrl.searchParams.get("action")||"idle");
      return json(res, 200, result);
    }
    if (pathname === "/api/dinet/speech-stream" && req.method === "POST") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"本地流式人物接口仅允许本机访问" });
      if(provider!=="minimax"||!apiKey)return json(res,503,{error:"流式人物当前需要 MiniMax 语音服务"});
      const data=await body(req),text=String(data.text||"").trim().slice(0,1800);
      if(!text)return json(res,400,{error:"语音内容不能为空"});
      const visualTurnId=/^[0-9a-f-]{8,64}$/i.test(String(data.visualTurnId||""))?String(data.visualTurnId):"";
      const visualSentenceIndex=Number(data.visualSentenceIndex);
      const orderedSentence=visualTurnId&&Number.isSafeInteger(visualSentenceIndex)&&visualSentenceIndex>=0;
      const controller=new AbortController();let closed=false;
      const pipelineStartedAt=performance.now();let firstAudioAt=null,firstSegmentAt=null;
      res.on("close",()=>{if(!closed)controller.abort();});
      res.writeHead(200,{"content-type":"text/event-stream; charset=utf-8","cache-control":"no-cache, no-transform","x-accel-buffering":"no"});
      const continuousVideo=data.externalAudio===true&&data.fragmentedVideo===true;
      const session=dinetStreams.start({action:String(data.action||"idle"),frameOffset:Number(data.frameOffset||0),videoOnly:data.externalAudio===true,binaryAudio:data.binaryAudio===true,fragmentedVideo:data.fragmentedVideo===true,renderBackpressure:data.renderBackpressure===true,visualTurnId:orderedSentence?visualTurnId:"",visualSentenceIndex:orderedSentence?visualSentenceIndex:0,...(continuousVideo?{firstSegmentMs:CONTINUOUS_FIRST_SEGMENT_MS,minimumTailMs:CONTINUOUS_MINIMUM_TAIL_MS}:{})});
      sendEvent(res,"started",session);
      const speculative=data.speculative===true;
      const speculativeState=speculative?{committed:false,waiters:new Set()}:null;
      if(speculativeState)speculativeStreams.set(session.id,speculativeState);
      let chunkSequence=0,renderChain=Promise.resolve(),firstSegmentSent=false,visualSlotPromise=null;
      const emitSegments=async(final=false)=>{
        if(speculativeState&&firstSegmentSent&&!speculativeState.committed)await new Promise((resolve,reject)=>{
          const wake=()=>{cleanup();resolve();},abort=()=>{cleanup();reject(Object.assign(new Error("cancelled"),{name:"AbortError"}));};
          const cleanup=()=>{speculativeState.waiters.delete(wake);controller.signal.removeEventListener("abort",abort);};
          speculativeState.waiters.add(wake);controller.signal.addEventListener("abort",abort,{once:true});
        });
        if(orderedSentence)await(visualSlotPromise||=visualTurns.wait(visualTurnId,visualSentenceIndex,{signal:controller.signal}));
        const segments=await dinetStreams.drain(session.id,{final,signal:controller.signal,onSegment:segment=>{
          firstSegmentAt??=performance.now();
          firstSegmentSent=true;sendEvent(res,"segment",segment);
        },maxSegments:speculativeState&&!speculativeState.committed?1:Infinity});
        return segments.length;
      };
      try{
        const resolvedVoice=voiceCatalog.resolve(data.voice),pcmKey=miniMaxPcmCacheKey({text,voice:resolvedVoice,emotion:data.emotion});
        const prewarmed=data.preferPrewarmed===true?miniMaxPcmCache.get(pcmKey):null;
        let ttsCacheHit=false,ttsMetrics,cachedPcm=null;
        const appendPcm=pcm=>{
            firstAudioAt??=performance.now();
            dinetStreams.append(session.id,chunkSequence++,pcm);
            renderChain=renderChain.then(()=>emitSegments(false));
        };
        if(prewarmed)cachedPcm=await prewarmed.catch(()=>null);
        if(cachedPcm){
          const cached=cachedPcm;ttsCacheHit=true;
          if(controller.signal.aborted)throw Object.assign(new Error("cancelled"),{name:"AbortError"});
          sendEvent(res,"audio-ready",{audioMs:cached.metrics.audioMs});
          appendPcm(cached.pcm);ttsMetrics={...cached.metrics,firstAudioMs:0,totalMs:0,cached:true};
        }else{
          const preparedConnection=takeTtsConnection(data.ttsConnectionId);
          try{
            ttsMetrics=await streamMiniMaxPcm({
              apiKey,text,model:miniMaxTtsModel,voice:resolvedVoice,emotion:data.emotion,
              url:miniMaxTtsWsUrl,signal:controller.signal,connection:preparedConnection,
              onAudio:appendPcm
            });
          }catch(error){
            if(!preparedConnection||chunkSequence||controller.signal.aborted)throw error;
            ttsMetrics=await streamMiniMaxPcm({
              apiKey,text,model:miniMaxTtsModel,voice:resolvedVoice,emotion:data.emotion,
              url:miniMaxTtsWsUrl,signal:controller.signal,onAudio:appendPcm
            });
            ttsMetrics.connectionFallback=true;
          }
          if(data.preferPrewarmed===true&&chunkSequence){
            // A prewarm miss can happen after cache eviction. Do not retain user
            // answer audio; only explicitly marked backchannels are eligible.
            ttsCacheHit=false;
          }
          sendEvent(res,"audio-ready",{audioMs:ttsMetrics.audioMs});
        }
        await renderChain;
        await emitSegments(true);
        const completed=dinetStreams.complete(session.id);
        sendEvent(res,"done",{...completed,tts:{...ttsMetrics,cacheHit:ttsCacheHit},firstSegmentSent,pipeline:{
          ttsFirstAudioMs:firstAudioAt?Math.round(firstAudioAt-pipelineStartedAt):null,
          firstSegmentMs:firstSegmentAt?Math.round(firstSegmentAt-pipelineStartedAt):null,
          totalMs:Math.round(performance.now()-pipelineStartedAt)
        }});
        closed=true;res.end();
      }catch(error){
        dinetStreams.cancel(session.id);if(!controller.signal.aborted)sendEvent(res,"error",{error:error.message||"流式人物生成失败"});closed=true;res.end();
      }finally{
        if(orderedSentence){
          if(speculativeState&&!speculativeState.committed)await skipVisualSentence(visualTurnId,visualSentenceIndex);
          else visualTurns.finish(visualTurnId,visualSentenceIndex);
        }
        speculativeStreams.delete(session.id);
      }
      return;
    }
    const visualTurnMatch=pathname.match(/^\/api\/dinet\/visual-turn\/([0-9a-f-]{8,64})\/(finish|skip)$/i);
    if(visualTurnMatch&&req.method==="POST"){
      if(!isLoopbackAddress(req.socket.remoteAddress))return json(res,403,{error:"本地人物轮次接口仅允许本机访问"});
      const[,turnId,command]=visualTurnMatch;
      if(command==="skip"){
        const data=await body(req),index=Number(data.index);
        if(!Number.isSafeInteger(index)||index<0)return json(res,400,{error:"视觉句序号无效"});
        return json(res,200,await skipVisualSentence(turnId,index));
      }
      visualTurns.close(turnId);
      for(const key of visualSkipTasks.keys())if(key.startsWith(`${turnId}:`))visualSkipTasks.delete(key);
      await dinetRenders.closeVisualTurn?.(turnId);
      return json(res,200,{id:turnId,closed:true});
    }
    if (pathname === "/api/dinet/stream/start" && req.method === "POST") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"本地 DINet 流式接口仅允许本机访问" });
      return json(res, 201, dinetStreams.start(await body(req)));
    }
    const dinetStreamMatch = pathname.match(/^\/api\/dinet\/stream\/([0-9a-f-]+)\/(audio-chunk|finish|cancel|ack|commit)$/i);
    if (dinetStreamMatch && req.method === "POST") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res, 403, { error:"本地 DINet 流式接口仅允许本机访问" });
      const [, sessionId, command] = dinetStreamMatch;
      if(command==="commit"){
        const state=speculativeStreams.get(sessionId);if(!state)return json(res,404,{id:sessionId,committed:false});
        state.committed=true;for(const wake of state.waiters)wake();state.waiters.clear();return json(res,200,{id:sessionId,committed:true});
      }
      if (command === "audio-chunk") {
        const sequence = Number(req.headers["x-chunk-sequence"]);
        return json(res, 202, dinetStreams.append(sessionId, sequence, await binaryBody(req, 512_000)));
      }
      if(command==="ack"){const data=await body(req);return json(res,200,dinetStreams.acknowledge(sessionId,data.sequence));}
      if (command === "finish") return json(res, 200, await dinetStreams.finish(sessionId));
      const speculativeState=speculativeStreams.get(sessionId);if(speculativeState){for(const wake of speculativeState.waiters)wake();speculativeState.waiters.clear();speculativeStreams.delete(sessionId);}
      return json(res, 200, dinetStreams.cancel(sessionId));
    }
    if (req.method === "GET" && pathname === "/api/health") return json(res, 200, { ok:true, mode:apiKey ? provider : "demo", memory:true, continuity:true, textModel:provider === "minimax" ? miniMaxTextModel : textModel, ttsModel:provider === "minimax" ? miniMaxTtsModel : ttsModel });
    if (req.method === "GET" && pathname === "/api/voices") return json(res,200,{provider:voiceCatalog.provider,defaultKey:voiceCatalog.defaultKey,voices:voiceCatalog.voices});
    if (req.method === "GET" && pathname === "/api/chat/debug/recent") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res,403,{error:"聊天诊断记录仅允许本机访问"});
      return json(res,200,{persisted:false,limit:20,traces:recentChatTraces});
    }
    if (req.method === "POST" && pathname === "/api/chat/memory/clear") {
      if (!isLoopbackAddress(req.socket.remoteAddress)) return json(res,403,{error:"聊天记忆清理仅允许本机访问"});
      const data=await body(req);
      return json(res,200,{ok:true,cleared:await memoryStore.clearUser(data.userId)});
    }
    if (req.method === "POST" && pathname === "/api/chat") return await chat(req, res);
    if (req.method === "POST" && pathname === "/api/chat/stream") return await chatStream(req, res);
    if (req.method === "POST" && pathname === "/api/speech") return await speech(req, res);
    if (req.method === "GET" || req.method === "HEAD") return await staticFile(req, res);
    json(res, 405, { error: "请求方法不支持" });
  } catch (error) {
    if(error.name==="AbortError"&&(req.aborted||res.destroyed||res.writableEnded))return;
    console.error(error.message);
    if (res.headersSent) {
      sendEvent(res, "error", { error:error.message || "服务暂时不可用" });
      return res.end();
    }
    json(res, error.status || 502, { error: error.message || "服务暂时不可用" });
  }
});

if (process.env.NODE_ENV !== "test") {
  void warmupMiniMaxChat().catch(error=>console.warn(`文案连接预热失败，将在首次请求时重试：${error.message}`));
  dinetRenders.warmup()
    .catch(error=>console.warn(`真人口型预热失败，将在首次请求时重试：${error.message}`))
    .finally(()=>server.listen(port, () => console.log(`露米已上线：http://localhost:${port} (${apiKey ? provider : "demo"}模式)`)));
}
