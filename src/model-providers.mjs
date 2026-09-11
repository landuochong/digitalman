export class ProviderUnavailableError extends Error {
  constructor(capability,provider){super(`${provider} 不支持 ${capability}`);this.name="ProviderUnavailableError";this.status=503;this.capability=capability;this.provider=provider;}
}

export class ModelProviderAdapter {
  constructor({id,capabilities={},handlers={}}={}){
    this.id=String(id||"unknown");
    this.capabilities=Object.freeze({...capabilities});
    this.handlers={...handlers};
  }
  supports(capability){return Boolean(this.capabilities[capability]&&typeof this.handlers[capability]==="function");}
  invoke(capability,input,context={}){
    if(!this.supports(capability))throw new ProviderUnavailableError(capability,this.id);
    return this.handlers[capability](input,{...context,provider:this.id});
  }
}

export class ProviderRegistry {
  constructor(capability){this.capability=capability;this.providers=new Map();}
  register(provider){
    if(!(provider instanceof ModelProviderAdapter))throw new TypeError("provider 必须是 ModelProviderAdapter");
    this.providers.set(provider.id,provider);return this;
  }
  get(id){return this.providers.get(String(id||""))||null;}
  require(id){
    const provider=this.get(id);
    if(!provider)throw new ProviderUnavailableError(this.capability,String(id||"unknown"));
    return provider;
  }
  invoke(id,input,context={}){return this.require(id).invoke(this.capability,input,context);}
  describe(){return[...this.providers.values()].map(provider=>({id:provider.id,available:provider.supports(this.capability)}));}
}
