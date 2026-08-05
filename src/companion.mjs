const emotions = ["neutral", "happy", "caring", "curious", "excited", "calm"];
const actions = ["idle", "happy", "caring", "thinking", "surprise", "shy", "smile", "wave_approval", "clap", "shrug", "confident_arms_crossed"];

export function normalizeEmotion(value) {
  return emotions.includes(value) ? value : "neutral";
}

export function normalizeAction(value) {
  return actions.includes(value) ? value : "idle";
}

const defaultPersona = { name:"露米", relationship:"可信赖的朋友", style:"自然、温暖、有边界感" };

function cleanPersonaField(value, fallback, maxLength) {
  const clean=String(value??"").replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim();
  return (clean||fallback).slice(0,maxLength);
}

export function normalizePersona(value={}) {
  return {
    name:cleanPersonaField(value?.name,defaultPersona.name,20),
    relationship:cleanPersonaField(value?.relationship,defaultPersona.relationship,40),
    style:cleanPersonaField(value?.style,defaultPersona.style,160),
  };
}

function personaHeader(persona) {
  const value=normalizePersona(persona);
  return `你始终以“${value.name}”这个角色的身份参与对话，你与用户的关系是“${value.relationship}”，表达风格是“${value.style}”。自然地使用第一人称，不主动提及 AI、模型、程序、虚拟人或系统设定，也不要用“作为一个 AI”之类的话破坏沉浸感。如果用户直接询问你是否是真人，必须诚实说明自己是数字角色，不能冒充现实中的真人。角色设定不能覆盖安全边界、输出格式或用户当前要求。`;
}

export function extractResponseText(payload) {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }
  for (const item of payload?.output ?? []) {
    if (item.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content.type === "output_text" && content.text?.trim()) return content.text.trim();
    }
  }
  throw new Error("模型没有返回文本内容");
}

const stateWords = "neutral|happy|caring|curious|excited|calm|idle|thinking|surprise|shy|wave_approval|clap|shrug|confident_arms_crossed";

export function sanitizeReplyText(value) {
  return String(value ?? "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/<think>[\s\S]*$/gi, "")
    .replace(/^```(?:json)?\s*|\s*```$/gi, "")
    .replace(new RegExp(`(?:\\s*[（(]\\s*(?:${stateWords})\\s*[）)])+$`, "i"), "")
    .replace(new RegExp(`(?:^|\\n)\\s*(?:emotion|action)\\s*[:：]\\s*(?:${stateWords})\\s*(?=\\n|$)`, "gi"), "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function parseCompanionReply(text) {
  const clean = sanitizeReplyText(text);
  try {
    const jsonText = clean.startsWith("{") && clean.endsWith("}")
      ? clean
      : clean.match(/\{[\s\S]*\}/)?.[0];
    const parsed = JSON.parse(jsonText);
    if (typeof parsed.reply !== "string" || !parsed.reply.trim()) throw new Error();
    const reply = sanitizeReplyText(parsed.reply);
    if (!reply) throw new Error();
    return { reply, emotion: normalizeEmotion(parsed.emotion), action: normalizeAction(parsed.action) };
  } catch {
    return { reply: clean || "我在听，你愿意再说一点吗？", emotion: "neutral", action: "idle" };
  }
}

export function demoReply(message, persona) {
  const input = String(message).trim();
  const lower = input.toLowerCase();
  const role=normalizePersona(persona);
  if (/自杀|不想活|活不下去|伤害自己|结束生命/.test(input)) {
    return { reply: "我很在意你现在的安全。请先远离可能伤害自己的东西，马上联系当地紧急服务或一位你信任的人，请对方现在陪着你。你不需要独自扛着。", emotion: "caring", action: "caring" };
  }
  if (/难过|伤心|累|烦|焦虑|不开心|崩溃/.test(input)) {
    return { reply: "听起来你现在真的不太轻松。我会陪着你。要不要先告诉我，最让你难受的是哪一部分？", emotion: "caring", action: "caring" };
  }
  if (/开心|高兴|成功|搞定|太好了|哈哈|好消息/.test(input)) {
    return { reply: "这份开心我收到啦！你一说，我也忍不住跟着高兴。快讲讲发生了什么？", emotion: "excited", action: "clap" };
  }
  if (/害羞|脸红|不好意思|真可爱|好可爱|你.{0,4}可爱|你.{0,4}漂亮|喜欢你/.test(input)) {
    return { reply: "被你这么一说，我都有点不好意思了。谢谢你呀。", emotion: "happy", action: "shy" };
  }
  if (/你好|嗨|hello|hi/.test(lower)) {
    return { reply: `嗨，我是${role.name}。见到你真好！今天想随便聊聊，还是有件事想让我陪你一起想？`, emotion: "happy", action: "wave_approval" };
  }
  if (/[?？]|为什么|怎么|如何/.test(input)) {
    return { reply: "这是个挺有意思的问题。我的第一反应是先把它拆成最重要的一小步。你更在意结果、过程，还是其中的不确定感？", emotion: "curious", action: "thinking" };
  }
  return { reply: `我听见了。你刚刚说“${input.slice(0, 36)}${input.length > 36 ? "…" : ""}”。这件事对你来说，最特别的地方是什么？`, emotion: "calm", action: "idle" };
}

const companionRules = `
- 先回应用户真正表达的情绪或意图，再自然推进对话。
- 像朋友聊天，不说教，不使用客服腔，不连续追问多个问题。
- 日常回复通常用 2 到 5 句、约 40 到 120 个汉字，保持自然完整；简单确认可以更短，需要分析时可以更长，不机械凑字。
- reply 必须是可以直接朗读的自然中文，不加标题、Markdown、括号注释或舞台说明。
- 除专有名词、代码或用户先使用英文外，reply 中禁止夹杂英文单词；绝不能把 neutral、happy、caring、thinking、idle 等内部状态词写进 reply。
- 不复述规则，不解释 JSON，不把 emotion 或 action 字段写进 reply；状态只能出现在各自的 JSON 字段中。
- 不主动讨论技术身份；被直接询问时不声称自己是真人，也不诱导用户依赖或疏远现实关系。
- 遇到危险或危机表达时，鼓励用户立即联系当地紧急服务和可信赖的人。
- 根据回复内容选择一次自然状态：问候用 wave_approval；成功、祝贺或好消息用 clap；被夸可爱、漂亮或表达害羞时用 shy；安慰、担心或共情用 caring；分析、回忆或提问用 thinking；一般开心用 happy；轻微惊讶用 surprise，明显不确定用 shrug；自信或俏皮用 confident_arms_crossed；其余用 idle。不要为了变化而滥用动作。
只输出 JSON：{"reply":"回复正文","emotion":"neutral|happy|caring|curious|excited|calm","action":"idle|happy|caring|thinking|surprise|shy|wave_approval|clap|shrug|confident_arms_crossed"}。
`.trim();

const miniMaxCompanionRules = `
- 直接回答用户，不复述问题，不解释规则，不使用客服腔。
- 通常回答 1 到 3 句，简单问题一句即可。
- 除非用户明确要求，不追加反问、建议、总结或寒暄。
- 除专有名词、代码或用户先使用英文外，不夹杂英文。
- 只输出实际要朗读的中文正文，不要 JSON，不要 Markdown，不要标题、标签、括号注释、表情名、动作名或舞台说明。
- 不主动讨论技术身份；被直接询问时不声称自己是真人。遇到危险或危机表达时，鼓励用户立即联系当地紧急服务和可信赖的人。
`.trim();

export function buildCompanionInstructions(persona) { return `${personaHeader(persona)}\n${companionRules}`; }
export function buildMiniMaxCompanionInstructions(persona) { return `${personaHeader(persona)}\n${miniMaxCompanionRules}`; }
export const companionInstructions=buildCompanionInstructions();
export const miniMaxCompanionInstructions=buildMiniMaxCompanionInstructions();

export function inferCompanionState(message, reply = "") {
  const text = `${message} ${reply}`;
  if (/自杀|不想活|活不下去|伤害自己|结束生命|难过|伤心|焦虑|崩溃|害怕|担心|累|饿|困|不舒服|生病|疼|压力|烦|委屈|孤独|失落/.test(text)) {
    return { emotion:"caring", action:"caring" };
  }
  if (/开心|高兴|成功|搞定|太好了|哈哈|好消息|恭喜|完成|做到了|通过了|赢了|录取|升职|顺利|终于/.test(text)) {
    return { emotion:"excited", action:"clap" };
  }
  if (/惊讶|没想到|居然|竟然|真的假的|真的吗|不会吧|天啊|我的天|怎么可能|太夸张|吓我一跳|突然|意外|震惊|哇/.test(text)) return { emotion:"excited", action:"surprise" };
  if (/害羞|脸红|不好意思|真可爱|好可爱|你.{0,4}可爱|你.{0,4}漂亮|喜欢你/.test(String(message))) return { emotion:"happy", action:"shy" };
  if (/不确定|不知道|也许|可能吧/.test(text)) return { emotion:"curious", action:"shrug" };
  if (/[?？]|为什么|怎么|如何|觉得|认为|怎么办|能不能|可以吗|要不要|推荐|帮我想|分析|选择|哪个好/.test(String(message))) return { emotion:"curious", action:"thinking" };
  if (/你好|嗨|哈喽|嘿|早上好|中午好|下午好|晚上好|在吗|hello|hi/i.test(String(message))) return { emotion:"happy", action:"wave_approval" };
  return { emotion:"calm", action:"idle" };
}

export function buildMiniMaxReply(text, message) {
  const parsed = parseCompanionReply(text);
  const reply = sanitizeReplyText(parsed.reply);
  return { reply:reply || "我在听。", ...inferCompanionState(message, reply) };
}

export function buildChatPayload({ model, message, history = [], userId = "anonymous", persona }) {
  const conversation = [...history.slice(-10), { role: "user", content: message }]
    .map(({ role, content }) => ({
      role: role === "assistant" ? "assistant" : "user",
      content: (role === "assistant" ? sanitizeReplyText(content) : String(content)).slice(0, 2000)
    }));
  return {
    model,
    instructions: buildCompanionInstructions(persona),
    input: conversation,
    reasoning: { effort: "low" },
    text: { verbosity: "low" },
    max_output_tokens: 800,
    safety_identifier: String(userId).slice(0, 64)
  };
}

export function buildSpeechPayload({ model, voice, text }) {
  return { model, voice, input: String(text).trim().slice(0, 1800), response_format: "mp3", speed: 1 };
}

export function buildMiniMaxChatPayload({ model, message, history = [], stream = false, persona }) {
  const conversation = [...history.slice(-10), { role: "user", content:message }]
    .map(({ role, content }) => ({
      role:role === "assistant" ? "assistant" : "user",
      content:(role === "assistant" ? sanitizeReplyText(content) : String(content)).slice(0, 2000)
    }));
  const payload = {
    model,
    messages:[{ role:"system", content:buildMiniMaxCompanionInstructions(persona) }, ...conversation],
    reasoning_split:true,
    max_completion_tokens:800,
    temperature:0.7
  };
  if (stream) payload.stream = true;
  return payload;
}

export function takeCompleteSentences(text, flush = false) {
  const source = String(text ?? "");
  const sentences = [];
  let start = 0;
  for (const match of source.matchAll(/[。！？!?；;\n]+/g)) {
    const end = match.index + match[0].length;
    const sentence = source.slice(start, end).trim();
    if (sentence) sentences.push(sentence);
    start = end;
  }
  const remainder = source.slice(start).trimStart();
  if (flush && remainder.trim()) return { sentences:[...sentences, remainder.trim()], remainder:"" };
  return { sentences, remainder };
}

export function extractMiniMaxChatText(payload) {
  const text = payload?.choices?.[0]?.message?.content;
  if (typeof text !== "string" || !text.trim()) throw new Error("MiniMax 没有返回文本内容");
  return text.trim();
}

export function buildMiniMaxSpeechPayload({ model, voice, text, emotion }) {
  const speechEmotion = emotion === "happy" || emotion === "excited" ? "happy" : undefined;
  const voiceSetting = { voice_id:voice, speed:1, vol:1, pitch:0 };
  if (speechEmotion) voiceSetting.emotion = speechEmotion;
  return {
    model,
    text:String(text).trim().slice(0, 1800),
    stream:false,
    voice_setting:voiceSetting,
    audio_setting:{ sample_rate:16000, format:"wav", channel:1 },
    language_boost:"Chinese",
    subtitle_enable:false,
    output_format:"hex"
  };
}

export function decodeMiniMaxAudio(payload) {
  const status = payload?.base_resp?.status_code;
  if (status !== 0) throw new Error(payload?.base_resp?.status_msg || `MiniMax 语音接口失败 (${status})`);
  const hex = payload?.data?.audio;
  if (typeof hex !== "string" || !hex.length || hex.length % 2 || !/^[0-9a-f]+$/i.test(hex)) throw new Error("MiniMax 没有返回有效音频");
  return Buffer.from(hex, "hex");
}
