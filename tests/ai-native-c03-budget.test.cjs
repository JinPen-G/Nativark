'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');
const { Prisma } = require('@prisma/client');
const { quantityAtoms } = require('../apps/api/src/modules/ai-native/budget/budget-quantity.ts');
const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository.ts');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports.ts');
const { PersistedBudgetEvidenceAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

const association = { requestId: 'req', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'idem', priceVersion: 'price',
  scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }, config: { configId: 'cfg', configRevision: 2, credentialRef: 'vault', protocol: 'openai-compatible', provider: 'synthetic', model: 'model', tenantId: 'tenant', serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant' } } };

test('quantity validation matches Prisma widths before a write', () => {
  assert.equal(quantityAtoms({ unit: 'money', amount: '0.000001', currency: 'CNY', scale: 6 }), 1n);
  assert.equal(quantityAtoms({ unit: 'money', amount: '123456789012345678.123456', currency: 'CNY', scale: 6 }), 123456789012345678123456n);
  assert.throws(() => quantityAtoms({ unit: 'money', amount: '1234567890123456789.123456', currency: 'CNY', scale: 6 }), BudgetError);
  assert.equal(quantityAtoms({ unit: 'calls', value: 4294967295 }), 4294967295n);
  assert.throws(() => quantityAtoms({ unit: 'calls', value: 4294967296 }), BudgetError);
});

test('evidence cannot authorize another actor even when call and scope match', async () => {
  const record = { id: 'reservation', callId: 'call', actorId: 'actor', scopeId: 'workspace', scopeKind: 'WORKSPACE', association };
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => ({ reservationId: 'reservation', requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, callId: 'call', actorId: 'intruder', scopeKey: 'WORKSPACE:workspace', configRevision: association.config.configRevision, priceVersion: association.priceVersion, dispatchToken: 'dispatch', state: 'dispatched' }), readUsage: async () => { throw Error('not used'); } });
  await assert.rejects(() => adapter.dispatch(record), error => error.code === 'FORBIDDEN');
});

test('repository writes and reads micro-money without floating point conversion', async () => {
  const row = { id: 'reservation', scopeId: 'workspace', scopeKind: 'WORKSPACE', actorId: 'actor', status: 'reserved', dispatchState: 'dispatched', reservedTokens: null, reservedCalls: null, reservedMoney: new Prisma.Decimal('123456789012345678.123456'), moneyCurrency: 'CNY', actualTokens: null, actualCalls: null, actualMoney: null, unknownReason: null, expiresAt: new Date('2026-10-04T12:01:00.000Z'), updatedAt: new Date('2026-10-04T12:00:00.000Z'), callId: 'call', idempotencyKey: 'idem', sceneCode: 'scene', configRevision: 2, tenantId: 'tenant', workspaceId: 'workspace' };
  const ledger = [];
  Object.assign(row, { configurationHash: requestFingerprint(association.config), requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, priceVersion: association.priceVersion });
  const db = { aiBudgetReservation: { updateMany: async ({ data }) => { Object.assign(row, data); if (typeof row.actualMoney === 'string') row.actualMoney = new Prisma.Decimal(row.actualMoney); row.status = 'settled'; row.dispatchState = 'completed'; row.updatedAt = new Date(row.updatedAt.getTime() + 1); return { count: 1 }; }, findUnique: async () => row }, aiBudgetLedgerEntry: { findUnique: async () => null, create: async ({ data }) => { ledger.push(data); return data; } }, $transaction: async callback => callback(db) };
  const repo = new PrismaBudgetRepository(db);
  const record = { id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind, actorId: row.actorId, revision: 2, storageVersion: row.updatedAt, association, callId: row.callId, sceneCode: row.sceneCode, status: 'reserved', reserved: { unit: 'money', amount: '123456789012345678.123456', currency: 'CNY', scale: 6 }, actual: null, dispatched: true, unknownReason: null, expiresAt: row.expiresAt };
  const values = ['0.000000', '0.000001', '1.234567', '9007199254.740993', '123456789012345678.123456', '999999999999999999.999999'];
  for (const [index, amount] of values.entries()) {
    const result = await repo.mutate(record, { action: 'settle', eventKey: `settle-money-${index}`, usage: { quantity: { unit: 'money', amount, currency: 'CNY', scale: 6 }, evidenceHash: 'a'.repeat(64) } }, async () => {});
    assert.equal(ledger[index].moneyAmount, amount);
    assert.equal(result.actual.amount, amount);
  }
  const writes = ledger.length;
  await assert.rejects(() => repo.mutate(record, { action: 'settle', eventKey: 'overflow', usage: { quantity: { unit: 'money', amount: '1000000000000000000.000000', currency: 'CNY', scale: 6 }, evidenceHash: 'a'.repeat(64) } }, async () => {}), BudgetError);
  assert.equal(ledger.length, writes);
});

test('post-lock policy reread is used when a concurrent revision disables the policy', async () => {
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant' }, config: association.config, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } }, sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  let reads = 0;
  const row = { id: 'policy', scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene', configRevision: 3, settingsJson: { ...settings, gates: { ...settings.gates, scene: { enabled: false, revision: 2 } } } };
  const first = { ...row, configRevision: 2, settingsJson: settings };
  const db = { aiScope: { findUnique: async () => ({ id: 'workspace', kind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace' }) }, aiBudgetPolicy: { findUnique: async () => ++reads === 1 ? first : row }, $queryRaw: async () => [{ id: 'policy' }], aiBudgetAllocation: { findMany: async () => [] }, aiBudgetReservation: { create: async () => { throw new Error('must reject'); } }, $transaction: async callback => callback(db) };
  const repo = new PrismaBudgetRepository(db);
  const quote = { association, callId: 'call', sceneCode: 'scene', model: 'model', actorId: 'actor', quantity: { unit: 'tokens', value: 1 }, policies: [{ scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene' }], consumerScope: { scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene' }, evidenceHash: 'b'.repeat(64), expiresAt: new Date('2026-10-04T12:01:00.000Z') };
  await assert.rejects(() => repo.reserve(quote, { association, callId: 'call', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'EXHAUSTED');
});
