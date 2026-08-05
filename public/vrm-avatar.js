import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils } from "@pixiv/three-vrm";
import { VrmMotionController } from "./vrm-motion.js";

const clamp=(value,min=0,max=1)=>Math.min(max,Math.max(min,value));
const damp=(current,target,speed,dt)=>THREE.MathUtils.damp(current,target,speed,dt);
const GESTURES=new Set(["wave_approval","clap","thinking","caring","surprise"]);

export class VrmCompanion{
  constructor(canvas,{modelUrl="/vrm/models/lumi-cc0.vrm",onReady,onError}={}){
    this.canvas=canvas;this.onReady=onReady;this.onError=onError;
    this.clock=new THREE.Clock();this.vrm=null;this.audioLevel=0;this.speaking=false;
    this.emotion="calm";this.action="idle";this.expression=0;this.blink=0;
    this.nextBlink=2.2+Math.random()*2;this.blinkTime=-1;this.lastGesture=-Infinity;
    this.modelUrl=modelUrl;this.loadingToken=0;this.motion=new VrmMotionController();
    this.viewYaw=0;this.targetViewYaw=0;
    this.scene=new THREE.Scene();
    this.modelPivot=new THREE.Group();this.scene.add(this.modelPivot);
    this.camera=new THREE.PerspectiveCamera(28,1,.1,20);this.camera.position.set(0,1.38,2.45);
    this.renderer=new THREE.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:"high-performance"});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio,2));this.renderer.outputColorSpace=THREE.SRGBColorSpace;
    this.scene.add(new THREE.HemisphereLight(0xfffaf5,0x8d8290,2.25));
    const key=new THREE.DirectionalLight(0xfff1e7,2.6);key.position.set(1.8,3,2.8);this.scene.add(key);
    const fill=new THREE.DirectionalLight(0xb9c8ff,1.25);fill.position.set(-2,1.8,1);this.scene.add(fill);
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
      if(this.vrm){this.modelPivot.remove(this.vrm.scene);VRMUtils.deepDispose(this.vrm.scene);}
      this.vrm=next;this.modelUrl=url;this.expression=0;this.blink=0;this.action="idle";
      this.modelPivot.rotation.y=0;this.modelPivot.add(next.scene);this.fitModel();this.prepareFallbackPose();this.prepareHands();
      if(next.lookAt)next.lookAt.target=this.lookTarget;
      await this.motion.attach(next);
      if(token!==this.loadingToken)return false;
      this.motion.update(0);next.update(0);this.fitModel();
      this.onReady?.(next.meta,url);return true;
    }catch(error){console.error(error);if(token===this.loadingToken)this.onError?.(error,url);return false;}
  }
  switchModel(url){if(url===this.modelUrl&&this.vrm)return Promise.resolve(true);return this.load(url);}
  fitModel(){
    this.modelPivot.position.set(0,0,0);
    const box=new THREE.Box3().setFromObject(this.vrm.scene),center=box.getCenter(new THREE.Vector3()),size=box.getSize(new THREE.Vector3());
    const hips=this.vrm.humanoid.getRawBoneNode("hips"),bodyCenter=hips?.getWorldPosition(new THREE.Vector3())||center;
    this.modelPivot.position.x=-bodyCenter.x;this.modelPivot.position.y=-box.min.y;
    const height=Math.max(size.y,1);this.camera.position.set(0,height*.69,height*1.4);this.camera.lookAt(0,height*.68,0);
    this.lookTarget.position.set(0,height*.72,height*2);
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
  setSpeaking(active){this.speaking=active;if(!active)this.audioLevel=0;}
  setAudioLevel(level){this.audioLevel=clamp(level);}
  setViewAngle(degrees,immediate=false){
    this.targetViewYaw=THREE.MathUtils.clamp(THREE.MathUtils.degToRad(degrees),THREE.MathUtils.degToRad(-65),THREE.MathUtils.degToRad(65));
    if(immediate)this.viewYaw=this.targetViewYaw;
    return this.getViewAngle();
  }
  nudgeViewAngle(degrees){return this.setViewAngle(this.getViewAngle()+degrees);}
  getViewAngle(){return THREE.MathUtils.radToDeg(this.targetViewYaw);}
  setBehavior(emotion="calm",action="idle",force=false){
    this.emotion=emotion;this.action=action;
    const now=this.clock.elapsedTime;
    if(GESTURES.has(action)&&(force||now-this.lastGesture>=3)){
      this.lastGesture=now;void this.motion.play(action);
    }
  }
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
    const open=this.speaking?clamp((this.audioLevel-.025)*2.1):0;
    this.setExpression("aa",open*.66);this.setExpression("oh",open*.22*(.5+.5*Math.sin(t*7.3)));this.setExpression("ih",open*.12*(.5+.5*Math.cos(t*6.1)));
  }
  animate(){
    requestAnimationFrame(()=>this.animate());
    const dt=Math.min(this.clock.getDelta(),.05),t=this.clock.elapsedTime;
    if(this.vrm){this.viewYaw=damp(this.viewYaw,this.targetViewYaw,8,dt);this.modelPivot.rotation.y=this.viewYaw;this.motion.update(dt);this.updateBlink(t,dt);this.updateExpressions(dt,t);this.vrm.update(dt);}
    this.renderer.render(this.scene,this.camera);
  }
}
