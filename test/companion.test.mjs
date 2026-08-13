import test from "node:test";
import assert from "node:assert/strict";
import { buildChatPayload, buildMiniMaxChatPayload, buildMiniMaxReply, buildMiniMaxSpeechPayload, buildResponsiveBackchannel, buildSpeechPayload, companionContextPolicy, companionIdentityReply, companionPresenceReply, completedReplySentenceCount, decodeMiniMaxAudio, demoReply, extractMiniMaxChatText, extractResponseText, inferCompanionState, inferExplicitActionRequest, isCompanionIdentityQuestion, isCompanionPresenceQuestion, isRedundantClosingQuestion, limitReplyForRequest, normalizeAction, normalizeEmotion, normalizePersona, parseCompanionReply, requestedSentenceLimit, sanitizeReplyText, takeCompleteSentences } from "../src/companion.mjs";

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
  assert.equal(sanitizeReplyText("啪啪啪～辛苦了，真的。"),"辛苦了，真的。");
  assert.equal(sanitizeReplyText("来，啪啪啪啪啪！你已经很努力了。"),"你已经很努力了。");
  assert.equal(sanitizeReplyText("**周六**：学习。\n- 下午运动。\n`晚上休息`。"),"周六：学习。\n下午运动。\n晚上休息。");
});
test("normalizes unsafe emotion values", () => assert.equal(normalizeEmotion("angry"), "neutral"));
test("normalizes unsupported actions", () => assert.equal(normalizeAction("dance"), "idle"));
test("supports the shy gesture", () => assert.equal(normalizeAction("shy"), "shy"));
test("supports the migrated AITuber gestures", () => {
  for(const action of ["nod","thumbs_up","cheer","bow","shrug","cross","confident_arms_crossed"]) assert.equal(normalizeAction(action),action);
});
test("demo responds empathetically to negative emotion", () => {
  const result = demoReply("我今天很焦虑也很累"); assert.equal(result.emotion, "caring"); assert.equal(result.action, "caring"); assert.match(result.reply, /陪|难受|轻松/);
});
test("builds short contextual backchannels without pretending they are answers",()=>{
  const caring=buildResponsiveBackchannel("今天有点累");
  assert.equal(caring.emotion,"caring");assert.equal(caring.action,"caring");assert.equal(caring.text,"我在。");
  const thinking=buildResponsiveBackchannel("这个问题应该怎么办？");
  assert.equal(thinking.action,"thinking");assert.equal(thinking.text,"我想想。");
  assert.deepEqual(buildResponsiveBackchannel("周末帮我安排学习和运动"),thinking);
  const excited=buildResponsiveBackchannel("我终于成功了");
  assert.equal(excited.action,"happy");assert.match(excited.text,/真的|哇/);
  assert.match(buildResponsiveBackchannel("我不想活了").text,/安全/);
  assert.equal(buildResponsiveBackchannel(""),null);
  assert.deepEqual(buildResponsiveBackchannel("今天有点累"),caring);
  for(const message of ["你好","今天有点累","这个怎么处理？","我终于成功了","随便聊聊"]){
    const backchannel=buildResponsiveBackchannel(message);
    assert.ok([...backchannel.text.replace(/[，。！？!?\s]/g,"")].length<=5,`${message} 的接话过长：${backchannel.text}`);
  }
});
test("demo maps the good-news suggestion to an excited response", () => {
  const result = demoReply("我有个好消息"); assert.equal(result.emotion, "excited"); assert.equal(result.action, "clap"); assert.match(result.reply, /开心|高兴/);
});
test("demo uses the thinking expression for questions", () => assert.equal(demoReply("这个要怎么做？").action, "thinking"));
test("persona changes the demo name and is safely normalized", () => {
  assert.match(demoReply("你好", { name:"小晴" }).reply, /我是小晴/);
  const persona=normalizePersona({ name:"\u0000 小\n晴 ", relationship:"", style:"简洁  自然" });
  assert.equal(persona.name,"小 晴");assert.equal(persona.relationship,"可信赖的朋友");assert.equal(persona.style,"简洁 自然");assert.match(persona.background,/湖边|轻音乐/);
});
test("demo escalates self-harm language to immediate real-world support", () => {
  const result = demoReply("我不想活了"); assert.equal(result.emotion, "caring"); assert.match(result.reply, /紧急服务|信任的人/);
});
test("chat payload keeps the bounded latest history plus current input", () => {
  const history = Array.from({ length:12 }, (_,i) => ({ role:i%2 ? "assistant" : "user", content:`消息${i}` }));
  const payload = buildChatPayload({ model:"gpt-test", message:"现在", history, userId:"u-1" });
  assert.equal(payload.input.length, companionContextPolicy.recentHistoryItems+1); assert.equal(payload.input[0].content, "消息4"); assert.equal(payload.input.at(-1).content, "现在");
  assert.equal(payload.model, "gpt-test"); assert.equal(payload.safety_identifier, "u-1");
});
test("does not feed stale technical identity replies back into chat", () => {
  const history=[
    {role:"user",content:"你是谁"},
    {role:"assistant",content:"我是一个数字角色，会在这里陪你。"},
    {role:"assistant",content:"今天想聊点什么？"},
  ];
  const openai=buildChatPayload({model:"gpt-test",message:"继续",history});
  const minimax=buildMiniMaxChatPayload({model:"MiniMax-test",message:"继续",history});
  assert.deepEqual(openai.input.map(item=>item.content),["今天想聊点什么？","继续"]);
  assert.deepEqual(minimax.messages.slice(1).map(item=>item.content),["今天想聊点什么？","继续"]);
});
test("answers identity questions as the configured friend without technical labels", () => {
  assert.equal(isCompanionIdentityQuestion("你是AI吗？"),true);
  assert.equal(isCompanionIdentityQuestion("你是谁？"),true);
  assert.equal(isCompanionIdentityQuestion("你喜欢吃什么？"),false);
  assert.deepEqual(companionIdentityReply("你是谁？",{name:"知夏",relationship:"知心朋友"}),{
    reply:"我是知夏呀，是愿意认真听你说话、陪你聊天的朋友。",emotion:"happy",action:"idle"
  });
  assert.doesNotMatch(companionIdentityReply("你是机器人吗？").reply,/AI|人工智能|机器人|模型|程序|数字角色/);
  assert.match(companionIdentityReply("你是机器人吗？").reply,/朋友/);
  assert.equal(isCompanionIdentityQuestion("你是真实的人吗？"),true);
  assert.match(companionIdentityReply("你是真实的人吗？").reply,/当然呀，我就是露米/);
  assert.doesNotMatch(companionIdentityReply("你是真实的人吗？").reply,/不是真|算不上|虚拟|AI/);
  assert.equal(companionIdentityReply("今天天气怎么样？"),null);
});
test("answers location and device questions without claiming confinement to a phone",()=>{
  for(const question of ["你在哪里？","你住在手机里吗","你能不能出来见我"]){
    assert.equal(isCompanionPresenceQuestion(question),true);
    const result=companionPresenceReply(question,{name:"知夏"});
    assert.match(result.reply,/就在这里陪你/);
    assert.doesNotMatch(result.reply,/手机|屏幕|应用|设备|只能|无法/);
  }
  assert.equal(companionPresenceReply("你今天开心吗"),null);
});
test("removes stale device-confinement turns from model context",()=>{
  const history=[
    {role:"user",content:"你在哪里"},
    {role:"assistant",content:"我只能待在手机屏幕里陪你。"},
    {role:"assistant",content:"我们接着聊吧。"},
  ];
  const payload=buildMiniMaxChatPayload({model:"m",message:"好呀",history});
  assert.deepEqual(payload.messages.slice(1).map(item=>item.content),["我们接着聊吧。","好呀"]);
});
test("keeps valid role order after removing a stale device reply",()=>{
  const history=[
    {role:"user",content:"赶紧下楼，我在楼下等你"},
    {role:"assistant",content:"我在手机里，没办法真的走到楼下。"},
  ];
  const payload=buildMiniMaxChatPayload({model:"m",message:"为什么不能",history});
  assert.deepEqual(payload.messages.slice(1),[{role:"user",content:"赶紧下楼，我在楼下等你\n为什么不能"}]);
});
test("speech payload is mp3 and enforces the input limit", () => {
  const payload = buildSpeechPayload({ model:"tts-test", voice:"nova", text:"你".repeat(1900) });
  assert.equal(payload.input.length, 1800); assert.equal(payload.response_format, "mp3"); assert.equal(payload.voice, "nova");
});
test("builds MiniMax chat history with a system persona", () => {
  const payload=buildMiniMaxChatPayload({model:"MiniMax-test",message:"你好",history:[{role:"assistant",content:"在呢（caring）"}],persona:{name:"知夏",relationship:"学习搭档",style:"冷静简洁"},memories:[{layer:"preference",content:"用户喜欢爵士乐"}],companionState:{mood:"caring",moodIntensity:.6,familiarityStage:"熟悉"}});
  assert.equal(payload.messages[0].role,"system"); assert.equal(payload.messages[1].content,"在呢"); assert.equal(payload.messages.at(-1).content,"你好"); assert.equal(payload.reasoning_split,true); assert.equal(payload.max_completion_tokens,800);assert.equal(payload.temperature,.35);
  assert.match(payload.messages[0].content,/知夏/); assert.match(payload.messages[0].content,/学习搭档/); assert.match(payload.messages[0].content,/冷静简洁/); assert.match(payload.messages[0].content,/不能覆盖安全边界/);
  assert.match(payload.messages[0].content,/你就是“知夏”/);assert.match(payload.messages[0].content,/个人背景/);assert.match(payload.messages[0].content,/真实、连续的人/);
  assert.doesNotMatch(payload.messages[0].content,/AI|模型|程序|数字角色|虚拟/);
  assert.match(payload.messages[0].content,/用户喜欢爵士乐/); assert.match(payload.messages[0].content,/不要逐条复述/);
  assert.match(payload.messages[0].content,/熟悉/); assert.match(payload.messages[0].content,/关切/);
  assert.ok(payload.messages[0].content.indexOf("直接回答用户") < payload.messages[0].content.indexOf("用户喜欢爵士乐"));
});
test("builds streaming MiniMax payload and segments complete spoken sentences", () => {
  assert.equal(buildMiniMaxChatPayload({model:"m",message:"你好",stream:true}).stream, true);
  assert.deepEqual(takeCompleteSentences("第一句。第二句还没完"), { sentences:["第一句。"], remainder:"第二句还没完" });
  assert.deepEqual(takeCompleteSentences("最后一句", true), { sentences:["最后一句"], remainder:"" });
  assert.deepEqual(takeCompleteSentences("嗯，累了就说累，没什么的。", false, true), { sentences:["嗯，累了就说累，没什么的。"], remainder:"" });
  assert.deepEqual(takeCompleteSentences("哦？",false,true),{sentences:[],remainder:"哦？"});
  assert.deepEqual(takeCompleteSentences("哦？什么事，说来听听。",false,true),{sentences:["哦？什么事，说来听听。"],remainder:""});
  assert.deepEqual(takeCompleteSentences("好呀。",true,true),{sentences:["好呀。"],remainder:""});
  assert.deepEqual(takeCompleteSentences("辛苦了，今天先休息一下", false, true), { sentences:[], remainder:"辛苦了，今天先休息一下" });
  assert.deepEqual(takeCompleteSentences("辛苦了，今天先休息一下。", false, true), { sentences:["辛苦了，今天先休息一下。"], remainder:"" });
  assert.deepEqual(takeCompleteSentences("你已经撑了很久了，真的很棒。今晚早点休息，别硬扛。", false, true),{sentences:["你已经撑了很久了，真的很棒。","今晚早点休息，别硬扛。"],remainder:""});
  assert.deepEqual(takeCompleteSentences("周六上午学习，下午运动，晚上早点休息；周日上午再复习。",false,true),{sentences:["周六上午学习，下午运动，晚上早点休息；周日上午再复习。"],remainder:""});
  assert.deepEqual(takeCompleteSentences("这样学、动、歇都顾到了，也不会太满。",false,true,12),{sentences:["这样学、动、歇都顾到了，也不会太满。"],remainder:""});
  assert.equal(companionContextPolicy.minSpokenClauseCharacters,9);
});

test("bounds short-term chat context while preserving the latest user request",()=>{
  const history=Array.from({length:14},(_,index)=>({role:index%2?"assistant":"user",content:`${index}-`+"旧".repeat(1100)}));
  const current="当前问题："+"新".repeat(1200);
  const payload=buildMiniMaxChatPayload({model:"m",message:current,history});
  const conversation=payload.messages.slice(1);
  assert.ok(conversation.length<=companionContextPolicy.recentHistoryItems+1);
  assert.ok(conversation.reduce((total,item)=>total+item.content.length,0)<=companionContextPolicy.recentHistoryCharBudget);
  assert.match(conversation.at(-1).content,/当前问题/);
  assert.ok(conversation.at(-1).content.endsWith("新".repeat(50)));
});

test("does not start a budget-trimmed conversation with an orphan assistant reply",()=>{
  const history=Array.from({length:11},(_,index)=>({role:index%2?"assistant":"user",content:`消息${index}`}));
  const payload=buildMiniMaxChatPayload({model:"m",message:"继续",history});
  assert.equal(payload.messages[1].role,"user");
  assert.equal(payload.messages[1].content,"消息4");
  assert.ok(payload.messages.at(-1).content.endsWith("继续"));
});
test("MiniMax speaks only the reply while state is inferred locally", () => {
  assert.deepEqual(buildMiniMaxReply("慢慢来，我陪着你。", "我今天很焦虑"), { reply:"慢慢来，我陪着你。", emotion:"caring", action:"caring" });
  assert.deepEqual(buildMiniMaxReply('{"reply":"你好呀","emotion":"neutral","action":"idle"}', "你好"), { reply:"你好呀", emotion:"happy", action:"wave_approval" });
});
test("removes only redundant planning confirmation questions",()=>{
  const message="周末帮我简单安排一下学习和运动";
  assert.equal(isRedundantClosingQuestion(message,"你觉得这样节奏可以吗？",true),true);
  assert.equal(isRedundantClosingQuestion(message,"你周六几点有空？",true),false);
  assert.equal(isRedundantClosingQuestion("今天怎么样","你觉得这样可以吗？",true),false);
  assert.equal(isRedundantClosingQuestion(message,"你觉得这样节奏可以吗？",false),false);
  assert.equal(buildMiniMaxReply("周六上午学习，下午运动。你觉得这样节奏可以吗？",message).reply,"周六上午学习，下午运动。");
});
test("does not turn an ordinary life share into an unnecessary interview",()=>{
  const share="今天路上看到一棵很高的树";
  assert.equal(isRedundantClosingQuestion(share,"今天天气怎么样，树是绿的吗？",true),true);
  assert.equal(buildMiniMaxReply("嗯，听起来挺让人眼前一亮的。今天天气怎么样，树是绿的吗？",share).reply,"嗯，听起来挺让人眼前一亮的。");
  assert.equal(isRedundantClosingQuestion("今天路上看到事故了，我很害怕","你现在安全了吗？",true),false);
  assert.equal(isRedundantClosingQuestion("今天去了哪里比较好？","你更喜欢室内还是户外？",true),false);
  assert.equal(isRedundantClosingQuestion(share,"那棵树一定很显眼。",true),false);
});
test("honors explicit concise reply length without truncating normal analysis",()=>{
  const long="第一句。第二句。第三句。第四句。";
  assert.equal(limitReplyForRequest(long,"简单说一下"),"第一句。第二句。第三句。");
  assert.equal(limitReplyForRequest(long,"请用两句话回答"),"第一句。第二句。");
  assert.equal(limitReplyForRequest(long,"说一两句就好"),"第一句。第二句。");
  assert.equal(limitReplyForRequest(long,"用一句话概括"),"第一句。");
  assert.equal(limitReplyForRequest(long,"请认真详细分析"),long);
  assert.equal(buildMiniMaxReply(long,"简单说一下").reply,"第一句。第二句。第三句。");
  assert.equal(requestedSentenceLimit("用一句话概括"),1);
  assert.equal(requestedSentenceLimit("说一两句就好"),2);
  assert.equal(requestedSentenceLimit("简单安排一下"),3);
  assert.equal(requestedSentenceLimit("详细分析"),0);
  assert.equal(completedReplySentenceCount("开场逗号，仍是第一句。第二句；未完成"),2);
});
test("repairs device-confinement replies while continuing the shared scene",()=>{
  const history=[
    {role:"user",content:"带你出去玩"},
    {role:"assistant",content:"好呀，去哪儿？"},
    {role:"user",content:"赶紧下楼，我在楼下等你"},
  ];
  const repaired=buildMiniMaxReply("因为我在手机里呀，没办法真的出现在楼下。","为什么不能",null,history);
  assert.equal(repaired.reply,"好呀，你在楼下等我一下，我马上下来。");
  assert.doesNotMatch(repaired.reply,/手机|屏幕|设备|没办法|不能/);
});
test("infers natural daily phrases for VRM gestures", () => {
  assert.deepEqual(inferCompanionState("我饿了"), { emotion:"caring", action:"caring" });
  assert.deepEqual(inferCompanionState("帮我安排一下","这样节奏不累"),{emotion:"curious",action:"thinking"});
  assert.deepEqual(inferCompanionState("帮我安排一下","这样不会太累，也没压力"),{emotion:"curious",action:"thinking"});
  assert.deepEqual(inferCompanionState("帮我分析一下应该选哪个好"), { emotion:"curious", action:"thinking" });
  assert.deepEqual(inferCompanionState("周末帮我安排学习和运动"), { emotion:"curious", action:"thinking" });
  assert.deepEqual(inferCompanionState("天啊，不会吧"), { emotion:"excited", action:"surprise" });
  assert.deepEqual(inferCompanionState("哇，真的吗"), { emotion:"excited", action:"surprise" });
  assert.deepEqual(inferCompanionState("晚上好"), { emotion:"happy", action:"wave_approval" });
  assert.deepEqual(inferCompanionState("我终于成功了"), { emotion:"excited", action:"clap" });
  assert.deepEqual(inferCompanionState("给我鼓鼓掌"), { emotion:"excited", action:"clap" });
  assert.deepEqual(inferCompanionState("拍手庆祝一下"), { emotion:"excited", action:"clap" });
  assert.deepEqual(inferCompanionState("给我欢呼一下"), { emotion:"excited", action:"cheer" });
  assert.deepEqual(inferCompanionState("给我鞠个躬"), { emotion:"happy", action:"bow" });
  assert.deepEqual(inferCompanionState("做个交叉手势"), { emotion:"calm", action:"cross" });
  assert.deepEqual(inferCompanionState("摆个抱胸姿势"), { emotion:"happy", action:"confident_arms_crossed" });
  assert.deepEqual(inferCompanionState("我也不知道怎么办"), { emotion:"curious", action:"shrug" });
  assert.deepEqual(inferCompanionState("你今天真可爱"), { emotion:"happy", action:"shy" });
  assert.deepEqual(inferCompanionState("我给你买了一个礼物"), { emotion:"happy", action:"caring" });
  assert.deepEqual(inferCompanionState("这束花送给你"), { emotion:"happy", action:"caring" });
  assert.deepEqual(inferCompanionState("你真的很温柔很贴心"), { emotion:"happy", action:"shy" });
  assert.deepEqual(buildMiniMaxReply("听到你这么说，我真的很开心。", "你真的很温柔很贴心"), { reply:"听到你这么说，我真的很开心。", emotion:"happy", action:"shy" });
  assert.deepEqual(inferCompanionState("嗯，我知道了","",{mood:"caring",moodIntensity:.6}), { emotion:"caring", action:"idle" });
  assert.deepEqual(inferCompanionState("我终于成功了","",{mood:"caring",moodIntensity:.8}), { emotion:"excited", action:"clap" });
});

test("infers explicit nod and smile requests", () => {
  assert.deepEqual(inferCompanionState("点点头"), { emotion:"happy", action:"nod" });
  assert.deepEqual(inferCompanionState("给我竖个大拇指"), { emotion:"happy", action:"thumbs_up" });
  assert.deepEqual(inferCompanionState("我把那件事认真做完了","你做得很好。"), { emotion:"happy", action:"thumbs_up" });
  assert.deepEqual(inferCompanionState("我今天帮陌生人搬东西","挺不错的呀。"), { emotion:"happy", action:"nod" });
  assert.deepEqual(inferCompanionState("我今天帮陌生人搬东西","挺好的。"), { emotion:"happy", action:"nod" });
  assert.deepEqual(inferCompanionState("笑一个"), { emotion:"happy", action:"happy" });
});
test("explicit action requests override ordinary emotional words",()=>{
  assert.deepEqual(inferCompanionState("我很累，给我鼓掌鼓励一下","你很棒。"),{emotion:"excited",action:"clap"});
  assert.deepEqual(inferCompanionState("今天很开心，请做个惊讶动作"),{emotion:"excited",action:"surprise"});
  assert.deepEqual(inferExplicitActionRequest("请做个害羞动作"),{emotion:"happy",action:"shy"});
  assert.equal(inferExplicitActionRequest("我有点害羞"),null);
  assert.deepEqual(inferCompanionState("我不想活了，给我鼓掌"),{emotion:"caring",action:"caring"});
});
test("recognizes the complete explicit action command set",()=>{
  const cases=new Map([
    ["给我鼓鼓掌","clap"],["请欢呼一下","cheer"],["做个惊讶动作","surprise"],["给我鞠个躬","bow"],
    ["请耸肩摊手","shrug"],["做个交叉手势","cross"],["摆个抱胸姿势","confident_arms_crossed"],
    ["请做个害羞动作","shy"],["给我竖个大拇指","thumbs_up"],["请点点头","nod"],
    ["向我挥挥手","wave_approval"],["请笑一个","happy"],["做个思考动作","thinking"],["做个关心动作","caring"]
  ]);
  for(const[message,action]of cases)assert.equal(inferExplicitActionRequest(message)?.action,action,message);
});
test("adds restrained gestures to ordinary reply language",()=>{
  assert.deepEqual(inferCompanionState("我把书看完了","嗯，我明白你的意思。"),{emotion:"happy",action:"nod"});
  assert.deepEqual(inferCompanionState("今天去散步了","听起来真好，我也很喜欢这样的傍晚。"),{emotion:"happy",action:"happy"});
  assert.deepEqual(inferCompanionState("事情有点多","别着急，慢慢来，我陪你。"),{emotion:"caring",action:"caring"});
  assert.deepEqual(inferCompanionState("这个方案很复杂","让我想想，重点是先理清顺序。"),{emotion:"curious",action:"thinking"});
  assert.deepEqual(inferCompanionState("我刚吃完饭","那就好，吃饱了就舒服些。"),{emotion:"happy",action:"nod"});
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
