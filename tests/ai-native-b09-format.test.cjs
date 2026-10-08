'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./fixtures/ai-native/b09-host.cjs');
test('three-client measurements reject unknown, invalid, negative and unsafe numbers',()=>{
 const admin=load('apps/admin/src/features/ai-native/formatters.ts');
 for(const value of [null,undefined,NaN,Infinity,-1,-1n,Number.MAX_SAFE_INTEGER+1]) assert.equal(admin.formatAmount(value).available,false);
 for(const app of ['miniprogram','staff-miniprogram']){
  const functions=load('apps/'+app+'/src/components/ai-native/display-format.ts');
  for(const value of [null,undefined,NaN,Infinity,-1,-1n,Number.MAX_SAFE_INTEGER+1]) assert.equal(functions.displayMeasurement(value,'tokens').text,'未知');
  assert.equal(functions.displayMeasurement(9007199254740993n,'tokens').text,'9007199254740993');assert.equal(functions.displayMeasurement(0,'tokens').text,'0');
  assert.equal(functions.displayTime('invalid'),'时间不可用');assert.equal(functions.displayTime('2026-10-04'),'时间不可用');
  assert.equal(functions.displayTime('2026-10-04T08:00:00+08:00'),'2026-10-04T00:00:00.000Z');
  assert.equal(functions.boundedText('🙂'.repeat(10001)).length,8000);assert.equal(functions.boundedText('a\u202Eevil'),'aevil');
 }
});
