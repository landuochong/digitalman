export function bindClientAbort(response,{reason="client-disconnected"}={}){
  const controller=new AbortController();
  let completed=false;
  const onClose=()=>{
    if(!completed&&!controller.signal.aborted)controller.abort(reason);
  };
  response.once("close",onClose);
  return{
    signal:controller.signal,
    complete(){
      if(completed)return false;
      completed=true;
      response.off?.("close",onClose);
      return true;
    },
    get completed(){return completed;}
  };
}
