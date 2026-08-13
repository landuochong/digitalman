function readBox(bytes,offset){
  if(offset+8>bytes.length)return null;
  let size=new DataView(bytes.buffer,bytes.byteOffset+offset,4).getUint32(0);
  const type=String.fromCharCode(...bytes.subarray(offset+4,offset+8));let header=8;
  if(size===1){if(offset+16>bytes.length)return null;const view=new DataView(bytes.buffer,bytes.byteOffset+offset+8,8);const high=view.getUint32(0),low=view.getUint32(4);size=high*2**32+low;header=16;}
  else if(size===0)size=bytes.length-offset;
  if(!Number.isSafeInteger(size)||size<header||offset+size>bytes.length)return null;
  return{type,start:offset,end:offset+size};
}

export function splitFragmentedMp4(input){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input),boxes=[];let offset=0;
  while(offset<bytes.length){const box=readBox(bytes,offset);if(!box)return null;boxes.push(box);offset=box.end;}
  const moofIndex=boxes.findIndex(box=>box.type==="moof");
  if(moofIndex<0||!boxes.slice(0,moofIndex).some(box=>box.type==="moov")||!boxes.slice(moofIndex+1).some(box=>box.type==="mdat"))return null;
  const mediaEnd=boxes.reduce((end,box,index)=>index>=moofIndex&&(box.type==="moof"||box.type==="mdat")?box.end:end,boxes[moofIndex].end);
  return{init:bytes.slice(0,boxes[moofIndex].start),media:bytes.slice(boxes[moofIndex].start,mediaEnd),boxes:boxes.map(box=>box.type)};
}

export function removableVideoRange(buffered,currentTime,keepBehindSeconds=3){
  if(!buffered?.length)return null;
  const removeEnd=Math.min(Number(currentTime)-Math.max(0,Number(keepBehindSeconds)||0),buffered.end(buffered.length-1));
  const removeStart=buffered.start(0);
  return removeEnd-removeStart>.5?{start:removeStart,end:removeEnd}:null;
}

export function bufferedVideoAhead(buffered,currentTime){
  if(!buffered?.length)return 0;
  const time=Number(currentTime);for(let index=0;index<buffered.length;index++)if(time>=buffered.start(index)-.05&&time<=buffered.end(index)+.05)return Math.max(0,buffered.end(index)-time);
  return 0;
}
