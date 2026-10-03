'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' inspection preserves missing, invalid and zero, only emits draft changes',()=>{
 const instance=mount(load('apps/'+app+'/src/components/ai-native/ai-inspection-draft/index.ts'),{items:[{key:'mileage',label:'Mileage',candidate:0,humanValue:NaN,internal:'private'},{key:'hours',candidate:null}],readonly:false});
 assert.equal(instance.data.visibleItems[0].candidate,'0');assert.equal(instance.data.visibleItems[0].humanValue,'非法值');assert.equal(instance.data.visibleItems[1].candidate,'缺失');
 assert.equal('internal' in instance.data.visibleItems[0],false);
 instance.onHumanInput({currentTarget:{dataset:{key:'mileage'}},detail:{value:'10'}});
 assert.equal(instance.events[0].name,'draftchange');assert.equal(instance.data.visibleItems[0].candidate,'0');
 instance.update({readonly:true});instance.onHumanInput({currentTarget:{dataset:{key:'mileage'}},detail:{value:'20'}});assert.equal(instance.events.length,1);
});
