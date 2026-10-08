'use strict';
const { validateScenario } = require('./loader.cjs');
const quote = Object.freeze({ id: 'synthetic_quote_1', currency: 'CNY', total: '360.00', ruleVersion: 'synthetic_rule_v1', priceVersion: 'synthetic_price_v1' });
const linesBefore = Object.freeze([{ sku: 'synthetic_camera_body', quantity: 1, amount: '300.00' }, { sku: 'synthetic_battery', quantity: 2, amount: '60.00' }]);
const linesAfter = Object.freeze([{ sku: 'synthetic_camera_body', quantity: 1, amount: '330.00' }, { sku: 'synthetic_battery', quantity: 2, amount: '60.00' }]);
const snapshotBefore = Object.freeze({ id: 'synthetic_quote_snapshot_before', quoteId: quote.id, lines: linesBefore, ruleVersion: 'synthetic_rule_v1', priceVersion: 'synthetic_price_v1' });
const snapshotAfter = Object.freeze({ id: 'synthetic_quote_snapshot_after', quoteId: quote.id, lines: linesAfter, ruleVersion: 'synthetic_rule_v2', priceVersion: 'synthetic_price_v2' });
const scenarios = Object.freeze(['success', 'missing_evidence', 'forbidden'].map(expected => validateScenario({ code: `quotes.change.${expected}`, synthetic: true, actor: { kind: 'operator', id: 'synthetic_operator_1' }, scope: { kind: 'tenant', id: 'synthetic_tenant_1' }, inputRefs: ['synthetic_quote_1', 'synthetic_quote_snapshot_before', 'synthetic_quote_snapshot_after'], expected })));
module.exports = Object.freeze({ quote, linesBefore, linesAfter, snapshotBefore, snapshotAfter, scenarios });
