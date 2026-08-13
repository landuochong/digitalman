import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { buildDINetWorkerCommand, DINetRenderStore } from "../src/dinet-render.mjs";
import { resolveRealActionAsset, resolveWaitingActionPreview } from "../src/real-actions.mjs";

test("development watch excludes generated avatar media",async()=>{
  const pkg=JSON.parse(await readFile(new URL("../package.json",import.meta.url),"utf8"));
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
  assert.equal(resolveRealActionAsset("wave_approval"),"bedroom_wave");
  assert.equal(resolveRealActionAsset("nod"),"bedroom_agree_test");
  assert.equal(resolveRealActionAsset("thumbs_up"),"bedroom_agree_test");
  assert.equal(resolveRealActionAsset("clap"),"bedroom_clap");
  assert.equal(resolveRealActionAsset("thinking"),"bedroom_thinking");
  assert.equal(resolveRealActionAsset("surprise"),"bedroom_idle_test");
  assert.equal(resolveRealActionAsset("cross"),"bedroom_cross");
  assert.equal(resolveRealActionAsset("confident_arms_crossed"),"bedroom_arms_crossed");
  assert.equal(resolveRealActionAsset("unknown"),"bedroom_idle_test");
  assert.deepEqual(resolveWaitingActionPreview("caring"),{action:"caring",asset:"bedroom_caring",url:"/dh-live/actions/bedroom_caring/01.mp4"});
  assert.equal(resolveWaitingActionPreview("clap"),null);
  assert.equal(resolveWaitingActionPreview("surprise"),null);
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
  assert.match(source,/transition_source = self\.visual_turn_frames\.get/);
  assert.match(source,/previous_visual_asset = self\.visual_turn_assets\.get/);
  assert.match(source,/cv2\.addWeighted/);
  assert.match(source,/transitionFrames/);
  assert.match(source,/close_visual_turn/);
  assert.doesNotMatch(source,/cv2\.VideoWriter/);
  assert.doesNotMatch(source,/silent_path/);
});

test("neural avatar keeps a persistent idle layer behind speech", async () => {
  const [html, script,styles] = await Promise.all([
    readFile(new URL("../public/wav2lip-avatar/avatar.html", import.meta.url), "utf8"),
    readFile(new URL("../public/wav2lip-avatar/avatar.js", import.meta.url), "utf8"),
    readFile(new URL("../public/wav2lip-avatar/avatar.css", import.meta.url), "utf8")
  ]);
  assert.match(html, /id="avatar-idle"/);
  assert.match(html, /id="avatar-speech"/);
  assert.match(script, /reflectedIdleTime/);
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
  assert.match(script,/fragmentReadyToPlay:item\.fragmentReadyToPlay/);
  assert.match(script,/wav2lip-media-gate/);
  assert.ok(script.indexOf("item.fragmentReadyToPlay=queueFragmentedVideo")<script.indexOf("item.audioReady=audioScheduleChain"));
  assert.match(script,/continuousVideoSync\(playback\.audioOrigin,streamAudioContext\.currentTime/);
  assert.match(script,/videoPrestartDelayMs/);
  assert.match(script,/videoBoundaryDelayMs/);
  assert.match(script,/wav2lip-audio-unlock/);
  assert.match(script,/mode:context\?"pcm-ready":"mp4"/);
  assert.doesNotMatch(script, /setTimeout\(playIdle,\s*250\)/);
  assert.match(styles,/object-fit:cover/);
  assert.match(styles,/lumi-bedroom-background-v1\.png/);
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
  assert.match(server,/\},BACKCHANNEL_OFFER_MS\):null/);
  assert.doesNotMatch(server,/const warmed=backchannelWarmup\?await backchannelWarmup:null/);
  assert.match(server,/reads the same in-flight cache promise/);
  assert.match(server,/backchannelPcm=\{\.\.\.trace\.backchannelPcm,status:"ready",audioMs:result\.metrics\.audioMs/);
  assert.match(server,/pipelineStartedAt/);
  assert.match(server,/const includeClauses=fastSpeech&&!trace\.emittedSentences\.length/);
  assert.match(server,/if\(replyBudgetReached\)\{finishReason="local-length";void reader\.cancel\(\)\.catch\(\(\)=>\{\}\);break;\}/);
  assert.match(server,/const streamedReply=trace\.emittedSentences\.join\(""\)/);
  assert.match(server,/trace\.timings\.localLengthReachedMs/);
  assert.match(server,/sendEvent\(res,"sentence",\{text:safeSentence,emotion:sentenceResult\.emotion,action:sentenceResult\.action\}\)/);
  assert.match(source,/queueMs:metrics\.queueMs/);
  assert.match(source,/fragmented-video:/);
  assert.match(server,/shouldPrepareAvatarAction\(initialState\.action,\{fastSpeech\}\)\)prepareAvatarAction\(initialState\.action,trace\)/);
  assert.match(server,/shouldPrepareAvatarAction\(groundedResult\.action,\{fastSpeech:data\.fastSpeech\}\)\)prepareAvatarAction\(groundedResult\.action,trace\)/);
  assert.match(server,/assetPrepareMs/);
  assert.match(server,/videoOnly:data\.externalAudio===true/);
  assert.match(server,/binaryAudio:data\.binaryAudio===true/);
  assert.match(server,/fragmentedVideo:data\.fragmentedVideo===true/);
  assert.match(server,/CONTINUOUS_FIRST_SEGMENT_MS=400/);
  assert.match(server,/CONTINUOUS_MINIMUM_TAIL_MS=160/);
  assert.match(server,/continuousVideo\?\{firstSegmentMs:CONTINUOUS_FIRST_SEGMENT_MS,minimumTailMs:CONTINUOUS_MINIMUM_TAIL_MS\}:\{\}/);
  assert.match(server,/new PreparedTtsLease\(/);
  assert.match(server,/prepare:\(\)=>prepareTtsConnection\(\{voice,emotion:initialState\.emotion\}\)/);
  assert.match(server,/sendEvent\(res,"speech-ready",\{ttsConnectionId\}\)/);
  const streamHandler=server.slice(server.indexOf("async function miniMaxChatStream"),server.indexOf("async function chat(req"));
  assert.ok(streamHandler.indexOf("ttsLease.start()")<streamHandler.indexOf("response=await fetch(`${miniMaxBaseUrl}/chat/completions`"));
  assert.match(server,/firstSentenceEmitted=true;ttsLease\?\.freeze\(\)/);
  assert.match(server,/cachedPromptTokens:Number\(streamUsage\.prompt_tokens_details\?\.cached_tokens\)\|\|0/);
  assert.match(streamHandler,/catch\(error\)\{\s*ttsLease\?\.cancel\(\);\s*throw error;/);
  assert.match(streamHandler,/if \(!response\.ok \|\| !response\.body\)\{ttsLease\?\.cancel\(\)/);
  assert.match(server,/signal:client\.signal/);
  assert.match(server,/ttsLease\?\.cancel\(\)/);
  assert.match(server,/prewarmMiniMaxPcm\(\{text:backchannel\.text,voice,emotion:backchannel\.emotion,signal:client\.signal\}\)/);
  assert.match(server,/trimPcm16Silence\(Buffer\.concat\(chunks\)\)/);
  assert.match(server,/connection:preparedConnection,trimLeadingSilence:true/);
  assert.match(server,/onAudio:appendPcm,trimLeadingSilence:true/);
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
});

test("prepares a resolved action through the serialized persistent worker",async()=>{
  const source=await readFile(new URL("../src/dinet-render.mjs",import.meta.url),"utf8");
  assert.match(source,/prepareAction\(action="idle"\)\{return this\.worker\.prepare\(resolveRealActionAsset\(action\)\);\}/);
  assert.match(source,/op:"prepare_asset"/);
  assert.match(source,/this\.chain\.then/);
});

test("action preparation diagnostic endpoint stays loopback-only",async()=>{
  const server=await readFile(new URL("../server.mjs",import.meta.url),"utf8");
  assert.match(server,/pathname==="\/api\/dinet\/prepare-action"/);
  assert.match(server,/isLoopbackAddress\(req\.socket\.remoteAddress\)/);
  assert.match(server,/dinetRenders\.prepareAction/);
  assert.match(server,/preview:resolveWaitingActionPreview\(action\)/);
  assert.match(server,/cache:await dinetRenders\.cacheStatus\(\)/);
});
