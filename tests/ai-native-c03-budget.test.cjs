'use strict';
const { load } = require('./fixtures/ai-native/rental-compatibility-source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { prismaRuntime: Prisma } = load('@rental-os/platform-server/prisma-runtime');
const { quantityAtoms } = load('@rental-os/ai-native-server/runtime/budget/budget-quantity');
const { PrismaBudgetRepository } = load('@rental-os/ai-native-server/runtime/budget/prisma-budget.repository');
const { BudgetError } = load('@rental-os/ai-native-server/runtime/budget/budget.ports');
const { PersistedBudgetEvidenceAdapter } = load('@rental-os/ai-native-server/runtime/budget/budget-dependency-adapters');
const { requestFingerprint } = load('@rental-os/platform-contracts/request-fingerprint');

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
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => ({ reservationId: 'reservation', requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, callId: 'call', actorId: 'intruder', scopeKey: 'WORKSPACE:workspace', sceneCode: 'scene', configRevision: association.config.configRevision, priceVersion: association.priceVersion, dispatchToken: 'dispatch', state: 'dispatched' }), readUsage: async () => { throw Error('not used'); } });
  await assert.rejects(() => adapter.dispatch(record), error => error.code === 'FORBIDDEN');
});

test('repository writes and reads micro-money without floating point conversion', async () => {
  const row = { id: 'reservation', scopeId: 'workspace', scopeKind: 'WORKSPACE', actorId: 'actor', status: 'reserved', dispatchState: 'dispatched', unitKind: 'money', reservedTokens: null, reservedCalls: null, reservedMoney: new Prisma.Decimal('123456789012345678.123456'), moneyCurrency: 'CNY', actualTokens: null, actualCalls: null, actualMoney: null, unknownReason: null, expiresAt: new Date('2026-10-04T12:01:00.000Z'), updatedAt: new Date('2026-10-04T12:00:00.000Z'), callId: 'call', idempotencyKey: 'idem', sceneCode: 'scene', configRevision: 2, tenantId: 'tenant', workspaceId: 'workspace' };
  const ledger = [];
  Object.assign(row, { configurationHash: requestFingerprint(association.config), requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, priceVersion: association.priceVersion });
  const keys = ['PLATFORM', 'TENANT', 'WORKSPACE'].map(scopeKind => ({ id: `policy-${scopeKind}`,
    scopeId: scopeKind === 'WORKSPACE' ? 'workspace' : `scope-${scopeKind}`, scopeKind, sceneCode: 'scene', configRevision: 2 }));
  const db = {
    aiScope: { findUnique: async ({ where }) => { const key = keys.find(item => item.scopeId === where.id); return key ? {
      id: key.scopeId, kind: key.scopeKind, tenantId: key.scopeKind === 'PLATFORM' ? null : 'tenant',
      workspaceId: key.scopeKind === 'WORKSPACE' ? 'workspace' : null } : null; } },
    aiBudgetPolicy: { findUnique: async ({ where }) => keys.find(item => where.id ? item.id === where.id
      : Object.entries(where.scopeId_scopeKind_sceneCode).every(([field, value]) => item[field] === value)) ?? null },
    aiBudgetAllocation: { findMany: async ({ where }) => where.reservationId === row.id
      ? keys.map(item => ({ policyId: item.id, policyRevision: item.configRevision })) : [] },
    $queryRaw: async () => [],
    aiBudgetReservation: { updateMany: async ({ where, data }) => {
      if (!Object.entries(where).every(([field, value]) => value instanceof Date ? +row[field] === +value : row[field] === value)) return { count: 0 };
      Object.assign(row, data); if (typeof row.actualMoney === 'string') row.actualMoney = new Prisma.Decimal(row.actualMoney);
      row.updatedAt = new Date(row.updatedAt.getTime() + 1); return { count: 1 };
    }, findUnique: async ({ where }) => where.id === row.id ? row : null },
    aiBudgetLedgerEntry: { findUnique: async ({ where }) => ledger.find(item =>
      item.reservationId === where.reservationId_eventKey.reservationId && item.eventKey === where.reservationId_eventKey.eventKey) ?? null,
    create: async ({ data }) => { ledger.push(data); return data; } }, $transaction: async callback => callback(db)
  };
  const repo = new PrismaBudgetRepository(db);
  const record = { id: row.id, scopeId: row.scopeId, scopeKind: row.scopeKind, actorId: row.actorId, revision: 2, storageVersion: row.updatedAt, association, callId: row.callId, sceneCode: row.sceneCode, status: 'reserved', reserved: { unit: 'money', amount: '123456789012345678.123456', currency: 'CNY', scale: 6 }, actual: null, dispatched: true, unknownReason: null, expiresAt: row.expiresAt };
  const values = ['0.000000', '0.000001', '1.234567', '9007199254.740993', '123456789012345678.123456', '999999999999999999.999999'];
  for (const [index, amount] of values.entries()) {
    // Each precision sample has its own original reservation. A settled row
    // cannot legitimately be settled again under a new event key.
    Object.assign(row, { id: `reservation-${index}`, callId: `call-${index}`, idempotencyKey: `idem-${index}`,
      status: 'reserved', dispatchState: 'dispatched', actualMoney: null });
    const original = { ...record, id: row.id, callId: row.callId, storageVersion: row.updatedAt,
      association: { ...association, idempotencyKey: row.idempotencyKey } };
    const result = await repo.mutate(original, { action: 'settle', eventKey: `settle-money-${index}`, usage: { quantity: { unit: 'money', amount, currency: 'CNY', scale: 6 }, evidenceHash: 'a'.repeat(64) } }, async () => {});
    assert.equal(ledger[index].moneyAmount, amount);
    assert.equal(result.actual.amount, amount);
  }
  const writes = ledger.length;
  Object.assign(row, { id: record.id, callId: record.callId, idempotencyKey: association.idempotencyKey,
    status: 'reserved', dispatchState: 'dispatched', actualMoney: null, updatedAt: record.storageVersion });
  await assert.rejects(() => repo.mutate(record, { action: 'settle', eventKey: 'overflow', usage: { quantity: { unit: 'money', amount: '1000000000000000000.000000', currency: 'CNY', scale: 6 }, evidenceHash: 'a'.repeat(64) } }, async () => {}), BudgetError);
  assert.equal(ledger.length, writes);
});

test('post-lock policy reread is used when a concurrent revision disables the policy', async () => {
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant' }, config: association.config, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } }, sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  let reads = 0, locked = false, writes = 0;
  const keys = ['PLATFORM', 'TENANT', 'WORKSPACE'].map(scopeKind => ({ scopeId: scopeKind === 'WORKSPACE' ? 'workspace' : `scope-${scopeKind}`, scopeKind, sceneCode: 'scene' }));
  const row = { id: 'policy-WORKSPACE', ...keys[2], configRevision: 3, settingsJson: { ...settings, gates: { ...settings.gates, scene: { enabled: false, revision: 2 } } } };
  const first = { ...row, configRevision: 2, settingsJson: settings };
  const db = { aiScope: { findUnique: async ({ where }) => { const key = keys.find(item => item.scopeId === where.id); return key ? {
    id: key.scopeId, kind: key.scopeKind, tenantId: key.scopeKind === 'PLATFORM' ? null : 'tenant',
    workspaceId: key.scopeKind === 'WORKSPACE' ? 'workspace' : null } : null; } },
    aiBudgetPolicy: { findUnique: async ({ where }) => {
      const key = keys.find(item => Object.entries(where.scopeId_scopeKind_sceneCode).every(([field, value]) => item[field] === value));
      if (!key) return null;
      if (key.scopeKind !== 'WORKSPACE') return { id: `policy-${key.scopeKind}`, ...key, configRevision: 2, settingsJson: settings };
      reads++; return locked ? row : first;
    } },
    $queryRaw: async query => { if (query.values.includes(row.id)) locked = true; return [{ id: row.id }]; },
    aiBudgetAllocation: { findMany: async () => [] }, aiBudgetReservation: { findUnique: async () => null,
      groupBy: async () => [], count: async () => 0, create: async () => { writes++; throw new Error('must reject'); } },
    $transaction: async callback => callback(db) };
  const repo = new PrismaBudgetRepository(db);
  const quote = { association, callId: 'call', sceneCode: 'scene', model: 'model', actorId: 'actor', quantity: { unit: 'tokens', value: 1 }, policies: keys, consumerScope: keys[2], evidenceHash: 'b'.repeat(64), expiresAt: new Date('2026-10-04T12:01:00.000Z') };
  await assert.rejects(() => repo.reserve(quote, { association, callId: 'call', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'EXHAUSTED');
  assert.equal(locked, true); assert.equal(reads, 2); assert.equal(writes, 0);
});
