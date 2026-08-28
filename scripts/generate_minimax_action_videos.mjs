#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const PROJECT_ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const DEFAULT_REFERENCE = path.join(PROJECT_ROOT, "public", "assets", "lumi-mature-reference-v1.png");
const DEFAULT_OUTPUT = path.join(PROJECT_ROOT, "resources", "minimax-generated", "lumi-mature-v1");
const API_BASE = "https://api.minimaxi.com";
const POLL_INTERVAL_MS = 10_000;
const LAKESIDE_ACTION_BASE = `Use the exact same cute young adult woman from the reference image: identical face, long dark hair, pink flower accessory, sailor-style white top, pleated skirt, body proportions, lakeside sunset background, framing, lighting and colors. Locked camera, full body centered, no zoom, no reframing, no background change. Her eyes remain naturally focused toward the camera. Her small narrow lips stay gently closed for the entire video, with warm coral-pink color, no teeth, no speech, no singing and no lip movement. The motion is subtle and physically natural, never exaggerated. Start from the exact reference pose and return smoothly to that exact pose at the end.`;
const XIAOTAO_GREEN_BASE = `Use the exact same adult East Asian woman from the reference image: identical face, long dark-brown hair, white fitted T-shirt with the original pastel cherry-blossom-and-ribbon illustration, pastel-pink high-waisted A-line skirt, white shoes and natural body proportions. Preserve the perfectly uniform chroma green #00FF00 background exactly across every frame: no room, scenery, floor horizon, texture, gradient, shadow, reflection, green spill or background movement. Locked straight-on camera, full body centered at the exact same scale, complete hair, arms, hands, skirt, legs and shoes visible, no zoom, pan, crop or reframing. Soft even frontal studio lighting, no backlight, rim light or hair halo. Her eyes remain naturally focused toward the camera. Her small natural lips stay gently closed for the entire video, no teeth, speech, singing or lip movement. Motion is subtle, anatomically correct and physically natural. Start from the exact reference pose and return smoothly to that exact pose at the end.`;
const FEIYIN_GREEN_BASE = `Use the exact same clearly adult anime woman from the reference image: identical mature face, pale skin, clear blue eyes, center-parted very long black hair, symmetrical gold drop earrings, fitted deep-red satin shirt-dress with the exact same tasteful deep V open collar and breast coverage, gold buttons, three-quarter sleeves, asymmetrical hem, black pumps and natural adult body proportions. Never alter the neckline depth, cleavage, dress closure, facial identity, earrings or body shape. Preserve the perfectly uniform chroma green #00FF00 background exactly across every frame: no room, scenery, floor horizon, texture, gradient, shadow, reflection, green spill or background movement. Locked straight-on camera, full body centered at the exact same scale, complete hair, arms, hands, dress, legs and shoes visible, no zoom, pan, crop or reframing. Soft even frontal studio lighting, no backlight, rim light or hair halo. Keep the long black hair behind the torso and separated from both arms. Her eyes remain naturally focused toward the camera. Her natural lips stay gently closed for the entire video, no teeth, speech, singing or lip movement. Motion is subtle, anatomically correct and physically natural. Start from the exact neutral reference stance with both arms hanging naturally beside the body and the feet close together, then return smoothly to that exact relaxed stance at the end. Never raise or spread the arms unless the requested action explicitly requires it, and never widen the standing stance.`;
const FEIYIN_IDLE_PROMPT = `${FEIYIN_GREEN_BASE} 让人物产生清楚可见但幅度克制的自然待机动作。在视频前三秒内，上胸口和肩膀完成一次缓慢自然的呼吸循环：吸气时轻微抬起，呼气时平滑落回；正常速度播放时必须可以看出呼吸，不能保持静止。约1.5秒时，两只眼睛同时完成一次自然眨眼，眼皮完整闭合后重新睁开。约3秒时，双手手指各做一次极轻微的放松调整，然后恢复原始形状。头部保持正直并面向镜头，双臂自然垂下，双脚保持窄站姿。人物不能左右摇摆、迈步、微笑或移动嘴唇。呼吸、眨眼和手指动作必须真实发生在人物身体上，绝对不能用背景、灯光、镜头或场景变化代替人物运动。视频最后平滑回到与参考图完全相同的人物位置、大小、头部角度、手臂位置、双手位置、双腿间距和中性表情。`;
const FEIYIN_WAVE_PROMPT = `${FEIYIN_GREEN_BASE} 人物先短暂保持自然站姿，随后只将右前臂和右手沿身体右前方抬到肩膀高度。右手掌心朝向镜头，用克制的手腕动作友好挥手两次。食指、中指、无名指和小指自然排列，只留狭窄真实间隙，拇指清晰显示在手掌侧面；整只右手必须清晰、不透明且符合人体结构。左臂、躯干、髋部、双腿和双脚保持不动，右肘不得高于肩膀。第二次挥手结束后，右臂沿原路径平滑放下，右手回到大腿外侧的初始位置。所有运动必须发生在人物右臂和右手上，背景必须在每一帧保持完全相同的纯绿色 #00FF00，禁止用背景、灯光、镜头或场景变化代替人物动作。视频最后平滑回到与参考图完全相同的人物位置、大小、头部角度、双臂位置、双手位置、双腿间距和中性表情。`;
const FEIYIN_NOD_PROMPT = `${FEIYIN_GREEN_BASE} 人物在第一秒保持身体完全直立并直视镜头。随后眼神变得略微柔和，形成极轻微、自然的认同式闭嘴微笑。视频中段只让下巴向下移动约三度，随后立即沿相同路径抬回初始角度。完整下压和回正持续约0.6秒，并且只发生一次。点头过程中，两只眼睛的瞳孔和眼白在每一帧都必须清晰可见，不得眨眼或闭眼。肩膀、锁骨、躯干、头发、双臂、双手、髋部、双腿和双脚保持不动。这是聊天中表示认同的一次短促轻点头，不是鞠躬。禁止长时间低头、重复点头、左右歪头、弯腰、肩膀下沉或向上过冲。所有运动必须发生在人物头部和轻微表情上，背景必须在每一帧保持完全相同的纯绿色 #00FF00。点头完成后，头部角度和轻微微笑平滑恢复为参考图的中性状态。`;

const ACTIONS = {
  idle: {
    filename: "idle.mp4",
    prompt: `固定机位的可爱真人数字伙伴待机镜头。严格保持参考图中的同一位年轻成年女性、脸型、五官、长发、粉色花朵发饰、海军风白色上衣和百褶裙、身材比例、湖边背景、构图、夕阳光线和颜色完全一致。她始终站在画面正中央，双脚和躯干位置不移动，肩膀放松，双臂和藏在身后的双手保持参考图姿势不变。只允许非常轻微且连续的自然呼吸和一次自然眨眼；眼神明亮、友善、稳定地看向镜头。保持参考图中小巧、窄而自然的嘴型，绝对不能把嘴或嘴角横向放大；保留自然好看的暖珊瑚粉唇色，不变成灰粉或紫色。头部不摇晃，眼睛不左右乱看，身体不左右摆动，裙摆和头发不飘动。嘴唇始终轻柔闭合，不咧嘴微笑，不露牙，不说话，不发声。镜头完全静止，无推拉、无摇移、无变焦。首尾姿势和位置完全相同，整体可爱、清新、自然，不幼稚、不夸张。`,
  },
  smile: {
    filename: "smile.mp4",
    prompt: `固定机位的可爱真人数字伙伴甜美微笑动作。严格保持参考图中的同一位年轻成年女性、脸型、五官、长发、粉色花朵发饰、海军风白色上衣和百褶裙、身材比例、湖边背景、构图、夕阳光线和颜色完全一致。她始终站在画面正中央，身体、肩膀、双臂和藏在身后的双手位置保持不变。开始时表情自然平静，随后缓慢露出清新、甜美、可爱的极轻微闭嘴微笑，脸颊微微上扬，眼神自然变得明亮柔和，停留片刻后平滑恢复初始表情。嘴和嘴角必须保持小巧、窄而自然，不能横向拉宽或变大；保留参考图的暖珊瑚粉自然唇色，不变成灰粉或紫色。可以有一次轻柔眨眼，但不能歪头或摇头。嘴唇始终闭合，不露牙，不说话，不发声；眼睛稳定看向镜头，不左右乱看；身体不摆动，裙摆和头发不飘动。镜头完全静止，无推拉、无摇移、无变焦。首尾姿势、位置和表情完全相同，动作可爱而克制。`,
  },
  agree: {
    filename: "agree.mp4",
    prompt: `固定机位的真人数字伙伴赞同动作。严格保持参考图中的同一位成年女性、脸型、五官、发型、酒红色连衣裙、身材比例、背景、构图、光线和颜色完全一致。她始终站在画面正中央，肩膀、双臂和双手保持放松且位置不变。她稳定看向镜头，缓慢而小幅地点头一次，配合轻微、克制的闭嘴微笑，然后自然回到初始平静姿势。点头幅度很小，只转动颈部，不带动身体前后或左右移动。嘴唇始终闭合，不露牙，不说话，不发声；眼睛不左右乱看，身体不摆动，衣服和头发不飘动。镜头完全静止，无推拉、无摇移、无变焦。首尾姿势和位置完全相同，动作真实自然。`,
  },
  agree_subtle: {
    filename: "agree-subtle.mp4",
    prompt: `固定机位的可爱真人数字伙伴做一次极轻微的赞同点头。严格保持参考图中的同一位年轻成年女性、脸型、五官、长发、粉色花朵发饰、海军风白色上衣和百褶裙、身材比例、湖边背景、构图、夕阳光线和颜色完全一致。她始终站在画面正中央，肩膀、锁骨、躯干、双臂和藏在身后的双手必须像固定住一样完全不动。她的眼睛全程明亮、友善并稳定直视镜头，不向下看。只允许颈部做一次幅度极小的点头：下巴向下移动不超过约一厘米，头部俯仰不超过约三度，随后立即平滑回到初始角度；配合甜美、可爱、克制的闭嘴微笑。绝对不能深低头、弯腰、鞠躬、歪头或带动肩膀。嘴唇始终闭合，不露牙，不说话，不发声。镜头完全静止，无推拉、无摇移、无变焦。首尾画面完全相同，动作清新可爱而自然。`,
  },
  idle_closed_cute: {
    filename: "idle-closed-cute.mp4",
    prompt:
      "A cute young adult woman matching the reference image exactly stands naturally by the lakeside at sunset. Preserve her face, long dark hair, pink flower hair accessory, sailor-style white top, pleated skirt, body proportions, lighting, and background. Keep both hands behind her back and keep her head and body facing the camera. She stays almost perfectly still with only subtle natural breathing and one soft blink. Preserve the reference's small, narrow, delicate mouth and warm natural coral-pink lip color exactly; never widen or enlarge the lips or mouth corners. Her lips remain gently sealed for the entire video with no smile, never opening and never showing teeth; no speech, no singing, no lip movement, no wink. Cute, clean, natural expression. Locked camera, no zoom, no reframing, no body sway, no walking, no hand movement, no background change.",
  },
  agree_micro_cute: {
    filename: "agree-micro-cute.mp4",
    prompt:
      "A cute young adult woman matching the reference image exactly stands naturally by the lakeside at sunset. Preserve her face, long dark hair, pink flower hair accessory, sailor-style white top, pleated skirt, body proportions, lighting, and background. Keep both hands behind her back and keep her body completely still. She looks directly into the camera with eyes open, gives a tiny warm closed-mouth smile, and for only a moment brings her chin inward by less than one centimeter, then immediately returns to the starting pose. Her forehead, eyes, and nose remain nearly at the same height; this is not a bow and not a downward head movement. Lips stay gently sealed, never show teeth; no speech, no lip movement, no wink. Locked camera, no zoom, no reframing, no body sway, no hand movement, no background change.",
  },
  wave: {
    filename:"wave.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She brings only her right hand from behind her back to shoulder height and gives two very small relaxed waves with the palm facing the camera. Keep the index, middle, ring and little fingers straight, naturally aligned and CLOSE TOGETHER as one clean silhouette, with absolutely no visible gaps, holes or bright slivers between those four fingers. Keep the thumb relaxed close to the side of the palm. The hand remains anatomically correct and sharply defined without fused, duplicated, missing or translucent fingers. Keep the wrist mostly straight and move the whole hand only a few degrees from the wrist; no fast motion blur. Then lower it behind her back. Keep the left arm, shoulders and torso still. Do not raise the elbow above shoulder level.`,
  },
  thumbs_up: {
    filename:"thumbs-up.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She brings only her right forearm forward to lower-chest height and makes one unmistakable thumbs-up gesture toward the camera. Her four fingers curl naturally into a compact fist while the thumb is fully extended straight vertically upward. The thumb must remain clearly separated from the curled fingers and fully visible; this is not an open palm, pointing gesture, wave, or nod. Keep the wrist straight, elbow relaxed below chest level, left arm behind her back, shoulders and torso still. Hold the vertical thumbs-up for about one second, then return the right hand behind her back.`,
  },
  clap: {
    filename:"clap.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She brings both forearms naturally forward and performs three gentle claps below her chin: palms vertical, fingers pointing upward, wrists aligned, elbows relaxed outward. The palms meet without crossing through each other. Then both hands return behind her back.`,
  },
  cheer: {
    filename:"cheer.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She makes one restrained celebratory gesture: both forearms rise beside her shoulders with small relaxed fists, pause briefly, then lower behind her back. Elbows stay below the top of her head; shoulders do not jump and the torso does not sway.`,
  },
  bow: {
    filename:"bow.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} Before bowing, she brings both hands from behind her back to the FRONT of her lower abdomen and rests one open hand gently over the other. Both complete arms must remain clearly visible from shoulder to elbow to wrist throughout the entire motion, with no forearm hidden behind her torso and no missing limb. Keeping the hands together in front, elbows relaxed slightly outward and wrists visible, she performs one small polite bow from the waist of approximately ten degrees. Her head stays aligned with her torso. She then returns upright and smoothly returns both hands behind her back. This is a short courteous bow, not a deep bow. No arm-body intersection, no hands behind the body during the bow, no disappearing arm, no cropped limb.`,
  },
  shy: {
    filename:"shy.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She shows a restrained shy reaction: her left hand rises lightly near one cheek without covering the face, her head tilts down and sideways only a few degrees, and a tiny closed-mouth smile appears. Then the hand returns behind her back and the head returns upright.`,
  },
  thinking: {
    filename:"thinking.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She makes a subtle thinking gesture: her right index finger rests lightly near the side of her chin, her head tilts only a few degrees, and her gaze shifts slightly upward for a moment without looking away from the camera. Then she returns her hand behind her back and faces forward.`,
  },
  caring: {
    filename:"caring.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She makes a gentle caring gesture: both hands come forward and rest softly together over the upper chest, shoulders relaxed, with a very slight sympathetic head tilt. Hold briefly, then return both hands behind her back and face forward.`,
  },
  surprise: {
    filename:"surprise.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She shows mild closed-mouth surprise: her right hand rises lightly in front of her lips without touching or covering the nose, eyebrows lift slightly and her head leans back only a few degrees. Her mouth remains fully closed. Then she returns to the exact calm reference pose.`,
  },
  shrug: {
    filename:"shrug.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She gives one small natural shrug: both shoulders rise slightly while her forearms move outward at waist level with relaxed open palms, then shoulders and hands return to the reference pose. No large arm spread and no torso sway.`,
  },
  shrug_left: {
    filename:"shrug-left.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She gives one small natural shrug: both shoulders rise slightly while her forearms move outward at waist level with relaxed open palms. At the same time, she gently tilts her head about eight degrees toward screen-left (toward her right shoulder), keeping her face visible and her eyes toward the camera. Hold briefly, then smoothly return her head, shoulders and hands to the exact reference pose. No large arm spread, no torso sway and no fast head movement.`,
  },
  shrug_left_v2: {
    filename:"shrug-left-v2.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She gives one small natural shrug: both shoulders rise slightly while her forearms move outward at waist level with relaxed open palms. At the same time, the TOP OF HER HEAD visibly moves toward the LEFT EDGE OF THE IMAGE, and the ear visible on the LEFT SIDE OF THE IMAGE moves closer to the shoulder on the LEFT SIDE OF THE IMAGE. This is a gentle counterclockwise head tilt of about eight degrees from the viewer's perspective. Keep her face visible and her eyes toward the camera. Hold briefly, then smoothly return her head, shoulders and hands to the exact reference pose. Never tilt toward the right edge of the image. No large arm spread, no torso sway and no fast head movement.`,
  },
  shrug_flower_left: {
    filename:"shrug-flower-left.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She gives one small natural shrug: both shoulders rise slightly while her forearms move outward only a little at waist level with relaxed open palms. At the same time, she gently tilts her head TOWARD THE PINK FLOWER HAIR ACCESSORY visible on the LEFT SIDE OF THE IMAGE. The flower-side ear moves closer to the flower-side shoulder, and the top of her head moves toward the flower and the left edge of the image. Keep her face visible and her eyes toward the camera. Hold briefly, then smoothly return her head, shoulders and hands to the exact reference pose. Never tilt away from the pink flower. No raised hands, no large arm spread, no torso sway and no fast head movement.`,
  },
  shrug_palms_up_left: {
    filename:"shrug-palms-up-left.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She makes a clear but restrained natural "I don't know" shrug. Both shoulders lift slightly. Both elbows bend and stay close to her waist. Both forearms move FORWARD in front of her body and slightly outward, with BOTH OPEN PALMS FACING UPWARD as if gently presenting or asking "what can I do?" Fingers are relaxed and naturally separated; the backs of the hands face downward. Her hands remain between waist and lower-chest height, never beside her body and never facing down. At the same time, she gently tilts her head toward the PINK FLOWER HAIR ACCESSORY on the LEFT SIDE OF THE IMAGE. Keep her face visible and eyes toward the camera. Hold the palms-up shrug briefly, then smoothly return head, shoulders and hands behind her back to the exact reference pose. No high raised hands, no palms facing the camera, no palms facing downward, no large arm spread, no torso sway and no fast movement.`,
  },
  cross: {
    filename:"cross.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She briefly brings both forearms in front of the upper chest to form a clear but gentle X-shaped refusal gesture, hands relaxed and below the chin, then uncrosses and returns both hands behind her back. Arms remain in front of the clothing without intersecting.`,
  },
  arms_crossed: {
    filename:"arms-crossed.mp4",
    prompt:`${LAKESIDE_ACTION_BASE} She brings both arms forward and folds them naturally across the lower chest in a calm confident pose, elbows relaxed and forearms visibly in front of the clothing. Hold briefly, then unfold and return both hands behind her back.`,
  },
};

const XIAOTAO_GREEN_ACTIONS = {
  idle: {
    filename: "idle.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She remains almost still with only subtle natural breathing and one soft blink. Both arms hang naturally with relaxed elbows and fingers. No head sway, wandering eyes, hair movement or skirt movement.`,
  },
  smile: {
    filename: "smile.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She slowly forms a tiny warm closed-mouth smile, cheeks lift only slightly, holds briefly, then returns to the exact neutral expression. Arms and body remain still. Never widen the mouth or create dark mouth corners.`,
  },
  agree_subtle: {
    filename: "agree-subtle.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} Match a quick subtle friendly agreement nod like a person acknowledging one sentence. Remain perfectly upright and look directly into the camera for the first second. In the middle of the video, lower ONLY the chin by about three degrees for a fraction of a second and immediately lift it back to the exact starting angle; the complete down-and-up gesture lasts about 0.6 seconds. Both pupils and the whites of both eyes must remain clearly visible in EVERY frame, with continuous eye contact and no blink during the nod. Keep a tiny closed-mouth smile. Shoulders, torso, hair, arms and hands remain completely still. No prolonged downward gaze, no closed or lowered eyelids, no repeated nod, no side tilt and no bowing from the waist.`,
  },
  wave: {
    filename: "wave.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She raises only her right hand to shoulder height and gives two small relaxed waves, palm facing camera. Four fingers stay naturally aligned with only narrow realistic gaps; thumb remains visible and relaxed. Keep the hand sharp, opaque and anatomically correct, then return it to the natural resting pose. Left arm and torso remain still.`,
  },
  thumbs_up: {
    filename: "thumbs-up.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She raises only her right forearm to lower-chest height and makes a clear vertical thumbs-up. Four fingers form a compact natural fist and the thumb points straight upward, fully visible. Hold briefly, then return to the resting pose.`,
  },
  clap: {
    filename: "clap.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} Match a natural gentle applause gesture. From the resting pose, lift both forearms smoothly along the FRONT of the torso without first spreading the arms sideways. Keep elbows relaxed near the waist. Bring two vertical palms together at mid-chest height, below the chin, with straight relaxed fingers pointing upward. Make two or three very small soft claps while the palms stay close together; only the upper palms separate slightly and the heel of each palm remains nearly touching. Do not swing the forearms, cross or merge the hands, or open the arms wide. Hold the final near-contact briefly, then lower both hands smoothly along the front of the torso to the exact resting pose.`,
  },
  cheer: {
    filename: "cheer.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She makes one restrained celebratory gesture: both forearms rise beside the shoulders with small relaxed fists, pause briefly, then lower. Elbows remain below head height; torso and feet stay fixed.`,
  },
  bow: {
    filename: "bow.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She places one open hand gently over the other in front of the lower abdomen, with both complete arms visible, and performs one polite ten-degree bow from the waist. She returns upright and lowers both arms. No disappearing limb or arm-body intersection.`,
  },
  shy: {
    filename: "shy.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She brings both hands lightly toward the lower face, covering the mouth area without covering the eyes or nose, with a tiny shy head tilt and closed-mouth smile. Hold briefly, then lower both hands and return upright. Hands and fingers remain opaque and anatomically correct.`,
  },
  thinking: {
    filename: "thinking.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She rests her right index finger lightly near the side of the chin, tilts her head only a few degrees and shifts her gaze slightly upward, then returns her hand and gaze to neutral.`,
  },
  caring: {
    filename: "caring.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She brings both hands softly together over the upper chest in a gentle caring gesture, shoulders relaxed, with a very slight sympathetic head tilt. Hold briefly, then return both hands and head to neutral.`,
  },
  surprise: {
    filename: "surprise.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She shows mild surprise: her right hand rises lightly in front of the closed mouth without touching the nose, eyebrows lift slightly and her head leans back only a few degrees. Then she returns to neutral. Hand and face remain fully opaque with clean edges.`,
  },
  shrug_palms_up_left: {
    filename: "shrug-palms-up-left.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She makes a restrained natural shrug: both shoulders lift slightly, elbows stay near the waist and both forearms move forward with open palms clearly facing upward. Her head tilts about six degrees toward screen-left. Hold briefly, then return to neutral.`,
  },
  cross: {
    filename: "cross.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She brings both forearms in front of the upper chest to form a clear gentle X-shaped refusal gesture below the chin, holds briefly, then uncrosses and returns to neutral. Arms remain in front of the clothing without intersecting.`,
  },
  arms_crossed: {
    filename: "arms-crossed.mp4",
    prompt: `${XIAOTAO_GREEN_BASE} She folds both arms naturally across the lower chest in a calm confident pose, elbows relaxed and forearms clearly visible in front of the shirt. Hold briefly, then unfold and return to neutral.`,
  },
};

function loadEnv(envPath) {
  if (!fs.existsSync(envPath)) return;
  for (const rawLine of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function parseArgs(argv) {
  const options = {
    reference: DEFAULT_REFERENCE,
    output: DEFAULT_OUTPUT,
    outputExplicit: false,
    engine: "h3",
    profile: "legacy",
    actions: Object.keys(ACTIONS),
    dryRun: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--reference") options.reference = path.resolve(argv[++index]);
    else if (arg === "--output") {
      options.output = path.resolve(argv[++index]);
      options.outputExplicit = true;
    }
    else if (arg === "--engine") options.engine = argv[++index];
    else if (arg === "--profile") options.profile = argv[++index];
    else if (arg === "--actions") options.actions = argv[++index].split(",").map((value) => value.trim()).filter(Boolean);
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`未知参数：${arg}`);
  }
  if (!new Set(["legacy", "xiaotao-green", "feiyin-green"]).has(options.profile)) throw new Error(`不支持的人物配置：${options.profile}`);
  const feiyinGreenActions = Object.fromEntries(Object.entries(XIAOTAO_GREEN_ACTIONS).map(([name, action]) => [name, {
    ...action,
    prompt: name === "idle"
      ? FEIYIN_IDLE_PROMPT
      : name === "wave"
        ? FEIYIN_WAVE_PROMPT
        : name === "agree_subtle"
          ? FEIYIN_NOD_PROMPT
        : action.prompt.replace(XIAOTAO_GREEN_BASE, FEIYIN_GREEN_BASE),
  }]));
  options.catalog = options.profile === "xiaotao-green"
    ? XIAOTAO_GREEN_ACTIONS
    : options.profile === "feiyin-green"
      ? feiyinGreenActions
      : ACTIONS;
  if (["xiaotao-green", "feiyin-green"].includes(options.profile) && options.actions.length === Object.keys(ACTIONS).length && options.actions.every((name, index) => name === Object.keys(ACTIONS)[index])) options.actions = Object.keys(options.catalog);
  for (const name of options.actions) if (!options.catalog[name]) throw new Error(`不支持的动作：${name}`);
  if (!new Set(["h3", "hailuo02"]).has(options.engine)) throw new Error(`不支持的引擎：${options.engine}`);
  if (options.profile === "xiaotao-green" && !options.outputExplicit) options.output = path.join(PROJECT_ROOT, "resources", "minimax-generated", "xiaotao-green-v1");
  if (options.profile === "feiyin-green" && !options.outputExplicit) options.output = path.join(PROJECT_ROOT, "resources", "minimax-generated", "feiyin-green-v1");
  if (options.engine === "hailuo02" && !options.outputExplicit) options.output = `${DEFAULT_OUTPUT}-hailuo02`;
  return options;
}

function imageDataUrl(imagePath) {
  const extension = path.extname(imagePath).toLowerCase();
  const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
  return `data:${mime};base64,${fs.readFileSync(imagePath).toString("base64")}`;
}

async function apiRequest(url, options, label) {
  const response = await fetch(url, options);
  const contentType = response.headers.get("content-type") || "";
  const body = contentType.includes("application/json") ? await response.json() : await response.text();
  if (!response.ok) {
    const detail = typeof body === "string" ? body.slice(0, 800) : JSON.stringify(body);
    throw new Error(`${label}失败（HTTP ${response.status}）：${detail}`);
  }
  return body;
}

function engineProfile(engine) {
  return engine === "hailuo02"
    ? { engine, model: "MiniMax-Hailuo-02", resolution: "768P", duration: 6 }
    : { engine, model: "MiniMax-H3", resolution: "768P", duration: 4 };
}

function readState(statePath, referencePath, profile) {
  if (fs.existsSync(statePath)) return JSON.parse(fs.readFileSync(statePath, "utf8"));
  return {
    engine: profile.engine,
    model: profile.model,
    resolution: profile.resolution,
    duration: profile.duration,
    reference: path.relative(PROJECT_ROOT, referencePath),
    createdAt: new Date().toISOString(),
    actions: {},
  };
}

function writeState(statePath, state) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  const temporaryPath = `${statePath}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`);
  fs.renameSync(temporaryPath, statePath);
}

async function submitAction(apiKey, imageUrl, action, profile) {
  if (profile.engine === "hailuo02") {
    const body = await apiRequest(`${API_BASE}/v1/video_generation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        prompt: `[固定] ${action.prompt}`,
        first_frame_image: imageUrl,
        last_frame_image: imageUrl,
        model: profile.model,
        duration: profile.duration,
        resolution: profile.resolution,
        prompt_optimizer: false,
        aigc_watermark: false,
      }),
    }, "创建视频任务");
    if (!body.task_id) throw new Error(`创建视频任务未返回 task_id：${JSON.stringify(body)}`);
    return String(body.task_id);
  }
  const payload = {
    model: profile.model,
    content: [
      { type: "text", text: action.prompt },
      { type: "image_url", image_url: { url: imageUrl }, role: "first_frame" },
      { type: "image_url", image_url: { url: imageUrl }, role: "last_frame" },
    ],
    resolution: profile.resolution,
    duration: profile.duration,
    ratio: "adaptive",
    aigc_watermark: false,
  };
  const body = await apiRequest(`${API_BASE}/v2/video_generation`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  }, "创建视频任务");
  if (!body.task_id) throw new Error(`创建视频任务未返回 task_id：${JSON.stringify(body)}`);
  return String(body.task_id);
}

async function waitForAction(apiKey, taskId, profile) {
  let previousStatus = "";
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const queryUrl = profile.engine === "hailuo02"
      ? `${API_BASE}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`
      : `${API_BASE}/v2/query/video_generation/${encodeURIComponent(taskId)}`;
    const body = await apiRequest(queryUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    }, "查询视频任务");
    if (profile.engine === "hailuo02") {
      const status = body.status;
      if (!status) throw new Error(`查询视频任务返回异常：${JSON.stringify(body)}`);
      if (status !== previousStatus) {
        console.log(`任务 ${taskId}：${status}`);
        previousStatus = status;
      }
      if (status === "Success") {
        if (!body.file_id) throw new Error(`任务成功但缺少 file_id：${JSON.stringify(body)}`);
        const fileBody = await apiRequest(`${API_BASE}/v1/files/retrieve?file_id=${encodeURIComponent(body.file_id)}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        }, "获取视频下载地址");
        if (!fileBody.file?.download_url) throw new Error(`文件查询缺少下载地址：${JSON.stringify(fileBody)}`);
        return {
          content: { url: fileBody.file.download_url },
          resolution: profile.resolution,
          duration: profile.duration,
          ratio: `${body.video_width || "?"}:${body.video_height || "?"}`,
          usage: null,
          videoWidth: body.video_width,
          videoHeight: body.video_height,
          fileId: String(body.file_id),
        };
      }
      if (status === "Fail") throw new Error(`任务 ${taskId} 失败：${JSON.stringify(body.base_resp || {})}`);
      continue;
    }
    const task = body.task;
    if (!task?.status) throw new Error(`查询视频任务返回异常：${JSON.stringify(body)}`);
    if (task.status !== previousStatus) {
      console.log(`任务 ${taskId}：${task.status}`);
      previousStatus = task.status;
    }
    if (task.status === "succeeded") {
      if (!task.content?.url) throw new Error(`任务成功但缺少下载地址：${JSON.stringify(body)}`);
      return task;
    }
    if (task.status === "failed" || task.status === "cancelled") {
      throw new Error(`任务 ${taskId} ${task.status}：${JSON.stringify(task.error || {})}`);
    }
  }
}

async function downloadVideo(url, outputPath) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`下载视频失败（HTTP ${response.status}）`);
  const temporaryPath = `${outputPath}.part`;
  fs.writeFileSync(temporaryPath, Buffer.from(await response.arrayBuffer()));
  fs.renameSync(temporaryPath, outputPath);
}

async function main() {
  loadEnv(path.join(PROJECT_ROOT, ".env"));
  const options = parseArgs(process.argv.slice(2));
  const profile = engineProfile(options.engine);
  if (!fs.existsSync(options.reference)) throw new Error(`参考图不存在：${options.reference}`);
  const imageSize = fs.statSync(options.reference).size;
  if (imageSize > 30 * 1024 * 1024) throw new Error("参考图超过 MiniMax 30 MB 限制");

  if (options.dryRun) {
    console.log(JSON.stringify({
      reference: options.reference,
      output: options.output,
      imageBytes: imageSize,
      engine: profile.engine,
      model: profile.model,
      resolution: profile.resolution,
      duration: profile.duration,
      profile: options.profile,
      actions: options.actions.map((name) => ({ name, filename: options.catalog[name].filename, prompt: options.catalog[name].prompt })),
    }, null, 2));
    return;
  }

  const apiKey = (process.env.MINIMAX_VIDEO_API_KEY || process.env.MINIMAX_API_KEY)?.trim();
  if (!apiKey) throw new Error("缺少 MINIMAX_VIDEO_API_KEY（也未配置兼容回退项 MINIMAX_API_KEY）");
  fs.mkdirSync(options.output, { recursive: true });
  const statePath = path.join(options.output, "generation.json");
  const state = readState(statePath, options.reference, profile);
  const imageUrl = imageDataUrl(options.reference);

  for (const name of options.actions) {
    const action = options.catalog[name];
    const outputPath = path.join(options.output, action.filename);
    const record = state.actions[name] || { prompt: action.prompt };
    state.actions[name] = record;

    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      console.log(`${name} 已存在，跳过：${outputPath}`);
      continue;
    }
    if (["failed","cancelled"].includes(record.status) && record.taskId) {
      record.previousTaskId = record.taskId;
      delete record.taskId;
      delete record.error;
      record.status = "retrying";
      record.retriedAt = new Date().toISOString();
      writeState(statePath, state);
    }
    try {
      if (!record.taskId) {
        console.log(`提交 ${name}（${profile.duration} 秒 / ${profile.resolution} / ${profile.model}）…`);
        record.taskId = await submitAction(apiKey, imageUrl, action, profile);
        record.status = "submitted";
        record.submittedAt = new Date().toISOString();
        writeState(statePath, state);
        console.log(`${name} 任务已提交：${record.taskId}`);
      } else {
        console.log(`继续查询 ${name} 已有任务：${record.taskId}`);
      }

      const task = await waitForAction(apiKey, record.taskId, profile);
      await downloadVideo(task.content.url, outputPath);
      record.status = "succeeded";
      record.completedAt = new Date().toISOString();
      record.output = path.relative(PROJECT_ROOT, outputPath);
      record.task = {
        resolution: task.resolution,
        duration: task.duration,
        ratio: task.ratio,
        usage: task.usage,
        videoWidth: task.videoWidth,
        videoHeight: task.videoHeight,
        fileId: task.fileId,
      };
      writeState(statePath, state);
      console.log(`${name} 已下载：${outputPath}`);
    } catch (error) {
      // A transport error such as "fetch failed" does not mean the remote
      // video task failed. Keep its task id so the next run resumes polling
      // instead of accidentally submitting and charging for a duplicate.
      const terminalFailure=/任务 .+ (?:failed|cancelled|失败)|insufficient balance|video_generation_failed/i.test(error.message);
      record.status = terminalFailure ? "failed" : "submitted";
      if (terminalFailure) record.failedAt = new Date().toISOString();
      else record.lastQueryErrorAt = new Date().toISOString();
      record.error = error.message;
      writeState(statePath, state);
      throw error;
    }
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
