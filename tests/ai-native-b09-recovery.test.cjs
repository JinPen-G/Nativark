'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./fixtures/ai-native/b09-host.cjs');
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
for(const app of ['miniprogram','staff-miniprogram']) test(app+' bounded backoff stops terminal failures and explicit retry resumes',async()=>{
 const {AiPollingController,AiPollingLoop}=load('apps/'+app+'/src/components/ai-native/polling-controller.ts');
 let kind='transient',calls=0;const timers=new Map(),delays=[],notices=[];let id=0;
 const clock={schedule(fn,ms){delays.push(ms);timers.set(++id,fn);return id;},clear(id){timers.delete(id);}};
 const context={audience:'staff',tenantId:'synthetic-A'};
 const loop=new AiPollingLoop(new AiPollingController(async()=>{calls++;throw new Error('synthetic');},()=>{}),clock,2000,{classify:()=>kind,notify:value=>notices.push(value)});
 loop.start(context);await flush();
 for(let i=0;i<3;i++){const [key,fn]=timers.entries().next().value;timers.delete(key);fn();await flush();}
 assert.equal(calls,4);assert.equal(timers.size,0);assert.deepEqual(delays,[4000,8000,16000]);
 loop.start(context);assert.equal(calls,4);
 for(kind of ['permission','version','reset','unknown']){loop.retry(context);await flush();assert.equal(timers.size,0);assert.equal(notices.at(-1),kind);}
 loop.destroy();
});
