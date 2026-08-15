import { chmod,mkdir,readFile,rename,writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeLatencySample } from "./chat-latency-summary.mjs";

export class LatencySampleStore{
  constructor(path,{limit=100}={}){this.path=path;this.limit=Math.max(3,Math.min(500,Number(limit)||100));this.samples=[];this.writeQueue=Promise.resolve();this.ready=this.load();}
  async load(){
    try{const value=JSON.parse(await readFile(this.path,"utf8"));this.samples=(Array.isArray(value?.samples)?value.samples:[]).map(normalizeLatencySample).filter(Boolean).slice(-this.limit);}
    catch(error){if(error.code!=="ENOENT")console.warn(`读取匿名延迟样本失败：${error.message}`);}
  }
  async snapshot(){await this.ready;return this.samples.map(sample=>({...sample}));}
  async append(value){
    await this.ready;const sample=normalizeLatencySample(value);if(!sample)return false;
    const operation=this.writeQueue.then(async()=>{
      const samples=[...this.samples,sample].slice(-this.limit),snapshot=JSON.stringify({version:1,samples},null,2);
      await mkdir(dirname(this.path),{recursive:true});const temp=`${this.path}.tmp`;
      await writeFile(temp,snapshot,{mode:0o600});await chmod(temp,0o600);await rename(temp,this.path);this.samples=samples;return true;
    });
    this.writeQueue=operation.catch(error=>console.warn(`保存匿名延迟样本失败：${error.message}`));
    try{return await operation;}catch{return false;}
  }
}
