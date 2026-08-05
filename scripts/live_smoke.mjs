import assert from "node:assert/strict";

process.env.NODE_ENV = "test";
const { server } = await import("../server.mjs");

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});

const { port } = server.address();
const base = `http://127.0.0.1:${port}`;

try {
  const health = await fetch(`${base}/api/health`).then((response) => response.json());
  assert.equal(health.ok, true);
  assert.equal(health.mode, "minimax");

  const streamStarted = performance.now();
  const chatResponse = await fetch(`${base}/api/chat/stream`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message: "请用一句话鼓励今天认真生活的我。", history: [], userId: "live-smoke" })
  });
  assert.equal(chatResponse.status, 200);
  assert.match(chatResponse.headers.get("content-type") || "", /text\/event-stream/);
  const reader = chatResponse.body.getReader(), decoder = new TextDecoder();
  let streamBuffer = "", firstSentenceMs, chat;
  while (true) {
    const { value, done } = await reader.read();
    streamBuffer += decoder.decode(value || new Uint8Array(), { stream:!done });
    const blocks = streamBuffer.split(/\r?\n\r?\n/); streamBuffer = blocks.pop() || "";
    for (const block of blocks) {
      const event = block.match(/^event:\s*(.+)$/m)?.[1];
      const data = block.match(/^data:\s*(.+)$/m)?.[1];
      if (!data) continue;
      const parsed = JSON.parse(data);
      if (event === "sentence" && firstSentenceMs === undefined) firstSentenceMs = Math.round(performance.now() - streamStarted);
      if (event === "done") chat = parsed;
    }
    if (done) break;
  }
  assert.equal(chat?.mode, "minimax");
  assert.ok(chat?.reply?.length > 2);
  assert.ok(firstSentenceMs > 0, "没有收到流式句子事件");
  assert.doesNotMatch(chat.reply, /\b(?:emotion|action|happy|caring|idle|thinking)\b/i);

  const speechResponse = await fetch(`${base}/api/speech`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "今天也辛苦了，我会陪着你。", emotion: "caring" })
  });
  const audio = new Uint8Array(await speechResponse.arrayBuffer());
  assert.equal(speechResponse.status, 200, new TextDecoder().decode(audio));
  assert.equal(speechResponse.headers.get("content-type"), "audio/wav");
  assert.ok(audio.length > 1000, "MiniMax TTS 返回的 WAV 过小");
  assert.equal(new TextDecoder().decode(audio.slice(0, 4)), "RIFF", "MiniMax TTS 返回的不是标准 WAV");
  const wav = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  assert.equal(wav.getUint16(22, true), 1, "WAV 必须为单声道");
  assert.equal(wav.getUint32(24, true), 16000, "WAV 必须为 16 kHz");
  assert.equal(wav.getUint16(34, true), 16, "WAV 必须为 PCM_16");

  console.log(JSON.stringify({
    ok: true,
    provider: health.mode,
    textModel: health.textModel,
    ttsModel: health.ttsModel,
    reply: chat.reply,
    emotion: chat.emotion,
    firstSentenceMs,
    audioBytes: audio.length,
    audioType: speechResponse.headers.get("content-type")
  }, null, 2));
} finally {
  await new Promise((resolve) => server.close(resolve));
}
