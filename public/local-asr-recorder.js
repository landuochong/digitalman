function writeAscii(view,offset,text){for(let index=0;index<text.length;index++)view.setUint8(offset+index,text.charCodeAt(index));}

export function encodePcm16Wav(samples,sampleRate=16_000){
  const pcm=samples instanceof Float32Array?samples:Float32Array.from(samples||[]);
  const buffer=new ArrayBuffer(44+pcm.length*2),view=new DataView(buffer);
  writeAscii(view,0,"RIFF");view.setUint32(4,36+pcm.length*2,true);writeAscii(view,8,"WAVE");writeAscii(view,12,"fmt ");
  view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,sampleRate,true);
  view.setUint32(28,sampleRate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);writeAscii(view,36,"data");view.setUint32(40,pcm.length*2,true);
  for(let index=0;index<pcm.length;index++){const value=Math.max(-1,Math.min(1,pcm[index]));view.setInt16(44+index*2,value<0?value*32768:value*32767,true);}
  return new Blob([buffer],{type:"audio/wav"});
}

export function resampleMono(chunks,inputRate,outputRate=16_000){
  const length=chunks.reduce((total,chunk)=>total+chunk.length,0),source=new Float32Array(length);let offset=0;
  for(const chunk of chunks){source.set(chunk,offset);offset+=chunk.length;}
  if(!source.length||inputRate===outputRate)return source;
  const outputLength=Math.max(1,Math.round(source.length*outputRate/inputRate)),output=new Float32Array(outputLength),ratio=inputRate/outputRate;
  for(let index=0;index<outputLength;index++){
    const position=index*ratio,left=Math.floor(position),right=Math.min(source.length-1,left+1),mix=position-left;
    output[index]=source[left]*(1-mix)+source[right]*mix;
  }
  return output;
}

export class LocalAsrRecorder{
  constructor(context,stream){
    this.context=context;this.stream=stream;this.chunks=[];this.recording=false;
    this.source=context.createMediaStreamSource(stream);
    this.processor=context.createScriptProcessor(2048,1,1);
    this.sink=context.createGain();this.sink.gain.value=0;
    this.processor.onaudioprocess=event=>{if(this.recording)this.chunks.push(new Float32Array(event.inputBuffer.getChannelData(0)));};
    this.source.connect(this.processor);this.processor.connect(this.sink);this.sink.connect(context.destination);
  }
  start(){this.chunks=[];this.recording=true;this.startedAt=performance.now();}
  stop(){
    this.recording=false;
    const samples=resampleMono(this.chunks,this.context.sampleRate,16_000);this.chunks=[];
    return{blob:encodePcm16Wav(samples,16_000),durationMs:Math.round(samples.length/16)};
  }
  cancel(){this.recording=false;this.chunks=[];}
  close(){this.cancel();this.processor.disconnect();this.source.disconnect();this.sink.disconnect();}
}
