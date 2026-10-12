// Keep appearance controls with persona settings in either presentation mode.
const appearance=document.createElement("div");
appearance.className="appearance-settings";
for(const id of ["avatarModeSwitch","realCharacterControl","animeLookControl","animeViewControls"]){
  const control=document.getElementById(id);if(control)appearance.append(control);
}
document.querySelector("#personaForm")?.prepend(appearance);
// Presentation only: keep the existing call, iframe and conversation alive.
const buttons=[...document.querySelectorAll(".view-mode-switch button")];
const avatarFrame=document.querySelector("#digitalHumanFrame");
function syncAvatarView(){
  // Same-origin iframe: update presentation without reloading active playback.
  const root=avatarFrame?.contentDocument?.documentElement;
  if(root)root.dataset.viewMode=document.body.dataset.viewMode;
}
avatarFrame?.addEventListener("load",syncAvatarView);
function setViewMode(mode){
  document.body.dataset.viewMode=mode==="frame"?"frame":"chat";
  syncAvatarView();
  for(const button of buttons){
    button.setAttribute("aria-pressed",String(button.dataset.viewMode===document.body.dataset.viewMode));
  }
}
for(const button of buttons)button.addEventListener("click",()=>setViewMode(button.dataset.viewMode));
// Every page visit starts in chat; switching never starts microphone capture.
setViewMode("chat");
