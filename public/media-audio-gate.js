export async function scheduleAfterMediaReady({fragmentedVideo=false,fragmentReadyToPlay=null,scheduleAudio}={}){
  if(typeof scheduleAudio!=="function")return false;
  if(fragmentedVideo&&!await fragmentReadyToPlay)return false;
  return scheduleAudio();
}
