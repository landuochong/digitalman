import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDINetWorkerCommand, DINetRenderStore } from "../src/dinet-render.mjs";
import { listRealActionSupport, normalizeRealAvatarCharacter, resolveRealActionAsset, resolveRealSpeechActionAsset, resolveSilentRealAction, resolveWaitingActionPreview } from "../src/real-actions.mjs";
import { REAL_MOUTH_PROFILE_VERSION, resolveRealMouthProfile } from "../src/real-mouth-profiles.mjs";

test("development watch excludes generated avatar media",async()=>{
  const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
  assert.equal(pkg.scripts.start,"exec node server.mjs");
  assert.match(pkg.scripts.dev,/^exec node /);
  assert.match(pkg.scripts.dev,/--watch-path=server\.mjs/);
  assert.match(pkg.scripts.dev,/--watch-path=src/);
  assert.doesNotMatch(pkg.scripts.dev,/public/);
});

test("preloads one persistent DINet worker with the bedroom asset", () => {
  const command = buildDINetWorkerCommand("/project");
  assert.equal(command.executable, "/project/.venv-dh-live/bin/python");
  assert.deepEqual(command.args, [
    "/project/scripts/dinet_worker.py",
    "--asset",
    "/project/public/dh-live/actions/bedroom_idle_test"
  ]);
});

test("maps anime action names onto same-character real video assets",()=>{
  assert.equal(resolveRealActionAsset("wave_approval"),"bedroom_wave_v2");
  assert.equal(resolveRealActionAsset("nod"),"bedroom_agree_test");
  assert.equal(resolveRealActionAsset("thumbs_up"),"bedroom_thumbs_up");
  assert.equal(resolveRealActionAsset("clap"),"bedroom_clap");
  assert.equal(resolveRealActionAsset("thinking"),"bedroom_thinking");
  assert.equal(resolveRealActionAsset("shy"),"bedroom_idle_test");
  assert.equal(resolveRealActionAsset("surprise"),"bedroom_idle_test");
  assert.equal(resolveRealActionAsset("cross"),"bedroom_cross");
  assert.equal(resolveRealActionAsset("confident_arms_crossed"),"bedroom_arms_crossed");
  assert.equal(resolveRealActionAsset("unknown"),"bedroom_idle_test");
  assert.deepEqual(resolveWaitingActionPreview("caring"),{action:"caring",asset:"bedroom_caring",url:"/dh-live/actions/bedroom_caring/01.mp4"});
  assert.deepEqual(resolveWaitingActionPreview("thumbs_up"),{action:"thumbs_up",asset:"bedroom_thumbs_up",url:"/dh-live/actions/bedroom_thumbs_up/01.mp4"});
  assert.deepEqual(resolveWaitingActionPreview("shy"),{action:"shy",asset:"bedroom_idle_test",url:"/real-actions/bedroom_surprise_silent.mp4"});
  assert.equal(resolveWaitingActionPreview("clap"),null);
  assert.equal(resolveWaitingActionPreview("surprise"),null);
  assert.equal(resolveRealActionAsset("wave_approval","xiaotao"),"xiaotao_wave");
  assert.equal(resolveRealActionAsset("clap","xiaotao"),"xiaotao_clap");
  assert.equal(resolveRealActionAsset("thinking","xiaotao"),"xiaotao_thinking");
  assert.equal(resolveRealActionAsset("unknown","xiaotao"),"xiaotao_idle");
  assert.equal(resolveRealActionAsset("happy","xiaotao"),"xiaotao_smile");
  assert.equal(resolveRealSpeechActionAsset("happy","xiaotao"),"xiaotao_idle");
  assert.equal(resolveRealSpeechActionAsset("smile","xiaotao"),"xiaotao_idle");
  assert.equal(resolveRealSpeechActionAsset("nod","xiaotao"),"xiaotao_idle");
  assert.equal(resolveRealSpeechActionAsset("thinking","xiaotao"),"xiaotao_idle");
  assert.equal(resolveRealSpeechActionAsset("clap","xiaotao"),"xiaotao_clap");
  assert.equal(resolveRealSpeechActionAsset("happy","lumi"),"bedroom_smile_test");
  assert.equal(normalizeRealAvatarCharacter("missing"),"lumi");
  assert.deepEqual(resolveWaitingActionPreview("shy","xiaotao"),{action:"shy",asset:"xiaotao_idle",url:"/real-actions/xiaotao_shy_once_fast.mp4",loop:false,durationMs:3360,overlaySpeech:true});
  assert.equal(resolveSilentRealAction("shy","xiaotao"),null);
  assert.equal(resolveSilentRealAction("bow","xiaotao"),"/dh-live/actions/xiaotao_bow/01.mp4");
  assert.equal(resolveSilentRealAction("surprise","xiaotao"),"/dh-live/actions/xiaotao_surprise/01.mp4");
  assert.equal(resolveSilentRealAction("clap","xiaotao"),null);
  const support=listRealActionSupport("xiaotao");
  assert.deepEqual(support.map(item=>item.action),["idle","happy","smile","shy","clap","cheer","wave_approval","nod","thumbs_up","bow","caring","thinking","surprise","shrug","cross","confident_arms_crossed"]);
  assert.equal(support.find(item=>item.action==="clap")?.asset,"xiaotao_clap");
  assert.equal(support.find(item=>item.action==="shy")?.distinct,false);
});

test("browser and server re-export the same real action catalog",async()=>{
  const source=await readFile(new URL("../src/real-actions.mjs",import.meta.url),"utf8");
  assert.match(source,/from "\.\.\/public\/real-action-catalog\.js"/);
  assert.doesNotMatch(source,/CHARACTER_ACTION_ASSETS/);
});

test("resolves one bounded mouth profile per real character",()=>{
  assert.equal(REAL_MOUTH_PROFILE_VERSION,3);
  assert.deepEqual(resolveRealMouthProfile("lumi"),{
    mouthMotionScale:0.79,mouthWidthScale:0.9,mouthHeightScale:0.97,
    compositeCenterX:0.5,compositeCenterY:0.39,
    lipColorCenterX:0.512,lipColorCenterY:0.481,lipColorStrength:0.88,upperLipColorStrength:0.78,
    lipBrightnessOffset:8,teethStrength:0.38
  });
  assert.deepEqual(resolveRealMouthProfile("xiaotao"),{
    mouthMotionScale:0.78,mouthWidthScale:0.91,mouthHeightScale:0.97,
    compositeCenterX:0.5,compositeCenterY:0.39,
    lipColorCenterX:0.513,lipColorCenterY:0.457,lipColorStrength:0.92,upperLipColorStrength:0.98,
    lipBrightnessOffset:9,teethStrength:0.46
  });
  assert.notEqual(resolveRealMouthProfile("lumi"),resolveRealMouthProfile("xiaotao"));
  assert.ok(Object.isFrozen(resolveRealMouthProfile("lumi")));
});

test("DINet uses authored per-frame mouth masks for both real characters",async()=>{
  const worker=await readFile(new URL("../scripts/dinet_worker.py",import.meta.url),"utf8");
  const builder=await readFile(new URL("../scripts/build_dinet_mouth_masks.py",import.meta.url),"utf8");
  assert.match(worker,/MOUTH_MASK_FILENAME = "mouth_masks-v1\.npz"/);
  assert.match(worker,/self\.mouth_masks\[frame_index\]/);
  assert.match(worker,/authored_mouth_mask = cv2\.resize/);
  assert.match(worker,/lip_support = authored_mask > 18/);
  assert.doesNotMatch(worker,/\(\(xx - width \* profile\["lipColorCenterX"\]\)/);
  assert.match(builder,/CHARACTER_PREFIXES = \("bedroom_", "xiaotao_"\)/);
  assert.match(builder,/connectedComponentsWithStats/);
});

test("bedroom wave repair uses only clean low-amplitude hand frames",async()=>{
  const source=await readFile(new URL("../scripts/repair_bedroom_wave.py",import.meta.url),"utf8");
  assert.match(source,/CLEAN_SOURCE_FRAMES = \(23, 24, 25, 26, 27\)/);
  assert.match(source,/cycle = \[23\] \* 3 \+ \[24\] \* 3 \+ \[25\] \* 3 \+ \[26\] \* 3 \+ \[27\] \* 3 \+ \[26\] \* 3 \+ \[25\] \* 3 \+ \[24\] \* 3/);
  assert.match(source,/full_mapping = first_half \+ list\(reversed\(first_half\)\)/);
  assert.match(source,/combined\["json_data"\] = \[original_json\[index\] for index in first_half\]/);
});

test("bedroom wave v2 cleanup removes only the leaked source-bench frames",async()=>{
  const source=await readFile(new URL("../scripts/repair_bedroom_wave_v2.py",import.meta.url),"utf8");
  assert.match(source,/DIRTY_FRAME_RANGES = \(\(20, 27\), \(194, 201\)\)/);
  assert.match(source,/PATCH_X, PATCH_Y, PATCH_WIDTH, PATCH_HEIGHT = 565, 495, 105, 105/);
  assert.match(source,/remove leaked source-bench fragment outside right shoulder/);
});

test("bedroom smile repair excludes the dark deep-smile mouth corners",async()=>{
  const source=await readFile(new URL("../scripts/repair_bedroom_smile.py",import.meta.url),"utf8");
  assert.match(source,/SOURCE_FRAMES = tuple\(range\(21\)\)/);
  assert.match(source,/smile_repair/);
  assert.match(source,/remove dark deep-smile mouth corners/);
});

test("rejects compressed audio before starting the DINet worker", async () => {
  const store = new DINetRenderStore({ projectRoot:"/project", autostart:false });
  await assert.rejects(
    store.render(Buffer.from("ID3xxxx")),
    error => error.status === 415 && /PCM WAV/.test(error.message)
  );
});

test("includes action package version in the DINet cache key",async()=>{
  const source=await readFile(new URL("../src/dinet-render.mjs",import.meta.url),"utf8");
  assert.match(source,/videoInfo\.size/);
  assert.match(source,/videoInfo\.mtimeMs/);
  assert.match(source,/dataInfo\.mtimeMs/);
  assert.match(source,/mouth-profile-v/);
  assert.match(source,/JSON\.stringify\(mouthProfile\)/);
});

test("bounds generated DINet media while protecting a newly returned file",async()=>{
  const source=await readFile(new URL("../src/dinet-render.mjs",import.meta.url),"utf8");
  assert.match(source,/new GeneratedMediaCache\(\{directory:this\.outputDir\}\)/);
  assert.match(source,/await this\.cache\.use\(outputPath\)/);
  assert.match(source,/this\.cache\.prune\(\{protectedPaths:\[outputPath\]\}\)/);
});

test("DINet streams raw frames into the final H.264 encode",async()=>{
  const source=await readFile(new URL("../scripts/dinet_worker.py",import.meta.url),"utf8");
  assert.match(source,/subprocess\.Popen/);
  assert.match(source,/"-f", "rawvideo"/);
  assert.match(source,/"-preset", "veryfast"/);
  assert.match(source,/if video_only:/);
  assert.match(source,/"-an"/);
  assert.match(source,/"videoOnly": video_only/);
  assert.match(source,/audio_offset_ms/);
  assert.match(source,/StreamingAudio2BlendShape/);
  assert.match(source,/stream_id/);
  assert.match(source,/cancel_stream/);
  assert.match(source,/prepare_asset/);
  assert.match(source,/"loadMs"/);
  assert.match(source,/source_upper_lips/);
  assert.match(source,/cv2\.dilate\(\s*source_upper_lips, np\.ones\(\(3, 3\)/);
  assert.match(source,/previous_visual_asset = self\.visual_turn_assets\.get/);
  assert.match(source,/transitionFrames/);
  assert.doesNotMatch(source,/cv2\.addWeighted/);
  assert.match(source,/close_visual_turn/);
  assert.doesNotMatch(source,/cv2\.VideoWriter/);
  assert.doesNotMatch(source,/silent_path/);
});

test("switches action silhouettes atomically without full-frame ghosting",async()=>{
  const source=await readFile(new URL("../scripts/dinet_worker.py",import.meta.url),"utf8");
  assert.match(source,/previous_visual_asset = self\.visual_turn_assets\.get\(visual_turn_id\)/);
  assert.match(source,/previous_visual_asset == str\(self\.asset\)/);
  assert.match(source,/frame_offset = self\.visual_turn_frame_offsets\[visual_turn_id\]/);
  assert.match(source,/self\.visual_turn_frame_offsets\[visual_turn_id\] =/);
  assert.match(source,/renderer\.visual_turn_frame_offsets\.pop/);
  assert.match(source,/transition_frames = 0/);
  assert.doesNotMatch(source,/cv2\.addWeighted/);
  assert.match(source,/self\.visual_turn_frames\[visual_turn_id\] = last_output_frame/);
});

test("neural avatar keeps a persistent idle layer behind speech", async () => {
  const [html, script,styles] = await Promise.all([
    readFile(new URL("../public/wav2lip-avatar/avatar.html", import.meta.url), "utf8"),
    readFile(new URL("../public/wav2lip-avatar/avatar.js", import.meta.url), "utf8"),
    readFile(new URL("../public/wav2lip-avatar/avatar.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="avatar-idle"/);
  assert.match(html, /id="avatar-speech"/);
  assert.match(script, /function keepIdlePlaying\(\)/);
  assert.doesNotMatch(script, /idleVideo\.pause\(\)|idleVideo\.currentTime\s*=/);
  assert.match(script, /revealAlignedIdle/);
  assert.match(script, /isSilentAction/);
  assert.match(script, /speechVideo\.muted = isSilentAction/);
  assert.match(script,/wav2lip-enqueue/);
  assert.match(script,/wav2lip-cancel/);
  assert.match(script,/cancelStreamRequest\(event\.data\.requestId\)/);
  assert.match(script,/segmentQueue/);
  assert.match(script,/createElement\("video"\)/);
  assert.match(script,/speech-segment/);
  assert.match(script,/requestVideoFrameCallback/);
  assert.match(script,/wav2lip-stream-end/);
  assert.match(script,/const STREAM_GAP_IDLE_MS=320/);
  assert.match(script,/else scheduleStreamGapReveal\(\)/);
  assert.match(script,/"wav2lip-gap-idle"/);
  assert.match(script,/RESUMABLE_PREVIEW_ACTIONS=new Set\(\["thinking","caring","nod","happy","idle"\]\)/);
  assert.match(script,/function canResumeWaitingPreview\(video\)/);
  assert.match(script,/keepWaitingPreview=previous===waitingPreview&&canResumeWaitingPreview\(previous\)/);
  assert.match(script,/preview=canResumeWaitingPreview\(waitingPreview\)\?waitingPreview:null/);
  assert.match(script,/notify\(preview\?"wav2lip-gap-preview":"wav2lip-gap-idle"/);
  assert.match(script,/if\(preview&&preview!==previous\)\{preview\.pause\(\);preview\.remove\(\);\}/);
  assert.ok(script.indexOf("clearTimeout(streamGapIdleTimer)")<script.indexOf("streamEnded=false"));
  assert.match(script,/activeSegment/);
  assert.match(script,/createBufferSource/);
  assert.match(script,/pcm_s16le/);
  assert.match(script,/video\.muted=externalAudio/);
  assert.match(script,/streamAudioTail/);
  assert.match(script,/pcmBytesPromise=loadPcmBytes\(item\.segment\?\.audio\)/);
  assert.match(script,/scheduleAfterMediaReady/);
  assert.match(script,/return scheduleSegmentAudio\(item,pcmBytesPromise,token\)/);
  assert.match(script,/Promise\.all\(\[ensureStreamAudio\(\),pcmBytesPromise\]\)/);
  assert.doesNotMatch(script,/audioScheduleChain\.then\(async\(\)=>\{await item\.videoReady/);
  assert.match(script,/stopStreamAudio/);
  assert.match(script,/video\.currentTime=catchup/);
  assert.match(script,/wav2lip-audio-mode/);
  assert.match(script,/loadeddata/);
  assert.match(script,/setTimeout\(done,2500\)/);
  assert.match(script,/playbackSequence:nextPlaybackSequence\+\+/);
  assert.match(script,/externalSegmentsPending/);
  assert.match(script,/handoffLateMs/);
  assert.match(script,/item\.videoOnly&&!externalAudio/);
  assert.match(script,/MediaSource\.isTypeSupported/);
  assert.match(script,/sourceBuffer\.mode="sequence"/);
  assert.match(script,/splitFragmentedMp4/);
  assert.match(script,/pruneFragmentedVideo\(playback\)/);
  assert.match(script,/sourceBuffer\.remove\(range\.start,range\.end\)/);
  assert.match(script,/MAX_VIDEO_AHEAD_SECONDS=4/);
  assert.match(script,/MAX_AUDIO_AHEAD_SECONDS=4/);
  assert.match(script,/scheduledAudioAhead\(streamAudioTail,context\.currentTime\)/);
  assert.match(script,/waitForFragmentCapacity\(playback,token\)/);
  assert.match(script,/playback\.startPromise\|\|=/);
  assert.match(script,/waitForFirstVideoFrame\(playback\.video\);playback\.video\.pause\(\)/);
  assert.match(script,/fragmentReadyToPlay:item\.fragmentReadyToPlay/);
  assert.match(script,/wav2lip-media-gate/);
  assert.ok(script.indexOf("item.fragmentReadyToPlay=queueFragmentedVideo")<script.indexOf("item.audioReady=audioScheduleChain"));
  assert.match(script,/continuousVideoSync\(playback\.audioOrigin,streamAudioContext\.currentTime/);
  assert.match(script,/item\.audioGapMs=gapMs/);
  assert.match(script,/continuousVideoOriginAfterGap\(playback\.audioOrigin,item\.audioGapMs\)/);
  assert.match(script,/if\(!item\.startedNotified\)/);
  assert.match(script,/resumedFromGap=activeSegment!==playback\.video/);
  assert.match(script,/resumedFromGap\}\);/);
  assert.match(script,/videoPrestartDelayMs/);
  assert.match(script,/videoBoundaryDelayMs/);
  assert.match(script,/wav2lip-audio-unlock/);
  assert.match(script,/mode:"pcm-ready",fragmentedVideo:false/);
  assert.match(script,/mode:"pcm-ready",fragmentedVideo:true,gapMs:0,prewarmed:true/);
  assert.match(script,/mode:"mp4",fragmentedVideo:false/);
  assert.doesNotMatch(script, /setTimeout\(playIdle,\s*250\)/);
  assert.match(styles,/object-fit:cover/);
  assert.match(styles,/\.avatar-layer#avatar-speech,\.avatar-layer\.speech-segment\{[^}]*transition:none/);
  assert.doesNotMatch(styles,/\.avatar-layer#avatar-speech,\.avatar-layer\.speech-segment\{[^}]*transition:opacity/);
  assert.match(script,/idleVideo\.poster=`\$\{characterRoot\}\/thumbnail\.jpg`/);
  assert.match(script,/stage\.style\.backgroundImage=/);
  assert.doesNotMatch(styles,/body\.loading #state/);
  assert.match(styles,/body\.needs-play #state\{opacity:1/);
});

test("stream endpoint reports TTS and first playable segment timing",async()=>{
  const [server,source]=await Promise.all([
    readFile(new URL("../server.mjs",import.meta.url),"utf8"),
    readFile(new URL("../src/dinet-render.mjs",import.meta.url),"utf8")
  ]);
  assert.match(server,/ttsFirstAudioMs:firstAudioAt/);
  assert.match(server,/sendEvent\(res,"audio-ready",\{audioMs:cached\.metrics\.audioMs\}\)/);
  assert.match(server,/firstSegmentMs:firstSegmentAt/);
  assert.match(server,/sendEvent\(res,"backchannel",backchannel\)/);
  assert.match(server,/sendEvent\(res,"backchannel",longWaitBackchannel\)/);
  assert.match(server,/LONG_WAIT_BACKCHANNEL_OFFER_MS/);
  assert.match(server,/\},BACKCHANNEL_OFFER_MS\):null/);
  assert.doesNotMatch(server,/const warmed=backchannelWarmup\?await backchannelWarmup:null/);
  assert.match(server,/reads the same in-flight cache promise/);
  assert.match(server,/backchannelPcm=\{\.\.\.trace\.backchannelPcm,status:"ready",audioMs:result\.metrics\.audioMs/);
  assert.match(server,/pipelineStartedAt/);
  assert.match(server,/sendEvent\(res,"tts-first-audio",\{firstAudioMs,requestSetupMs:/);
  assert.match(server,/onTiming:\(event,timing\)=>\{if\(event==="first-audio"\)ttsFirstAudioStages=timing;\}/);
  assert.match(server,/segment\.firstSegmentTiming=\{pcmBufferingMs:/);
  assert.match(server,/renderChain=renderChain\.then\(\(\)=>emitSegments\(false\)\);\s*\/\/[^\n]*\n(?:\s*\/\/[^\n]*\n){2}\s*void renderChain\.catch\(\(\)=>\{\}\);/);
  assert.match(server,/const includeClauses=fastSpeech&&!trace\.emittedSentences\.length/);
  assert.match(server,/includeClauses\?1:Infinity/);
  assert.match(server,/buildMiniMaxReply\(sentence,message,companionState,history,\{allowEmpty:true\}\)/);
  assert.ok(server.indexOf("if(!safeSentence){trace.filteredSentenceCount")<server.indexOf("firstSentenceEmitted=true"));
  assert.match(server,/if\(replyBudgetReached\)\{finishReason="local-length";void reader\.cancel\(\)\.catch\(\(\)=>\{\}\);break;\}/);
  assert.match(server,/const streamedReply=trace\.emittedSentences\.join\(""\)/);
  assert.match(server,/trace\.timings\.localLengthReachedMs/);
  assert.match(server,/sendEvent\(res,"sentence",\{text:safeSentence,emotion:sentenceResult\.emotion,action:sentenceResult\.action\}\)/);
  assert.match(source,/queueMs:metrics\.queueMs/);
  assert.match(source,/close\(\)\{return this\.worker\.close\(\);\}/);
  assert.match(source,/child\.kill\("SIGTERM"\)/);
  assert.match(server,/process\.once\("SIGTERM",\(\)=>void shutdown\("SIGTERM"\)\)/);
  assert.match(server,/if\(server\.listening\)await new Promise\(resolve=>server\.close\(resolve\)\)/);
  assert.match(source,/fragmented-video:/);
  assert.match(server,/shouldPrepareAvatarAction\(initialState\.action,\{fastSpeech\}\)\)prepareAvatarAction\(initialState\.action,trace,realAvatarCharacter\)/);
  assert.match(server,/shouldPrepareAvatarAction\(groundedResult\.action,\{fastSpeech:data\.fastSpeech\}\)\)prepareAvatarAction\(groundedResult\.action,trace,realAvatarCharacter\)/);
  assert.match(server,/assetPrepareMs/);
  assert.match(server,/videoOnly:data\.externalAudio===true/);
  assert.match(server,/binaryAudio:data\.binaryAudio===true/);
  assert.match(server,/fragmentedVideo:data\.fragmentedVideo===true/);
  assert.match(server,/CONTINUOUS_FIRST_SEGMENT_MS=240/);
  assert.match(server,/CONTINUOUS_MINIMUM_TAIL_MS=160/);
  assert.match(server,/continuousVideo\?\{firstSegmentMs:CONTINUOUS_FIRST_SEGMENT_MS,minimumTailMs:CONTINUOUS_MINIMUM_TAIL_MS\}:\{\}/);
  assert.match(server,/new PreparedTtsLease\(/);
  assert.match(server,/prepare:\(\)=>prepareTtsConnection\(\{voice,emotion:initialState\.emotion\}\)/);
  assert.match(server,/sendEvent\(res,"speech-ready",\{ttsConnectionId\}\)/);
  const streamHandler=server.slice(server.indexOf("async function miniMaxChatStream"),server.indexOf("async function chat(req"));
  assert.ok(streamHandler.indexOf("ttsLease.start()")<streamHandler.indexOf("fetchWithConnectionHedge(`${miniMaxBaseUrl}/chat/completions`"));
  assert.match(server,/firstSentenceEmitted=true;ttsLease\?\.freeze\(\)/);
  assert.match(server,/cachedPromptTokens:Number\(streamUsage\.prompt_tokens_details\?\.cached_tokens\)\|\|0/);
  assert.match(streamHandler,/catch\(error\)\{\s*ttsLease\?\.cancel\(\);\s*throw error;/);
  assert.match(streamHandler,/if \(!response\.ok \|\| !response\.body\)\{ttsLease\?\.cancel\(\)/);
  assert.match(server,/signal:client\.signal/);
  assert.match(server,/fetchWithConnectionHedge/);
  assert.match(server,/MINIMAX_HEDGE_DELAY_MS\?\?0/);
  assert.match(server,/MINIMAX_CHAT_WARMUP === "1"/);
  assert.match(server,/chatWarmupEnabled:miniMaxChatWarmup/);
  assert.match(server,/trace\.providerConnection=/);
  assert.match(server,/traceId:trace\.id/);
  assert.match(server,/sanitizeClientTiming\(data\)/);
  assert.match(server,/summarizeLatencySamples\(\[\.\.\.stored,\.\.\.live\]\)/);
  assert.match(server,/if\(timing\.event==="formal-speech"&&!trace\.latencyPersisted\)/);
  assert.match(server,/Object\.defineProperty\(trace,"_latencyPersisting"/);
  assert.match(server,/ttsLease\?\.cancel\(\)/);
  assert.match(server,/prewarmMiniMaxPcm\(\{text:backchannel\.text,voice,emotion:backchannel\.emotion,signal:client\.signal\}\)/);
  assert.match(server,/trimPcm16Silence\(Buffer\.concat\(chunks\)\)/);
  assert.match(server,/connection:preparedConnection,trimLeadingSilence:true/);
  assert.match(server,/takeTtsConnection\(data\.ttsConnectionId,\{model:miniMaxTtsModel,voice:resolvedVoice,emotion:data\.emotion\}\)/);
  assert.match(server,/onAudio:appendPcm,onTiming:[^\n]+,trimLeadingSilence:true/);
  assert.match(server,/if\(client\.signal\.aborted\)return/);
  assert.match(server,/connection:preparedConnection/);
  assert.match(server,/renderBackpressure:data\.renderBackpressure===true/);
  assert.match(server,/speculativeState&&firstSegmentSent/);
  assert.match(server,/maxSegments:speculativeState&&!speculativeState\.committed\?1:Infinity/);
  assert.match(server,/audio-chunk\|finish\|cancel\|ack\|commit/);
  assert.match(server,/audio-chunk\|finish\|cancel\|ack/);
  assert.match(server,/dinetStreams\.acknowledge/);
  assert.match(server,/visualTurns\.wait\(visualTurnId,visualSentenceIndex/);
  assert.match(server,/visualTurns\.finish\(visualTurnId,visualSentenceIndex\)/);
  assert.match(server,/dinetRenders\.closeVisualTurn/);
  assert.match(server,/\(finish\|skip\)/);
  assert.match(server,/visualTurns\.finish\(turnId,index\)/);
  assert.match(server,/function skipVisualSentence\(turnId,index\)/);
  assert.match(server,/await dinetRenders\.closeVisualTurn\?\.\(turnId\);\s*visualTurns\.finish\(turnId,index\)/);
  assert.match(server,/speculativeState&&!speculativeState\.committed\)await skipVisualSentence/);
  assert.match(server,/if\(!controller\.signal\.aborted\)sendEvent\(res,"error"/);
  const worker=await readFile(new URL("../scripts/dinet_worker.py",import.meta.url),"utf8");
  assert.match(worker,/frag_keyframe\+empty_moov\+default_base_moof/);
  assert.match(worker,/"-g", "20", "-keyint_min", "20", "-sc_threshold", "0"/);
  assert.match(server,/^\s*const pcmMatch=pathname\.match/m);
  assert.match(server,/cache-control":"no-store"/);
  assert.match(server,/streams:dinetStreams\.snapshot\(\)/);
});

test("prepares a character-specific resolved action through the serialized persistent worker",async()=>{
  const source=await readFile(new URL("../src/dinet-render.mjs",import.meta.url),"utf8");
  assert.match(source,/prepareAction\(action="idle",character="lumi"\)\{return this\.worker\.prepare\(resolveRealSpeechActionAsset\(action,character\)\);\}/);
  assert.match(source,/const asset=resolveRealSpeechActionAsset\(action,character\)/);
  assert.match(source,/op:"prepare_asset"/);
  assert.match(source,/this\.chain\.then/);
});

test("action preparation diagnostic endpoint stays loopback-only",async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(server,/pathname==="\/api\/dinet\/prepare-action"/);
  assert.match(server,/isLoopbackAddress\(req\.socket\.remoteAddress\)/);
  assert.match(server,/dinetRenders\.prepareAction/);
  assert.match(server,/preview:resolveWaitingActionPreview\(action,character\)/);
  assert.match(server,/cache:await dinetRenders\.cacheStatus\(\)/);
});
