'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' missing confirmation evidence cannot look human-confirmed',()=>{
 const {memoryProjection}=load('apps/'+app+'/src/components/ai-native/memory-projection.ts');
 assert.equal(memoryProjection({status:'confirmed',actorKind:'human',value:'synthetic-private'}).value,'内容不可用');
});
for(const app of ['miniprogram','staff-miniprogram']) test(app+' memory component expires, revokes and rejects automation or changed hashes',()=>{
 const prefix='apps/'+app+'/src/components/ai-native/';
 const nowIso='2026-10-04T00:00:00.000Z';
 const item={id:'synthetic-memory',label:'Synthetic preference',value:'synthetic-value',status:'confirmed',actorKind:'human',revision:'1',confirmedRevision:'1',contentHash:'synthetic-hash',confirmedContentHash:'synthetic-hash',expiresAt:'2026-10-04T01:00:00.000Z'};
 const instance=mount(load(prefix+'ai-memory-preference/index.ts'),{available:true,nowIso,items:[item]});
 assert.equal(instance.data.rows[0].value,'synthetic-value');
 for(const patch of [{status:'revoked'},{status:'expired'},{actorKind:'automation'},{revision:'2'},{contentHash:'synthetic-new-hash'}]){
  instance.update({items:[{...item,...patch}]});assert.equal(instance.data.rows[0].value,'内容不可用');
 }
 instance.update({items:[item],nowIso:item.expiresAt});assert.equal(instance.data.rows[0].value,'内容不可用');
 instance.update({nowIso,available:false});assert.equal(instance.data.rows.length,0);
 instance.update({available:true,items:Array.from({length:1000},(_,i)=>({...item,id:'synthetic-'+i}))});assert.equal(instance.data.rows.length,50);
 instance.detach();assert.equal(instance.data.rows.length,0);assert.equal(instance.events.length,0);
});
