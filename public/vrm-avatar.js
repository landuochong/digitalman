import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VrmMotionController } from "./vrm-motion.js?v=20260810-nod-v1";

const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
const damp=(current,target,speed,dt)=>THREE.MathUtils.damp(current,target,speed,dt);
const NIKE2_SKIN_COLOR="#f6ddd6";
const NIKE2_FOREARM_COLOR="#f2d2ca";
const GESTURES=new Set(["wave_approval","nod","clap","cheer","bow","shrug","cross","confident_arms_crossed","shy","thinking","caring","surprise"]);

export class VrmCompanion{
  constructor(canvas,{modelUrl="/vrm/models/lumi-cc0.vrm",restPose="natural",onReady,onError}={}){
    this.canvas=canvas;this.onReady=onReady;this.onError=onError;
    this.clock=new THREE.Clock();this.vrm=null;this.audioLevel=0;this.speaking=false;this.blush=0;this.blushMeshes=[];this.forearmOverlays=[];
    this.emotion="calm";this.action="idle";this.expression=0;this.blink=0;
    this.nextBlink=2.2+Math.random()*2;this.blinkTime=-1;this.lastGesture=-Infinity;
    this.modelUrl=modelUrl;this.loadingToken=0;this.motion=new VrmMotionController();this.motion.restPose=restPose;
    this.scene=new THREE.Scene();
    this.modelPivot=new THREE.Group();this.scene.add(this.modelPivot);
    this.camera=new THREE.PerspectiveCamera(28,1,.1,20);this.camera.position.set(0,1.38,2.45);
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:"high-performance"});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.controls=new OrbitControls(this.camera,canvas);this.controls.enableDamping=true;this.controls.dampingFactor=.08;
    this.controls.screenSpacePanning=true;this.controls.minPolarAngle=.12;this.controls.maxPolarAngle=Math.PI-.12;
    this.scene.add(new THREE.AmbientLight(0xffffff,1.2));
    const key=new THREE.DirectionalLight(0xffffff,1.8);key.position.set(1,1,1).normalize();this.scene.add(key);
    this.lookTarget=new THREE.Object3D();this.lookTarget.position.set(0,1.42,2.6);this.scene.add(this.lookTarget);
    this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(canvas);this.resize();
    this.load(modelUrl);this.animate();
  }
  async load(url){
    const token=++this.loadingToken;
    try{
      const loader=new GLTFLoader();loader.register(parser=>new VRMLoaderPlugin(parser));
      const gltf=await loader.loadAsync(url);
      if(token!==this.loadingToken){VRMUtils.deepDispose(gltf.scene);return false;}
      const next=gltf.userData.vrm;
      VRMUtils.removeUnnecessaryVertices(gltf.scene);VRMUtils.combineSkeletons(gltf.scene);VRMUtils.combineMorphs(next);
      VRMUtils.rotateVRM0(next);
      const previous=this.vrm;
      this.vrm=next;this.modelUrl=url;this.expression=0;this.blink=0;this.action="idle";
      next.scene.visible=false;this.modelPivot.add(next.scene);this.tuneModelMaterials(url,next.scene);this.prepareFallbackPose();this.prepareHands();this.prepareBlush();this.prepareForearmOverlays(url);
      if(next.lookAt)next.lookAt.target=this.lookTarget;
      this.motion.modelProfile=url.includes("avatar-sample-b.vrm")?"default":"mouth";
      this.motion.clapProfile=url.includes("avatar-sample-a.vrm")?"soft":url.includes("avatar-sample-b.vrm")?"vivid":url.includes("nikechan_v1.vrm")?"nike1":url.includes("nikechan_v2.vrm")?"nike2":"classic";
      await this.motion.attach(next);
      if(token!==this.loadingToken)return false;
      this.motion.update(.42);next.update(0);
      if(previous){this.modelPivot.remove(previous.scene);VRMUtils.deepDispose(previous.scene);}
      this.modelPivot.rotation.y=0;this.fitModel();next.scene.visible=true;
      this.onReady?.(next.meta,url);return true;
    }catch(error){console.error(error);if(token===this.loadingToken)this.onError?.(error,url);return false;}
  }
  switchModel(url){if(url===this.modelUrl&&this.vrm)return Promise.resolve(true);return this.load(url);}
  tuneModelMaterials(url,scene){
    scene.traverse(object=>{
      if(!object.isMesh)return;
      for(const material of Array.isArray(object.material)?object.material:[object.material]){
        if(!material)continue;
        if(url.includes("nikechan_v2.vrm")&&(material.name==="NikeChanBody"||material.name==="NikeChanBodyShade")){
          material.color?.set(NIKE2_SKIN_COLOR);material.needsUpdate=true;
        }
      }
    });
  }
  fitModel(){
    this.modelPivot.position.set(0,0,0);
    this.modelPivot.updateMatrixWorld(true);this.vrm.scene.updateMatrixWorld(true);
    const box=new THREE.Box3().setFromObject(this.vrm.scene),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const hips=this.vrm.humanoid.getRawBoneNode("hips"),bodyCenter=hips?.getWorldPosition(new THREE.Vector3())||center;
    this.modelPivot.position.x=-bodyCenter.x;this.modelPivot.position.y=-box.min.y;
    this.modelPivot.updateMatrixWorld(true);
    const height=Math.max(size.y,1);this.camera.position.set(0,height*.69,height*1.4);this.camera.lookAt(0,height*.68,0);
    this.controls.target.set(0,height*.68,0);this.controls.minDistance=height*.55;this.controls.maxDistance=height*3.4;this.controls.update();
    this.defaultViewTarget=this.controls.target.clone();this.defaultViewOffset=this.camera.position.clone().sub(this.controls.target);
    this.lookTarget.position.copy(this.camera.position);
  }
  bone(name){return this.vrm?.humanoid?.getNormalizedBoneNode(name)||null;}
  prepareFallbackPose(){
    const lu=this.bone("leftUpperArm"),ru=this.bone("rightUpperArm"),ll=this.bone("leftLowerArm"),rl=this.bone("rightLowerArm");
    if(lu)lu.rotation.z=1.3;if(ru)ru.rotation.z=-1.32;if(ll)ll.rotation.z=.34;if(rl)rl.rotation.z=-.3;
  }
  prepareHands(){
    for(const side of ["left","right"]){
      const sign=side==="left"?1:-1;
      for(const finger of ["Index","Middle","Ring","Little"]){
        const proximal=this.bone(`${side}${finger}Proximal`),intermediate=this.bone(`${side}${finger}Intermediate`),distal=this.bone(`${side}${finger}Distal`);
        if(proximal)proximal.rotation.z=sign*.12;if(intermediate)intermediate.rotation.z=sign*.08;if(distal)distal.rotation.z=sign*.04;
      }
    }
  }
  prepareBlush(){
    this.blush=0;this.blushMeshes=[];
    const head=this.bone("head");if(!head)return;
    const canvas=document.createElement("canvas");canvas.width=128;canvas.height=64;
    const context=canvas.getContext("2d"),gradient=context.createRadialGradient(64,32,2,64,32,58);
    gradient.addColorStop(0,"rgba(255,88,116,.9)");gradient.addColorStop(.46,"rgba(255,112,137,.55)");gradient.addColorStop(1,"rgba(255,145,160,0)");
    context.fillStyle=gradient;context.fillRect(0,0,128,64);
    context.strokeStyle="rgba(255,78,108,.72)";context.lineWidth=5;context.lineCap="round";
    for(const x of [45,64,83]){context.beginPath();context.moveTo(x-7,39);context.lineTo(x+4,24);context.stroke();}
    const texture=new THREE.CanvasTexture(canvas);texture.colorSpace=THREE.SRGBColorSpace;
    for(const x of [-0.055,0.055]){
      const material=new THREE.MeshBasicMaterial({map:texture,transparent:true,opacity:0,depthWrite:false,depthTest:true,toneMapped:false,side:THREE.DoubleSide});
      const cheek=new THREE.Mesh(new THREE.PlaneGeometry(0.058,0.029),material);
      cheek.position.set(x,0.03,-0.106);cheek.renderOrder=10;head.add(cheek);this.blushMeshes.push(cheek);
    }
  }
  prepareForearmOverlays(url){
    this.forearmOverlays=[];if(!url.includes("nikechan_v2.vrm"))return;
    const rawBones=["left","right"].map(side=>({side,bone:this.vrm.humanoid.getRawBoneNode(`${side}LowerArm`)})).filter(item=>item.bone);
    const meshes=[];this.vrm.scene.traverse(object=>{if(object.isSkinnedMesh)meshes.push(object);});
    for(const mesh of meshes){
      const sourceMaterials=Array.isArray(mesh.material)?mesh.material:[mesh.material];
      if(!sourceMaterials.some(material=>material?.name==="NikeChanBody"||material?.name==="NikeChanBodyShade"))continue;
      for(const {side,bone} of rawBones){
        const index=mesh.skeleton?.bones.indexOf(bone);if(index<0)continue;
        const materials=sourceMaterials.map(source=>{
          const material=new THREE.MeshBasicMaterial({
            color:NIKE2_FOREARM_COLOR,side:source.side,
            depthTest:false,depthWrite:false,transparent:true,toneMapped:false,
          });
          material.onBeforeCompile=shader=>{
            const mask=`(1.0-step(0.5,abs(float(skinIndex.x)-${index}.0)))*skinWeight.x+(1.0-step(0.5,abs(float(skinIndex.y)-${index}.0)))*skinWeight.y+(1.0-step(0.5,abs(float(skinIndex.z)-${index}.0)))*skinWeight.z+(1.0-step(0.5,abs(float(skinIndex.w)-${index}.0)))*skinWeight.w`;
            shader.vertexShader=shader.vertexShader
              .replace("#include <common>","#include <common>\nvarying float vForearmMask;")
              .replace("#include <skinning_vertex>",`#include <skinning_vertex>\nvForearmMask=${mask};`);
            shader.fragmentShader=shader.fragmentShader
              .replace("#include <common>","#include <common>\nvarying float vForearmMask;")
              .replace("#include <clipping_planes_fragment>","#include <clipping_planes_fragment>\nif(vForearmMask<0.015)discard;");
          };
          material.customProgramCacheKey=()=>`v2-${side}-forearm-overlay-${index}`;return material;
        });
        const overlay=mesh.clone(false);overlay.material=Array.isArray(mesh.material)?materials:materials[0];overlay.skeleton=mesh.skeleton;
        overlay.bindMatrix.copy(mesh.bindMatrix);overlay.bindMatrixInverse.copy(mesh.bindMatrixInverse);overlay.name=`${mesh.name}_${side}_forearm_overlay`;
        overlay.userData.forearmSide=side;overlay.renderOrder=1000;overlay.frustumCulled=false;overlay.visible=false;
        mesh.parent.add(overlay);this.forearmOverlays.push(overlay);
      }
    }
  }
  setSpeaking(active){this.speaking=active;if(!active)this.audioLevel=0;}
  setAudioLevel(level){this.audioLevel=clamp(level);}
  setRestPose(name){return this.motion.setRestPose(name);}
  startPoseCalibration(frameIndex=0){return this.motion.startCalibration("clap",frameIndex);}
  setPoseCalibrationOffset(boneName,offset){return this.motion.setCalibrationOffset(boneName,offset);}
  resetPoseCalibration(){return this.motion.resetCalibrationOffsets();}
  exportPoseCalibration(){return this.motion.exportCalibrationPose();}
  stopPoseCalibration(){return this.motion.stopCalibration();}
  setViewAngle(degrees){
    const angle=THREE.MathUtils.degToRad(degrees),offset=this.defaultViewOffset||this.camera.position.clone().sub(this.controls.target);
    const target=this.defaultViewTarget||this.controls.target;this.controls.target.copy(target);
    const radius=Math.max(Math.hypot(offset.x,offset.z),.01);
    this.camera.position.x=this.controls.target.x+Math.sin(angle)*radius;
    this.camera.position.y=this.controls.target.y+offset.y;
    this.camera.position.z=this.controls.target.z+Math.cos(angle)*radius;
    this.controls.update();return this.getViewAngle();
  }
  nudgeViewAngle(degrees){return this.setViewAngle(this.getViewAngle()+degrees);}
  getViewAngle(){const offset=this.camera.position.clone().sub(this.controls.target);return THREE.MathUtils.radToDeg(Math.atan2(offset.x,offset.z));}
  resetView(){this.fitModel();return 0;}
  setBehavior(emotion="calm",action="idle",force=false,holdGesture=false){
    this.emotion=emotion;this.action=action;
    const now=this.clock.elapsedTime;
    if(GESTURES.has(action)&&(force||now-this.lastGesture>=3)){
      this.lastGesture=now;void this.motion.play(action,{hold:holdGesture});
      return true;
    }
    return false;
  }
  finishGesture(){if(this.motion.hasGesture)this.motion.stopPose(true);}
  resize(){const rect=this.canvas.getBoundingClientRect();if(!rect.width||!rect.height)return;this.renderer.setSize(rect.width,rect.height,false);this.camera.aspect=rect.width/rect.height;this.camera.updateProjectionMatrix();}
  setExpression(name,value){this.vrm?.expressionManager?.setValue(name,clamp(value));}
  updateBlink(t,dt){
    if(this.blinkTime<0&&t>=this.nextBlink)this.blinkTime=0;
    if(this.blinkTime>=0){
      this.blinkTime+=dt;const p=this.blinkTime/.18;
      this.blink=p<.45?Math.sin(p/.45*Math.PI/2):Math.max(0,Math.cos((p-.45)/.55*Math.PI/2));
      if(p>=1){this.blinkTime=-1;this.blink=0;this.nextBlink=t+3.2+Math.random()*3.4;}
    }
    this.setExpression("blink",this.blink);
  }
  updateExpressions(dt,t){
    const target=this.emotion==="happy"||this.emotion==="excited"?.28:this.emotion==="caring"?.12:.04;
    this.expression=damp(this.expression,target,4,dt);this.setExpression("happy",this.expression);
    this.setExpression("relaxed",this.emotion==="calm"?.1:0);
    this.setExpression("surprised",this.motion.activeAction==="surprise"?.34:0);
    const showBothForearms=this.motion.activeAction==="caring"||this.motion.activeAction==="thinking"||this.motion.activeAction==="cheer"||
      (this.motion.activeAction==="idle"&&this.motion.restPose==="touch");
    this.forearmOverlays.forEach(overlay=>{
      overlay.visible=showBothForearms||(this.motion.activeAction==="wave_approval"&&overlay.userData.forearmSide==="right");
    });
    this.blush=damp(this.blush,this.motion.activeAction==="shy"?.68:0,7,dt);
    this.blushMeshes.forEach(cheek=>{cheek.material.opacity=this.blush;});
    const open=this.speaking?clamp((this.audioLevel-.025)*2.1):0;
    this.setExpression("aa",open*.66);this.setExpression("oh",open*.22*(.5+.5*Math.sin(t*7.3)));this.setExpression("ih",open*.12*(.5+.5*Math.cos(t*6.1)));
  }
  animate(){
    requestAnimationFrame(()=>this.animate());
    const dt=Math.min(this.clock.getDelta(),.05),t=this.clock.elapsedTime;
    this.controls.update();
    if(this.vrm){this.lookTarget.position.copy(this.camera.position);this.motion.update(dt);this.updateBlink(t,dt);this.updateExpressions(dt,t);this.vrm.update(dt);}
    this.renderer.render(this.scene,this.camera);
  }
}
