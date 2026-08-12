import { readdir,stat,unlink,utimes } from "node:fs/promises";
import { join,resolve } from "node:path";

const GENERATED_MP4=/^[a-f0-9]{24}\.mp4$/;

export class GeneratedMediaCache {
  constructor({directory,maxBytes=128*1024*1024,maxFiles=384,minAgeMs=15*60*1000,now=()=>Date.now()}={}){
    this.directory=resolve(directory);
    this.maxBytes=Math.max(0,Number(maxBytes)||0);
    this.maxFiles=Math.max(0,Number(maxFiles)||0);
    this.minAgeMs=Math.max(0,Number(minAgeMs)||0);
    this.now=now;
    this.chain=Promise.resolve();
  }

  use(path){
    const task=this.chain.then(async()=>{
      const resolved=resolve(path);
      if(!resolved.startsWith(`${this.directory}/`))return null;
      const time=new Date(this.now());
      try{const info=await stat(resolved);await utimes(resolved,time,time);return info;}catch(error){if(error.code==="ENOENT")return null;throw error;}
    });
    this.chain=task.catch(()=>{});
    return task;
  }

  prune({protectedPaths=[]}={}){
    const protectedSet=new Set(protectedPaths.map(path=>resolve(path)));
    const task=this.chain.then(()=>this.#prune(protectedSet));
    this.chain=task.catch(()=>{});
    return task;
  }

  snapshot(){
    const task=this.chain.then(async()=>{
      const files=await this.#files(),bytes=files.reduce((sum,file)=>sum+file.size,0);
      return {files:files.length,bytes,maxFiles:this.maxFiles,maxBytes:this.maxBytes,minAgeMs:this.minAgeMs,overLimit:files.length>this.maxFiles||bytes>this.maxBytes};
    });
    this.chain=task.catch(()=>{});
    return task;
  }

  async #files(){
    let entries;
    try{entries=await readdir(this.directory,{withFileTypes:true});}catch(error){if(error.code==="ENOENT")return[];throw error;}
    const files=[];
    await Promise.all(entries.filter(entry=>entry.isFile()&&GENERATED_MP4.test(entry.name)).map(async entry=>{
      const path=join(this.directory,entry.name),info=await stat(path);
      files.push({path,name:entry.name,size:info.size,mtimeMs:info.mtimeMs});
    }));
    return files;
  }

  async #prune(protectedSet){
    const files=await this.#files();
    const before={files:files.length,bytes:files.reduce((sum,file)=>sum+file.size,0)};
    let currentFiles=before.files,currentBytes=before.bytes,removedFiles=0,removedBytes=0;
    const cutoff=this.now()-this.minAgeMs;
    for(const file of files.sort((left,right)=>left.mtimeMs-right.mtimeMs)){
      if(currentFiles<=this.maxFiles&&currentBytes<=this.maxBytes)break;
      if(file.mtimeMs>cutoff||protectedSet.has(file.path))continue;
      try{
        await unlink(file.path);
        currentFiles--;currentBytes-=file.size;removedFiles++;removedBytes+=file.size;
      }catch(error){if(error.code!=="ENOENT")throw error;}
    }
    return {
      before,after:{files:currentFiles,bytes:currentBytes},removedFiles,removedBytes,
      overLimit:currentFiles>this.maxFiles||currentBytes>this.maxBytes
    };
  }
}
