const defaultSleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

export function createClientTimingReporter({
  fetchImpl=globalThis.fetch?.bind(globalThis),
  endpoint="/api/chat/debug/client-timing",
  retryDelaysMs=[0,120,480],
  sleep=defaultSleep
}={}){
  if(typeof fetchImpl!=="function")throw new TypeError("fetchImpl is required");
  const delays=Array.isArray(retryDelaysMs)&&retryDelaysMs.length?retryDelaysMs:[0];
  return async payload=>{
    let status=0;
    for(let index=0;index<delays.length;index++){
      const delay=Math.max(0,Number(delays[index])||0);if(delay)await sleep(delay);
      try{
        const response=await fetchImpl(endpoint,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(payload),keepalive:true});
        status=Number(response?.status)||0;
        if(response?.ok)return{ok:true,attempts:index+1,status};
        // A malformed timing payload cannot become valid by retrying. A 404
        // may be a short-lived ordering race while the matching trace arrives.
        if(status>=400&&status<500&&status!==404)return{ok:false,attempts:index+1,status};
      }catch{}
    }
    return{ok:false,attempts:delays.length,status};
  };
}
