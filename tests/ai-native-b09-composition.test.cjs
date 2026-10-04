'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount,deferred}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' actual card, input, proposal, polling and customer result compose without automatic effects',async()=>{
 const prefix='apps/'+app+'/src/components/ai-native/';
 const card=mount(load(prefix+'ai-task-card/index.ts'),{task:{id:'synthetic-task'},disabled:false,available:true});
 assert.equal(card.events.length,0);card.onOpen();assert.equal(card.events[0].detail.taskId,'synthetic-task');
 const input=mount(load(prefix+'ai-supplement-input/index.ts'),{taskId:'synthetic-task',inputRevision:'1',fields:[{key:'note',label:'Note'}],submitHandler:async()=>{}});
 input.onFieldInput({currentTarget:{dataset:{key:'note'}},detail:{value:'synthetic'}});await input.onSubmit();assert.equal(input.events[0].name,'submit');
 let confirms=0;const proposal=mount(load(prefix+'ai-proposal-confirm/index.ts'),{proposal:{id:'synthetic-proposal',revision:'1'},disabled:false,confirmHandler:async()=>{confirms++;}});
 proposal.onCheck({detail:{value:['read']}});await proposal.onConfirm();assert.equal(confirms,1);
 const customer=mount(load(prefix+'ai-order-explanation/index.ts'),{available:true,order:{availabilityLabel:'待核对',paid:null}});
 const waiting=deferred();const {AiPollingController}=load(prefix+'polling-controller.ts');
 const controller=new AiPollingController(()=>waiting.promise,()=>customer.update({order:{paid:0,availabilityLabel:'已完成'}}));
 const read=controller.poll({audience:'client',tenantId:'synthetic-tenant',taskId:'synthetic-task'});
 customer.update({available:false});proposal.update({disabled:true});controller.changeContext();waiting.resolve({cursor:'1',events:[],version:'v1'});
 assert.equal(await read,'stale');assert.equal(customer.data.projection,null);
 input.detach();proposal.detach();controller.destroy();
});
