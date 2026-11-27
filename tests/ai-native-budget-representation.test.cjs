'use strict';
const { load } = require('./fixtures/ai-native/rental-compatibility-source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaBudgetRepository } = load('@rental-os/ai-native-server/runtime/budget/prisma-budget.repository');
const { quantityAtoms } = load('@rental-os/ai-native-server/runtime/budget/budget-quantity');
const { BudgetError } = load('@rental-os/ai-native-server/runtime/budget/budget.ports');

test('token quantity never exceeds the representable shared number boundary', () => {
  assert.equal(quantityAtoms({ unit: 'tokens', value: Number.MAX_SAFE_INTEGER }), 9007199254740991n);
  assert.throws(() => quantityAtoms({ unit: 'tokens', value: Number.MAX_SAFE_INTEGER + 1 }), BudgetError);
});

test('an unsafe token reservation is rejected before opening a database transaction', async () => {
  let transactions = 0;
  const repository = new PrismaBudgetRepository({
    aiScope: { findUnique: async () => ({ id: 'scope', kind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'space' }) },
    aiBudgetPolicy: { findUnique: async () => null },
    aiBudgetAllocation: { findMany: async () => [] },
    aiBudgetReservation: { create: async () => { throw new Error('must not write'); } },
    aiBudgetLedgerEntry: { findUnique: async () => null, create: async () => { throw new Error('must not write'); } },
    $transaction: async () => { transactions += 1; throw new Error('must not open'); }
  });
  const association = {
    requestId: 'req', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'call', priceVersion: 'price',
    scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'space' },
    config: { configId: 'config', configRevision: 1 }
  };
  const quote = {
    association, callId: 'call', sceneCode: 'scene', model: 'model', actorId: 'actor',
    quantity: { unit: 'tokens', value: Number.MAX_SAFE_INTEGER + 1 },
    policies: [{ scopeId: 'scope', scopeKind: 'WORKSPACE', sceneCode: 'scene' }],
    consumerScope: { scopeId: 'scope', scopeKind: 'WORKSPACE', sceneCode: 'scene' },
    evidenceHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000)
  };
  await assert.rejects(() => repository.reserve(quote, { association, callId: 'call', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'INVALID');
  assert.equal(transactions, 0);
});
