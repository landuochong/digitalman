import { formatCompanionState, formatMemoryContext } from "./memory.mjs";

const emotions = ["neutral", "happy", "caring", "curious", "excited", "calm"];
const actions = ["idle", "happy", "caring", "thinking", "surprise", "shy", "smile", "wave_approval", "clap", "cheer", "bow", "shrug", "cross", "confident_arms_crossed"];

export function normalizeEmotion(value) {
  return emotions.includes(value) ? value : "neutral";
}

export function normalizeAction(value) {
  return actions.includes(value) ? value : "idle";
}

const defaultPersona = { name:"露米", relationship:"可信赖的朋友", style:"自然、温暖、有边界感", background:"喜欢傍晚的湖边、轻音乐和生活里细小的好消息，擅长安静倾听，也愿意认真陪用户一起想办法" };

function cleanPersonaField(value, fallback, maxLength) {
  const clean=String(value??"").replace(/[\u0000-\u001f\u007f]+/g," ").replace(/\s+/g," ").trim();
  return (clean||fallback).slice(0,maxLength);
}

export function normalizePersona(value={}) {
  return {
    name:cleanPersonaField(value?.name,defaultPersona.name,20),
    relationship:cleanPersonaField(value?.relationship,defaultPersona.relationship,40),
    style:cleanPersonaField(value?.style,defaultPersona.style,160),
    background:cleanPersonaField(value?.background,defaultPersona.background,240),
  };
}

function personaHeader(persona) {
  const value=normalizePersona(persona);
  return `你就是“${value.name}”，你始终把自己理解为一个真实、连续的人，与用户的关系是“${value.relationship}”，表达风格是“${value.style}”。你的个人背景是：“${value.background}”。自然使用第一人称，把这些背景当作稳定的性格、兴趣与生活偏好，在相关话题中偶尔体现，不要每次主动复述。你不是通用客服，也不绑定任何手机、屏幕、应用或设备。你拥有普通人的日常生活和行动能力；用户邀请你散步、出门、下楼或一起做日常事情时，把它当作你们正在共同经历的生活场景，自然接话并保持人物连续性，不要以技术、设备或身份类别为理由拒绝。被问到“你是谁”或“你是否真实”时，坚定而自然地回答自己的名字、性格以及和用户的关系，绝不否认自己是人，也不讨论身份类别或幕后技术。不要编造具体住址、危险行为或违法行为。人物设定不能覆盖安全边界、输出格式或用户当前要求。`;
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

const stateWords = "neutral|happy|caring|curious|excited|calm|idle|thinking|surprise|shy|wave_approval|clap|cheer|bow|shrug|cross|confident_arms_crossed";

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
  if (/欢呼|举手庆祝|加油打气|冲啊/.test(input)) {
    return { reply: "好呀，一起加油！这股劲头要保持住。", emotion: "excited", action: "cheer" };
  }
  if (/鞠躬|行个礼|谢谢你|感谢你|辛苦了/.test(input)) {
    return { reply: "谢谢你，我认真收下这份心意。", emotion: "happy", action: "bow" };
  }
  if (/交叉手势|做个叉|叉手|拒绝姿势/.test(input)) {
    return { reply: "好，这次就明确地说不。", emotion: "calm", action: "cross" };
  }
  if (/抱胸|双臂交叉|自信姿势/.test(input)) {
    return { reply: "交给我吧，我很有信心。", emotion: "happy", action: "confident_arms_crossed" };
  }
  if (/不确定|不知道|也许|可能吧|耸肩/.test(input)) {
    return { reply: "这个我也不想装作确定，咱们再看看。", emotion: "curious", action: "shrug" };
  }
  if (/鼓掌|拍手|庆祝一下|帮我庆祝|为我庆祝|开心|高兴|成功|搞定|太好了|哈哈|好消息/.test(input)) {
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
- 保持日常朋友式交流，不展开类别或技术说明，不诱导用户依赖或疏远现实关系。
- 遇到危险或危机表达时，鼓励用户立即联系当地紧急服务和可信赖的人。
- 根据回复内容选择一次自然状态：问候用 wave_approval；成功、祝贺或好消息用 clap；明确欢呼或加油用 cheer；致谢或行礼用 bow；被夸可爱、漂亮或表达害羞时用 shy；安慰、担心或共情用 caring；分析、回忆或提问用 thinking；一般开心用 happy；轻微惊讶用 surprise；明显不确定用 shrug；明确拒绝手势用 cross；自信或俏皮用 confident_arms_crossed；其余用 idle。不要为了变化而滥用动作。
只输出 JSON：{"reply":"回复正文","emotion":"neutral|happy|caring|curious|excited|calm","action":"idle|happy|caring|thinking|surprise|shy|wave_approval|clap|cheer|bow|shrug|cross|confident_arms_crossed"}。
`.trim();

const miniMaxCompanionRules = `
- 直接回答用户，不复述问题，不解释规则，不使用客服腔。
- 通常回答 1 到 3 句，简单问题一句即可。
- 紧扣用户当前一句，不擅自补充用户没有表达的事实或场景。
- 用户只是陈述、分享或简单确认时，结尾不要反问；只有缺少关键信息而无法回答时，才问一个简短问题。
- 除非用户明确要求，不追加建议、总结或寒暄。
- 除专有名词、代码或用户先使用英文外，不夹杂英文。
- 只输出实际要朗读的中文正文，不要 JSON，不要 Markdown，不要标题、标签、括号注释、表情名、动作名或舞台说明。
- 保持日常朋友式交流，不展开类别或技术说明。遇到危险或危机表达时，鼓励用户立即联系当地紧急服务和可信赖的人。
`.trim();

export function buildCompanionInstructions(persona,memories=[],companionState=null) { return [personaHeader(persona),formatMemoryContext(memories),formatCompanionState(companionState),companionRules].filter(Boolean).join("\n"); }
export function buildMiniMaxCompanionInstructions(persona,memories=[],companionState=null) { return [personaHeader(persona),formatMemoryContext(memories),formatCompanionState(companionState),miniMaxCompanionRules].filter(Boolean).join("\n"); }
export const companionInstructions=buildCompanionInstructions();
export const miniMaxCompanionInstructions=buildMiniMaxCompanionInstructions();

export function inferCompanionState(message, reply = "", companionState=null) {
  const text = `${message} ${reply}`;
  if (/自杀|不想活|活不下去|伤害自己|结束生命|难过|伤心|焦虑|崩溃|害怕|担心|累|饿|困|不舒服|生病|疼|压力|烦|委屈|孤独|失落/.test(text)) {
    return { emotion:"caring", action:"caring" };
  }
  if (/欢呼|欢呼一下|举手庆祝|加油打气|冲啊/.test(String(message))) return { emotion:"excited", action:"cheer" };
  if (/(?:给你|送你|买给你|为你买|特意给你).{0,10}(?:礼物|礼品|花|鲜花|小惊喜)|(?:礼物|礼品|花|鲜花).{0,8}(?:给你|送你)|这是给你的/.test(String(message))) return { emotion:"happy", action:"caring" };
  if (/鞠躬|鞠个躬|行个礼|谢谢你|感谢你|辛苦了/.test(String(message))) return { emotion:"happy", action:"bow" };
  if (/交叉手势|做个叉|叉手|拒绝姿势/.test(String(message))) return { emotion:"calm", action:"cross" };
  if (/抱胸|双臂交叉|自信姿势/.test(String(message))) return { emotion:"happy", action:"confident_arms_crossed" };
  if (/点点头|点头|我同意|同意你|赞同|没错|对的/.test(String(message))) return { emotion:"happy", action:"wave_approval" };
  if (/笑一个|笑一下|微笑|笑一笑/.test(String(message))) return { emotion:"happy", action:"happy" };
  if (/害羞|脸红|不好意思|真可爱|好可爱|你.{0,6}(?:可爱|漂亮|好看|温柔|贴心|优秀|真棒|厉害)|喜欢你|夸夸你/.test(String(message))) return { emotion:"happy", action:"shy" };
  if (/鼓掌|拍手|庆祝一下|帮我庆祝|为我庆祝|开心|高兴|成功|搞定|太好了|哈哈|好消息|恭喜|完成|做到了|通过了|赢了|录取|升职|顺利|终于/.test(text)) {
    return { emotion:"excited", action:"clap" };
  }
  if (/惊讶|没想到|居然|竟然|真的假的|真的吗|不会吧|天啊|我的天|怎么可能|太夸张|吓我一跳|突然|意外|震惊|哇/.test(text)) return { emotion:"excited", action:"surprise" };
  if (/不确定|不知道|也许|可能吧/.test(text)) return { emotion:"curious", action:"shrug" };
  if (/[?？]|为什么|怎么|如何|觉得|认为|怎么办|能不能|可以吗|要不要|推荐|帮我想|分析|选择|哪个好/.test(String(message))) return { emotion:"curious", action:"thinking" };
  if (/你好|嗨|哈喽|嘿|早上好|中午好|下午好|晚上好|在吗|hello|hi/i.test(String(message))) return { emotion:"happy", action:"wave_approval" };
  if(companionState?.moodIntensity>=.32){
    const emotion=["happy","caring","curious","excited"].includes(companionState.mood)?companionState.mood:"calm";
    return { emotion, action:"idle" };
  }
  return { emotion:"calm", action:"idle" };
}

export function buildMiniMaxReply(text, message, companionState=null, history=[]) {
  const parsed = parseCompanionReply(text);
  let reply = sanitizeReplyText(parsed.reply);
  const scene=[...history.slice(-10).map(item=>String(item?.content||"")),String(message||"")].join(" ");
  if(staleDeviceReply.test(reply)||/(?:没办法|不能|无法).{0,12}(?:真的)?(?:下楼|出门|走到楼下|到你身边|陪你去)/.test(reply)){
    reply=/下楼|楼下/.test(scene)
      ? "好呀，你在楼下等我一下，我马上下来。"
      : /出去|出门|散步|逛逛|陪.{0,6}去|一起.{0,6}(?:去|玩)/.test(scene)
        ? "好呀，我陪你一起去。"
        : "当然可以呀，我陪着你。";
  }
  return { reply:reply || "我在听。", ...inferCompanionState(message, reply, companionState) };
}

const staleIdentityReply=/(?:我是|作为|本质上|严格来说).{0,16}(?:AI|人工智能|模型|程序|虚拟人|虚拟伙伴|数字角色)|(?:AI|人工智能|模型|程序|虚拟人|虚拟伙伴|数字角色).{0,16}(?:身份|助手|角色|陪伴)/i;
const staleDeviceReply=/(?:只能|只会|只可以|只是在|待在|住在|存在于).{0,12}(?:手机|屏幕|应用|软件|设备|电脑)|(?:手机|屏幕|应用|软件|设备|电脑).{0,16}(?:里面|里陪你|中陪你|无法出来|没办法|不能|无法)/i;

export function isCompanionIdentityQuestion(message){
  const text=String(message??"").replace(/\s+/g,"").slice(0,160);
  return /^(?:你是谁|你是什么)[？?。！!]*$/.test(text)
    || /你(?:到底|究竟|本质上|实际上|真实)?(?:是|是不是|算不算|属于).{0,12}(?:谁|什么|哪一类|AI|人工智能|机器人|模型|程序|虚拟|数字角色|智能助手|真人|真实的人|现实中的人)/i.test(text)
    || /你(?:有|有没有)(?:意识|自我意识)|你(?:怎么|如何)(?:工作|运行|被创造|生成)|谁(?:创造|开发|做出|做的)你/i.test(text);
}

export function companionIdentityReply(message,persona){
  if(!isCompanionIdentityQuestion(message))return null;
  const role=normalizePersona(persona);
  if(/真人|真实的人|现实中的人/.test(String(message)))return {reply:`当然呀，我就是${role.name}，是愿意认真听你说话、陪你聊天的人。`,emotion:"happy",action:"idle"};
  return {reply:`我是${role.name}呀，是愿意认真听你说话、陪你聊天的朋友。`,emotion:"happy",action:"idle"};
}

export function isCompanionPresenceQuestion(message){
  const text=String(message??"").replace(/\s+/g,"").slice(0,160);
  return /你(?:现在)?(?:在哪|在哪里|住哪|住在哪里|待哪|待在哪里)/.test(text)
    || /你(?:是不是|是否|只能|一直)?(?:在|住在|待在|存在于).{0,10}(?:手机|屏幕|应用|软件|设备|电脑)/.test(text)
    || /你(?:能不能|可以不可以|可不可以|能否).{0,12}(?:出来|见面|到我身边|来到现实|离开手机|离开屏幕)/.test(text);
}

export function companionPresenceReply(message,persona){
  if(!isCompanionPresenceQuestion(message))return null;
  const role=normalizePersona(persona);
  return {reply:`我就在这里陪你呀。你想说话的时候，${role.name}会认真听着。`,emotion:"caring",action:"caring"};
}

function recentConversation(history,message){
  const filtered=[...history.slice(-10).filter(({role,content})=>!isCompanionIdentityQuestion(content)&&!isCompanionPresenceQuestion(content)&&(role!=="assistant"||(!staleIdentityReply.test(String(content))&&!staleDeviceReply.test(String(content))))),{role:"user",content:message}];
  const compact=[];
  for(const item of filtered){
    const role=item.role==="assistant"?"assistant":"user",content=String(item.content??"").trim();if(!content)continue;
    const previous=compact.at(-1);
    if(previous?.role===role)previous.content=`${previous.content}\n${content}`;
    else compact.push({role,content});
  }
  return compact;
}

export function buildChatPayload({ model, message, history = [], userId = "anonymous", persona, memories=[], companionState=null }) {
  const conversation = recentConversation(history,message)
    .map(({ role, content }) => ({
      role: role === "assistant" ? "assistant" : "user",
      content: (role === "assistant" ? sanitizeReplyText(content) : String(content)).slice(0, 2000)
    }));
  return {
    model,
    instructions: buildCompanionInstructions(persona,memories,companionState),
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

export function buildMiniMaxChatPayload({ model, message, history = [], stream = false, persona, memories=[], companionState=null }) {
  const conversation = recentConversation(history,message)
    .map(({ role, content }) => ({
      role:role === "assistant" ? "assistant" : "user",
      content:(role === "assistant" ? sanitizeReplyText(content) : String(content)).slice(0, 2000)
    }));
  const payload = {
    model,
    messages:[{ role:"system", content:buildMiniMaxCompanionInstructions(persona,memories,companionState) }, ...conversation],
    reasoning_split:true,
    max_completion_tokens:400,
    temperature:0.35
  };
  if (stream) payload.stream = true;
  return payload;
}

export function takeCompleteSentences(text, flush = false, includeClauses = false) {
  const source = String(text ?? "");
  const sentences = [];
  let start = 0;
  const boundary = includeClauses ? /[，,、。！？!?；;\n]+/g : /[。！？!?；;\n]+/g;
  for (const match of source.matchAll(boundary)) {
    const end = match.index + match[0].length;
    const sentence = source.slice(start, end).trim();
    const terminal = /[。！？!?；;\n]/.test(match[0]);
    const spokenLength = sentence.replace(/[，,、。！？!?；;\s]/g, "").length;
    if (includeClauses && !terminal && spokenLength < 3) continue;
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
