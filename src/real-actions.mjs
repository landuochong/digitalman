// The browser and server deliberately share one action catalog. Keeping a
// second server-only copy previously allowed the test buttons and live chat to
// resolve the same semantic gesture to different videos.
export {
  REAL_AVATAR_CHARACTERS,
  listRealActionAssets,
  listRealActionSupport,
  normalizeRealAvatarCharacter,
  resolveRealActionAsset,
  resolveRealSpeechActionAsset,
  resolveSilentRealAction,
  resolveWaitingActionPreview,
} from "../public/real-action-catalog.js";
