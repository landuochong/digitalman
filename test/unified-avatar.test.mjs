import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readPublic=name=>readFile(new URL(`../public/${name}`,import.meta.url),"utf8");

test("main voice page offers real and anime modes in one conversation",async()=>{
  const [html,app,styles,realActions]=await Promise.all([readPublic("index.html"),readPublic("app.js"),readPublic("mode-switch.css"),readPublic("real-action-catalog.js")]);
  assert.match(html,/data-avatar-mode="real"[^>]*>真人/);
  assert.match(html,/data-avatar-mode="anime"[^>]*>动漫/);
  assert.match(html,/id="animeLookSelect"/);
  assert.match(html,/id="realCharacterSelect"/);
  assert.match(html,/id="animeViewControls"/);
  assert.match(html,/id="personaForm"/);
  assert.match(html,/id="personaBackground"/);
  assert.match(html,/id="personaVoice"/);
  assert.match(html,/人物设置/);
  assert.match(app,/lumi-avatar-mode/);
  assert.match(html,/app\.js\?v=20260907-barge-boundary-v8/);
  assert.doesNotMatch(html,/绯音手工重建版/);
  assert.match(html,/aria-label="开始通话" aria-pressed="false"/);
  assert.match(app,/avatarRuntimeVersion="20260815-real-character-v46"/);
  assert.match(app,/from "\.\/real-action-catalog\.js\?v=20260815-shared-real-actions-v1"/);
  assert.match(app,/lumi-real-character/);
  assert.match(app,/avatarRuntimeUrl\("\/wav2lip-avatar\/avatar\.html",\{character:realAvatarCharacter\}\)/);
  assert.match(app,/AVATAR_FIRST_SEGMENT_LEAD_MS=240/);
  assert.match(app,/get\("continuous"\) !== "0"/);
  assert.match(app,/lumi-vrm-look/);
  assert.match(app,/lumi-vrm-persona/);
  assert.match(app,/lumi-voice-profile/);
  assert.match(app,/\/api\/voices/);
  assert.match(app,/voice:voiceProfile/);
  assert.match(app,/action=\$\{encodeURIComponent\(action\)\}&character=\$\{encodeURIComponent\(realAvatarCharacter\)\}/);
  assert.match(app,/conversationActions\.planForSentence\(data\.text,sentenceIndex,data\.action\|\|currentAction,currentEmotion\)/);
  assert.match(app,/const sentenceHasSpeech=true/);
  assert.match(app,/behavior\?\.explicit===true\?silentNeuralAction\(action\):null/);
  assert.match(app,/if\(!reusedBackchannel\)enqueueSpeech\(speechText,currentEmotion,batch,sentencePlan,streamTurn,\{ttsConnectionId,onStart:\(\)=>\{if\(sentenceHasSpeech\)reportSpeechStart\("formal"\);revealSentence\(transcriptIndex\);\}/);
  assert.match(app,/new BackchannelGate\(\{delayMs:BACKCHANNEL_GRACE_MS/);
  assert.match(app,/new BackchannelPlayback\(data\.text\)/);
  assert.match(app,/backchannelStartedMs=String\(Math\.round\(performance\.now\(\)-activeReplyStartedAt\)\)/);
  assert.match(app,/backchannelCompleted="true"/);
  assert.match(app,/backchannelCompletedMs=String\(Math\.round\(performance\.now\(\)-activeReplyStartedAt\)\)/);
  assert.match(app,/longWaitBackchannelMs/);
  assert.match(app,/createClientTimingReporter/);
  assert.match(app,/postClientTiming\(payload\)/);
  assert.match(app,/delete portrait\.dataset\.videoFirstFrameMs/);
  assert.match(app,/delete portrait\.dataset\.videoHandoffLateMs/);
  assert.match(app,/ttsRequestSetupMs:numericDataset\("ttsRequestSetupMs"\)/);
  assert.match(app,/portrait\.dataset\.ttsSynthesisMs=String\(data\.synthesisMs\?\?""\)/);
  assert.match(app,/avatarPcmBufferingMs:numericDataset\("avatarPcmBufferingMs"\)/);
  assert.match(app,/portrait\.dataset\.avatarTransportMs=String\(Math\.max\(0,avatarPipelineMs-ttsFirstAudioMs-pcmBufferingMs-renderMs\)\)/);
  assert.match(app,/reportSpeechStart\("formal"\)/);
  assert.match(app,/commitObservedAt:performance\.now\(\)/);
  assert.match(app,/reportClientTiming\("playback-ended"\)/);
  assert.match(app,/portrait\.dataset\.avatarRenderMs=String\(renderMs\)/);
  assert.match(app,/backchannelPlayback\?\.claim\(data\.text/);
  assert.match(app,/remainingAfterSpokenBackchannel\(backchannelPlayback\.text,data\.text\)/);
  assert.match(app,/backchannelPlayback\.close\(\);backchannelPlayback=null/);
  assert.match(app,/onPrepare:data=>/);
  assert.match(app,/speculative:true/);
  assert.match(app,/preparedWork:prepared\?\.work/);
  assert.match(app,/backchannelPreparedLeadMs/);
  assert.match(app,/holdMs:Math\.max\(1400,Number\(data\.audioMs\)\|\|0\)/);
  assert.match(app,/visual-turn\/\$\{encodeURIComponent\(behavior\.visualTurnId\)\}\/skip/);
  assert.match(app,/backchannelGate\.cancel\(\)/);
  assert.match(app,/frameOffset/);
  assert.match(app,/portrait\.dataset\.behavior=JSON\.stringify\(sentencePlan\)/);
  assert.match(app,/behavior:sentencePlan/);
  assert.match(app,/conversation-actions\.js\?v=20260813-restrained-action-v21/);
  assert.match(app,/function silentNeuralAction\(action\)/);
  assert.match(app,/return resolveSilentRealAction\(action,realAvatarCharacter\)/);
  assert.match(realActions,/bedroom_\$\{asset\}\/01\.mp4|`\/dh-live\/actions\/\$\{asset\}\/01\.mp4`/);
  assert.match(realActions,/bedroom_bow_front_silent\.mp4/);
  assert.match(app,/if\(silentAction\)\{\s*if\(streamTurn\)await streamTurn\.waitForPlayback\(\);\s*await playSilentNeuralAction/);
  assert.match(app,/playPreparedNeuralSpeech\(await preparation/);
  assert.match(app,/\/wav2lip-avatar\/avatar\.html/);
  assert.match(app,/\/vrm-embed\.html/);
  assert.match(app,/history:history\.slice\(0,-1\)\.slice\(-6\)/);
  assert.match(app,/responsiveSpeech:true/);
  assert.match(app,/prewarmPcm:mode==="minimax"/);
  assert.match(app,/firstTtsConnectionId=String\(data\.ttsConnectionId\|\|""\)/);
  assert.match(app,/event==="speech-ready"/);
  assert.match(app,/ttsConnectionId:options\.ttsConnectionId/);
  assert.match(app,/type:"wav2lip-preview"/);
  assert.match(app,/data\.waitingPreview\?\.url/);
  assert.match(app,/elapsedMs:previewTimeMs,leadMs:AVATAR_FIRST_SEGMENT_LEAD_MS/);
  assert.match(app,/activeWaitingPreview\?\.action===event\.data\.action/);
  assert.match(app,/backchannelVisualElapsedMs\(backchannelVisual\)/);
  assert.match(app,/backchannelContinuationMs=String\(elapsedMs\)/);
  assert.match(app,/data\.kind==="long-wait"&&backchannelVisual/);
  assert.match(app,/if\(visual&&!visual\.startedAt\)visual\.startedAt=performance\.now\(\)/);
  assert.match(app,/sentencePlan\.frameOffset\+actionFrameBias/);
  assert.match(app,/binaryAudio:externalAudio/);
  assert.match(app,/fragmentedVideo/);
  assert.match(app,/continuousVideoExperiment/);
  assert.match(app,/content:compactUploadedHistoryContent\(item\.content\)/);
  assert.match(app,/content\.slice\(0,head\).*content\.slice\(-tail\)/s);
  assert.doesNotMatch(html,/lumi-realistic-v2\.png|class="realistic-avatar"/);
  assert.match(styles,/\.avatar-panel \.portrait[\s\S]*position: absolute/);
});

test("localhost page exposes temporary direct action testing controls",async()=>{
  const [html,app,css,realActions]=await Promise.all([
    readFile(new URL("../public/index.html",import.meta.url),"utf8"),
    readFile(new URL("../public/app.js",import.meta.url),"utf8"),
    readFile(new URL("../public/mode-switch.css",import.meta.url),"utf8"),
    readFile(new URL("../public/real-action-catalog.js",import.meta.url),"utf8")
  ]);
  assert.match(html,/id="actionTestPanel" hidden/);
  assert.match(html,/data-action-test="happy">微笑/);
  assert.match(html,/data-action-test="wave_approval">挥手/);
  assert.match(app,/localActionTestHost=\["localhost","127\.0\.0\.1","::1"\]/);
  assert.match(app,/purpose:"action-test"/);
  assert.match(app,/function rawActionTestUrl\(action\)/);
  assert.match(app,/resolveWaitingActionPreview\(action,realAvatarCharacter\)/);
  assert.match(realActions,/xiaotao_shy_once_fast\.mp4/);
  assert.match(css,/\.action-test-buttons/);
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
  const [html,css,script]=await Promise.all([readPublic("wav2lip-avatar/avatar.html"),readPublic("wav2lip-avatar/avatar.css"),readPublic("wav2lip-avatar/avatar.js")]);
  assert.match(html,/avatar\.css\?v=20260828-shy-overlay-v1/);
  assert.match(css,/\.avatar-layer\{[^}]*width:100%;height:100%;object-fit:cover;object-position:center center/);
  assert.match(script,/lumi:\{idleAsset:"bedroom_idle_test",idleVideo:"01-seamless\.mp4/);
  assert.match(script,/xiaotao:\{idleAsset:"xiaotao_idle",idleVideo:"01\.mp4/);
  assert.match(script,/idleVideo\.poster=`\$\{characterRoot\}\/thumbnail\.jpg`/);
  assert.match(script,/stage\.style\.backgroundImage=/);
});

test("embedded anime view receives shared speech and behavior events",async()=>{
  const [html,app]=await Promise.all([readPublic("vrm-embed.html"),readPublic("vrm-embed.js")]);
  assert.match(html,/id="avatarCanvas"/);
  assert.match(html,/vrm-embed\.js/);
  assert.match(app,/\|\|"nike1"/);
  for(const event of ["vrm-ready","vrm-behavior","vrm-behavior-accepted","vrm-speaking","vrm-audio-level","vrm-clear","vrm-finish-gesture","vrm-view-angle"])assert.match(app,new RegExp(event));
  assert.match(app,/data\.behavior\|\|null/);
  assert.match(app,/dataset\.behavior=JSON\.stringify/);
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
  assert.match(app,/new ListeningGestureGate\(\)/);
  assert.match(app,/voiceCallActive&&recognitionRunning&&recognizedText/);
  assert.match(app,/setDigitalHumanAction\("nod",\{force:true,hold:false,behavior:\{purpose:"listening"/);
  assert.match(app,/realAvatarCharacter==="xiaotao"\?"xiaotao_nod":"bedroom_agree_test"/);
  assert.match(app,/type:"wav2lip-preview-clear"/);
  const realAvatar=await readPublic("wav2lip-avatar/avatar.js");
  assert.match(realAvatar,/video\.loop=data\.loop!==false/);
  assert.match(realAvatar,/wav2lip-preview-ended/);
});

test("voice button toggles one continuous call instead of each utterance",async()=>{
  const app=await readPublic("app.js");
  assert.match(app,/const toggleCall=\(\)=>voiceCallActive\?endCall\(\):beginCall\(\)/);
  assert.match(app,/await completedQueue\.catch\(\(\)=>\{\}\)/);
  assert.match(app,/recognitionResumeDelayMs\(\{preciseAudioTail:neuralAvatarProfile&&avatarPcmReady,outputLatencyMs\}\)/);
  assert.match(app,/recognitionSilenceMs\(\{text:recognizedText\}\)/);
  assert.match(app,/new SpeechEndpointDetector\(\)/);
  assert.match(app,/enoughInput=Boolean\(speechStartedAt\)/);
  assert.doesNotMatch(app,/peakRms>=\.0035\|\|speechStartedAt/);
  assert.match(app,/dataset\.vadNoiseFloor/);
  assert.match(app,/dataset\.vadThreshold/);
  assert.match(app,/now-lastDiagnosticAt>=250/);
  assert.match(app,/dataset\.answerEndToListeningMs/);
  assert.match(app,/dataset\.audioOutputLatencyMs/);
  assert.match(app,/const silenceTargetMs=recognitionSilenceMs\(\{text:recognizedText\}\)/);
  assert.match(app,/new RecognitionTurnGate\(\{onCommit:commitRecognizedTurn,finalizeDelayMs:90\}\)/);
  assert.match(app,/turnGate\.requestStop\(\{endpointSilenceMs:endpoint\.silenceMs\}\)/);
  assert.match(app,/const final=Boolean\(results\.at\(-1\)\?\.isFinal\)/);
  assert.match(app,/if\(turnGate\.update\(recognizedText,\{final,endpointSilenceMs:latestEndpointSilenceMs\}\)\)\{stopVadLoop\(\);clearListeningGesture\(\);/);
  assert.match(app,/const markRecognitionStopped=\(\)=>\{recognitionRunning=false;/);
  assert.match(app,/clearListeningGesture\(\);markRecognitionStopped\(\);try\{recognition\.stop\(\)/);
  assert.match(app,/stopVadLoop\(\);markRecognitionStopped\(\);turnGate\.requestStop\(\{endpointSilenceMs:endpoint\.silenceMs\}\)/);
  assert.match(app,/dataset\.vadStopToSubmitMs/);
  assert.match(app,/speechEndpointMs/);
  assert.match(app,/endpointSilenceMs:endpoint\.silenceMs/);
  assert.match(app,/endpointSilenceMs:latestEndpointSilenceMs/);
  assert.match(app,/if\(recognitionRunning\)\{restartListeningTimer=setTimeout\(startListening,100\);return;\}/);
  assert.match(app,/if\(turnGate\.committed\)return;recognitionFailed=true;turnGate\.fail\(\)/);
  assert.match(app,/getFloatTimeDomainData/);
  assert.match(app,/voiceButton\.onclick=toggleCall/);
  assert.match(app,/new BargeInDetector\(\)/);
  assert.match(app,/new ReplyTranscript\(\)/);
  assert.match(app,/onStart:\(\)=>revealSentence\(transcriptIndex\)/);
  assert.match(app,/onComplete:\(\)=>finishSentence\(transcriptIndex\)/);
  assert.match(app,/settleActiveTranscript\(true\)/);
  assert.match(app,/你可以随时开口打断/);
  assert.match(app,/startBargeInLoop\(generation\)/);
  assert.match(app,/answerGeneration\+\+/);
  assert.match(app,/stopSpeech\(\);setVoiceState\("idle","已暂停，我在听"\);scheduleListening\(60\)/);
  assert.doesNotMatch(app,/voiceButton\.onclick=startListening/);
});

test("streaming avatar experiment consumes ordered server segments and cancels stale sessions",async()=>{
  const app=await readPublic("app.js");
  assert.match(app,/streamingAvatarExperiment/);
  assert.match(app,/get\("streaming"\) !== "0"/);
  assert.match(app,/\/api\/dinet\/speech-stream/);
  assert.match(app,/event==="segment"/);
  assert.match(app,/lastPlayback=playPreparedNeuralSpeech\(item\.value,batch,\{enqueue:true,onStart,cancellation\}\)/);
  assert.match(app,/pendingWav2LipStarts\.get\(event\.data\.requestId\)/);
  assert.match(await readPublic("wav2lip-avatar/avatar.js"),/requestId:item\.requestId.*resumedFromGap/s);
  assert.match(app,/new AvatarStreamTurn/);
  assert.match(app,/task=>streamTurn\.enqueue\(task\)/);
  assert.match(app,/streamTurn\?streamTurn\.finish\(\):speechQueue/);
  assert.match(app,/turn\.trackSegment\(/);
  assert.match(app,/await streamTurn\.waitForPlayback\(\)/);
  assert.match(app,/buildWav2LipPlaybackMessage\(rendered,requestId,\{enqueue\}\)/);
  assert.match(await readPublic("avatar-stream-turn.js"),/await Promise\.all\(this\.playbacks\)/);
  assert.match(app,/wav2lip-stream-end/);
  assert.equal(app.match(/type:"wav2lip-stream-end"/g)?.length,1);
  assert.match(app,/lingerMs/);
  assert.match(app,/idleTimeMs:realSpeechTimelineMs/);
  assert.match(app,/dataset\.audioMode/);
  assert.match(app,/dataset\.videoHandoffLateMs/);
  assert.match(app,/const externalAudio=avatarPcmReady&&avatarAudioContext\?\.state==="running"/);
  assert.match(app,/avatarPcmReady=event\.data\.mode==="pcm-ready"\|\|event\.data\.mode==="pcm"/);
  assert.match(app,/avatarFragmentedVideoReady=event\.data\.fragmentedVideo===true/);
  assert.match(app,/videoMaxDriftMs/);
  assert.match(app,/avatarGapIdleMs/);
  assert.match(app,/event\.data\?\.type==="wav2lip-gap-preview"/);
  assert.match(app,/avatarGapMode="preview"/);
  assert.match(app,/videoPrunedSeconds/);
  assert.match(app,/audioAheadSeconds/);
  assert.match(app,/renderBackpressure:fragmentedVideo/);
  assert.match(app,/\/ack`/);
  assert.match(app,/renderUnacknowledged/);
  assert.match(app,/videoAudioGateMs/);
  assert.match(app,/action,character:realAvatarCharacter,frameOffset,externalAudio/);
  assert.match(app,/streamTurn\.allocateSentence\(\)/);
  assert.match(app,/visualTurnId:behavior\?\.visualTurnId/);
  assert.match(app,/closeVisualTurn\(streamTurn\.id\)/);
  assert.match(app,/dataset\.chatFirstSentenceMs/);
  assert.match(app,/raw===undefined\|\|raw\.trim\(\)===""/);
  assert.match(app,/dataset\.avatarFirstSegmentMs/);
  assert.match(app,/dataset\.ttsFirstAudioMs/);
  assert.match(app,/dataset\.ttsConnectionReused/);
  assert.match(app,/dataset\.ttsTaskPrimed/);
  assert.match(app,/dataset\.ttsConnectionLeadMs/);
  assert.match(app,/if\(plan\.cadenceManaged\)/);
  assert.match(app,/plan\.implicitMicroGesture\?beginWaitingPreview\(plan,null,\{pending:avatarMode!=="anime"\}\):null/);
  assert.match(app,/preparedPreviewCanStart\(localPreview,\{activePreview:waitingPreview,aborted:controller\.signal\.aborted,spokenSentenceCount\}\)/);
  assert.match(app,/!waitingPreview\.pending&&!sentencePlan\.deferred/);
  assert.match(app,/dataset\.avatarPipelineMs/);
  assert.match(app,/window\.__lumiAvatarAudioContext=avatarAudioContext/);
  assert.match(app,/document\.addEventListener\("pointerdown",\(\)=>void unlockAvatarAudio\(\),\{once:true,capture:true\}\)/);
  assert.match(app,/void unlockAvatarAudio\(\)/);
  assert.match(app,/type:"wav2lip-audio-unlock"/);
  const avatar=await readPublic("wav2lip-avatar/avatar.js");
  assert.match(avatar,/scheduleIdleReveal\(pendingIdleLingerMs,pendingIdleTimeMs\)/);
  assert.match(avatar,/parent\.__lumiAvatarAudioContext/);
  assert.match(avatar,/let fragmentedPlaybackPromise=null/);
  assert.match(avatar,/fragmentedPlaybackGeneration\+\+/);
  assert.match(avatar,/generation!==fragmentedPlaybackGeneration/);
  assert.match(avatar,/if\(fragmentedPlaybackPromise\)return fragmentedPlaybackPromise/);
  assert.match(avatar,/void prewarmFragmentedPlayback\(playToken\)/);
  assert.match(avatar,/fragmentedVideo:true,gapMs:0,prewarmed:true/);
  assert.match(app,/for\(const stream of activeStreamingSpeech\)stream\.cancel\(\)/);
  assert.doesNotMatch(app,/liveTranscript\.textContent=recognizedText/);
});

test("captions stay inside the right panel without hiding the avatar",async()=>{
  const [html,app,voice,style]=await Promise.all([readPublic("index.html"),readPublic("app.js"),readPublic("voice.css"),readPublic("style.css")]);
  assert.match(html,/aria-controls="messages"/);
  assert.match(html,/voice\.css\?v=20260813-video-handoff-v11/);
  assert.match(html,/style\.css\?v=20260813-video-handoff-v11/);
  assert.match(html,/id="liveTranscript" aria-live="off" hidden/);
  assert.match(app,/if\(visible\)messages\.scrollTop=messages\.scrollHeight/);
  assert.match(voice,/\.voice-panel \{[^}]*overflow: hidden/);
  assert.match(voice,/\.captions \{[^}]*min-height: 0;[^}]*overflow-y: auto/);
  assert.match(voice,/body\.show-captions \.avatar-panel \{[^}]*visibility: visible/);
  assert.match(style,/@media\(max-width:620px\)\{body/);
});
