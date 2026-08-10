export const REAL_ACTION_ASSETS=Object.freeze({
  idle:"lakeside_idle_test",
  happy:"lakeside_smile_test",
  smile:"lakeside_smile_test",
  shy:"lakeside_shy",
  clap:"lakeside_clap",
  cheer:"lakeside_cheer",
  wave_approval:"lakeside_wave",
  nod:"lakeside_agree_test",
  bow:"lakeside_agree_test",
  caring:"lakeside_caring",
  thinking:"lakeside_thinking",
  // A hand covers the mouth in this clip. The main page plays the original
  // video silently; direct DINet requests fall back to idle to avoid drawing
  // a synthetic mouth through the fingers.
  surprise:"lakeside_idle_test",
  shrug:"lakeside_shrug",
  cross:"lakeside_cross",
  confident_arms_crossed:"lakeside_arms_crossed",
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
