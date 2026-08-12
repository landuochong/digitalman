import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readPublic=name=>readFile(new URL(`../public/${name}`,import.meta.url),"utf8");

test("main voice page offers real and anime modes in one conversation",async()=>{
  const [html,app,styles]=await Promise.all([readPublic("index.html"),readPublic("app.js"),readPublic("mode-switch.css")]);
  assert.match(html,/data-avatar-mode="real"[^>]*>真人/);
  assert.match(html,/data-avatar-mode="anime"[^>]*>动漫/);
  assert.match(html,/id="animeLookSelect"/);
  assert.match(html,/id="animeViewControls"/);
  assert.match(html,/id="personaForm"/);
  assert.match(html,/id="personaBackground"/);
  assert.match(html,/id="personaVoice"/);
  assert.match(html,/人物设置/);
  assert.match(app,/lumi-avatar-mode/);
  assert.match(html,/app\.js\?v=20260812-bedroom-v1/);
  assert.match(html,/aria-label="开始通话" aria-pressed="false"/);
  assert.match(app,/avatarRuntimeVersion="20260812-bedroom-v1"/);
  assert.match(app,/lumi-vrm-look/);
  assert.match(app,/lumi-vrm-persona/);
  assert.match(app,/lumi-voice-profile/);
  assert.match(app,/\/api\/voices/);
  assert.match(app,/voice:voiceProfile/);
  assert.match(app,/action=\$\{encodeURIComponent\(action\)\}/);
  assert.match(app,/conversationActions\.actionForSentence\(data\.text,sentenceIndex,data\.action\|\|currentAction\)/);
  assert.match(app,/bow:"\/real-actions\/bedroom_bow_silent\.mp4"/);
  assert.match(app,/surprise:"\/real-actions\/bedroom_surprise_silent\.mp4"/);
  assert.match(app,/if\(silentAction\)await playSilentNeuralAction/);
  assert.match(app,/\/wav2lip-avatar\/avatar\.html/);
  assert.match(app,/\/vrm-embed\.html/);
  assert.match(app,/history:history\.slice/);
  assert.doesNotMatch(html,/lumi-realistic-v2\.png|class="realistic-avatar"/);
  assert.match(styles,/\.avatar-panel \.portrait[\s\S]*position: absolute/);
});

test("user-facing pages hide provider and rendering implementation names",async()=>{
  const [index,app,vrm,vrmApp,realAvatar,legacyAvatar]=await Promise.all([
    readPublic("index.html"),readPublic("app.js"),readPublic("vrm.html"),readPublic("vrm-app.js"),
    readPublic("wav2lip-avatar/avatar.html"),readPublic("dh-live/avatar.html")
  ]);
  const visibleCopy=[index,vrm,realAvatar,legacyAvatar].join("\n")
    .replace(/<script\b[\s\S]*?<\/script>/gi,"")
    .replace(/<style\b[\s\S]*?<\/style>/gi,"")
    .replace(/<[^>]+>/g," ");
  assert.doesNotMatch(visibleCopy,/MiniMax|OpenAI|DINet|Wav2Lip|DH_live|VRMA|神经口型|数字人实验/);
  assert.doesNotMatch(app,/语音对话已连接`|MiniMax.*语音对话已连接|OpenAI.*语音对话已连接/);
  assert.doesNotMatch(vrmApp,/MiniMax.*流式回答|VRMA 自然动作/);
});

test("real avatar video covers the complete left panel",async()=>{
  const [html,css]=await Promise.all([readPublic("wav2lip-avatar/avatar.html"),readPublic("wav2lip-avatar/avatar.css")]);
  assert.match(html,/avatar\.css\?v=20260812-bedroom-v1/);
  assert.match(css,/\.avatar-layer\{[^}]*width:100%;height:100%;object-fit:cover;object-position:center center/);
  assert.match(css,/#stage\{[^}]*lumi-bedroom-background-v1\.png[^}]*center\/cover/);
});

test("embedded anime view receives shared speech and behavior events",async()=>{
  const [html,app]=await Promise.all([readPublic("vrm-embed.html"),readPublic("vrm-embed.js")]);
  assert.match(html,/id="avatarCanvas"/);
  assert.match(html,/vrm-embed\.js/);
  assert.match(app,/\|\|"nike1"/);
  for(const event of ["vrm-ready","vrm-behavior","vrm-behavior-accepted","vrm-speaking","vrm-audio-level","vrm-clear","vrm-finish-gesture","vrm-view-angle"])assert.match(app,new RegExp(event));
});

test("anime avatar provides a restrained one-shot nod gesture",async()=>{
  const [avatar,motion]=await Promise.all([readPublic("vrm-avatar.js"),readPublic("vrm-motion.js")]);
  assert.match(avatar,/"wave_approval","nod","thumbs_up","clap"/);
  assert.match(motion,/nod:\{procedural:"nod",duration:1\.2,oneShot:true\}/);
  assert.match(motion,/function createNodClip/);
  assert.match(motion,/THREE\.LoopOnce/);
  assert.match(await readPublic("vrm-embed.js"),/dataset\.actionStarted=String\(started\)/);
});

test("praise has a dedicated anime thumbs-up and a restrained listening nod",async()=>{
  const [avatar,motion,pose,app]=await Promise.all([
    readPublic("vrm-avatar.js"),readPublic("vrm-motion.js"),readPublic("vrm/motions/poses/thumbs_up.json"),readPublic("app.js")
  ]);
  assert.match(avatar,/"nod","thumbs_up","clap"/);
  assert.match(motion,/thumbs_up:\{files:\["thumbs_up\.json"\],duration:1\.7\}/);
  assert.match(pose,/"rightThumbProximal"/);
  assert.match(pose,/"rightLittleDistal"/);
  assert.match(app,/scheduleListeningGesture/);
  assert.match(app,/recognitionRunning&&recognizedText/);
  assert.match(app,/setDigitalHumanAction\("nod",\{force:true,hold:false\}\)/);
});

test("voice button toggles one continuous call instead of each utterance",async()=>{
  const app=await readPublic("app.js");
  assert.match(app,/const toggleCall=\(\)=>voiceCallActive\?endCall\(\):beginCall\(\)/);
  assert.match(app,/await completedQueue\.catch\(\(\)=>\{\}\)/);
  assert.match(app,/scheduleListening\(180\)/);
  assert.match(app,/now-silenceStarted>=650/);
  assert.match(app,/getFloatTimeDomainData/);
  assert.match(app,/voiceButton\.onclick=toggleCall/);
  assert.doesNotMatch(app,/voiceButton\.onclick=startListening/);
});

test("captions stay inside the right panel without hiding the avatar",async()=>{
  const [html,app,voice,style]=await Promise.all([readPublic("index.html"),readPublic("app.js"),readPublic("voice.css"),readPublic("style.css")]);
  assert.match(html,/aria-controls="messages"/);
  assert.match(html,/voice\.css\?v=20260810-captions-v3/);
  assert.match(html,/style\.css\?v=20260810-captions-v3/);
  assert.match(app,/if\(visible\)messages\.scrollTop=messages\.scrollHeight/);
  assert.match(voice,/\.voice-panel \{[^}]*overflow: hidden/);
  assert.match(voice,/\.captions \{[^}]*min-height: 0;[^}]*overflow-y: auto/);
  assert.match(voice,/body\.show-captions \.avatar-panel \{[^}]*visibility: visible/);
  assert.match(style,/@media\(max-width:620px\)\{body/);
});
