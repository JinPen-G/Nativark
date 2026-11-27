'use strict';
const { load } = require('./fixtures/ai-native/rental-compatibility-source.cjs');
const test = require('node:test');
const assert = require('node:assert/strict');
const { PrismaBudgetRepository } = load('@rental-os/ai-native-server/runtime/budget/prisma-budget.repository');
const { BudgetError } = load('@rental-os/ai-native-server/runtime/budget/budget.ports');
const { prismaRuntime: Prisma } = load('@rental-os/platform-server/prisma-runtime');

const association = {
  requestId: 'req', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'call', priceVersion: 'price',
  scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'space' }, config: { configId: 'config', configRevision: 1 }
};
const keys = ['PLATFORM', 'TENANT', 'WORKSPACE'].map(scopeKind => ({ scopeId: scopeKind === 'WORKSPACE' ? 'scope' : `scope-${scopeKind}`, scopeKind, sceneCode: 'scene' }));
const quote = {
  association, callId: 'call', sceneCode: 'scene', model: 'model', actorId: 'actor', quantity: { unit: 'tokens', value: 1 },
  policies: keys, consumerScope: keys[2],
  evidenceHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000)
};
const dbBase = () => ({
  aiScope: { findUnique: async ({ where }) => { const key = keys.find(row => row.scopeId === where.id); return { id: key.scopeId, kind: key.scopeKind,
    tenantId: key.scopeKind === 'PLATFORM' ? null : 'tenant', workspaceId: key.scopeKind === 'WORKSPACE' ? 'space' : null }; } },
  aiBudgetPolicy: { findUnique: async ({ where }) => ({ id: `policy-${where.scopeId_scopeKind_sceneCode.scopeKind}`, ...where.scopeId_scopeKind_sceneCode, configRevision: 1, settingsJson: { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant' }, config: association.config, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } }, sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 1, maxCallsPerRun: 1 } }) },
  aiBudgetAllocation: { findMany: async () => [] },
  aiBudgetReservation: { findUnique: async () => null, findFirst: async () => null, groupBy: async () => [], count: async () => 0,
    create: async () => { throw new Error('commit acknowledgement lost'); } },
  aiBudgetLedgerEntry: { findUnique: async () => null, create: async () => null },
  $queryRaw: async () => [{ id: 'policy' }]
});

test('unknown transaction failure is pending reconciliation, not exhausted', async () => {
  const db = dbBase(); db.$transaction = async callback => { await callback(db); throw new Error('commit acknowledgement lost'); };
  const repository = new PrismaBudgetRepository(db);
  await assert.rejects(() => repository.reserve(quote, { association, callId: 'call', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'PENDING_RECONCILIATION');
});

test('a definite unique conflict still rereads the same idempotency key', async () => {
  const db = dbBase();
  db.$transaction = async () => { throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'offline' }); };
  db.aiBudgetReservation.findFirst = async () => ({ id: 'reservation', requestHash: 'different' });
  const repository = new PrismaBudgetRepository(db);
  await assert.rejects(() => repository.reserve(quote, { association, callId: 'call', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'IDEMPOTENCY_CONFLICT');
});
