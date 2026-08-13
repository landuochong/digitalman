const PCM16_BYTES_PER_SAMPLE=2;

function firstActiveSample(input,{sampleRate=16_000,windowMs=10,thresholdRms=260}={}){
  const samples=Math.floor(input.length/PCM16_BYTES_PER_SAMPLE),windowSamples=Math.max(1,Math.round(sampleRate*windowMs/1000));
  for(let start=0;start<samples;start+=windowSamples){
    const end=Math.min(samples,start+windowSamples);let energy=0;
    for(let index=start;index<end;index++){const value=input.readInt16LE(index*2);energy+=value*value;}
    if(Math.sqrt(energy/Math.max(1,end-start))>=thresholdRms)return start;
  }
  return -1;
}

export class Pcm16LeadingSilenceGate{
  constructor({sampleRate=16_000,windowMs=10,thresholdRms=260,leadingMs=60,maxScanMs=1200}={}){
    this.options={sampleRate,windowMs,thresholdRms};this.leadingSamples=Math.round(sampleRate*leadingMs/1000);this.maxBytes=Math.round(sampleRate*maxScanMs/1000)*2;this.buffer=Buffer.alloc(0);this.open=false;this.trimmedLeadingMs=0;
  }
  push(chunk){
    const input=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk||[]);if(!input.length)return[];
    if(this.open)return[input];
    this.buffer=Buffer.concat([this.buffer,input]);
    const active=firstActiveSample(this.buffer,this.options);
    if(active>=0){
      const from=Math.max(0,active-this.leadingSamples),output=this.buffer.subarray(from*2);this.trimmedLeadingMs=Math.round(from*1000/this.options.sampleRate);this.buffer=Buffer.alloc(0);this.open=true;return output.length?[output]:[];
    }
    if(this.buffer.length>=this.maxBytes){const output=this.buffer;this.buffer=Buffer.alloc(0);this.open=true;return[output];}
    return[];
  }
  finish(){const output=this.buffer;this.buffer=Buffer.alloc(0);this.open=true;return output.length?[output]:[];}
}

export function trimPcm16Silence(pcm,{sampleRate=16_000,windowMs=10,thresholdRms=260,leadingMs=60,trailingMs=100,minimumMs=320}={}){
  const input=Buffer.isBuffer(pcm)?pcm:Buffer.from(pcm||[]);
  const samples=Math.floor(input.length/PCM16_BYTES_PER_SAMPLE);
  if(!samples)return{pcm:input,trimmedLeadingMs:0,trimmedTrailingMs:0};
  const windowSamples=Math.max(1,Math.round(sampleRate*windowMs/1000));
  let first=firstActiveSample(input,{sampleRate,windowMs,thresholdRms}),last=-1;
  if(first<0)return{pcm:input,trimmedLeadingMs:0,trimmedTrailingMs:0};
  for(let start=0;start<samples;start+=windowSamples){
    const end=Math.min(samples,start+windowSamples);let energy=0;
    for(let index=start;index<end;index++){const value=input.readInt16LE(index*2);energy+=value*value;}
    if(Math.sqrt(energy/Math.max(1,end-start))>=thresholdRms)last=end;
  }
  const leadingSamples=Math.round(sampleRate*leadingMs/1000),trailingSamples=Math.round(sampleRate*trailingMs/1000);
  let from=Math.max(0,first-leadingSamples),to=Math.min(samples,last+trailingSamples);
  const minimumSamples=Math.min(samples,Math.round(sampleRate*minimumMs/1000));
  if(to-from<minimumSamples){const missing=minimumSamples-(to-from),before=Math.min(from,Math.floor(missing/2));from-=before;to=Math.min(samples,to+missing-before);from=Math.max(0,to-minimumSamples);}
  if(from===0&&to===samples)return{pcm:input,trimmedLeadingMs:0,trimmedTrailingMs:0};
  return{
    pcm:input.subarray(from*2,to*2),
    trimmedLeadingMs:Math.round(from*1000/sampleRate),
    trimmedTrailingMs:Math.round((samples-to)*1000/sampleRate)
  };
}
