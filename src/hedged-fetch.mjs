function abortError(signal){
  if(signal?.reason instanceof Error)return signal.reason;
  return new DOMException("The operation was aborted", "AbortError");
}

// Hedge only the wait for response headers. The losing request is aborted as
// soon as one upstream accepts the stream, so ordinary fast requests still use
// a single call and slow-tail protection does not duplicate generated output.
export async function fetchWithConnectionHedge(url,init={},options={}){
  const fetchImpl=options.fetchImpl||globalThis.fetch;
  const delayMs=Math.max(0,Number(options.delayMs)||0);
  const schedule=options.schedule||setTimeout,cancelSchedule=options.cancelSchedule||clearTimeout;
  const parentSignal=init.signal;
  if(!delayMs){
    return{response:await fetchImpl(url,init),winner:"primary",hedged:false};
  }
  if(parentSignal?.aborted)throw abortError(parentSignal);

  const primaryController=new AbortController(),hedgeController=new AbortController();
  let hedgeStarted=false,timer=null,rejectHedge=null;
  const abortAll=()=>{
    primaryController.abort(parentSignal?.reason);
    hedgeController.abort(parentSignal?.reason);
    if(timer!==null){cancelSchedule(timer);timer=null;rejectHedge?.(abortError(parentSignal));}
  };
  parentSignal?.addEventListener("abort",abortAll,{once:true});
  const request=(controller,winner)=>fetchImpl(url,{...init,signal:controller.signal}).then(response=>({response,winner}));
  const primary=request(primaryController,"primary");
  const hedge=new Promise((resolve,reject)=>{
    rejectHedge=reject;
    timer=schedule(()=>{
      timer=null;hedgeStarted=true;
      request(hedgeController,"hedge").then(resolve,reject);
    },delayMs);
    timer?.unref?.();
  });
  try{
    let result;
    try{result=await Promise.any([primary,hedge]);}
    catch(error){if(parentSignal?.aborted)throw abortError(parentSignal);throw error;}
    if(timer!==null){cancelSchedule(timer);timer=null;}
    if(result.winner==="primary")hedgeController.abort();else primaryController.abort();
    return{...result,hedged:hedgeStarted};
  }finally{
    parentSignal?.removeEventListener("abort",abortAll);
  }
}
