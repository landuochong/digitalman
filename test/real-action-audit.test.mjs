import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("real action audit renders every frame plus enlarged side edges",async()=>{
  const [source,pkg,backgroundTool,hairRepair,motionAudit,xiaotaoPreparation,videoGeneration]=await Promise.all([
    readFile(new URL("../scripts/audit_real_action_frames.mjs",import.meta.url),"utf8"),
    readFile(new URL("../package.json",import.meta.url),"utf8").then(JSON.parse),
    readFile(new URL("../scripts/replace_real_action_background.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/repair_bedroom_hair_rim.py",import.meta.url),"utf8"),
    readFile(new URL("../scripts/validate_xiaotao_motion.py",import.meta.url),"utf8"),
    readFile(new URL("../scripts/prepare_xiaotao_green_actions.mjs",import.meta.url),"utf8"),
    readFile(new URL("../scripts/generate_minimax_action_videos.mjs",import.meta.url),"utf8"),
  ]);
  assert.equal(pkg.scripts["audit:real-actions"],"node scripts/audit_real_action_frames.mjs");
  assert.equal(pkg.scripts["audit:xiaotao-motion"],".venv-dh-live/bin/python scripts/validate_xiaotao_motion.py --json");
  assert.match(source,/"-count_frames"/);
  assert.match(source,/Math\.ceil\(info\.frameCount\/columns\)/);
  assert.match(source,/allFramesAudited:true/);
  assert.match(source,/left-edge\.png/);
  assert.match(source,/right-edge\.png/);
  assert.match(backgroundTool,/"-color_range", "tv", "-color_primaries", "bt709", "-color_trc", "iec61966-2-1"/);
  assert.match(hairRepair,/CROWN_ROI = \(345, 100, 565, 280\)/);
  assert.match(hairRepair,/ALPHA_LOW = 0\.50/);
  assert.match(hairRepair,/ALPHA_HIGH = 0\.85/);
  assert.match(hairRepair,/crown_halo_cleanup/);
  assert.match(hairRepair,/h264_metadata=video_full_range_flag=0/);
  assert.match(motionAudit,/nod_range - smile_range < 8/);
  assert.match(motionAudit,/separation < 0\.14/);
  assert.match(motionAudit,/contact_frames < 15/);
  assert.match(motionAudit,/wide_reopenings > 1/);
  assert.match(motionAudit,/maximumFirstToIdleMae/);
  assert.match(motionAudit,/metrics\["lastToIdleMae"\] > 6\.0/);
  assert.match(xiaotaoPreparation,/const characterScale=0\.94/);
  assert.match(xiaotaoPreparation,/overlay=\(W-w\)\/2:H-h/);
  assert.match(xiaotaoPreparation,/trim=start=0:end=0\.88/);
  assert.match(xiaotaoPreparation,/xiaotao-green-lumi-motion-v2/);
  assert.match(xiaotaoPreparation,/xiaotao-green-lumi-motion-v3/);
  assert.match(videoGeneration,/A transport error such as "fetch failed" does not mean/);
  assert.doesNotMatch(videoGeneration,/\\b\(\?:failed\|cancelled\|Fail\)\\b/);
});
