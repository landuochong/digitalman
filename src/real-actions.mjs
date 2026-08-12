export const REAL_ACTION_ASSETS=Object.freeze({
  idle:"bedroom_idle_test",
  happy:"bedroom_smile_test",
  smile:"bedroom_smile_test",
  shy:"bedroom_shy",
  clap:"bedroom_clap",
  cheer:"bedroom_cheer",
  wave_approval:"bedroom_wave",
  nod:"bedroom_agree_test",
  thumbs_up:"bedroom_agree_test",
  bow:"bedroom_agree_test",
  caring:"bedroom_caring",
  thinking:"bedroom_thinking",
  // A hand covers the mouth in this clip. The main page plays the original
  // video silently; direct DINet requests fall back to idle to avoid drawing
  // a synthetic mouth through the fingers.
  surprise:"bedroom_idle_test",
  shrug:"bedroom_shrug",
  cross:"bedroom_cross",
  confident_arms_crossed:"bedroom_arms_crossed",
});

export function listRealActionAssets(){
  return [...new Set(Object.values(REAL_ACTION_ASSETS))];
}

export function resolveRealActionAsset(action){
  return REAL_ACTION_ASSETS[String(action||"").trim()]||REAL_ACTION_ASSETS.idle;
}

export function listRealActionSupport(){
  return Object.entries(REAL_ACTION_ASSETS).map(([action,asset])=>({
    action,asset,distinct:action==="idle"||asset!==REAL_ACTION_ASSETS.idle
  }));
}
