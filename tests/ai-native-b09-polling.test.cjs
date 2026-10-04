'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,deferred}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']){
 const file='apps/'+app+'/src/components/ai-native/polling-controller.ts';
 test(app+' single in-flight and lifecycle stale result',async()=>{
  const {AiPollingController}=load(file); const pending=deferred();let calls=0;const pages=[];
  const controller=new AiPollingController(()=>{calls++;return pending.promise;},p=>pages.push(p));
  const first=controller.poll({audience:'staff',tenantId:'synthetic-A'});
  assert.equal(await controller.poll({audience:'staff',tenantId:'synthetic-A'}),'skipped');
  controller.pause();controller.resume();assert.equal(await controller.poll({audience:'staff',tenantId:'synthetic-A'}),'skipped');
  controller.destroy();pending.resolve({cursor:'9007199254740993',events:[],version:'v1'});
  assert.equal(await first,'stale');assert.equal(calls,1);assert.equal(pages.length,0);
  assert.equal(await controller.poll({audience:'staff',tenantId:'synthetic-A'}),'skipped');
 });
 test(app+' loop releases timers, coalesces show and drops late results',async()=>{
  const {AiPollingController,AiPollingLoop}=load(file);const pending=deferred();let calls=0;let output=0;
  const timers=new Map();let next=0;
  const clock={schedule(fn){timers.set(++next,fn);return next;},clear(id){timers.delete(id);}};
  const controller=new AiPollingController(()=>{calls++;return pending.promise;},()=>output++);
  const loop=new AiPollingLoop(controller,clock);
  const context={audience:'client',tenantId:'synthetic-A'};
  loop.start(context);loop.start(context);assert.equal(calls,1);
  loop.pause();loop.start(context);assert.equal(calls,1);
  loop.destroy();pending.resolve({cursor:null,events:[],version:'v1'});
  await pending.promise;await Promise.resolve();await Promise.resolve();
  assert.equal(timers.size,0);assert.equal(output,0);loop.start(context);assert.equal(calls,1);
 });
}
