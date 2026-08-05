let rendererReady = false;
const queuedAudio = [];
let queuedAction = null;

async function switchAction(action, requestId) {
  try {
    const selected = await window.switchDhLiveAction?.(action);
    parent.postMessage({ type: "dh-live-action-ready", action: selected || action, requestId }, location.origin);
  } catch (error) {
    parent.postMessage({ type: "dh-live-action-error", action, requestId, error: error.message }, location.origin);
  }
}

function sendAudioToRenderer(buffer) {
  if (!rendererReady || !window.Module?._setAudioBuffer) {
    queuedAudio.push(buffer);
    return;
  }
  const bytes = new Uint8Array(buffer);
  const pointer = Module._malloc(bytes.byteLength);
  Module.HEAPU8.set(bytes, pointer);
  Module._setAudioBuffer(pointer, bytes.byteLength);
  Module._free(pointer);
  parent.postMessage({ type: "dh-live-audio-accepted", bytes: bytes.byteLength }, location.origin);
}

window.addEventListener("dh-live-renderer-ready", () => {
  rendererReady = true;
  if (queuedAction) { switchAction(queuedAction.action, queuedAction.requestId); queuedAction = null; }
  while (queuedAudio.length) sendAudioToRenderer(queuedAudio.shift());
  parent.postMessage({ type: "dh-live-ready" }, location.origin);
});

window.addEventListener("message", event => {
  if (event.origin !== location.origin || event.source !== parent) return;
  if (event.data?.type === "dh-live-audio") {
    const audio = event.data.audio;
    if (audio instanceof ArrayBuffer) sendAudioToRenderer(audio);
    else if (ArrayBuffer.isView(audio)) sendAudioToRenderer(audio.buffer.slice(audio.byteOffset, audio.byteOffset + audio.byteLength));
  }
  if (event.data?.type === "dh-live-clear") {
    queuedAudio.length = 0;
    if (rendererReady && window.Module?._clearAudio) Module._clearAudio();
  }
  if (event.data?.type === "dh-live-action") {
    const request = { action:event.data.action, requestId:event.data.requestId };
    if (rendererReady) switchAction(request.action, request.requestId);
    else queuedAction = request;
  }
});
