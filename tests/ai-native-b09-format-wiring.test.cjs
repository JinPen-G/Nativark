'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount}=require('./fixtures/ai-native/b09-host.cjs');
for(const app of ['miniprogram','staff-miniprogram']) test(app+' actual customer and preference templates receive bounded safe formatting',()=>{
 const prefix='apps/'+app+'/src/components/ai-native/';
 const customer=mount(load(prefix+'ai-order-explanation/index.ts'),{available:true,order:{title:'🙂'.repeat(1000),paid:9007199254740993n,receivable:Number.MAX_SAFE_INTEGER+1,deposit:'a\u202Eevil'}});
 assert.equal(customer.data.projection.title.length,400);
 assert.equal(customer.data.projection.paid,'9007199254740993');assert.equal(customer.data.projection.receivable,'未知');assert.equal(customer.data.projection.deposit,'aevil');
 const preference=mount(load(prefix+'ai-memory-preference/index.ts'),{available:true,nowIso:'2026-10-04T00:00:00.000Z',items:[{id:'synthetic',revision:'1',label:'synthetic',status:'proposed',expiresAt:'2026-10-04T01:00:00.000Z',value:'🙂'.repeat(10000)}]});
 assert.equal(preference.data.rows[0].value.length,8000);assert.equal(Array.from(preference.data.rows[0].value).length,4000);
});
