'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
function load() {
  const file = path.join(root, 'apps/admin/src/features/ai-native/order-facts-display.ts');
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require, console });
  return exports;
}
const { toDisplayOrderFacts, orderFactsRows } = load();
const base = {
  draftVersion: 'ain-order-facts-draft-1', paymentEvidence: 'not_loaded', historicalFeeEvidence: 'not_loaded', observedAt: '2026-10-04T10:00:00Z',
  scope: { id: 'workspace-a' }, sources: [{ scope: { id: 'workspace-a' }, basis: { kind: 'current' } }],
  order: { id: 'order-a', orderNo: 'RO-1', status: 'settling', currency: 'CNY', amounts: { rental: 0, service: null, discount: 10, coupon: 0, deposit: null, preAuthorization: 500, finalPayable: 100 } },
};
test('order facts preserve authoritative zero and unloaded null without recalculation', () => {
  const facts = toDisplayOrderFacts(base);
  assert.equal(facts.amounts.rental, 0);
  assert.equal(facts.amounts.service, null);
  assert.equal(orderFactsRows(facts).find(row => row.label === '服务').value, '未加载');
  assert.equal(orderFactsRows(facts).find(row => row.label === '租金').value, '0');
});
test('order facts reject wrong version, scope mismatch and malformed source', () => {
  assert.equal(toDisplayOrderFacts({ ...base, draftVersion: 'wrong' }), null);
  assert.equal(toDisplayOrderFacts({ ...base, sources: [{ scope: { id: 'other' }, basis: { kind: 'current' } }] }).sourceScope, 'other');
  assert.equal(toDisplayOrderFacts({ ...base, sources: [] }), null);
  assert.equal(toDisplayOrderFacts({ ...base, paymentEvidence: 'loaded' }), null);
});
