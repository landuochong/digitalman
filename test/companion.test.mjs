import test from "node:test";
import assert from "node:assert/strict";
import { buildChatPayload, buildMiniMaxChatPayload, buildMiniMaxReply, buildMiniMaxSpeechPayload, buildSpeechPayload, decodeMiniMaxAudio, demoReply, extractMiniMaxChatText, extractResponseText, inferCompanionState, normalizeAction, normalizeEmotion, parseCompanionReply, sanitizeReplyText, takeCompleteSentences } from "../src/companion.mjs";

test("extracts Responses API output text", () => {
  assert.equal(extractResponseText({ output:[{ type:"message", content:[{ type:"output_text", text:"你好" }] }] }), "你好");
});
test("parses structured companion response", () => {
  assert.deepEqual(parseCompanionReply('{"reply":"我在呢","emotion":"caring","action":"smile"}'), { reply:"我在呢", emotion:"caring", action:"smile" });
  assert.deepEqual(parseCompanionReply("普通文本"), { reply:"普通文本", emotion:"neutral", action:"idle" });
});
test("removes leaked internal state words from spoken replies", () => {
  assert.equal(sanitizeReplyText("我在听。（caring）"), "我在听。");
  assert.equal(sanitizeReplyText("我在听。\nemotion: caring\naction: idle"), "我在听。");
  assert.deepEqual(parseCompanionReply('结果如下：{"reply":"慢慢来，我陪你。（calm）","emotion":"calm","action":"idle"}'), { reply:"慢慢来，我陪你。", emotion:"calm", action:"idle" });
});
test("normalizes unsafe emotion values", () => assert.equal(normalizeEmotion("angry"), "neutral"));
test("normalizes unsupported actions", () => assert.equal(normalizeAction("dance"), "idle"));
test("demo responds empathetically to negative emotion", () => {
  const result = demoReply("我今天很焦虑也很累"); assert.equal(result.emotion, "caring"); assert.equal(result.action, "caring"); assert.match(result.reply, /陪|难受|轻松/);
});
test("demo maps the good-news suggestion to an excited response", () => {
  const result = demoReply("我有个好消息"); assert.equal(result.emotion, "excited"); assert.equal(result.action, "clap"); assert.match(result.reply, /开心|高兴/);
});
test("demo uses the thinking expression for questions", () => assert.equal(demoReply("这个要怎么做？").action, "thinking"));
test("demo escalates self-harm language to immediate real-world support", () => {
  const result = demoReply("我不想活了"); assert.equal(result.emotion, "caring"); assert.match(result.reply, /紧急服务|信任的人/);
});
test("chat payload keeps only the latest ten history messages plus current input", () => {
  const history = Array.from({ length:12 }, (_,i) => ({ role:i%2 ? "assistant" : "user", content:`消息${i}` }));
  const payload = buildChatPayload({ model:"gpt-test", message:"现在", history, userId:"u-1" });
  assert.equal(payload.input.length, 11); assert.equal(payload.input[0].content, "消息2"); assert.equal(payload.input.at(-1).content, "现在");
  assert.equal(payload.model, "gpt-test"); assert.equal(payload.safety_identifier, "u-1");
});
test("speech payload is mp3 and enforces the input limit", () => {
  const payload = buildSpeechPayload({ model:"tts-test", voice:"nova", text:"你".repeat(1900) });
  assert.equal(payload.input.length, 1800); assert.equal(payload.response_format, "mp3"); assert.equal(payload.voice, "nova");
});
test("builds MiniMax chat history with a system persona", () => {
  const payload=buildMiniMaxChatPayload({model:"MiniMax-test",message:"你好",history:[{role:"assistant",content:"在呢（caring）"}]});
  assert.equal(payload.messages[0].role,"system"); assert.equal(payload.messages[1].content,"在呢"); assert.equal(payload.messages.at(-1).content,"你好"); assert.equal(payload.reasoning_split,true); assert.equal(payload.max_completion_tokens,800);
});
test("builds streaming MiniMax payload and segments complete spoken sentences", () => {
  assert.equal(buildMiniMaxChatPayload({model:"m",message:"你好",stream:true}).stream, true);
  assert.deepEqual(takeCompleteSentences("第一句。第二句还没完"), { sentences:["第一句。"], remainder:"第二句还没完" });
  assert.deepEqual(takeCompleteSentences("最后一句", true), { sentences:["最后一句"], remainder:"" });
});
test("MiniMax speaks only the reply while state is inferred locally", () => {
  assert.deepEqual(buildMiniMaxReply("慢慢来，我陪着你。", "我今天很焦虑"), { reply:"慢慢来，我陪着你。", emotion:"caring", action:"caring" });
  assert.deepEqual(buildMiniMaxReply('{"reply":"你好呀","emotion":"neutral","action":"idle"}', "你好"), { reply:"你好呀", emotion:"happy", action:"wave_approval" });
});
test("infers natural daily phrases for VRM gestures", () => {
  assert.deepEqual(inferCompanionState("我饿了"), { emotion:"caring", action:"caring" });
  assert.deepEqual(inferCompanionState("帮我分析一下应该选哪个好"), { emotion:"curious", action:"thinking" });
  assert.deepEqual(inferCompanionState("天啊，不会吧"), { emotion:"excited", action:"surprise" });
  assert.deepEqual(inferCompanionState("哇，真的吗"), { emotion:"excited", action:"surprise" });
  assert.deepEqual(inferCompanionState("晚上好"), { emotion:"happy", action:"wave_approval" });
  assert.deepEqual(inferCompanionState("我终于成功了"), { emotion:"excited", action:"clap" });
});
test("extracts MiniMax chat content and strips thinking before parsing", () => {
  const text=extractMiniMaxChatText({choices:[{message:{content:'<think>分析</think>{"reply":"你好","emotion":"happy"}'}}]});
  assert.deepEqual(parseCompanionReply(text),{reply:"你好",emotion:"happy",action:"idle"});
});
test("builds and decodes MiniMax DH_live-compatible WAV payload", () => {
  const request=buildMiniMaxSpeechPayload({model:"speech-test",voice:"voice-test",text:"好消息",emotion:"excited"});
  assert.equal(request.voice_setting.emotion,"happy"); assert.deepEqual(request.audio_setting,{sample_rate:16000,format:"wav",channel:1});
  assert.deepEqual(decodeMiniMaxAudio({base_resp:{status_code:0},data:{audio:"52494646"}}),Buffer.from("RIFF"));
});
