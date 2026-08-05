import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from "@pixiv/three-vrm-animation";

const FADE_SECONDS=0.35;
const POSE_ROOT="/vrm/motions/poses";
const ACTIONS={
  wave_approval:{files:["wave1.json","wave2.json"],step:0.5,duration:1.8},
  clap:{files:["clap1.json","clap2.json"],step:0.2,duration:1.8},
  thinking:{files:["think.json"],duration:1.6},
  caring:{files:["finger_touch.json"],duration:1.7},
  surprise:{files:["mouth_cover.json"],duration:1.7},
};

const poseCache=new Map();

async function loadPose(file){
  if(!poseCache.has(file)){
    poseCache.set(file,fetch(`${POSE_ROOT}/${file}`).then(response=>{
      if(!response.ok)throw new Error(`姿势文件加载失败: ${file}`);
      return response.json();
    }));
  }
  return poseCache.get(file);
}

function targetQuaternion(rotation,vrm){
  const [x,y,z,w]=rotation;
  return vrm.meta.metaVersion==="0"?[-x,y,-z,w]:[x,y,z,w];
}

function applyHipsOffset(values,pose,boneName){
  if(boneName!=="hips"||!pose.yRotationOffsetDeg)return values;
  const q=new THREE.Quaternion().fromArray(values);
  const offset=new THREE.Quaternion().setFromAxisAngle(
    new THREE.Vector3(0,1,0),THREE.MathUtils.degToRad(pose.yRotationOffsetDeg)
  );
  return q.premultiply(offset).toArray();
}

function poseBones(pose){
  if(pose.pose)return pose.pose;
  const result={};
  for(const [boneName,tracks] of Object.entries(pose.bones||{})){
    const rotation=tracks.rotation?.values?.[0];
    if(rotation)result[boneName]={rotation};
  }
  return result;
}

function createPoseClip(pose,vrm,name){
  const tracks=[];
  for(const [boneName,value] of Object.entries(poseBones(pose))){
    const node=vrm.humanoid.getNormalizedBoneNode(boneName);
    if(!node||!value.rotation)continue;
    const quaternion=applyHipsOffset(targetQuaternion(value.rotation,vrm),pose,boneName);
    tracks.push(new THREE.QuaternionKeyframeTrack(
      `${node.name}.quaternion`,[0,1],[...quaternion,...quaternion]
    ));
  }
  return new THREE.AnimationClip(name,1,tracks);
}

function createSequenceClip(poses,vrm,step,name){
  const boneNames=new Set();
  poses.forEach(pose=>Object.keys(poseBones(pose)).forEach(name=>boneNames.add(name)));
  const times=poses.map((_,index)=>index*step);times.push(poses.length*step);
  const tracks=[];
  for(const boneName of boneNames){
    const node=vrm.humanoid.getNormalizedBoneNode(boneName);if(!node)continue;
    const values=poses.map(pose=>{
      const rotation=poseBones(pose)[boneName]?.rotation||[0,0,0,1];
      return applyHipsOffset(targetQuaternion(rotation,vrm),pose,boneName);
    });
    values.push(values[0]);
    tracks.push(new THREE.QuaternionKeyframeTrack(`${node.name}.quaternion`,times,values.flat()));
  }
  return new THREE.AnimationClip(name,times.at(-1),tracks);
}

export class VrmMotionController{
  constructor(){
    this.vrm=null;this.mixer=null;this.idleAction=null;this.poseAction=null;this.additiveAction=null;
    this.activeAction="idle";this.activeUntil=0;this.requestId=0;this.idleAnimationPromise=null;this.retiring=[];
  }
  async loadIdleAnimation(){
    if(!this.idleAnimationPromise){
      this.idleAnimationPromise=new Promise((resolve,reject)=>{
        const gltfLoader=new GLTFLoader();
        gltfLoader.register(parser=>new VRMAnimationLoaderPlugin(parser));
        gltfLoader.load("/vrm/motions/idle_loop.vrma",gltf=>resolve(gltf.userData.vrmAnimations?.[0]),undefined,reject);
      });
    }
    return this.idleAnimationPromise;
  }
  async attach(vrm){
    const requestId=++this.requestId;
    if(this.mixer){this.mixer.stopAllAction();this.mixer.uncacheRoot(this.vrm.scene);}
    this.vrm=vrm;this.mixer=new THREE.AnimationMixer(vrm.scene);
    this.poseAction=null;this.additiveAction=null;this.activeAction="idle";this.activeUntil=0;this.retiring=[];
    try{
      const animation=await this.loadIdleAnimation();
      if(requestId!==this.requestId||vrm!==this.vrm||!animation)return;
      const clip=createVRMAnimationClip(animation,vrm);clip.name="companion_idle";
      this.idleAction=this.mixer.clipAction(clip);
      this.idleAction.setLoop(THREE.LoopRepeat,Infinity).play();
    }catch(error){
      console.warn("待机动作加载失败，继续使用静态站姿。",error);
    }
  }
  async play(actionName){
    const config=ACTIONS[actionName];if(!config||!this.vrm||!this.mixer)return false;
    const requestId=++this.requestId,vrm=this.vrm;
    try{
      const poses=await Promise.all(config.files.map(loadPose));
      if(requestId!==this.requestId||vrm!==this.vrm)return false;
      this.stopPose(false);
      const clip=config.step
        ?createSequenceClip(poses,vrm,config.step,`pose_${actionName}`)
        :createPoseClip(poses[0],vrm,`pose_${actionName}`);
      this.poseAction=this.mixer.clipAction(clip);
      this.poseAction.setLoop(THREE.LoopRepeat,Infinity).reset().setEffectiveWeight(1).fadeIn(FADE_SECONDS).play();
      if(this.idleAction){
        const additiveClip=this.idleAction.getClip().clone();
        additiveClip.name=`idle_overlay_${actionName}`;
        additiveClip.tracks=additiveClip.tracks.filter(track=>!track.name.endsWith("hips.position"));
        THREE.AnimationUtils.makeClipAdditive(additiveClip);
        this.additiveAction=this.mixer.clipAction(additiveClip);
        this.additiveAction.blendMode=THREE.AdditiveAnimationBlendMode;
        this.additiveAction.setLoop(THREE.LoopRepeat,Infinity).reset().setEffectiveWeight(0.75).fadeIn(FADE_SECONDS).play();
        this.idleAction.fadeOut(FADE_SECONDS);
      }
      this.activeAction=actionName;
      this.activeUntil=performance.now()/1000+config.duration;
      return true;
    }catch(error){console.warn(`动作 ${actionName} 加载失败。`,error);return false;}
  }
  stopPose(fade=true){
    const duration=fade?FADE_SECONDS:0.05;
    const stopAt=performance.now()/1000+duration+.05;
    if(this.poseAction){this.poseAction.fadeOut(duration);this.retiring.push({action:this.poseAction,stopAt});this.poseAction=null;}
    if(this.additiveAction){this.additiveAction.fadeOut(duration);this.retiring.push({action:this.additiveAction,stopAt});this.additiveAction=null;}
    if(this.idleAction)this.idleAction.reset().fadeIn(duration).play();
    this.activeAction="idle";this.activeUntil=0;
  }
  update(delta){
    if(!this.mixer)return;
    const now=performance.now()/1000;
    if(this.activeUntil&&now>=this.activeUntil)this.stopPose(true);
    this.mixer.update(delta);
    this.retiring=this.retiring.filter(entry=>{if(now<entry.stopAt)return true;entry.action.stop();return false;});
  }
  get active(){return this.activeAction!=="idle";}
}
