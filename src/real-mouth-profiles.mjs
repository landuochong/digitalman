import { readFileSync } from "node:fs";

const CONFIG_URL = new URL("../config/real-avatar-mouth-profiles.json", import.meta.url);
const document = JSON.parse(readFileSync(CONFIG_URL, "utf8"));

const RULES = Object.freeze({
  mouthMotionScale:[0.65, 1.15],
  mouthWidthScale:[0.65, 1.10],
  mouthHeightScale:[0.75, 1.15],
  compositeCenterX:[0.42, 0.58],
  compositeCenterY:[0.32, 0.52],
  lipColorCenterX:[0.42, 0.58],
  lipColorCenterY:[0.40, 0.58],
  lipColorStrength:[0, 1],
  lipBrightnessOffset:[-12, 20],
  teethStrength:[0, 1],
});

function boundedNumber(value, [minimum, maximum], key) {
  const number=Number(value);
  if(!Number.isFinite(number)||number<minimum||number>maximum){
    throw new Error(`真人口型配置 ${key} 必须在 ${minimum}-${maximum} 之间`);
  }
  return number;
}

function normalizeProfile(profile={}, defaults={}) {
  return Object.freeze(Object.fromEntries(Object.entries(RULES).map(([key,range])=>[
    key,boundedNumber(profile[key] ?? defaults[key], range, key)
  ])));
}

const defaultProfile=normalizeProfile(document.defaults);
const profiles=Object.freeze(Object.fromEntries(Object.entries(document.characters||{}).map(([character,profile])=>[
  character,normalizeProfile(profile,defaultProfile)
])));

export const REAL_MOUTH_PROFILE_VERSION=Number(document.version)||1;

export function resolveRealMouthProfile(character) {
  return profiles[String(character||"").trim()]||defaultProfile;
}
