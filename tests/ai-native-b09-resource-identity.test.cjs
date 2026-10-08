'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mountWithHost: mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) {
 const prefix='apps/'+app+'/src/components/ai-native/';
 test(app+' source references preserve exact id/version and reject truncated or ambiguous identities',async()=>{
  const calls=[];
  const source=mount(load(prefix+'ai-knowledge-source/index.ts'),{sources:[{id:'x'.repeat(129),version:'1',status:'published'}],openHandler:async ref=>{calls.push(ref);}});
  assert.equal(source.data.visibleSources.length,0,'overlong ids must not be truncated into another identity');
  source.update({sources:[{id:'same',version:'1',status:'published'},{id:'same',version:'2',status:'published'}]});
  await source.onOpen({currentTarget:{dataset:{id:'same'}}});assert.equal(calls.length,0,'legacy id alone cannot choose a version');
  await source.onOpen({currentTarget:{dataset:{id:'same',version:'2'}}});assert.equal(calls.length,1);assert.equal(calls[0].version,'2');
  source.update({sources:[{id:'dup',version:'1',status:'published'},{id:'dup',version:'1',status:'published'}]});
  assert.equal(source.data.visibleSources.length,0,'duplicate exact identities excluded');source.detach();
 });
 test(app+' memory and inspection never truncate or silently select duplicate row identities',()=>{
  const memory=mount(load(prefix+'ai-memory-preference/index.ts'),{available:true,items:[{id:'x'.repeat(129),revision:'1'}]});
  assert.equal(memory.data.rows.length,0);
  memory.update({items:[{id:'dup',revision:'1'},{id:'dup',revision:'1'}]});assert.equal(memory.data.rows.length,0);
  memory.update({items:[{id:'same',revision:'1'},{id:'same',revision:'2'}]});
  assert.equal(memory.data.rows.length,2);assert.notEqual(memory.data.rows[0].rowKey,memory.data.rows[1].rowKey);
  memory.update({items:null});assert.equal(memory.data.rows.length,0);
  const inspection=mount(load(prefix+'ai-inspection-draft/index.ts'),{readonly:false,items:[{key:'x'.repeat(65)},{key:'dup'},{key:'dup'}]});
  assert.equal(inspection.data.visibleItems.length,0);
  inspection.onHumanInput({currentTarget:{dataset:{key:'dup'}},detail:{value:'10'}});assert.equal(inspection.events.length,0);
  memory.detach();inspection.detach();
 });
}
