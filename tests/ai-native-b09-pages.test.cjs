'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' actual page consumer handles empty, duplicate, hasMore, malformed and sticky reset',()=>{
 const prefix='apps/'+app+'/src/components/ai-native/';
 const {consumeCursorPage}=load(prefix+'cursor-page.ts');const {initialCursorState}=load(prefix+'cursor-adapter.ts');
 const initial=initialCursorState('synthetic','v1');
 const event={taskId:'synthetic',version:'v1',type:'known',cursor:'9007199254740993'};
 let result=consumeCursorPage(initial,[event],true,['known']);assert.equal(result.continueReading,true);
 result=consumeCursorPage(result.state,[event],false,['known']);assert.equal(result.state.cursor,event.cursor);assert.equal(result.continueReading,false);
 assert.equal(consumeCursorPage(initial,[],true,['known']).state.sync,'unsynced');
 assert.equal(consumeCursorPage(initial,[],false,['known']).state.cursor,null);
 assert.equal(consumeCursorPage(initial,[null],false,['known']).state.sync,'unsynced');
 const reset=consumeCursorPage(initial,[{...event,type:'reset_required'}],false,['known']);
 assert.equal(consumeCursorPage(reset.state,[event],false,['known']).state.cursor,null);
 assert.equal(consumeCursorPage(initial,[event,{...event,cursor:'9007199254740995'}],true,['known']).state.sync,'unsynced');
});
