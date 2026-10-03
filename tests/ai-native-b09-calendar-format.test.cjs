'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {load}=require('./fixtures/ai-native/b09-host.cjs');
for(const target of ['admin','miniprogram','staff-miniprogram']) {
 test(target+' rejects normalized invalid calendar dates and timezone-free strings',()=>{
  const module=load(target==='admin'?'apps/admin/src/features/ai-native/formatters.ts':'apps/'+target+'/src/components/ai-native/display-format.ts');
  const format=value=>target==='admin'?module.formatTimestamp(value).value:module.displayTime(value);
  for(const value of ['2026-02-30T08:00:00Z','2025-02-29T00:00:00Z','2026-04-31T12:00:00+08:00','2026-10-04T24:00:00Z','2026-10-04T00:00:00','2026-10-04']) assert.equal(format(value),'时间不可用',value);
  assert.equal(format('2024-02-29T08:00:00+08:00'),'2024-02-29T00:00:00.000Z');
  assert.equal(format('2026-10-04T00:00Z'),'2026-10-04T00:00:00.000Z');
 });
}
