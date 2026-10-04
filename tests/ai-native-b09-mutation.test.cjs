'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount,deferred}=require('./fixtures/ai-native/b09-host.cjs');
test('in-memory removal of generation, pending and cursor checks breaks their invariants',async()=>{
 const prefix='apps/miniprogram/src/components/ai-native/';
 const {AiPollingController}=load(prefix+'polling-controller.ts',source=>source.replace('generation !== this.generation','false'));
 const pending=deferred();let writes=0;const controller=new AiPollingController(()=>pending.promise,()=>writes++);
 const read=controller.poll({audience:'client',tenantId:'synthetic'});controller.changeContext();
 // Also remove abort invalidation so this mutation isolates the generation assertion.
 const {AiPollingController:GenerationMutant}=load(prefix+'polling-controller.ts',source=>source.replace('generation !== this.generation','false').replace('changeContext() { this.generation += 1; this.abort?.abort(); }','changeContext() { this.generation += 1; }'));
 const late=deferred();const mutant=new GenerationMutant(()=>late.promise,()=>writes++);const result=mutant.poll({audience:'client',tenantId:'synthetic'});mutant.changeContext();late.resolve({});await result;
 assert.throws(()=>assert.equal(writes,0),/Expected/);pending.resolve({});await read;
 const definition=load(prefix+'ai-proposal-confirm/index.ts',source=>source.replaceAll(' || this.data.submitting',''));
 const response=deferred();let calls=0;
 const instance=mount(definition,{proposal:{id:'synthetic',revision:'1'},disabled:false,confirmHandler:()=>{calls++;return response.promise;}});
 instance.onCheck({detail:{value:['read']}});const a=instance.onConfirm(),b=instance.onConfirm();
 assert.throws(()=>assert.equal(calls,1),/Expected/);response.resolve();await Promise.all([a,b]);
 const cursor=load(prefix+'cursor-adapter.ts',source=>source.replace('!knownTypes.includes(event.type)','false'));
 const state=cursor.applyCursorEvent(cursor.initialCursorState('synthetic','v1'),{taskId:'synthetic',version:'v1',type:'unsupported',cursor:'1'},[]);
 assert.throws(()=>assert.equal(state.cursor,null),/Expected/);
});
