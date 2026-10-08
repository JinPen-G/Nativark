'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');
const { Prisma } = require('@prisma/client');
const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository.ts');
const { PersistedBudgetEvidenceAdapter, ServerBudgetAuthorityAdapter, SubscriptionBudgetEntitlementAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports.ts');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

const association = { requestId: 'req', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'idem', priceVersion: 'price',
  scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }, config: { configId: 'cfg', configRevision: 2, credentialRef: 'vault', protocol: 'openai-compatible', provider: 'synthetic', model: 'model', tenantId: 'tenant', serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant' } } };
const record = { id: 'reservation', scopeId: 'workspace', scopeKind: 'WORKSPACE', actorId: 'actor', revision: 2, storageVersion: new Date('2026-10-04T12:00:00.000Z'), association, callId: 'call', sceneCode: 'scene', status: 'reserved', reserved: { unit: 'tokens', value: 10 }, actual: null, dispatched: true, unknownReason: null, expiresAt: new Date('2026-10-04T12:01:00.000Z') };

function fakeDb() {
  const row = { id: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, actorId: record.actorId, status: 'reserved', dispatchState: 'dispatched', reservedTokens: 10n, reservedCalls: null, reservedMoney: null, moneyCurrency: null, actualTokens: null, actualCalls: null, actualMoney: null, unknownReason: null, expiresAt: record.expiresAt, updatedAt: record.storageVersion, callId: record.callId, idempotencyKey: 'idem', sceneCode: 'scene', configRevision: 2, tenantId: 'tenant', workspaceId: 'workspace' };
  const ledger = new Map();
  Object.assign(row, { configurationHash: requestFingerprint(association.config), requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, priceVersion: association.priceVersion });
  const db = {
    aiBudgetLedgerEntry: { findUnique: async ({ where }) => ledger.get(`${where.reservationId_eventKey.reservationId}:${where.reservationId_eventKey.eventKey}`) ?? null,
      create: async ({ data }) => { ledger.set(`${data.reservationId}:${data.eventKey}`, data); return data; } },
    aiBudgetReservation: { updateMany: async ({ data }) => { Object.assign(row, data); if (data.actualTokens !== undefined) row.actualTokens = data.actualTokens; row.updatedAt = new Date(row.updatedAt.getTime() + 1); return { count: 1 }; },
      findUnique: async () => row },
    $transaction: async callback => callback(db)
  };
  return { db, ledger, row };
}

test('Prisma repository replays only identical settlement payloads', async () => {
  const { db, ledger } = fakeDb();
  const repo = new PrismaBudgetRepository(db);
  const usage = { quantity: { unit: 'tokens', value: 4 }, evidenceHash: 'a'.repeat(64) };
  const first = await repo.mutate(record, { action: 'settle', eventKey: 'event-1', usage }, async () => {});
  assert.equal(first.status, 'settled');
  assert.equal(ledger.size, 1);
  const replay = await repo.mutate({ ...record, status: 'settled', storageVersion: first.storageVersion }, { action: 'settle', eventKey: 'event-1', usage }, async () => {});
  assert.equal(replay.status, 'settled');
  await assert.rejects(() => repo.mutate(record, { action: 'settle', eventKey: 'event-1', usage: { ...usage, quantity: { unit: 'tokens', value: 5 } } }, async () => {}), error => error instanceof BudgetError && error.code === 'IDEMPOTENCY_CONFLICT');
});

test('server authority adapter fails closed when the formal AI entitlement is absent', async () => {
  const source = { resolveContext: async () => ({ actor: { kind: 'user', userId: 'u' }, scope: { kind: 'tenant', tenantId: 't' }, authorizedAt: new Date().toISOString(), requestId: 'r', audience: 'staff', access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, contractVersion: 'ain-c01-c02-draft-1' }), authorize: async () => ({ authorizationKey: 'key', expiresAt: new Date(Date.now() + 1000) }) };
  const adapter = new ServerBudgetAuthorityAdapter(source, { check: async () => ({ available: false, revision: 1 }) });
  await assert.rejects(() => adapter.resolve('reserve', {}), error => error instanceof BudgetError && error.code === 'FORBIDDEN');
});

test('subscription entitlement adapter consumes only a formal catalog row', async () => {
  const reader = new SubscriptionBudgetEntitlementAdapter({ read: async () => ({ revision: 4, entitlements: [{ code: 'ai.native.use', available: true }] }) });
  const context = { actor: { kind: 'user', userId: 'u' }, scope: { kind: 'tenant', tenantId: 't' }, authorizedAt: new Date().toISOString(), requestId: 'r', audience: 'staff', access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, contractVersion: 'ain-c01-c02-draft-1' };
  assert.deepEqual(await reader.check(context, 'ai.native.use'), { available: true, revision: 4 });
  const missing = new SubscriptionBudgetEntitlementAdapter({ read: async () => ({ revision: 4, entitlements: [] }) });
  await assert.rejects(() => missing.check(context, 'ai.native.use'), error => error instanceof BudgetError && error.code === 'FORBIDDEN');
  await assert.rejects(() => reader.check({ ...context, scope: { kind: 'platform' } }, 'ai.native.use'), error => error instanceof BudgetError && error.code === 'UNAVAILABLE');
});

test('persisted evidence adapter rejects a row from another scope', async () => {
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => ({ state: 'dispatched', reservationId: 'reservation', requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, callId: 'call', actorId: 'actor', scopeKey: 'TENANT:other', sceneCode: 'scene', configRevision: association.config.configRevision, priceVersion: association.priceVersion, dispatchToken: 'dispatch' }), readUsage: async () => { throw new Error('must not read usage'); } });
  await assert.rejects(() => adapter.dispatch(record), error => error instanceof BudgetError && error.code === 'FORBIDDEN');
});

test('settled actual usage remains in the durable budget aggregate', async () => {
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant' }, config: association.config,
    gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
    sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  const policyRow = { id: 'policy', scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene', configRevision: 2, settingsJson: settings };
  const db = { aiScope: { findUnique: async () => ({ id: 'workspace', kind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace' }) }, aiBudgetPolicy: { findUnique: async () => policyRow }, aiBudgetAllocation: { findMany: async () => [{ reservation: { status: 'settled', reservedTokens: 4n, reservedCalls: null, reservedMoney: null, actualTokens: 10n, actualCalls: null, actualMoney: null, moneyCurrency: null, runId: 'old' } }] }, aiBudgetReservation: { create: async () => { throw new Error('must reject before create'); } }, $transaction: async callback => callback(db), $queryRaw: async () => [{ id: 'policy' }] };
  const repo = new PrismaBudgetRepository(db);
  const quote = { association, callId: 'call-new', sceneCode: 'scene', model: 'model', actorId: 'actor', quantity: { unit: 'tokens', value: 1 }, policies: [{ scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene' }], consumerScope: { scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene' }, evidenceHash: 'b'.repeat(64), expiresAt: new Date('2026-10-04T12:01:00.000Z') };
  await assert.rejects(() => repo.reserve(quote, { association, callId: 'call-new', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'EXHAUSTED');
});
