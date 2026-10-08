'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');
const { budgetMethodForGatewayOutcome, assertGatewayBudgetEvidence } = require('../apps/api/src/modules/ai-native/budget/budget-gateway-contract.ts');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports.ts');

test('gateway contract maps one invocation to one budget ledger method', () => {
  assert.deepEqual(['before_dispatch', 'dispatch_claimed', 'completed', 'failed_not_dispatched', 'unknown', 'reconciled'].map(budgetMethodForGatewayOutcome), ['reserve', 'dispatch', 'settle', 'release', 'markUnknown', 'reconcile']);
});
test('gateway contract never treats unknown or ordinary failure as releasable', () => {
  assert.throws(() => assertGatewayBudgetEvidence('unknown'), error => error instanceof BudgetError && error.code === 'PENDING_RECONCILIATION');
  assert.throws(() => assertGatewayBudgetEvidence('failed_not_dispatched'), error => error instanceof BudgetError && error.code === 'PENDING_RECONCILIATION');
  assert.doesNotThrow(() => assertGatewayBudgetEvidence('failed_not_dispatched', { provesNotDispatched: true }));
  assert.throws(() => assertGatewayBudgetEvidence('completed', { dispatchToken: 'd' }), error => error instanceof BudgetError && error.code === 'PENDING_RECONCILIATION');
  assert.doesNotThrow(() => assertGatewayBudgetEvidence('completed', { dispatchToken: 'd', usageRef: 'usage' }));
});
