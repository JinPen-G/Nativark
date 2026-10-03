'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' unknown events never advance; reset is sticky; large cursor stays exact',()=>{
 const {applyCursorEvent,initialCursorState}=load('apps/'+app+'/src/components/ai-native/cursor-adapter.ts');
 const event={taskId:'synthetic',version:'v1',type:'known',cursor:'9007199254740993'};
 let state=applyCursorEvent(initialCursorState('synthetic','v1'),event,['known']);assert.equal(state.cursor,event.cursor);
 assert.equal(applyCursorEvent(state,event,['known']).reason,'duplicate');
 for(const changed of [{type:'new-event'},{version:'v2'},{cursor:'9007199254740995'},{type:'reset_required'}]){
  const reset=applyCursorEvent(state,{...event,cursor:'9007199254740994',...changed},['known']);
  assert.equal(reset.sync,'unsynced');assert.equal(reset.cursor,null);
  assert.equal(applyCursorEvent(reset,event,['known']),reset);
 }
 assert.equal(applyCursorEvent(state,{...event,cursor:'1'},['known']).reason,'out_of_order');
});
