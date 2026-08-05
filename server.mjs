import http from "node:http";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { buildChatPayload, buildMiniMaxChatPayload, buildMiniMaxReply, buildMiniMaxSpeechPayload, buildSpeechPayload, decodeMiniMaxAudio, demoReply, extractMiniMaxChatText, extractResponseText, inferCompanionState, parseCompanionReply, sanitizeReplyText, takeCompleteSentences } from "./src/companion.mjs";

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
const port = Number(process.env.PORT || 3000);
const provider = process.env.AI_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : process.env.MINIMAX_API_KEY ? "minimax" : "demo");
const apiKey = provider === "minimax" ? process.env.MINIMAX_API_KEY : process.env.OPENAI_API_KEY;
const textModel = process.env.OPENAI_TEXT_MODEL || "gpt-5.6-luna";
const ttsModel = process.env.OPENAI_TTS_MODEL || "tts-1";
const ttsVoice = process.env.OPENAI_TTS_VOICE || "nova";
const miniMaxBaseUrl = (process.env.MINIMAX_BASE_URL || "https://api.minimaxi.com/v1").replace(/\/$/, "");
const miniMaxTextModel = process.env.MINIMAX_TEXT_MODEL || "MiniMax-M2.7-highspeed";
const miniMaxTtsModel = process.env.MINIMAX_TTS_MODEL || "speech-2.8-turbo";
const miniMaxTtsVoice = process.env.MINIMAX_TTS_VOICE || "female-tianmei";
const mime = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png", ".wasm": "application/wasm", ".mp4": "video/mp4", ".vrm": "model/gltf-binary", ".gz": "application/gzip" };

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

async function openAIChat(message, history, userId) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildChatPayload({ model:textModel, message, history, userId:userId || "anonymous" }))
  });
  if (!response.ok) throw new Error(`OpenAI 文案接口失败 (${response.status})`);
  return parseCompanionReply(extractResponseText(await response.json()));
}

async function miniMaxChat(message, history) {
  const response = await fetch(`${miniMaxBaseUrl}/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${apiKey}`, "content-type":"application/json" },
    body:JSON.stringify(buildMiniMaxChatPayload({ model:miniMaxTextModel, message, history }))
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.base_resp?.status_code > 0) throw new Error(payload?.base_resp?.status_msg || `MiniMax 文案接口失败 (${response.status})`);
  return buildMiniMaxReply(extractMiniMaxChatText(payload), message);
}

function sendEvent(res, event, data) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

async function miniMaxChatStream(message, history, res) {
  const response = await fetch(`${miniMaxBaseUrl}/chat/completions`, {
    method:"POST",
    headers:{ authorization:`Bearer ${apiKey}`, "content-type":"application/json" },
    body:JSON.stringify(buildMiniMaxChatPayload({ model:miniMaxTextModel, message, history, stream:true }))
  });
  if (!response.ok || !response.body) throw new Error(`MiniMax 流式文案接口失败 (${response.status})`);

  res.writeHead(200, {
    "content-type":"text/event-stream; charset=utf-8",
    "cache-control":"no-cache, no-transform",
    connection:"keep-alive"
  });
  sendEvent(res, "meta", { ...inferCompanionState(message), mode:"minimax" });

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let upstream = "", rawText = "", observedCleanLength = 0, sentenceBuffer = "";

  const emitAvailable = (flush = false) => {
    const clean = sanitizeReplyText(rawText);
    if (clean.length < observedCleanLength) {
      observedCleanLength = 0;
      sentenceBuffer = "";
    }
    sentenceBuffer += clean.slice(observedCleanLength);
    observedCleanLength = clean.length;
    const { sentences, remainder } = takeCompleteSentences(sentenceBuffer, flush);
    for (const sentence of sentences) sendEvent(res, "sentence", { text:sentence });
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
        const delta = chunk?.choices?.[0]?.delta?.content;
        if (typeof delta === "string") rawText += delta;
      } catch {}
    }
    emitAvailable(false);
    if (done) break;
  }

  emitAvailable(true);
  const result = buildMiniMaxReply(rawText, message);
  sendEvent(res, "done", { ...result, mode:"minimax" });
  res.end();
}

async function chat(req, res) {
  const data = await body(req);
  const message = String(data.message || "").trim();
  if (!message) return json(res, 400, { error: "请输入聊天内容" });
  if (message.length > 2000) return json(res, 400, { error: "单条消息不能超过 2000 字" });
  const history = Array.isArray(data.history) ? data.history : [];
  const result = provider === "minimax" && apiKey ? await miniMaxChat(message,history)
    : provider === "openai" && apiKey ? await openAIChat(message,history,data.userId)
    : demoReply(message);
  json(res, 200, { ...result, mode:apiKey ? provider : "demo" });
}

async function chatStream(req, res) {
  const data = await body(req);
  const message = String(data.message || "").trim();
  if (!message) return json(res, 400, { error:"请输入聊天内容" });
  if (message.length > 2000) return json(res, 400, { error:"单条消息不能超过 2000 字" });
  const history = Array.isArray(data.history) ? data.history : [];
  if (provider === "minimax" && apiKey) return miniMaxChatStream(message, history, res);
  const result = provider === "openai" && apiKey
    ? await openAIChat(message, history, data.userId)
    : demoReply(message);
  res.writeHead(200, { "content-type":"text/event-stream; charset=utf-8", "cache-control":"no-cache, no-transform" });
  sendEvent(res, "meta", { emotion:result.emotion, action:result.action, mode:apiKey ? provider : "demo" });
  for (const sentence of takeCompleteSentences(result.reply, true).sentences) sendEvent(res, "sentence", { text:sentence });
  sendEvent(res, "done", { ...result, mode:apiKey ? provider : "demo" });
  res.end();
}

async function speech(req, res) {
  if (!apiKey) return json(res, 503, { error: "演示模式使用浏览器本地语音", code: "DEMO_MODE" });
  const data = await body(req);
  const input = String(data.text || "").trim().slice(0, 1800);
  if (!input) return json(res, 400, { error: "语音内容不能为空" });
  if (provider === "minimax") {
    const response = await fetch(`${miniMaxBaseUrl}/t2a_v2`, {
      method:"POST",
      headers:{ authorization:`Bearer ${apiKey}`, "content-type":"application/json" },
      body:JSON.stringify(buildMiniMaxSpeechPayload({ model:miniMaxTtsModel, voice:miniMaxTtsVoice, text:input, emotion:data.emotion }))
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload?.base_resp?.status_msg || `MiniMax 语音接口失败 (${response.status})`);
    const audio = decodeMiniMaxAudio(payload);
    res.writeHead(200, { "content-type":"audio/wav", "content-length":audio.length, "cache-control":"no-store" });
    return res.end(audio);
  }
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify(buildSpeechPayload({ model:ttsModel, voice:ttsVoice, text:input }))
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
    const file = await readFile(path);
    res.writeHead(200, { "content-type": mime[extname(path)] || "application/octet-stream", "cache-control": "no-cache" });
    res.end(file);
  } catch { json(res, 404, { error: "页面不存在" }); }
}

export const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/health") return json(res, 200, { ok:true, mode:apiKey ? provider : "demo", textModel:provider === "minimax" ? miniMaxTextModel : textModel, ttsModel:provider === "minimax" ? miniMaxTtsModel : ttsModel });
    if (req.method === "POST" && req.url === "/api/chat") return await chat(req, res);
    if (req.method === "POST" && req.url === "/api/chat/stream") return await chatStream(req, res);
    if (req.method === "POST" && req.url === "/api/speech") return await speech(req, res);
    if (req.method === "GET" || req.method === "HEAD") return await staticFile(req, res);
    json(res, 405, { error: "请求方法不支持" });
  } catch (error) {
    console.error(error.message);
    if (res.headersSent) {
      sendEvent(res, "error", { error:error.message || "服务暂时不可用" });
      return res.end();
    }
    json(res, error.status || 502, { error: error.message || "服务暂时不可用" });
  }
});

if (process.env.NODE_ENV !== "test") server.listen(port, () => console.log(`露米已上线：http://localhost:${port} (${apiKey ? provider : "demo"}模式)`));
