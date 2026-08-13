const PCM16_BYTES_PER_SAMPLE=2;

export function trimPcm16Silence(pcm,{sampleRate=16_000,windowMs=10,thresholdRms=260,leadingMs=60,trailingMs=100,minimumMs=320}={}){
  const input=Buffer.isBuffer(pcm)?pcm:Buffer.from(pcm||[]);
  const samples=Math.floor(input.length/PCM16_BYTES_PER_SAMPLE);
  if(!samples)return{pcm:input,trimmedLeadingMs:0,trimmedTrailingMs:0};
  const windowSamples=Math.max(1,Math.round(sampleRate*windowMs/1000));
  let first=-1,last=-1;
  for(let start=0;start<samples;start+=windowSamples){
    const end=Math.min(samples,start+windowSamples);let energy=0;
    for(let index=start;index<end;index++){const value=input.readInt16LE(index*2);energy+=value*value;}
    if(Math.sqrt(energy/Math.max(1,end-start))>=thresholdRms){if(first<0)first=start;last=end;}
  }
  if(first<0)return{pcm:input,trimmedLeadingMs:0,trimmedTrailingMs:0};
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
