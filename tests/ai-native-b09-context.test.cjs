'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,deferred}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' A-B-A and same task cross identity cannot publish old response',async()=>{
 const {AiPollingController}=load('apps/'+app+'/src/components/ai-native/polling-controller.ts');
 for(const changed of [{tenantId:'synthetic-B'},{workspaceId:'synthetic-B'},{audience:'client'}]){
  const requests=[],published=[]; const controller=new AiPollingController((context)=>{const result=deferred();requests.push({context,result});return result.promise;},page=>published.push(page));
  const a={audience:'staff',tenantId:'synthetic-A',workspaceId:'synthetic-A',taskId:'same-task'};
  const first=controller.poll(a);controller.changeContext();assert.equal(await controller.poll({...a,...changed}),'skipped');
  controller.changeContext();requests[0].result.resolve({cursor:'1',events:[],version:'v1'});assert.equal(await first,'stale');
  const fresh=controller.poll(a);requests[1].result.resolve({cursor:'2',events:[],version:'v1'});assert.equal(await fresh,'started');
  assert.equal(published.length,1);assert.equal(published[0].cursor,'2');controller.destroy();
 }
});
