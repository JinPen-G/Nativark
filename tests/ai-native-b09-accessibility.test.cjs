'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' multiple input instances isolate IDs and disabled handlers emit nothing',async()=>{
 const definition=load('apps/'+app+'/src/components/ai-native/ai-supplement-input/index.ts');
 const properties={taskId:'synthetic',inputRevision:'1',fields:[{key:'note',label:'Note'}],disabled:true,submitHandler:async()=>{throw new Error('disabled handler should not run');}};
 const a=mount(definition,properties),b=mount(definition,properties);assert.notEqual(a.data.instanceId,b.data.instanceId);
 a.onFieldInput({currentTarget:{dataset:{key:'note'}},detail:{value:'ignored'}});await a.onSubmit();
 assert.equal(a.events.length,0);assert.equal(Object.keys(a.data.localDraft).length,0);a.detach();b.detach();
});
