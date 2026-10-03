'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,deferred}=require('./fixtures/ai-native/b09-host.cjs');
const context={audience:'client',tenantId:'synthetic-tenant',taskId:'synthetic-task'};
const page={cursor:null,events:[],version:'fixture-v1'};
const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
for(const app of ['miniprogram','staff-miniprogram']) {
 const file='apps/'+app+'/src/components/ai-native/polling-controller.ts';
 test(app+' failing cancellation listener does not prevent other cleanup listeners',async()=>{
  const {AiPollingController}=load(file);const pending=deferred();let cleaned=0,pages=0;
  const controller=new AiPollingController((_,signal)=>{
   signal.onAbort(()=>{throw new Error('synthetic-private');});signal.onAbort(()=>{cleaned++;});return pending.promise;
  },()=>pages++);
  const read=controller.poll(context);
  assert.throws(()=>controller.destroy(),/AI轮询取消清理失败/);assert.equal(cleaned,1);
  pending.resolve(page);assert.equal(await read,'stale');assert.equal(pages,0);
  assert.equal(await controller.poll(context),'skipped');
 });
 test(app+' destroy remains terminal when host abort cleanup throws',async()=>{
  const {AiPollingController,AiPollingLoop}=load(file);const pending=deferred();let calls=0;
  const controller=new AiPollingController((_,signal)=>{calls++;signal.onAbort(()=>{throw new Error('synthetic-private');});return pending.promise;},()=>{});
  const timers=new Map();let id=0;
  const loop=new AiPollingLoop(controller,{schedule(fn){timers.set(++id,fn);return id;},clear(key){timers.delete(key);}});
  loop.start(context);assert.throws(()=>loop.destroy(),/AI轮询取消清理失败/);pending.resolve(page);await flush();
  loop.start(context);loop.retry(context);await flush();assert.equal(calls,1);assert.equal(timers.size,0);
 });
 test(app+' failing clock cleanup still invalidates in-flight results and cannot restart destroyed loop',async()=>{
  const {AiPollingController,AiPollingLoop}=load(file);let calls=0;const tasks=[];
  const pending=deferred();
  const controller=new AiPollingController(()=>{calls++;return calls===1?Promise.resolve(page):pending.promise;},()=>{});
  const loop=new AiPollingLoop(controller,{schedule(fn){tasks.push(fn);return tasks.length;},clear(){throw new Error('synthetic clock failure');}});
  loop.start(context);await flush();assert.equal(tasks.length,1);
  const inFlight=controller.poll(context);assert.equal(calls,2);
  assert.throws(()=>loop.destroy(),/AI轮询时钟清理失败/);pending.resolve(page);assert.equal(await inFlight,'stale');
  loop.start(context);loop.retry(context);tasks[0]();await flush();
  assert.equal(calls,2,'destroy terminal even if clock could not remove queued callback');
 });
}
