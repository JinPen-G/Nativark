'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' memory draft stays explicitly unsynced and is cleared on exit',()=>{
 const {AiDraftController}=load('apps/'+app+'/src/components/ai-native/draft-controller.ts');
 const draft=new AiDraftController();draft.set('synthetic-task','1',{note:'synthetic'});
 assert.equal(draft.snapshot().sync,'unsynced');
 const snapshot=draft.snapshot();snapshot.values.note='mutated';assert.equal(draft.snapshot().values.note,'synthetic');
 draft.set('synthetic-task','2',{});assert.equal(Object.keys(draft.snapshot().values).length,0);
 draft.destroy();assert.equal(draft.snapshot(),null);
});
