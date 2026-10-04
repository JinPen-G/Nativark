'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount,deferred}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' confirmation waits, locks double click and isolates late results',async()=>{
 const definition=load('apps/'+app+'/src/components/ai-native/ai-proposal-confirm/index.ts');
 const pending=deferred();let calls=0;const handler=()=>{calls++;return pending.promise;};
 const instance=mount(definition,{proposal:{id:'synthetic-A',revision:'1'},disabled:false,confirmHandler:handler});
 instance.onCheck({detail:{value:['read']}});
 const first=instance.onConfirm();await instance.onConfirm();assert.equal(calls,1);assert.equal(instance.data.submitting,true);assert.equal(instance.events.filter(e=>e.name==='confirm').length,0);
 instance.update({proposal:{id:'synthetic-B',revision:'1'}});await instance.onConfirm();assert.equal(calls,1);
 pending.reject(new Error('secret internal exception'));await first;assert.equal(instance.data.errorLabel,'');
 instance.update({confirmHandler:()=>{throw new Error('private');}});
 instance.onCheck({detail:{value:['read']}});await instance.onConfirm();assert.match(instance.data.errorLabel,/提交失败/);assert.doesNotMatch(instance.data.errorLabel,/private/);
 const late=deferred();instance.update({confirmHandler:()=>late.promise});instance.onCheck({detail:{value:['read']}});const last=instance.onConfirm();instance.detach();late.resolve();await last;assert.equal(instance.events.filter(e=>e.name==='confirm').length,0);
});
