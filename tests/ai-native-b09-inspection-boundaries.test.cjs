'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) {
 test(app+' inspection rejects malformed missing lists and unsafe number precision',()=>{
  const instance=mount(load('apps/'+app+'/src/components/ai-native/ai-inspection-draft/index.ts'),{readonly:false,missing:null,items:[
   {key:'unsafe',candidate:Number.MAX_SAFE_INTEGER+1},
   {key:'exact',candidate:9007199254740993n},
   {key:'text',candidate:'😀'.repeat(5000),label:'a\u202Elabel',sourceLabel:'a\u2066source'},
  ]});
  assert.equal(instance.data.visibleMissing.length,0);
  assert.equal(instance.data.visibleItems[0].candidate,'非法值');
  assert.equal(instance.data.visibleItems[1].candidate,'9007199254740993');
  assert.equal(Array.from(instance.data.visibleItems[2].candidate).length,4000);
  assert.equal(instance.data.visibleItems[2].label,'alabel');
  assert.equal(instance.data.visibleItems[2].sourceLabel,'asource');
  instance.update({missing:{private:'synthetic'},items:null});
  assert.equal(instance.data.visibleItems.length,0);assert.equal(instance.data.visibleMissing.length,0);
  instance.detach();
 });
 test(app+' inspection input rejects malformed events and bounds human draft without changing candidate',()=>{
  const instance=mount(load('apps/'+app+'/src/components/ai-native/ai-inspection-draft/index.ts'),{readonly:false,items:[{key:'mileage',candidate:0}]});
  for(const event of [null,{}, {detail:{value:'x'}},{currentTarget:{dataset:{key:'unknown'}},detail:{value:'x'}}]) assert.doesNotThrow(()=>instance.onHumanInput(event));
  assert.equal(instance.events.length,0);
  instance.onHumanInput({currentTarget:{dataset:{key:'mileage'}},detail:{value:'😀'.repeat(5000)+'\u202e'}});
  assert.equal(Array.from(instance.events[0].detail.humanValue).length,4000);
  assert.equal(instance.data.visibleItems[0].candidate,'0');instance.detach();
 });
}
