import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMAnimationLoaderPlugin, createVRMAnimationClip } from "@pixiv/three-vrm-animation";

const FADE_SECONDS=0.35;
const POSE_ROOT="/vrm/motions/poses";
const POSE_VERSION="20260810-thumbs-up-v1";
const ACTIONS={
  wave_approval:{files:["wave1.json","wave2.json"],step:0.5,duration:1.8},
  nod:{procedural:"nod",duration:1.2,oneShot:true},
  thumbs_up:{files:["thumbs_up.json"],duration:1.7},
  clap:{files:["clap1.json","clap2.json"],step:0.3,duration:1.8},
  cheer:{files:["cheer.json"],duration:1.8},
  bow:{files:["bow.json"],duration:1.8},
  shrug:{files:["shrug.json"],duration:1.7},
  cross:{files:["cross.json"],duration:1.7},
  confident_arms_crossed:{files:["crossed_arms.json"],duration:1.8},
  shy:{files:["shy.json"],duration:1.7},
  thinking:{files:["think.json"],duration:1.6},
  caring:{files:["finger_touch.json"],duration:1.7},
  surprise:{files:["mouth_cover.json"],duration:1.7},
};
const REST_POSES={
  natural:{files:["relaxed_hands.json"],additive:true},
  touch:{files:["finger_touch.json"]},
  crossed:{files:["crossed_arms.json"]},
};
const CALIBRATION_BONES=["leftShoulder","leftUpperArm","leftLowerArm","leftHand","rightShoulder","rightUpperArm","rightLowerArm","rightHand"];

const poseCache=new Map();

async function loadPose(file){
  if(!poseCache.has(file)){
    poseCache.set(file,fetch(`${POSE_ROOT}/${file}?v=${POSE_VERSION}`).then(response=>{
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

function sourceQuaternion(quaternion,vrm){
  const {x,y,z,w}=quaternion;
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

function createNodClip(vrm,name="pose_nod"){
  const head=vrm.humanoid.getNormalizedBoneNode("head");if(!head)return new THREE.AnimationClip(name,1.2,[]);
  const angles=[0,10,-2,7,0,0].map(value=>THREE.MathUtils.degToRad(value));
  const values=angles.flatMap(angle=>new THREE.Quaternion().setFromEuler(new THREE.Euler(angle,0,0,"XYZ")).toArray());
  return new THREE.AnimationClip(name,1.2,[new THREE.QuaternionKeyframeTrack(`${head.name}.quaternion`,[0,.2,.43,.66,.94,1.2],values)]);
}

function stabilizeRootTranslation(clip,vrm){
  const hips=vrm.humanoid.getNormalizedBoneNode("hips");if(!hips)return clip;
  for(const track of clip.tracks){
    if(track.ValueTypeName!=="vector"&&!track.name.endsWith(".position"))continue;
    if(track.name!==`${hips.name}.position`&&!track.name.endsWith("hips.position"))continue;
    for(let index=0;index<track.values.length;index+=3){
      track.values[index]=hips.position.x;track.values[index+1]=hips.position.y;track.values[index+2]=hips.position.z;
    }
  }
  return clip;
}

export class VrmMotionController{
  constructor(){
    this.vrm=null;this.mixer=null;this.idleAction=null;this.poseAction=null;this.additiveAction=null;
    this.restPose="natural";this.restAction=null;this.restAdditiveAction=null;
    this.activeAction="idle";this.activeUntil=0;this.requestId=0;this.idleAnimationPromise=null;this.retiring=[];this.modelProfile="default";this.clapProfile="classic";this.gesturePending=false;this.calibration=null;this.clapIk=false;
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
    this.vrm=vrm;this.mixer=new THREE.AnimationMixer(vrm.scene);this.gesturePending=false;this.calibration=null;this.clapIk=false;
    this.poseAction=null;this.additiveAction=null;this.restAction=null;this.restAdditiveAction=null;this.activeAction="idle";this.activeUntil=0;this.retiring=[];
    try{
      const animation=await this.loadIdleAnimation();
      if(requestId!==this.requestId||vrm!==this.vrm||!animation)return;
      const clip=stabilizeRootTranslation(createVRMAnimationClip(animation,vrm),vrm);clip.name="companion_idle";
      this.idleAction=this.mixer.clipAction(clip);
      this.idleAction.setLoop(THREE.LoopRepeat,Infinity).play();
      await this.setRestPose(this.restPose);
    }catch(error){
      console.warn("待机动作加载失败，继续使用静态站姿。",error);
    }
  }
  async play(actionName,{hold=false}={}){
    const config=ACTIONS[actionName];if(!config||!this.vrm||!this.mixer)return false;
    this.gesturePending=true;this.calibration=null;
    const requestId=++this.requestId,vrm=this.vrm;
    try{
      let files=config.files;
      if(actionName==="shy"&&this.modelProfile==="mouth")files=["shy_cover_left.json"];
      if(actionName==="thumbs_up"&&vrm.meta.metaVersion!=="0")files=["thumbs_up_vrm1.json"];
      const poses=files?await Promise.all(files.map(loadPose)):[];
      if(requestId!==this.requestId||vrm!==this.vrm)return false;
      this.stopGesture(0.05);this.fadeRestOut(FADE_SECONDS);
      const clip=config.procedural==="nod"
        ?createNodClip(vrm,`pose_${actionName}`)
        :config.step
        ?createSequenceClip(poses,vrm,config.step,`pose_${actionName}`)
        :createPoseClip(poses[0],vrm,`pose_${actionName}`);
      this.poseAction=this.mixer.clipAction(clip);
      if(config.oneShot){this.poseAction.setLoop(THREE.LoopOnce,1);this.poseAction.clampWhenFinished=true;}
      else this.poseAction.setLoop(THREE.LoopRepeat,Infinity);
      this.poseAction.reset().setEffectiveWeight(1).fadeIn(FADE_SECONDS).play();
      if(this.idleAction){
        this.additiveAction=this.createIdleOverlay(`idle_overlay_${actionName}`);
        this.additiveAction.fadeIn(FADE_SECONDS);
      }
      this.activeAction=actionName;
      this.clapIk=actionName==="clap"&&this.clapProfile!=="classic";
      this.gesturePending=false;
      this.activeUntil=hold?Number.POSITIVE_INFINITY:performance.now()/1000+config.duration;
      return true;
    }catch(error){if(requestId===this.requestId)this.gesturePending=false;console.warn(`动作 ${actionName} 加载失败。`,error);return false;}
  }
  async startCalibration(actionName="clap",frameIndex=0){
    const config=ACTIONS[actionName];if(!config||!this.vrm||!this.mixer)return false;
    const file=config.files[Math.max(0,Math.min(config.files.length-1,Number(frameIndex)||0))];
    const requestId=++this.requestId,vrm=this.vrm;
    try{
      const pose=await loadPose(file);
      if(requestId!==this.requestId||vrm!==this.vrm)return false;
      this.calibration=null;this.stopGesture(0.05);this.fadeRestOut(0.05);
      const clip=createPoseClip(pose,vrm,`calibration_${actionName}_${frameIndex}`);
      this.poseAction=this.mixer.clipAction(clip);
      this.poseAction.setLoop(THREE.LoopRepeat,Infinity).reset().setEffectiveWeight(1).play();
      this.activeAction="calibration";this.activeUntil=Number.POSITIVE_INFINITY;this.gesturePending=false;
      const baseQuaternions=new Map();
      for(const boneName of CALIBRATION_BONES){
        const rotation=poseBones(pose)[boneName]?.rotation;
        if(rotation)baseQuaternions.set(boneName,new THREE.Quaternion().fromArray(targetQuaternion(rotation,vrm)));
      }
      this.calibration={actionName,frameIndex:Number(frameIndex)||0,pose,offsets:new Map(),baseQuaternions};
      return true;
    }catch(error){console.warn("姿势标定启动失败。",error);return false;}
  }
  setCalibrationOffset(boneName,{x=0,y=0,z=0}={}){
    if(!this.calibration||!CALIBRATION_BONES.includes(boneName))return false;
    const euler=new THREE.Euler(
      THREE.MathUtils.degToRad(Number(x)||0),THREE.MathUtils.degToRad(Number(y)||0),THREE.MathUtils.degToRad(Number(z)||0),"XYZ"
    );
    this.calibration.offsets.set(boneName,new THREE.Quaternion().setFromEuler(euler));return true;
  }
  resetCalibrationOffsets(){
    if(!this.calibration)return false;
    this.calibration.offsets.clear();
    for(const [boneName,base] of this.calibration.baseQuaternions){
      const node=this.vrm.humanoid.getNormalizedBoneNode(boneName);if(node)node.quaternion.copy(base);
    }
    return true;
  }
  exportCalibrationPose(){
    if(!this.calibration||!this.vrm)return null;
    const result={};
    for(const [boneName,value] of Object.entries(poseBones(this.calibration.pose))){
      if(!value.rotation)continue;
      const quaternion=this.calibration.baseQuaternions.get(boneName)?.clone()||new THREE.Quaternion().fromArray(targetQuaternion(value.rotation,this.vrm));
      const offset=this.calibration.offsets.get(boneName);if(offset)quaternion.multiply(offset).normalize();
      result[boneName]={rotation:sourceQuaternion(quaternion,this.vrm).map(number=>Number(number.toFixed(9)))};
    }
    return {version:"1.0",pose:result};
  }
  stopCalibration(){if(!this.calibration)return false;this.calibration=null;this.stopPose(true);return true;}
  createIdleOverlay(name){
    const clip=this.idleAction.getClip().clone();clip.name=name;
    clip.tracks=clip.tracks.filter(track=>!track.name.endsWith("hips.position"));
    THREE.AnimationUtils.makeClipAdditive(clip);
    const action=this.mixer.clipAction(clip);action.blendMode=THREE.AdditiveAnimationBlendMode;
    action.setLoop(THREE.LoopRepeat,Infinity).reset().setEffectiveWeight(0.75).play();return action;
  }
  retire(action,duration){
    if(!action)return;action.fadeOut(duration);this.retiring.push({action,stopAt:performance.now()/1000+duration+.05});
  }
  stopGesture(duration){
    this.retire(this.poseAction,duration);this.retire(this.additiveAction,duration);
    this.poseAction=null;this.additiveAction=null;this.activeAction="idle";this.activeUntil=0;this.clapIk=false;
  }
  fadeRestOut(duration){
    if(this.restPose==="natural"){this.idleAction?.fadeOut(duration);this.restAction?.fadeOut(duration);}
    else{this.restAction?.fadeOut(duration);this.restAdditiveAction?.fadeOut(duration);}
  }
  restoreRest(duration){
    if(this.restPose==="natural"){this.idleAction?.reset().fadeIn(duration).play();this.restAction?.reset().setEffectiveWeight(1).fadeIn(duration).play();}
    else{
      this.restAction?.reset().setEffectiveWeight(1).fadeIn(duration).play();
      this.restAdditiveAction?.reset().setEffectiveWeight(0.75).fadeIn(duration).play();
    }
  }
  async setRestPose(name="natural"){
    if(!(name in REST_POSES))name="natural";
    const requestId=++this.requestId,vrm=this.vrm;this.restPose=name;this.gesturePending=false;
    this.stopGesture(FADE_SECONDS);
    this.retire(this.restAction,FADE_SECONDS);this.retire(this.restAdditiveAction,FADE_SECONDS);
    this.restAction=null;this.restAdditiveAction=null;
    try{
      const config=REST_POSES[name],poses=await Promise.all(config.files.map(loadPose));
      if(requestId!==this.requestId||vrm!==this.vrm)return false;
      const clip=createPoseClip(poses[0],vrm,`rest_${name}`);
      this.restAction=this.mixer.clipAction(clip);
      if(config.additive)this.restAction.blendMode=THREE.AdditiveAnimationBlendMode;
      this.restAction.setLoop(THREE.LoopRepeat,Infinity).reset().setEffectiveWeight(1).fadeIn(FADE_SECONDS).play();
      if(name==="natural")this.idleAction?.reset().fadeIn(FADE_SECONDS).play();
      else if(this.idleAction){this.restAdditiveAction=this.createIdleOverlay(`rest_idle_${name}`);this.restAdditiveAction.fadeIn(FADE_SECONDS);this.idleAction.fadeOut(FADE_SECONDS);}
      return true;
    }catch(error){console.warn(`待机姿势 ${name} 加载失败。`,error);this.restPose="natural";this.idleAction?.reset().fadeIn(FADE_SECONDS).play();return false;}
  }
  stopPose(fade=true){
    this.requestId++;this.gesturePending=false;this.calibration=null;
    const duration=fade?FADE_SECONDS:0.05;
    this.stopGesture(duration);this.restoreRest(duration);
  }
  applyWorldDelta(joint,deltaWorld,amount=1){
    if(!joint?.parent)return;
    const jointWorld=joint.getWorldQuaternion(new THREE.Quaternion());
    const desiredWorld=deltaWorld.multiply(jointWorld);
    const parentWorld=joint.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
    const desiredLocal=parentWorld.multiply(desiredWorld).normalize();
    joint.quaternion.slerp(desiredLocal,amount);joint.updateWorldMatrix(false,true);
  }
  rotateJointToward(joint,effector,target,amount=1){
    if(!joint||!effector||!joint.parent)return;
    joint.updateWorldMatrix(true,true);effector.updateWorldMatrix(true,false);
    const jointPosition=joint.getWorldPosition(new THREE.Vector3());
    const effectorDirection=effector.getWorldPosition(new THREE.Vector3()).sub(jointPosition);
    const targetDirection=target.clone().sub(jointPosition);
    if(effectorDirection.lengthSq()<1e-8||targetDirection.lengthSq()<1e-8)return;
    effectorDirection.normalize();targetDirection.normalize();
    this.applyWorldDelta(joint,new THREE.Quaternion().setFromUnitVectors(effectorDirection,targetDirection),amount);
  }
  alignPalmPlane(side,hand,fingertip,sideSign){
    const humanoid=this.vrm.humanoid;
    const index=humanoid.getNormalizedBoneNode(`${side}IndexProximal`);
    const little=humanoid.getNormalizedBoneNode(`${side}LittleProximal`);
    if(!index||!little)return;
    hand.updateWorldMatrix(true,true);fingertip.updateWorldMatrix(true,false);index.updateWorldMatrix(true,false);little.updateWorldMatrix(true,false);
    const wrist=hand.getWorldPosition(new THREE.Vector3());
    const fingerDirection=fingertip.getWorldPosition(new THREE.Vector3()).sub(wrist).normalize();
    const lateral=little.getWorldPosition(new THREE.Vector3()).sub(index.getWorldPosition(new THREE.Vector3())).normalize();
    const palmNormal=new THREE.Vector3().crossVectors(fingerDirection,lateral).normalize();
    const desiredNormal=new THREE.Vector3(-sideSign,0,0).addScaledVector(fingerDirection,sideSign*fingerDirection.x).normalize();
    palmNormal.addScaledVector(fingerDirection,-palmNormal.dot(fingerDirection)).normalize();
    const angle=Math.atan2(
      fingerDirection.dot(new THREE.Vector3().crossVectors(palmNormal,desiredNormal)),
      THREE.MathUtils.clamp(palmNormal.dot(desiredNormal),-1,1)
    );
    this.applyWorldDelta(hand,new THREE.Quaternion().setFromAxisAngle(fingerDirection,angle),0.9);
    if(side==="left")this.applyWorldDelta(hand,new THREE.Quaternion().setFromAxisAngle(fingerDirection,Math.PI),1);
  }
  applyClapIk(){
    const humanoid=this.vrm?.humanoid;if(!humanoid)return;
    const leftUpper=humanoid.getNormalizedBoneNode("leftUpperArm"),rightUpper=humanoid.getNormalizedBoneNode("rightUpperArm");
    const chest=humanoid.getNormalizedBoneNode("upperChest")||humanoid.getNormalizedBoneNode("chest");
    if(!leftUpper||!rightUpper||!chest)return;
    this.vrm.scene.updateMatrixWorld(true);
    const leftShoulder=leftUpper.getWorldPosition(new THREE.Vector3()),rightShoulder=rightUpper.getWorldPosition(new THREE.Vector3());
    const chestPosition=chest.getWorldPosition(new THREE.Vector3());
    const shoulderWidth=Math.max(leftShoulder.distanceTo(rightShoulder),0.25);
    const cycleDuration=ACTIONS.clap.step*2;
    const cycleTime=((this.poseAction?.time||0)%cycleDuration+cycleDuration)%cycleDuration;
    const openness=THREE.MathUtils.clamp(1-Math.abs(cycleTime-ACTIONS.clap.step)/ACTIONS.clap.step,0,1);
    const directionalHands=this.clapProfile==="soft";
    const aimFingers=this.clapProfile!=="classic";
    const clapForward=this.clapProfile==="nike1"?0.62:(directionalHands?0.38:0.42);
    const center=new THREE.Vector3(
      (leftShoulder.x+rightShoulder.x)/2,
      chestPosition.y-shoulderWidth*(directionalHands?0.2:-0.05),
      chestPosition.z+shoulderWidth*clapForward
    );
    for(const side of ["left","right"]){
      const upper=humanoid.getNormalizedBoneNode(`${side}UpperArm`);
      const lower=humanoid.getNormalizedBoneNode(`${side}LowerArm`);
      const hand=humanoid.getNormalizedBoneNode(`${side}Hand`);
      if(!upper||!lower||!hand)continue;
      const shoulder=side==="left"?leftShoulder:rightShoulder;
      const sideSign=Math.sign(shoulder.x-center.x)||((side==="left")?1:-1);
      const wristGap=this.clapProfile==="soft"?0.068:this.clapProfile==="nike2"?0.05:this.clapProfile==="nike1"?0.038:0.02;
      const target=center.clone();target.x+=sideSign*shoulderWidth*wristGap;
      for(let iteration=0;iteration<3;iteration++){
        this.rotateJointToward(lower,hand,target,0.82);
        this.rotateJointToward(upper,hand,target,0.72);
      }
      if(this.clapProfile==="nike1"||this.clapProfile==="nike2"){
        lower.updateWorldMatrix(true,true);
        const elbowTarget=lower.getWorldPosition(new THREE.Vector3());
        const elbowSpread=this.clapProfile==="nike1"?0.13:0.055;
        elbowTarget.x+=sideSign*shoulderWidth*elbowSpread;
        if(this.clapProfile==="nike1")elbowTarget.z+=shoulderWidth*0.1;
        this.rotateJointToward(upper,lower,elbowTarget,0.4);
        this.rotateJointToward(lower,hand,target,0.9);
      }
      const fingertip=humanoid.getNormalizedBoneNode(`${side}MiddleDistal`)||humanoid.getNormalizedBoneNode(`${side}MiddleIntermediate`);
      if(aimFingers&&fingertip){
        hand.updateWorldMatrix(true,true);fingertip.updateWorldMatrix(true,false);
        const wristPosition=hand.getWorldPosition(new THREE.Vector3());
        const handLength=Math.max(wristPosition.distanceTo(fingertip.getWorldPosition(new THREE.Vector3())),shoulderWidth*0.12);
        const fingertipTarget=new THREE.Vector3(
          center.x+sideSign*handLength*(0.015+openness*0.48),
          center.y+handLength*0.96,
          center.z
        );
        this.rotateJointToward(hand,fingertip,fingertipTarget,0.92);
        if(directionalHands)this.alignPalmPlane(side,hand,fingertip,sideSign);
      }
    }
  }
  applyNike2DanglingHandCorrection(){
    if(this.clapProfile!=="nike2"||(this.activeAction!=="shy"&&this.activeAction!=="surprise"))return;
    const side=this.activeAction==="shy"?"right":"left";
    const humanoid=this.vrm?.humanoid,lower=humanoid?.getNormalizedBoneNode(`${side}LowerArm`),hand=humanoid?.getNormalizedBoneNode(`${side}Hand`);
    lower?.quaternion.identity();hand?.quaternion.identity();
  }
  update(delta){
    if(!this.mixer)return;
    const now=performance.now()/1000;
    if(this.activeUntil&&now>=this.activeUntil)this.stopPose(true);
    this.mixer.update(delta);
    if(this.calibration){
      for(const [boneName,base] of this.calibration.baseQuaternions){
        const node=this.vrm.humanoid.getNormalizedBoneNode(boneName);if(!node)continue;
        node.quaternion.copy(base);
        const offset=this.calibration.offsets.get(boneName);if(offset)node.quaternion.multiply(offset);
      }
    }
    if(this.clapIk&&!this.calibration)this.applyClapIk();
    this.applyNike2DanglingHandCorrection();
    this.retiring=this.retiring.filter(entry=>{if(now<entry.stopAt)return true;entry.action.stop();return false;});
  }
  get active(){return this.activeAction!=="idle";}
  get hasGesture(){return this.gesturePending||this.active;}
}
