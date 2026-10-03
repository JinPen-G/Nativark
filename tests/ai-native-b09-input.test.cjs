'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount,deferred}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' clarification uses finite fields, waits and clears draft on identity change',async()=>{
 const definition=load('apps/'+app+'/src/components/ai-native/ai-supplement-input/index.ts');
 const pending=deferred();let calls=0;
 const instance=mount(definition,{taskId:'synthetic-A',inputRevision:'1',fields:[{key:'name',label:'Name',value:'initial',required:true},{key:'constructor',label:'invalid'}],submitHandler:()=>{calls++;return pending.promise;}});
 instance.onFieldInput({currentTarget:{dataset:{key:'hidden'}},detail:{value:'no'}});
 assert.equal(Object.keys(instance.data.localDraft).length,0);
 instance.onFieldInput({currentTarget:{dataset:{key:'name'}},detail:{value:''}});assert.equal(instance.data.visibleFields[0].value,'');
 await instance.onSubmit();assert.equal(calls,0);
 instance.onFieldInput({currentTarget:{dataset:{key:'name'}},detail:{value:'synthetic'}});
 const first=instance.onSubmit();await instance.onSubmit();assert.equal(calls,1);
 instance.update({taskId:'synthetic-B'});assert.equal(Object.keys(instance.data.localDraft).length,0);
 pending.reject(new Error('private'));await first;assert.equal(instance.data.errorLabel,'');
 instance.update({submitHandler:async()=>{throw new Error('private');}});await instance.onSubmit();assert.match(instance.data.errorLabel,/提交失败/);
 instance.detach();assert.equal(instance.data.visibleFields.length,0);
});
