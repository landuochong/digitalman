const DEFAULT_REAL_CHARACTER="lumi";

const CHARACTER_ACTION_ASSETS=Object.freeze({
  lumi:Object.freeze({
    idle:"bedroom_idle_test",happy:"bedroom_smile_test",smile:"bedroom_smile_test",
    shy:"bedroom_idle_test",clap:"bedroom_clap",cheer:"bedroom_cheer",
    wave_approval:"bedroom_wave_v2",nod:"bedroom_agree_test",thumbs_up:"bedroom_thumbs_up",
    bow:"bedroom_agree_test",caring:"bedroom_caring",thinking:"bedroom_thinking",
    surprise:"bedroom_idle_test",shrug:"bedroom_shrug",cross:"bedroom_cross",
    confident_arms_crossed:"bedroom_arms_crossed",
  }),
  xiaotao:Object.freeze({
    idle:"xiaotao_idle",happy:"xiaotao_smile",smile:"xiaotao_smile",
    shy:"xiaotao_idle",clap:"xiaotao_clap",cheer:"xiaotao_cheer",
    wave_approval:"xiaotao_wave",nod:"xiaotao_nod",thumbs_up:"xiaotao_thumbs_up",
    bow:"xiaotao_idle",caring:"xiaotao_caring",thinking:"xiaotao_thinking",
    surprise:"xiaotao_idle",shrug:"xiaotao_shrug",cross:"xiaotao_cross",
    confident_arms_crossed:"xiaotao_arms_crossed",
  }),
});

// Some expressive source clips are safe as silent reactions but provide a
// poor neutral mouth canvas for DINet. Keep the visible action catalog intact
// and only substitute the source used while synthesizing speech.
const CHARACTER_SPEECH_OVERRIDES=Object.freeze({
  xiaotao:Object.freeze({happy:"xiaotao_idle",smile:"xiaotao_idle",nod:"xiaotao_idle",thinking:"xiaotao_idle"}),
});

export const REAL_AVATAR_CHARACTERS=Object.freeze({
  lumi:Object.freeze({id:"lumi",label:"露米",idleAsset:"bedroom_idle_test"}),
  xiaotao:Object.freeze({id:"xiaotao",label:"小桃",idleAsset:"xiaotao_idle"}),
});

export function normalizeRealAvatarCharacter(character){
  const normalized=String(character||"").trim();
  return CHARACTER_ACTION_ASSETS[normalized]?normalized:DEFAULT_REAL_CHARACTER;
}

export function listRealActionAssets(character=DEFAULT_REAL_CHARACTER){
  const assets=CHARACTER_ACTION_ASSETS[normalizeRealAvatarCharacter(character)];
  return [...new Set(Object.values(assets))];
}

export function resolveRealActionAsset(action,character=DEFAULT_REAL_CHARACTER){
  const assets=CHARACTER_ACTION_ASSETS[normalizeRealAvatarCharacter(character)];
  return assets[String(action||"").trim()]||assets.idle;
}

export function resolveRealSpeechActionAsset(action,character=DEFAULT_REAL_CHARACTER){
  const characterId=normalizeRealAvatarCharacter(character),normalized=String(action||"").trim();
  return CHARACTER_SPEECH_OVERRIDES[characterId]?.[normalized]||resolveRealActionAsset(normalized,characterId);
}

const WAITING_PREVIEW_ACTIONS=new Set(["happy","caring","thinking","nod","thumbs_up","shy"]);
export function resolveWaitingActionPreview(action,character=DEFAULT_REAL_CHARACTER){
  const normalized=String(action||"").trim();
  if(!WAITING_PREVIEW_ACTIONS.has(normalized))return null;
  const characterId=normalizeRealAvatarCharacter(character),asset=resolveRealActionAsset(normalized,characterId);
  const url=normalized==="shy"
    ?characterId==="xiaotao"?"/real-actions/xiaotao_shy_once_fast.mp4":"/real-actions/bedroom_surprise_silent.mp4"
    :`/dh-live/actions/${asset}/01.mp4`;
  return normalized==="shy"&&characterId==="xiaotao"
    ?{action:normalized,asset,url,loop:false,durationMs:3360,overlaySpeech:true}
    :{action:normalized,asset,url};
}

export function resolveSilentRealAction(action,character=DEFAULT_REAL_CHARACTER){
  const characterId=normalizeRealAvatarCharacter(character),normalized=String(action||"").trim();
  if(!new Set(["bow","surprise"]).has(normalized))return null;
  if(characterId==="xiaotao")return`/dh-live/actions/xiaotao_${normalized}/01.mp4`;
  return normalized==="bow"?"/real-actions/bedroom_bow_front_silent.mp4":"/real-actions/bedroom_surprise_silent.mp4";
}

export function listRealActionSupport(character=DEFAULT_REAL_CHARACTER){
  const characterId=normalizeRealAvatarCharacter(character),assets=CHARACTER_ACTION_ASSETS[characterId];
  return Object.entries(assets).map(([action,asset])=>({
    action,asset,character:characterId,distinct:action==="idle"||asset!==assets.idle
  }));
}
