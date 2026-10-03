'use strict';
const { validateScenario } = require('./loader.cjs');
const actors = ['operator', 'staff', 'client', 'saas_admin', 'automation']; const scopes = ['workspace', 'tenant', 'platform']; const outcomes = ['success', 'missing_evidence', 'forbidden'];
const order = Object.freeze({ id: 'synthetic_order_1', customerId: 'synthetic_customer_1', status: 'reserved', quoteSnapshotId: 'synthetic_quote_snapshot_1', total: '120.00', currency: 'CNY' });
const customer = Object.freeze({ id: 'synthetic_customer_1', displayName: 'Synthetic Customer', memberStatus: 'active' });
const snapshot = Object.freeze({ id: 'synthetic_quote_snapshot_1', priceVersion: 'synthetic_price_v1', ruleVersion: 'synthetic_rule_v1', capturedAt: '2026-01-01T00:00:00Z' });
const scenarios = actors.flatMap(actor => scopes.flatMap(scope => outcomes.map(expected => validateScenario({ code: `orders.explain.${actor}.${scope}.${expected}`, synthetic: true, actor: { kind: actor, id: `synthetic_${actor}_1` }, scope: { kind: scope, id: `synthetic_${scope}_1` }, inputRefs: ['synthetic_order_1', 'synthetic_customer_1', 'synthetic_quote_snapshot_1'], expected }))));
module.exports = Object.freeze({ order, customer, snapshot, scenarios });
