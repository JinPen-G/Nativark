'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' customer projection is allowlisted, unknown is not zero and revocation clears immediately',()=>{
 const instance=mount(load('apps/'+app+'/src/components/ai-native/ai-order-explanation/index.ts'),{available:true,order:{title:'synthetic',receivable:0,paid:null,refundStatus:'退款处理中',availabilityLabel:'支付未确认 / 部分完成',internalNotes:'private',cost:99,otherCustomer:'private'}});
 assert.equal(instance.data.projection.receivable,'0');assert.equal(instance.data.projection.paid,'未知');assert.equal(instance.data.projection.refundStatus,'退款处理中');
 assert.equal('cost' in instance.data.projection,false);assert.doesNotMatch(JSON.stringify(instance.data.projection),/private/);
 instance.update({available:false});assert.equal(instance.data.projection,null);
});
