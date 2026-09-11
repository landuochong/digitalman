import test from "node:test";
import assert from "node:assert/strict";
import { ModelProviderAdapter, ProviderRegistry, ProviderUnavailableError } from "../src/model-providers.mjs";

test("provider registries expose one stable interface for model implementations",async()=>{
  const registry=new ProviderRegistry("transcribe").register(new ModelProviderAdapter({
    id:"local_sherpa",capabilities:{transcribe:true},handlers:{transcribe:async(input,context)=>({text:String(input),provider:context.provider})}
  }));
  assert.deepEqual(await registry.invoke("local_sherpa","你好"),{text:"你好",provider:"local_sherpa"});
  assert.deepEqual(registry.describe(),[{id:"local_sherpa",available:true}]);
});

test("unsupported capabilities fail consistently",()=>{
  const registry=new ProviderRegistry("synthesize").register(new ModelProviderAdapter({id:"demo"}));
  assert.throws(()=>registry.invoke("demo",{}),error=>error instanceof ProviderUnavailableError&&error.status===503);
});
