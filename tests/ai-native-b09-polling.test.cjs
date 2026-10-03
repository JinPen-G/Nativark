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
}
