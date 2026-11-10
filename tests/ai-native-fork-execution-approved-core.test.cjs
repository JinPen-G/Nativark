'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

const input = { quoteId: 'quote-1', customerType: 'personal', customerId: 'customer-1', fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-1', startAt: '2026-10-05T10:00:00Z', endAt: '2026-10-06T10:00:00Z', lines: [{ itemGroupId: 'item-1', quantity: 1 }] };
function harness(options = {}) {
  const state = { orders: [], key: null, consumed: false, approval: null, effects: 0, trace: [], deny: false, records: structuredClone(options.records ?? {}) };
  const quote = { id: 'quote-1', request: input, expiresAt: '2099-01-01T00:00:00.000Z', ruleSnapshot: {} };
  const order = { id: 'order-1', tenantId: 'tenant-1', workspaceId: 'workspace-1', status: 'reserved', lines: input.lines };
  const service = Object.create(RentalOrderConfirmationService.prototype);
  service.prisma = { $transaction: async callback => {
    const tx = { state: structuredClone({ orders: state.orders, key: state.key, consumed: state.consumed, approval: state.approval, records: state.records }) };
    if (options.txFactory) Object.assign(tx, options.txFactory(tx, state));
    state.trace.push('begin');
    try { const result = await callback(tx); Object.assign(state, tx.state); state.trace.push('commit'); if (options.ackLost) throw Error('ack lost'); return result; }
    catch (error) { state.trace.push('error'); throw error; }
  } };
  service.core = { resolveWorkspaceId: () => 'workspace-1', prepareOrder: async () => { state.effects++; return structuredClone(order); }, assertAvailabilityWithLocks: async () => { state.trace.push('availability'); } };
  service.business = { consumeQuote: () => structuredClone(quote), assertOrderDaysOpenForConfirmation: () => {}, validateCouponForOrder: () => null, applyOrderConfirmationToCache: () => state.trace.push('cache') };
  service.coreFacts = { findOrder: async (_tenant, id) => state.orders.find(row => row.id === id), saveOrderAggregate: async (value, _lines, tx) => { state.trace.push('order'); tx.state.orders.push(structuredClone(value)); if (options.failOrder) throw Error('order failed'); } };
  service.businessFacts = { findQuote: async () => structuredClone(quote), consumeQuoteIfAvailable: async (_tenant, _quote, _order, _at, tx) => { state.trace.push('quote'); tx.state.consumed = true; return true; } };
  service.idempotency = { find: async (_tenant, _action, _key, tx) => (tx?.state ?? state).key, record: async (value, tx) => { state.trace.push('idempotency'); tx.state.key = structuredClone(value); } };
  const participant = {
    authorize: async binding => { assert.equal(binding.workspaceId, 'workspace-1'); assert.equal(binding.requestFingerprint, requestFingerprint(input)); if (state.deny) throw Error('revoked'); state.trace.push('authorize'); },
    recover: async () => state.approval?.resultRef ?? null,
    prepare: async tx => { state.trace.push('approval.prepare'); tx.state.approval = { resultRef: null }; },
    commit: async (tx, binding, orderId) => { state.trace.push('approval.commit'); assert.equal(tx.state.orders[0].id, orderId); assert.equal(tx.state.consumed, true); if (options.failApproval) throw Error('approval commit failed'); tx.state.approval.resultRef = orderId; if (options.revokeAfterCommit) state.deny = true; },
    replay: async (_binding, id) => { state.trace.push('approval.replay'); if (state.deny) throw Error('revoked'); assert.equal(state.approval?.resultRef, id); }
  };
  return { state, service, participant, run: () => service.createApprovedOrder('tenant-1', structuredClone(input), 'operator', { category: { code: 'camera' } }, 'key-1', participant) };
}

test('approved create participates in the actual Core transaction and is replayable', async () => {
  const h = harness(); assert.equal((await h.run()).replayed, false);
  assert.equal(h.state.orders.length, 1); assert.equal(h.state.approval.resultRef, 'order-1');
  assert.ok(h.state.trace.indexOf('approval.prepare') < h.state.trace.indexOf('order'));
  assert.ok(h.state.trace.indexOf('approval.commit') < h.state.trace.indexOf('commit'));
  assert.equal((await h.run()).replayed, true); assert.equal(h.state.effects, 1);
});
for (const option of ['failOrder', 'failApproval']) test(`Core and approval both roll back on ${option}`, async () => {
  const h = harness({ [option]: true }); await assert.rejects(h.run());
  assert.equal(h.state.orders.length, 0); assert.equal(h.state.consumed, false); assert.equal(h.state.key, null); assert.equal(h.state.approval, null);
});
test('commit ack loss preserves facts and a later request recovers without another order', async () => {
  const h = harness({ ackLost: true }); await assert.rejects(h.run());
  assert.equal(h.state.orders.length, 1); assert.equal((await h.run()).replayed, true); assert.equal(h.state.effects, 1);
});
test('expired business idempotency record does not permit repeating a consumed action', async () => {
  const h = harness();
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { identity } = require('./fixtures/ai-native/authorization-baseline.cjs');
  // This old Core double predates quote ACL and transaction-owned numbering.
  // Transport its declared tenant and synthetic ALS without weakening either
  // the production guard or the original consumed-action replay assertions.
  const readQuote = h.service.businessFacts.findQuote;
  h.service.businessFacts.findQuote = async (...args) => ({ ...await readQuote(...args), tenantId: 'tenant-1' });
  h.service.core.bindOrderCreationFulfillment = async (tenantId, order, tx) => {
    assert.equal(tenantId, 'tenant-1'); assert.equal(order.id, 'order-1'); assert.ok(tx.state);
  };
  h.service.coreFacts.allocateOrderNumber = async (tenantId, _at, _zone, tx) => {
    assert.equal(tenantId, 'tenant-1'); assert.ok(tx.state.approval);
    return 'synthetic-order-number';
  };
  await assert.rejects(h.run(), error => error.getStatus?.() === 403);
  assert.equal(h.state.effects, 0, 'missing authenticated quote identity must still refuse creation');
  const run = () => runWithRequestIdentity(identity({ tenantId: 'tenant-1', workspaceId: 'workspace-1',
    userId: 'operator-1', audience: 'operator', permissions: ['rental-os:order:create', 'rental-os:order:view'] }), h.run);
  await run(); h.state.key = null;
  assert.equal((await run()).replayed, true); assert.equal(h.state.effects, 1);
});
test('revocation after commit suppresses output without undoing committed facts', async () => {
  const h = harness({ revokeAfterCommit: true }); await assert.rejects(h.run(), /revoked/u);
  assert.equal(h.state.orders.length, 1); assert.equal(h.state.approval.resultRef, 'order-1');
});
test('manual Core creation still works with no AI participant', async () => {
  const h = harness(); const result = await h.service.createOrder('tenant-1', structuredClone(input), 'operator', { category: { code: 'camera' } }, 'manual-key');
  assert.equal(result.replayed, false); assert.equal(h.state.orders.length, 1); assert.equal(h.state.approval, null);
});

const { PrismaAiApprovalConsumptionRepository } = require('../apps/api/src/modules/ai-native/prisma-approval-consumption.repository');
function matches(value, rule) {
  if (rule === null || typeof rule !== 'object') return value === rule;
  if (rule instanceof Date) return value instanceof Date && value.getTime() === rule.getTime();
  if (typeof rule.toFixed === 'function') return String(value) === rule.toFixed(0);
  return Object.entries(rule).every(([key, child]) => {
    if (key === 'is') return matches(value, child);
    if (key === 'in') return child.includes(value);
    if (key === 'gt') return value > child;
    if (key === 'not') return !matches(value, child);
    return value != null && matches(value[key], child);
  });
}
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const shared = require('./fixtures/ai-native/local-shared.cjs');
function persisted(options = {}) {
  const context = { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'request-1', authorizedAt: '2026-10-05T10:00:00.000Z', audience: 'operator', actor: { kind: 'user', userId: 'user-1' }, scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'workspace-1' }, access: { permissions: ['rental.order.create'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
  const bound = { context, scopeId: 'scope-1', taskId: 'task-1', actionId: 'action-1', approvalId: 'approval-1', proposalId: 'proposal-1', proposalRevision: 1, actionFingerprint: requestFingerprint(input), businessIdempotencyKey: 'key-1', lease: { runId: 'run-1', holderId: 'worker-1', revision: 2, fencingToken: '9' } };
  const relation = { scopeId: bound.scopeId, taskId: bound.taskId, proposalId: bound.proposalId, proposalRevision: 1 };
  const records = {
    aiTask: { id: bound.taskId, scopeId: bound.scopeId, scopeKind: 'WORKSPACE', scope: aiPersistenceScopeColumns(context.scope), ownerKind: 'USER', ownerId: 'user-1', audience: 'OPERATOR', archivedAt: null, status: 'RUNNING', revision: 3, cancelRequestedAt: null },
    aiRun: { id: 'run-1', scopeId: 'scope-1', taskId: 'task-1', revision: 2, fencingToken: 9n, leaseOwnerId: 'worker-1', leaseExpiresAt: new Date('2099-01-01T00:00:00Z'), actorKind: 'USER', actorId: 'user-1', status: 'RUNNING' },
    aiProposal: { scopeId: bound.scopeId, taskId: bound.taskId, id: bound.proposalId, stateRevision: 1, status: 'CONFIRMED', currentRevision: 1 },
    aiApproval: { ...relation, id: 'approval-1', actorKind: 'USER', actorId: 'user-1', audience: 'OPERATOR', decision: 'APPROVED', payloadHash: 'a'.repeat(64), expiresAt: new Date('2099-01-01T00:00:00Z') },
    aiProposalVersion: { scopeId: bound.scopeId, taskId: bound.taskId, proposalId: bound.proposalId, revision: 1, payloadHash: 'a'.repeat(64), expiresAt: new Date('2099-01-01T00:00:00Z') },
    aiProposalAction: { ...relation, actionId: 'action-1', requestFingerprint: bound.actionFingerprint, step: { scopeId: bound.scopeId, taskId: bound.taskId, runId: 'run-1', actionId: 'action-1', requestFingerprint: bound.actionFingerprint, toolCode: 'rental.order.commit', status: 'RUNNING' } }
  };
  let nesting = 0, clockTime = new Date('2026-10-05T10:00:01.000Z');
  const h = harness({ records, ...options, txFactory: (tx, state) => {
    const project = (row, args) => row && matches(row, args.where) ? structuredClone(Object.fromEntries(Object.keys(args.select).map(key => [key, row[key]]))) : null;
    const result = {};
    for (const name of Object.keys(records)) result[name] = { findFirst: async args => project(tx.state.records[name], args), updateMany: async args => {
      const row = tx.state.records[name]; if (!row || !matches(row, args.where)) return { count: 0 }; Object.assign(row, args.data); return { count: 1 };
    } };
    result.aiApprovalConsumption = {
      findFirst: async args => project(tx.state.approval, args),
      create: async args => { assert.equal(tx.state.approval, null); tx.state.approval = structuredClone(args.data); return project(tx.state.approval, { ...args, where: {} }); },
      updateMany: async args => { if (!tx.state.approval || !matches(tx.state.approval, args.where)) return { count: 0 }; if (options.failConsume) throw Error('synthetic consumption write failed'); Object.assign(tx.state.approval, args.data); return { count: 1 }; }
    };
    result.rentalOrder = { findFirst: async args => project(tx.state.orders.find(order => order.id === args.where.id), args) };
    result.rentalOrderIdempotencyRecord = { findFirst: async args => {
      if (options.expireAfterReceipt) clockTime = new Date('2099-01-01T00:00:00.000Z');
      return project(tx.state.key ? { id: 'idem-1', workspaceId: 'workspace-1', status: 'succeeded', idempotencyKey: tx.state.key.key, ...tx.state.key } : null, args);
    } };
    return result;
  } });
  const transaction = h.service.prisma.$transaction;
  h.service.prisma.$transaction = async callback => { assert.equal(nesting, 0, 'no nested independent transaction'); nesting++; try { return await transaction(callback); } finally { nesting--; } };
  const authority = { resolve: async () => { if (h.state.deny) throw Error('revoked'); return structuredClone(context); } };
  const repository = new PrismaAiApprovalConsumptionRepository(h.service.prisma, () => new Date(clockTime));
  const participant = repository.createOrderTransaction(bound, authority);
  return { ...h, bound, context, authority, repository, participant, run: () => h.service.createApprovedOrder('tenant-1', structuredClone(input), 'operator', { category: { code: 'camera' } }, 'key-1', participant) };
}

test('real Prisma approval participant and real Core share one write transaction', async () => {
  const h = persisted(); assert.equal((await h.run()).replayed, false);
  assert.equal(h.state.orders.length, 1); assert.equal(h.state.approval.status, 'COMMITTED');
  assert.equal((await h.run()).replayed, true); assert.equal(h.state.effects, 1);
  h.state.key = null; assert.equal((await h.run()).replayed, true); assert.equal(h.state.orders.length, 1);
});

for (const [name, change] of Object.entries({
  'wrong approving actor': h => h.state.records.aiApproval.actorId = 'another',
  'old worker fence': h => h.state.records.aiRun.fencingToken = 10n,
  'cancellation': h => h.state.records.aiTask.cancelRequestedAt = new Date(),
  'stale proposal': h => h.state.records.aiProposal.currentRevision = 2,
  'expired approval': h => h.state.records.aiApproval.expiresAt = new Date('2020-01-01'),
  'wrong action request': h => h.state.records.aiProposalAction.requestFingerprint = 'b'.repeat(64),
  'different tenant': h => h.state.records.aiTask.scope.tenantId = 'another',
  'revoked authority': h => h.state.deny = true
})) test(`persisted approval refuses ${name} before Core writes`, async () => {
  const h = persisted(); change(h); await assert.rejects(h.run());
  assert.equal(h.state.orders.length, 0); assert.equal(h.state.approval, null);
});

test('consumption write failure rolls back the real Core order and idempotency receipt', async () => {
  const h = persisted({ failConsume: true }); await assert.rejects(h.run());
  assert.equal(h.state.orders.length, 0); assert.equal(h.state.approval, null); assert.equal(h.state.key, null);
});

test('approval and lease expiring during the final fact lookup roll back the transaction', async () => {
  const h = persisted({ expireAfterReceipt: true }); await assert.rejects(h.run());
  assert.equal(h.state.orders.length, 0); assert.equal(h.state.approval, null); assert.equal(h.state.key, null);
});

test('a standalone fabricated resultRef cannot commit the approved action', async () => {
  const h = persisted();
  const binding = { tenantId: 'tenant-1', workspaceId: 'workspace-1', idempotencyKey: 'key-1', requestFingerprint: requestFingerprint(input), request: input };
  await assert.rejects(h.service.prisma.$transaction(async tx => {
    await h.participant.prepare(tx, binding); await h.participant.commit(tx, binding, 'made-up-order');
  }));
  assert.equal(h.state.approval, null);
});
