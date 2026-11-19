'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ skipProject: true, transpileOnly: true, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository');
const { platformCreditScene } = require('../apps/api/src/modules/ai-native/budget/platform-credit-policy');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const money = (amount, currency = 'CNY') => ({ unit: 'money', amount, currency, scale: 6 });

function fixture({ tenant, workspace, prior = '0.000000' } = {}) {
  const now = new Date('2026-11-19T00:00:00Z'), sceneCode = 'order_explanation';
  const config = { tenantId: 'tenant', configId: 'platform-model', configRevision: 1, credentialRef: 'vault-model',
    protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', serviceMode: 'platform_managed', configurationScope: { kind: 'platform' } };
  const association = { requestId: 'call', idempotencyKey: 'call', runId: 'run', stepId: 'step', actionId: 'action', priceVersion: 'price',
    config, scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' } };
  const scopes = ['PLATFORM', 'TENANT', 'WORKSPACE'].map(kind => ({ id: `scope-${kind}`, kind,
    tenantId: kind === 'PLATFORM' ? null : 'tenant', workspaceId: kind === 'WORKSPACE' ? 'workspace' : null }));
  const creditScene = platformCreditScene(sceneCode, association);
  const keys = scopes.map(scope => ({ scopeId: scope.id, scopeKind: scope.kind, sceneCode: scope.kind === 'PLATFORM' ? sceneCode : creditScene }));
  const policy = (key, cap, id) => ({ ...key, id, configRevision: 1, settingsJson: {
    draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant' }, config, sceneCode,
    gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
    allowedModels: ['model'], allowedScenes: [sceneCode], budget: { state: 'limited', quantity: money('100.000000') },
    maxConcurrent: 100, maxCallsPerRun: 100, ...(cap === undefined ? {} : { maxMoneyPerTask: money(cap) })
  } });
  const policies = keys.map((key, index) => policy(key, index === 0 ? '10.000000' : undefined, `allocation-${key.scopeKind}`));
  for (const [kind, cap] of [['TENANT', tenant], ['WORKSPACE', workspace]]) if (cap !== undefined) {
    policies.push(policy({ scopeId: `scope-${kind}`, scopeKind: kind, sceneCode }, cap, `ordinary-${kind}`));
  }
  const state = { reservations: [], allocations: [], events: [], policyReads: [], queries: [], updates: 0 };
  const task = { id: 'task', scopeId: 'scope-WORKSPACE', scopeKind: 'WORKSPACE', ownerId: 'actor', ownerKind: 'USER', sceneCode };
  const run = { id: 'run', scopeId: task.scopeId, taskId: task.id, actorId: 'actor', actorKind: 'USER' };
  const invocation = { id: 'invocation', ...run, runId: run.id, stepId: 'step', actionId: 'action', callId: 'call', sceneCode,
    configuration: config, configurationHash: requestFingerprint(config), priceVersion: 'price' };
  const emptyTable = () => ({ findFirst: async () => null, findUnique: async () => null });
  const db = {
    aiScope: { ...emptyTable(), findUnique: async ({ where }) => scopes.find(scope => scope.id === where.id) },
    aiTask: { ...emptyTable(), findFirst: async () => task }, aiRun: { ...emptyTable(), findFirst: async () => run },
    aiGatewayInvocation: { ...emptyTable(), findUnique: async () => invocation }, aiGatewayAccountingReceipt: emptyTable(),
    aiBudgetPolicy: { findUnique: async ({ where }) => {
      if (where.id) return policies.find(row => row.id === where.id) ?? null;
      const key = where.scopeId_scopeKind_sceneCode;
      state.policyReads.push({ ...key });
      return policies.find(row => Object.entries(key).every(([name, value]) => row[name] === value)) ?? null;
    } },
    aiTenantAiAllowance: { findUnique: async () => ({ grantedAmount: new Prisma.Decimal(100), allocationsJson: { workspace: '100.000000' } }) },
    aiBudgetReservation: { ...emptyTable(),
      findUnique: async ({ where }) => where.id ? state.reservations.find(row => row.id === where.id) ?? null : null,
      groupBy: async () => [], count: async () => 0,
      create: async ({ data }) => {
        const row = { reservedTokens: null, reservedCalls: null, actualTokens: null, actualCalls: null, actualMoney: null,
          unknownReason: null, ...data, reservedMoney: new Prisma.Decimal(data.reservedMoney), updatedAt: now };
        state.reservations.push(row); return row;
      },
      updateMany: async ({ where, data }) => { const row = state.reservations.find(value => value.id === where.id);
        state.updates++; Object.assign(row, data); return { count: 1 }; }
    },
    aiBudgetAllocation: { createMany: async ({ data }) => { state.allocations.push(...data); return { count: data.length }; },
      findMany: async () => state.allocations },
    aiBudgetLedgerEntry: { ...emptyTable(), create: async ({ data }) => { state.events.push(data); return data; } },
    $queryRaw: async query => {
      state.queries.push(query);
      const rows = state.reservations.length + (prior === '0.000000' ? 0 : 1);
      if (query.sql.includes('task_money_origin')) return [{ joinedRows: String(rows), reservationRows: String(rows), badRows: '0' }];
      if (query.sql.includes('task_money_sum')) return [{ rowCount: String(rows), amountCount: String(rows), currencyErrors: '0',
        usedMoney: rows ? state.reservations.reduce((sum, row) => sum.plus(row.reservedMoney), new Prisma.Decimal(prior)) : null }];
      return [];
    },
    $transaction: async callback => callback(db)
  };
  const repository = new PrismaBudgetRepository(db, () => now), expiresAt = new Date(now.getTime() + 60000);
  const command = { association, callId: 'call', sceneCode, expiresAt };
  const quote = { ...command, actorId: 'actor', model: 'model', quantity: money('5.000000'), policies: keys, consumerScope: keys[2], evidenceHash: 'a'.repeat(64) };
  return { db, state, policies, repository, quote, command,
    reserve: () => repository.reserve(quote, command, 'identity', async () => {}),
    dispatch: record => repository.mutate(record, { action: 'dispatch', eventKey: 'original-dispatch' }, async () => {}) };
}

for (const scope of ['tenant', 'workspace']) test(`platform credit intersects the ordinary ${scope} task cap before any reservation`, async () => {
  const host = fixture({ [scope]: '1.000000' });
  await assert.rejects(host.reserve(), error => error.code === 'EXHAUSTED');
  assert.equal(host.state.reservations.length, 0); assert.equal(host.state.allocations.length, 0);
  assert.ok(host.state.policyReads.some(key => key.scopeKind === scope.toUpperCase() && key.sceneCode === 'order_explanation'));
  const locks = host.state.queries.filter(query => query.sql.includes('ai_budget_policies') && query.values.length === 3);
  assert.deepEqual(locks.map(query => query.values[1]), ['TENANT', 'WORKSPACE']);
});

test('missing optional task caps inherit the platform cap without adding another ledger allocation', async () => {
  const host = fixture(); const record = await host.reserve();
  assert.equal(record.reserved.amount, '5.000000'); assert.equal(host.state.allocations.length, 3);
  assert.deepEqual(host.state.allocations.map(row => row.policyId), ['allocation-PLATFORM', 'allocation-TENANT', 'allocation-WORKSPACE']);
  await host.dispatch(record); assert.equal(host.state.events.length, 1); assert.equal(host.state.updates, 1);
});

test('dispatch rechecks a newly lowered ordinary cap and never grants another reservation', async () => {
  const host = fixture({ tenant: '6.000000', workspace: '7.000000' }); const record = await host.reserve();
  const ordinary = host.policies.find(row => row.id === 'ordinary-TENANT');
  ordinary.settingsJson.maxMoneyPerTask = money('4.000000'); ordinary.configRevision++;
  await assert.rejects(host.dispatch(record), error => error.code === 'EXHAUSTED');
  assert.equal(host.state.updates, 0); assert.equal(host.state.events.length, 0); assert.equal(host.state.reservations.length, 1);
  ordinary.settingsJson.maxMoneyPerTask = money('6.000000'); ordinary.configRevision++;
  await host.dispatch(record); assert.equal(host.state.reservations.length, 1); assert.equal(host.state.events.length, 1);
});

test('task cap includes original unresolved money across runs with exact micro-unit comparisons', async () => {
  const denied = fixture({ tenant: '6.000000', prior: '1.000001' });
  await assert.rejects(denied.reserve(), error => error.code === 'EXHAUSTED'); assert.equal(denied.state.reservations.length, 0);
  const exact = fixture({ tenant: '6.000000', prior: '1.000000' }); await exact.reserve(); assert.equal(exact.state.reservations.length, 1);
});

test('zero and incompatible currency task caps fail closed', async () => {
  const zero = fixture({ workspace: '0.000000' }); await assert.rejects(zero.reserve(), error => error.code === 'EXHAUSTED');
  const foreign = fixture({ tenant: '6.000000' }), settings = foreign.policies.find(row => row.id === 'ordinary-TENANT').settingsJson;
  settings.maxMoneyPerTask.currency = 'USD'; settings.budget.quantity.currency = 'USD';
  await assert.rejects(foreign.reserve(), error => error.code === 'UNAVAILABLE');
  assert.equal(zero.state.reservations.length + foreign.state.reservations.length, 0);
});
