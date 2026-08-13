import { randomBytes } from "node:crypto";

const TOKEN_PATTERN=/^[a-f0-9]{32}$/;

export class EphemeralPcmStore{
  constructor({ttlMs=60_000,maxBytes=8*1024*1024,now=()=>Date.now()}={}){
    this.ttlMs=Math.max(1,Number(ttlMs)||60_000);
    this.maxBytes=Math.max(1024,Number(maxBytes)||8*1024*1024);
    this.now=now;this.entries=new Map();this.bytes=0;
  }

  put(pcm,{streamId="",sequence=0,sampleRate=16_000,channels=1}={}){
    if(!Buffer.isBuffer(pcm)||!pcm.length||pcm.length%2)throw new TypeError("PCM16 分片必须是非空偶数字节 Buffer");
    this.prune();
    const token=randomBytes(16).toString("hex"),entry={token,pcm,streamId:String(streamId),sequence:Number(sequence)||0,sampleRate:Number(sampleRate)||16_000,channels:Number(channels)||1,createdAt:this.now(),timer:null};
    entry.timer=setTimeout(()=>this.#delete(token),this.ttlMs);entry.timer.unref?.();
    this.entries.set(token,entry);this.bytes+=pcm.length;this.#trim();
    return {token,url:`/api/dinet/pcm/${token}`,bytes:pcm.length,sampleRate:entry.sampleRate,channels:entry.channels};
  }

  get(token){
    if(!TOKEN_PATTERN.test(String(token||"")))return null;
    this.prune();const entry=this.entries.get(token);if(!entry)return null;
    this.entries.delete(token);this.entries.set(token,entry);return entry;
  }

  deleteStream(streamId){
    let removed=0;for(const [token,entry] of this.entries){if(entry.streamId===String(streamId)){this.#delete(token);removed++;}}
    return removed;
  }

  prune(){const cutoff=this.now()-this.ttlMs;for(const [token,entry] of this.entries){if(entry.createdAt<=cutoff)this.#delete(token);}this.#trim();}
  snapshot(){this.prune();return{entries:this.entries.size,bytes:this.bytes,maxBytes:this.maxBytes,ttlMs:this.ttlMs};}
  #trim(){while(this.bytes>this.maxBytes&&this.entries.size)this.#delete(this.entries.keys().next().value);}
  #delete(token){const entry=this.entries.get(token);if(!entry)return;clearTimeout(entry.timer);this.bytes-=entry.pcm.length;this.entries.delete(token);}
}
