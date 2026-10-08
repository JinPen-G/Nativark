'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { PrismaGatewayInvocationBindings } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-invocation-bindings');
const { BudgetGatewayAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-gateway-adapter');
const { prepareGatewayTextIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const now = new Date('2026-10-05T12:00:00Z');
const intent = { draftVersion: 'ain-c03-draft-2', requestId: 'request-1', sceneCode: 'rental.order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'Explain the authorized order.' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 64 };
const config = { configId: 'profile-1', configRevision: 3, credentialRef: 'vault-1', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model-1', tenantId: 'tenant-1', serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant-1' } };
const intentHash = prepareGatewayTextIntent(intent, { sceneCode: intent.sceneCode, maxOutputTokens: 64 }, 'invoke').intentHash;
const narrow = { actorId: 'actor-1', tenantId: 'tenant-1', workspaceId: 'workspace-1' };
const request = { callId: intent.requestId, model: config.model, maxOutputTokens: 64, intentHash };
function copy(value) {
  if (value instanceof Date) return new Date(value);
  if (value instanceof Prisma.Decimal) return new Prisma.Decimal(value);
  if (Array.isArray(value)) return value.map(copy);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, copy(v)]));
  return value;
}
function matches(row, where) {
  return Object.entries(where).every(([key, value]) => {
    if (value instanceof Prisma.Decimal) return row[key]?.equals(value);
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('gt' in value) return row[key] > value.gt;
      return false;
    }
    return value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value;
  });
}
function harness() {
  const state = { time: new Date(now), creates: 0, authCalls: 0, authHook: null, readHook: null, commitFailure: null,
    principal: { context: { contractVersion: 'ain-c01-c02-draft-1', requestId: 'auth-1', authorizedAt: now.toISOString(), audience: 'operator', actor: { kind: 'user', userId: 'actor-1' }, scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' }, access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } }, scope: { id: 'scope-1', kind: 'WORKSPACE', tenantId: 'tenant-1', workspaceId: 'workspace-1' } },
    rows: {
      aiScope: [{ id: 'owner-1', kind: 'TENANT', tenantId: 'tenant-1', workspaceId: null, scopeKey: 'tenant:8:tenant-1' }],
      aiProviderProfile: [{ id: config.configId, scopeId: 'owner-1', scopeKind: 'TENANT', configRevision: 3, credentialRef: config.credentialRef, protocol: config.protocol, provider: config.provider, model: config.model, serviceMode: config.serviceMode, enabled: true, disabledAt: null }],
      aiTask: [{ id: 'task-1', scopeId: 'scope-1', scopeKind: 'WORKSPACE', ownerId: 'actor-1', ownerKind: 'USER', audience: 'OPERATOR', status: 'RUNNING', revision: 5, sceneCode: intent.sceneCode, archivedAt: null, cancelRequestedAt: null }],
      aiRun: [{ id: 'run-1', taskId: 'task-1', scopeId: 'scope-1', actorId: 'actor-1', actorKind: 'USER', status: 'RUNNING', revision: 7, leaseOwnerId: 'worker-1', leaseExpiresAt: new Date(now.getTime() + 60_000), fencingToken: new Prisma.Decimal(2) }],
      aiStep: [{ id: 'step-1', taskId: 'task-1', runId: 'run-1', scopeId: 'scope-1', actionId: 'action-1', requestFingerprint: intentHash, status: 'RUNNING', revision: 9 }],
      aiGatewayInvocation: [], aiBudgetReservation: []
    }
  };
  function delegates(rows) {
    return Object.fromEntries(Object.keys(rows).map(name => [name, {
      findFirst: async ({ where }) => { state.readHook?.(name); return copy(rows[name].find(row => matches(row, where)) ?? null); },
      findUnique: async ({ where }) => copy(rows[name].find(row => matches(row, where.scopeId_callId ?? where)) ?? null),
      updateMany: async ({ where, data }) => { const selected = rows[name].filter(row => matches(row, where)); selected.forEach(row => Object.assign(row, copy(data))); return { count: selected.length }; },
      create: async ({ data }) => {
        if (rows[name].some(row => row.scopeId === data.scopeId && (row.callId === data.callId || row.stepId === data.stepId))) throw new Prisma.PrismaClientKnownRequestError('synthetic unique', { code: 'P2002', clientVersion: '5.22.0' });
        state.creates++; const row = { id: `invocation-${state.creates}`, ...copy(data), createdAt: now }; rows[name].push(row); return copy(row);
      }
    }]));
  }
  const db = Object.fromEntries(Object.keys(state.rows).map(name => [name, Object.fromEntries(['findFirst', 'findUnique', 'updateMany', 'create'].map(method => [method, args => delegates(state.rows)[name][method](args)]))]));
  let queue = Promise.resolve();
  db.$transaction = operation => {
    const pending = queue.then(async () => {
      const rows = copy(state.rows), result = await operation(delegates(rows));
      if (state.commitFailure === 'rollback') throw Error('synthetic rollback');
      state.rows = rows;
      if (state.commitFailure === 'ack') throw Error('synthetic lost commit acknowledgement');
      return result;
    }); queue = pending.catch(() => {}); return pending;
  };
  const source = () => new PrismaGatewayInvocationBindings(db, { resolveCurrent: async () => { state.authCalls++; state.authHook?.(state.authCalls); return copy(state.principal); } }, () => new Date(state.time));
  const input = () => ({ stepId: 'step-1', mode: 'invoke', lease: { runId: 'run-1', holderId: 'worker-1', fencingToken: '2' }, intent: copy(intent), configuration: copy(config), priceVersion: 'price-1', expiresAt: new Date(now.getTime() + 30_000) });
  const budget = () => {
    const row = state.rows.aiGatewayInvocation[0];
    state.rows.aiBudgetReservation.push({ id: 'budget-1', scopeId: row.scopeId, scopeKind: 'WORKSPACE', actorId: row.actorId, tenantId: 'tenant-1', workspaceId: 'workspace-1', callId: row.callId, requestId: row.callId, runId: row.runId, stepId: row.stepId, actionId: row.actionId, idempotencyKey: row.callId, sceneCode: row.sceneCode, configurationHash: row.configurationHash, configRevision: 3, priceVersion: row.priceVersion });
  };
  return { state, source, input, budget };
}

test('real binding source registers one existing task step and survives service recreation', async () => {
  const h = harness();
  assert.equal((await h.source().register(h.input())).replayed, false);
  assert.equal((await h.source().register(h.input())).replayed, true);
  const bound = await h.source().resolveForReserve(narrow, request);
  assert.equal(h.state.creates, 1); assert.equal(bound.association.runId, 'run-1'); assert.equal(bound.association.stepId, 'step-1'); assert.equal(bound.association.actionId, 'action-1');
  assert.notEqual(bound.association.runId, bound.association.requestId);
  assert.equal(JSON.stringify(h.state.rows.aiGatewayInvocation).includes('Explain the authorized order.'), false);
  let received;
  const adapter = new BudgetGatewayAdapter({ reserve: async command => { received = command; return { id: 'budget-1', association: command.association, callId: command.callId, sceneCode: command.sceneCode }; } }, h.source());
  assert.equal(await adapter.reserve(narrow, request), 'budget-1'); assert.equal(received.association.stepId, 'step-1');
});

test('runner invocation preparation uses the real binding repository and refuses replay as fresh readiness', async () => {
  const { PrismaTaskGatewayInvocationPreparation } = require('../apps/api/src/modules/ai-native/runner/prisma-task-gateway-invocation.preparation');
  const h = harness(); const ref = { registered: { stepId: 'step-1' } };
  const held = { taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', revision: 7, fencingToken: '2', expiresAt: new Date(now.getTime() + 60_000).toISOString() };
  const adapter = new PrismaTaskGatewayInvocationPreparation(h.source(), { resolve: async () => h.input() });
  assert.equal((await adapter.prepare(ref, held)).invocationId, 'invocation-1');
  await assert.rejects(adapter.prepare(ref, held), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(h.state.creates, 1); assert.equal(h.state.rows.aiBudgetReservation.length, 0);
});

test('runner invocation preparation cannot repair stale holder/configuration with invented associations', async () => {
  const { PrismaTaskGatewayInvocationPreparation } = require('../apps/api/src/modules/ai-native/runner/prisma-task-gateway-invocation.preparation');
  for (const mode of ['holder', 'step', 'config', 'expiry', 'lost-commit']) {
    const h = harness(); const ref = { registered: { stepId: 'step-1' } };
    const held = { taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', revision: 7, fencingToken: '2', expiresAt: new Date(now.getTime() + 60_000).toISOString() };
    const source = { resolve: async () => { const value = h.input();
      if (mode === 'holder') value.lease.holderId = 'another';
      if (mode === 'step') value.stepId = 'another';
      if (mode === 'config') value.configuration.configRevision++;
      if (mode === 'expiry') value.expiresAt = new Date(now.getTime() + 120_000);
      return value;
    } };
    if (mode === 'lost-commit') h.state.commitFailure = 'ack';
    await assert.rejects(new PrismaTaskGatewayInvocationPreparation(h.source(), source).prepare(ref, held));
    assert.equal(h.state.rows.aiBudgetReservation.length, 0);
    assert.equal(h.state.rows.aiGatewayInvocation.length, mode === 'lost-commit' ? 1 : 0);
  }
});
for (const [name, mutate] of Object.entries({
  owner: h => h.state.rows.aiTask[0].ownerId = 'other',
  scope: h => h.state.rows.aiStep[0].scopeId = 'other',
  fingerprint: h => h.state.rows.aiStep[0].requestFingerprint = 'b'.repeat(64),
  run: h => h.state.rows.aiStep[0].runId = 'other',
  cancellation: h => h.state.rows.aiTask[0].cancelRequestedAt = now,
  fence: h => h.state.rows.aiRun[0].fencingToken = new Prisma.Decimal(3),
  holder: h => h.state.rows.aiRun[0].leaseOwnerId = 'other',
  lease_expired: h => h.state.rows.aiRun[0].leaseExpiresAt = now,
  configuration: h => h.state.rows.aiProviderProfile[0].configRevision = 4,
  profile_owner: h => h.state.rows.aiProviderProfile[0].scopeId = 'other'
})) test(`registration rejects ${name} before creating an invocation`, async () => {
  const h = harness(); mutate(h); await assert.rejects(h.source().register(h.input())); assert.equal(h.state.creates, 0);
});
for (const changes of [{ intentHash: 'b'.repeat(64) }, { model: 'other' }, { maxOutputTokens: 65 }, { callId: 'unregistered' }]) test(`reserve lookup rejects changed request ${Object.keys(changes)[0]}`, async () => {
  const h = harness(); await h.source().register(h.input()); await assert.rejects(h.source().resolveForReserve(narrow, { ...request, ...changes }));
});
test('missing invocation never invents task or pricing identifiers', async () => {
  const h = harness(); await assert.rejects(h.source().resolveForReserve(narrow, request)); assert.equal(h.state.creates, 0);
});
test('lost registration commit acknowledgement is not turned into a successful read-after-error', async () => {
  const h = harness(); h.state.commitFailure = 'ack';
  await assert.rejects(h.source().register(h.input()), error => error.code === 'PENDING_RECONCILIATION');
  assert.equal(h.state.rows.aiGatewayInvocation.length, 1);
});
test('current authorization changes roll back a registration rather than publishing a stale binding', async () => {
  const h = harness(); h.state.authHook = calls => { if (calls === 3) h.state.principal.context.actor.userId = 'other'; };
  await assert.rejects(h.source().register(h.input())); assert.equal(h.state.rows.aiGatewayInvocation.length, 0);
});
test('settlement binding can be reloaded after task completion and credential rotation without reauthorizing dispatch', async () => {
  const h = harness(); await h.source().register(h.input()); h.budget();
  h.state.rows.aiTask[0].status = 'SUCCEEDED'; h.state.rows.aiProviderProfile[0].configRevision = 4; h.state.time = new Date(now.getTime() + 120_000);
  const bound = await h.source().resolveForReservation(narrow, 'budget-1');
  assert.deepEqual(bound.association.config, config);
  await assert.rejects(h.source().resolveForReserve(narrow, request));
});
test('reservation reload rejects another configuration, actor and altered association', async () => {
  for (const changes of [{ configurationHash: 'b'.repeat(64) }, { stepId: 'other' }, { actorId: 'other' }, { priceVersion: 'other' }, { runId: 'other' }]) {
    const h = harness(); await h.source().register(h.input()); h.budget(); Object.assign(h.state.rows.aiBudgetReservation[0], changes);
    await assert.rejects(h.source().resolveForReservation(narrow, 'budget-1'));
  }
});
test('expiry during final authority check cannot publish a ready reserve binding', async () => {
  const h = harness(); await h.source().register(h.input());
  h.state.authHook = calls => { if (calls === 5) h.state.time = new Date(now.getTime() + 120_000); };
  await assert.rejects(h.source().resolveForReserve(narrow, request));
});
