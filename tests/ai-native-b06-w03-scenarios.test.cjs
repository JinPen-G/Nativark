'use strict';
const test = require('node:test'); const assert = require('node:assert/strict');
const { validateScenario } = require('./fixtures/ai-native/scenarios/loader.cjs');
const valid = { code: 'orders.explain.success', synthetic: true, actor: { kind: 'operator', id: 'synthetic_operator_1' }, scope: { kind: 'workspace', id: 'synthetic_workspace_1' }, inputRefs: ['synthetic_order_1'], expected: 'success' };
test('scenario loader accepts bounded synthetic fixtures and freezes a copy', () => { const loaded = validateScenario(valid); assert.equal(loaded.code, valid.code); assert.notEqual(loaded, valid); assert.throws(() => loaded.code = 'changed', TypeError); });
test('scenario loader rejects unknown fields, missing synthetic marker and oversized inputs', () => { assert.throws(() => validateScenario({ ...valid, unknown: true }), /unknown field/); assert.throws(() => validateScenario({ ...valid, synthetic: false }), /synthetic marker/); assert.throws(() => validateScenario({ ...valid, inputRefs: ['real_customer_1'] }), /inputRefs/); assert.throws(() => validateScenario({ ...valid, code: 'x'.repeat(70) }), /scenario code/); });
