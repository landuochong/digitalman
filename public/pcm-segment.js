export async function loadPcmBytes(audio,{fetchImpl=globalThis.fetch,decodeBase64=defaultDecodeBase64}={}){
  if(audio?.data)return decodeBase64(audio.data);
  if(!audio?.url||typeof fetchImpl!=="function")return null;
  const response=await fetchImpl(audio.url,{cache:"no-store"});
  if(!response.ok)return null;
  const bytes=new Uint8Array(await response.arrayBuffer());
  return Number(audio.bytes)&&bytes.length!==Number(audio.bytes)?null:bytes;
}

function defaultDecodeBase64(value){
  return Uint8Array.from(atob(value),character=>character.charCodeAt(0));
}
