'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');
const { Prisma } = require('@prisma/client');
const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository.ts');
const { PersistedBudgetEvidenceAdapter, ServerBudgetAuthorityAdapter, SubscriptionBudgetEntitlementAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports.ts');
const { BudgetService } = require('../apps/api/src/modules/ai-native/budget/budget.service.ts');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

const association = { requestId: 'req', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'idem', priceVersion: 'price',
  scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }, config: { configId: 'cfg', configRevision: 2, credentialRef: 'vault', protocol: 'openai-compatible', provider: 'synthetic', model: 'model', tenantId: 'tenant', serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant' } } };
const record = { id: 'reservation', scopeId: 'workspace', scopeKind: 'WORKSPACE', actorId: 'actor', revision: 2, storageVersion: new Date('2026-10-04T12:00:00.000Z'), association, callId: 'call', sceneCode: 'scene', status: 'reserved', reserved: { unit: 'tokens', value: 10 }, actual: null, dispatched: true, unknownReason: null, expiresAt: new Date('2026-10-04T12:01:00.000Z') };

test('actual budget settings keep the authorized input across awaits and retain lost COMMIT as unknown', async () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const key = { scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene' };
  const settings = { draftVersion: 'ain-c07-draft-2', scope: association.config.configurationScope, config: association.config,
    gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
    sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  const initial = structuredClone(settings), queries = [], writes = [];
  let mutate, loseCommit = false;
  const db = { aiBudgetPolicy: {
    findUnique: async args => { queries.push(structuredClone(args.where)); return null; },
    create: async ({ data }) => { writes.push(structuredClone(data)); return data; }
  }, $transaction: async callback => { const result = await callback(db); if (loseCommit) throw Error('COMMIT response lost'); return result; } };
  const context = { contractVersion: 'ain-c01-c02-draft-1', requestId: 'auth', authorizedAt: now.toISOString(), audience: 'operator',
    actor: { kind: 'user', userId: 'actor' }, scope: association.scope,
    access: { permissions: ['ai:manage'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
  const authority = { resolve: async () => { mutate?.(); return { context, entitled: true, authorizationKey: 'grant', expiresAt: new Date(now.getTime() + 60000) }; } };
  const unavailable = async () => { throw Error('no invocation in settings'); };
  const service = new BudgetService(new PrismaBudgetRepository(db), authority, { quote: unavailable }, { dispatch: unavailable, usage: unavailable }, () => now);
  mutate = () => { key.sceneCode = 'other-scene'; };
  assert.equal(await service.settings(key), null);
  assert.equal(queries[0].scopeId_scopeKind_sceneCode.sceneCode, 'scene');
  key.sceneCode = 'scene';
  mutate = () => { key.sceneCode = 'other-scene'; settings.allowedModels[0] = 'other-model'; settings.budget.quantity.value = 999; };
  const saved = await service.saveSettings(key, settings, 0);
  assert.equal(saved.sceneCode, 'scene'); assert.deepEqual(saved.settings, initial);
  assert.equal(writes[0].sceneCode, 'scene'); assert.deepEqual(writes[0].settingsJson, initial);
  mutate = undefined; loseCommit = true;
  const second = { ...initial, sceneCode: 'scene-second', allowedScenes: ['scene-second'] };
  await assert.rejects(service.saveSettings({ ...key, sceneCode: 'scene-second' }, second, 0), error => error.code === 'PENDING_RECONCILIATION');
  assert.equal(writes.length, 2, 'unknown reply does not rerun the write');
  assert.equal(writes[1].sceneCode, 'scene-second');
  loseCommit = false; db.aiBudgetPolicy.updateMany = async () => ({ count: 0 });
  await assert.rejects(service.saveSettings({ ...key, sceneCode: 'scene' }, initial, 1), error => error.code === 'REVISION_CONFLICT');
  assert.equal(writes.length, 2, 'real CAS conflict does not become unknown or write again');
});

test('budget settings and indexed unit/currency projections commit together without stale money metadata', async () => {
  const key = { scopeId: 'platform', scopeKind: 'PLATFORM', sceneCode: 'scene' };
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'platform' }, config: association.config,
    gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
    sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'money', amount: '10.250000', currency: 'USD', scale: 6 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  let row, failRevalidation = false;
  const db = { aiBudgetPolicy: { create: async ({ data }) => { row = structuredClone(data); return row; },
    updateMany: async ({ data }) => { const revision = row.configRevision; Object.assign(row, structuredClone(data)); row.configRevision = revision + data.configRevision.increment; return { count: 1 }; },
    findUnique: async () => row }, aiBudgetAllocation: { findFirst: async () => null },
    $transaction: async work => { const before = structuredClone(row); try { return await work(db); } catch (error) { row = before; throw error; } } };
  const repository = new PrismaBudgetRepository(db);
  await repository.saveSettings(key, settings, 0, async () => {});
  assert.equal(row.moneyCurrency, 'USD'); assert.equal(row.moneyLimit, '10.250000'); assert.equal(row.unitKind, 'money');
  db.aiBudgetPolicy.findMany = async ({ where }) => row.scopeKind === where.scopeKind && row.enabled === where.enabled
    && row.unitKind === where.unitKind && row.moneyCurrency !== null ? [{ moneyCurrency: row.moneyCurrency }] : [];
  const { AiCreditService } = require('../apps/api/src/modules/ai-native/budget/ai-credit.service');
  const credits = new AiCreditService(db, {});
  assert.deepEqual(await credits.currencies(), ['USD'], 'the actual credit currency reader discovers the just-saved indexed currency');
  assert.equal((await repository.settings(key)).settings.budget.quantity.currency, 'USD');
  const disabled = { ...settings, gates: { ...settings.gates, scene: { enabled: false, revision: 2 } } };
  await repository.saveSettings(key, disabled, 1, async () => {});
  assert.equal(row.enabled, false); assert.equal(row.moneyCurrency, 'USD');
  const calls = { ...settings, budget: { state: 'limited', quantity: { unit: 'calls', value: 7 } } };
  await repository.saveSettings(key, calls, 2, async () => {});
  assert.equal(row.unitKind, 'calls'); assert.equal(row.callLimit, 7); assert.equal(row.moneyCurrency, null); assert.equal(row.moneyLimit, null); assert.equal(row.tokenLimit, null);
  const before = structuredClone(row);
  await assert.rejects(repository.saveSettings(key, settings, 3, async () => {
    if (failRevalidation) throw Error('revoked after write'); failRevalidation = true;
  }));
  assert.deepEqual(row, before);
  const notConfigured = { ...settings, budget: { state: 'not_configured' } };
  await repository.saveSettings(key, notConfigured, 3, async () => {});
  assert.equal(row.moneyCurrency, null); assert.equal(row.callLimit, null); assert.equal(row.enabled, false);
});

function fakeDb() {
  const row = { id: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, actorId: record.actorId, status: 'reserved', dispatchState: 'dispatched', unitKind: 'tokens', reservedTokens: 10n, reservedCalls: null, reservedMoney: null, moneyCurrency: null, actualTokens: null, actualCalls: null, actualMoney: null, unknownReason: null, expiresAt: record.expiresAt, updatedAt: record.storageVersion, callId: record.callId, idempotencyKey: 'idem', sceneCode: 'scene', configRevision: 2, tenantId: 'tenant', workspaceId: 'workspace' };
  const ledger = new Map();
  Object.assign(row, { configurationHash: requestFingerprint(association.config), requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, priceVersion: association.priceVersion });
  const keys = ['PLATFORM', 'TENANT', 'WORKSPACE'].map((scopeKind, index) => ({ id: `p-${index}`, scopeId: `s-${index}`, scopeKind, sceneCode: 'scene', configRevision: 2 }));
  const db = {
    aiScope: { findUnique: async ({ where }) => { const key = keys.find(item => item.scopeId === where.id); return { id: key.scopeId,
      kind: key.scopeKind, tenantId: key.scopeKind === 'PLATFORM' ? null : 'tenant', workspaceId: key.scopeKind === 'WORKSPACE' ? 'workspace' : null }; } },
    aiBudgetPolicy: { findUnique: async ({ where }) => keys.find(item => where.id ? item.id === where.id : item.scopeId === where.scopeId_scopeKind_sceneCode.scopeId) },
    aiBudgetAllocation: { findMany: async () => keys.map(item => ({ policyId: item.id, policyRevision: 2 })) },
    $queryRaw: async () => [],
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
  const policies = ['PLATFORM', 'TENANT', 'WORKSPACE'].map((scopeKind, index) => ({ ...policyRow, id: `policy-${index}`, scopeId: `scope-${index}`, scopeKind }));
  const db = { aiScope: { findUnique: async ({ where }) => { const key = policies.find(item => item.scopeId === where.id); return { id: key.scopeId,
    kind: key.scopeKind, tenantId: key.scopeKind === 'PLATFORM' ? null : 'tenant', workspaceId: key.scopeKind === 'WORKSPACE' ? 'workspace' : null }; } },
    aiBudgetPolicy: { findUnique: async ({ where }) => policies.find(item => item.scopeId === where.scopeId_scopeKind_sceneCode.scopeId) },
    aiBudgetReservation: { findUnique: async () => null,
      groupBy: async () => [{ status: 'settled', unitKind: 'tokens', moneyCurrency: null, _count: { _all: 1, actualTokens: 1 }, _sum: { actualTokens: 10n } }],
      count: async () => 0, create: async () => { throw new Error('must reject before create'); } },
    $transaction: async callback => callback(db), $queryRaw: async () => [] };
  const repo = new PrismaBudgetRepository(db);
  const quote = { association, callId: 'call-new', sceneCode: 'scene', model: 'model', actorId: 'actor', quantity: { unit: 'tokens', value: 1 }, policies: policies.map(({ scopeId, scopeKind, sceneCode }) => ({ scopeId, scopeKind, sceneCode })), consumerScope: { scopeId: 'scope-2', scopeKind: 'WORKSPACE', sceneCode: 'scene' }, evidenceHash: 'b'.repeat(64), expiresAt: new Date('2026-10-04T12:01:00.000Z') };
  await assert.rejects(() => repo.reserve(quote, { association, callId: 'call-new', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'EXHAUSTED');
});
