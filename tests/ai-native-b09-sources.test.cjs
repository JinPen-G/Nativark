'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount,deferred}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' revoked sources clear and late opens do not restore; automation cannot confirm memory',async()=>{
 const source={id:'synthetic-resource',version:'1',status:'published',title:'synthetic title',location:'section'};
 const pending=deferred();let calls=0;
 const instance=mount(load('apps/'+app+'/src/components/ai-native/ai-knowledge-source/index.ts'),{sources:[source],openHandler:()=>{calls++;return pending.promise;}});
 const first=instance.onOpen({currentTarget:{dataset:{id:source.id}}});
 instance.update({sources:[{...source,status:'no_access'}]});assert.equal(instance.data.visibleSources[0].title,'来源不可用');
 await instance.onOpen({currentTarget:{dataset:{source}}});assert.equal(calls,1);
 pending.resolve();await first;assert.equal(instance.events.length,0);
 const {memoryProjection}=load('apps/'+app+'/src/components/ai-native/memory-projection.ts');
 assert.equal(memoryProjection({status:'confirmed',actorKind:'automation',revision:'1',confirmedRevision:'1',value:'private'}).value,'内容不可用');
 assert.equal(memoryProjection({status:'confirmed',actorKind:'human',revision:'2',confirmedRevision:'1',value:'private'}).value,'内容不可用');
});
