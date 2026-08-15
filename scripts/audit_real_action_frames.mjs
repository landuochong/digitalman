#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"..");
const actionsRoot=path.join(projectRoot,"public","dh-live","actions");
const columns=15;

function argumentValue(name){
  const index=process.argv.indexOf(name);
  return index>=0?process.argv[index+1]:null;
}

function run(command,args){
  const result=spawnSync(command,args,{cwd:projectRoot,encoding:"utf8"});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(String(result.stderr||`${command} failed`));
  return result.stdout.trim();
}

async function selectedActions(){
  const requested=argumentValue("--actions");
  if(requested){
    return requested.split(",").map(value=>value.trim()).filter(Boolean)
      .map(value=>/^(?:bedroom|xiaotao)_/.test(value)?value:`bedroom_${value}`);
  }
  const entries=await readdir(actionsRoot,{withFileTypes:true});
  return entries.filter(entry=>entry.isDirectory()&&entry.name.startsWith("bedroom_"))
    .map(entry=>entry.name).sort();
}

function probe(video){
  const payload=JSON.parse(run("ffprobe",[
    "-v","error","-select_streams","v:0","-count_frames",
    "-show_entries","stream=width,height,avg_frame_rate,nb_read_frames",
    "-of","json",video,
  ]));
  const stream=payload.streams?.[0];
  if(!stream)throw new Error(`cannot inspect ${video}`);
  const frameCount=Number(stream.nb_read_frames);
  if(!Number.isInteger(frameCount)||frameCount<1)throw new Error(`invalid frame count: ${video}`);
  return{width:Number(stream.width),height:Number(stream.height),fps:stream.avg_frame_rate,frameCount};
}

function renderSheet(video,filter,output){
  run("ffmpeg",[
    "-y","-hide_banner","-loglevel","error","-i",video,
    "-vf",filter,"-frames:v","1",output,
  ]);
}

async function main(){
  const outputRoot=path.resolve(argumentValue("--output")||path.join(os.tmpdir(),`digitalman-real-action-audit-${Date.now()}`));
  await mkdir(outputRoot,{recursive:true});
  const report={createdAt:new Date().toISOString(),allFramesAudited:true,columns,actions:[]};
  for(const action of await selectedActions()){
    const video=path.join(actionsRoot,action,"01.mp4");
    const info=probe(video);
    const rows=Math.ceil(info.frameCount/columns);
    const full=path.join(outputRoot,`${action}-full.png`);
    const left=path.join(outputRoot,`${action}-left-edge.png`);
    const right=path.join(outputRoot,`${action}-right-edge.png`);
    renderSheet(video,`scale=96:144,tile=${columns}x${rows}`,full);
    renderSheet(video,`crop=iw/2:ih*0.62:0:ih*0.16,scale=144:178,tile=${columns}x${rows}`,left);
    renderSheet(video,`crop=iw/2:ih*0.62:iw/2:ih*0.16,scale=144:178,tile=${columns}x${rows}`,right);
    report.actions.push({action,...info,rows,sheets:{full,left,right}});
    console.log(`${action}: ${info.frameCount} frames -> ${path.basename(full)}`);
  }
  const reportPath=path.join(outputRoot,"report.json");
  await writeFile(reportPath,`${JSON.stringify(report,null,2)}\n`);
  console.log(`report: ${reportPath}`);
}

main().catch(error=>{console.error(error?.stack||error);process.exitCode=1;});
