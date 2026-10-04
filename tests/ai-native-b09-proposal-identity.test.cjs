'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' proposal identity and availability invalidate the first new render',async()=>{
 const definition=load('apps/'+app+'/src/components/ai-native/ai-proposal-confirm/index.ts');
 for(const patch of [{proposal:{id:'B',revision:'1'}},{proposal:{id:'A',revision:'2'}},{expired:true},{disabled:true}]){
  let calls=0;const instance=mount(definition,{proposal:{id:'A',revision:'1'},disabled:false,confirmHandler:async()=>{calls++;}});
  instance.onCheck({detail:{value:['read']}});assert.notEqual(instance.data.checkedIdentity,'');
  instance.update(patch);assert.equal(instance.data.checkedIdentity,'');await instance.onConfirm();assert.equal(calls,0);
 }
});
