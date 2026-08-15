#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const sourceRoot=path.join(projectRoot,"resources","minimax-generated","xiaotao-green-v1");
const lumiMotionV2Root=path.join(projectRoot,"resources","minimax-generated","xiaotao-green-lumi-motion-v2");
const lumiMotionV3Root=path.join(projectRoot,"resources","minimax-generated","xiaotao-green-lumi-motion-v3");
const normalizedRoot=path.join(projectRoot,"resources","xiaotao-green-normalized");
const background=path.join(projectRoot,"public","assets","lumi-bedroom-background-v1.png");
const actions={
  idle:["idle.mp4","xiaotao_idle"],
  smile:["smile.mp4","xiaotao_smile"],
  agree_subtle:["agree-subtle.mp4","xiaotao_nod",lumiMotionV3Root],
  wave:["wave.mp4","xiaotao_wave"],
  thumbs_up:["thumbs-up.mp4","xiaotao_thumbs_up"],
  clap:["clap.mp4","xiaotao_clap",lumiMotionV2Root],
  cheer:["cheer.mp4","xiaotao_cheer"],
  bow:["bow.mp4","xiaotao_bow"],
  shy:["shy.mp4","xiaotao_shy"],
  thinking:["thinking.mp4","xiaotao_thinking"],
  caring:["caring.mp4","xiaotao_caring"],
  surprise:["surprise.mp4","xiaotao_surprise"],
  shrug_palms_up_left:["shrug-palms-up-left.mp4","xiaotao_shrug"],
  cross:["cross.mp4","xiaotao_cross"],
  arms_crossed:["arms-crossed.mp4","xiaotao_arms_crossed"],
};
const silentOnlyActions=new Set(["bow","surprise"]);
const compositedWidth=768;
const compositedHeight=1152;
const characterScale=0.94;
const characterWidth=Math.round(compositedWidth*characterScale/2)*2;
const characterHeight=Math.round(compositedHeight*characterScale/2)*2;

function option(name){const index=process.argv.indexOf(name);return index>=0?process.argv[index+1]:null;}
function run(command,args){
  const result=spawnSync(command,args,{cwd:projectRoot,stdio:"inherit"});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(`${command} 执行失败（${result.status}）`);
}

function motionFilter(action){
  if(action==="agree_subtle")return [
    // Lumi's face track moves about 21 px vertically. Keep only the v3
    // source's first 23 px of descent, then return along the same restrained
    // path; the rest of the generated clip bows too deeply and overshoots.
    "[1:v]fps=25,trim=start=0:end=0.88,setpts=PTS-STARTPTS,split=2[nod_down][nod_return_source]",
    "[nod_return_source]reverse,setpts=PTS-STARTPTS[nod_return]",
    "[nod_down][nod_return]concat=n=2:v=1:a=0,tpad=stop_mode=clone:stop_duration=4,trim=duration=5,fps=25[green_source]",
  ].join(";");
  if(action==="clap")return [
    // Preserve the authored timing. Reversing one short interval three times
    // made every opening identical and repeatedly moved the whole forearm.
    "[1:v]fps=25,tpad=stop_mode=clone:stop_duration=1,trim=duration=5[green_source]",
  ].join(";");
  return"[1:v]fps=25[green_source]";
}

const selected=(option("--actions")||Object.keys(actions).join(",")).split(",").map(value=>value.trim()).filter(Boolean);
for(const action of selected)if(!actions[action])throw new Error(`未知动作：${action}`);
const force=process.argv.includes("--force");
mkdirSync(normalizedRoot,{recursive:true});

for(const action of selected){
  const[sourceName,assetName,sourceOverride]=actions[action],source=path.join(sourceOverride||sourceRoot,sourceName),normalized=path.join(normalizedRoot,`${assetName}.mp4`);
  console.log(`\n[${action}] 绿幕合成卧室背景`);
  run("ffmpeg",[
    "-y","-hide_banner","-loglevel","error","-loop","1","-i",background,"-i",source,
    "-filter_complex",
    `[0:v]scale=${compositedWidth}:${compositedHeight}[bg];${motionFilter(action)};[green_source]scale=${compositedWidth}:-2,crop=${compositedWidth}:${compositedHeight}:0:0,scale=${characterWidth}:${characterHeight}[green];[green]chromakey=0x00FF00:0.24:0.08,despill=type=green:mix=0.75:expand=0.08[person];[bg][person]overlay=(W-w)/2:H-h:shortest=1:eof_action=endall:format=auto[out]`,
    "-map","[out]","-an","-shortest","-c:v","libx264","-preset","slow","-crf","14","-pix_fmt","yuv420p",
    "-color_range","tv","-color_primaries","bt709","-color_trc","iec61966-2-1","-movflags","+faststart",normalized,
  ]);
  if(silentOnlyActions.has(action)){
    const target=path.join(projectRoot,"public","dh-live","actions",assetName);
    if(force)rmSync(target,{recursive:true,force:true});
    mkdirSync(target,{recursive:true});
    copyFileSync(normalized,path.join(target,"01.mp4"));
    console.log(`[${action}] 静默动作已安装 ${target}`);
    continue;
  }
  console.log(`[${action}] 生成 DH_live 动作包 ${assetName}`);
  const prepareArgs=["scripts/prepare_dh_action.mjs","--name",assetName,"--video",normalized,"--return-to","xiaotao_idle","--use-for",action,"--work-dir",path.join(projectRoot,"resources","dh-actions",assetName)];
  if(action==="idle")prepareArgs.push("--loop","--allow-size-mismatch");
  else prepareArgs.push("--baseline","xiaotao_idle");
  if(force)prepareArgs.push("--force");
  run(process.execPath,prepareArgs);
}
