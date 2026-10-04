'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');
const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository.ts');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports.ts');
const { Prisma } = require('@prisma/client');

const association = {
  requestId: 'req', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'call', priceVersion: 'price',
  scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'space' }, config: { configId: 'config', configRevision: 1 }
};
const quote = {
  association, callId: 'call', sceneCode: 'scene', model: 'model', actorId: 'actor', quantity: { unit: 'tokens', value: 1 },
  policies: [{ scopeId: 'scope', scopeKind: 'WORKSPACE', sceneCode: 'scene' }], consumerScope: { scopeId: 'scope', scopeKind: 'WORKSPACE', sceneCode: 'scene' },
  evidenceHash: 'a'.repeat(64), expiresAt: new Date(Date.now() + 60_000)
};
const dbBase = () => ({
  aiScope: { findUnique: async () => ({ id: 'scope', kind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'space' }) },
  aiBudgetPolicy: { findUnique: async () => ({ id: 'policy', scopeId: 'scope', scopeKind: 'WORKSPACE', sceneCode: 'scene', configRevision: 1, settingsJson: { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant' }, config: association.config, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } }, sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 1, maxCallsPerRun: 1 } }) },
  aiBudgetAllocation: { findMany: async () => [] },
  aiBudgetReservation: { findFirst: async () => null, create: async () => { throw new Error('commit acknowledgement lost'); } },
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
