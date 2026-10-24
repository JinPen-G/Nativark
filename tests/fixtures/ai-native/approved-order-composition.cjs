'use strict';
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const apiRequire = createRequire(require('node:path').resolve(__dirname, '../../../apps/api/package.json'));
const shared = apiRequire('@rental-os/shared');
const { AuthService } = require('../../../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { getRequestIdentity } = require('../../../apps/api/src/common/request-identity');
const { RentalOrderConfirmationService } = require('../../../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { RentalIdempotencyRepository, requestFingerprint } = require('../../../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { AiProposalRepository } = require('../../../apps/api/src/modules/ai-native/ai-proposal-repository');
const { PrismaAiApprovalRepository } = require('../../../apps/api/src/modules/ai-native/ai-approval-repository');
const { aiPersistenceScopeColumns } = require('../../../apps/api/src/modules/ai-native/persistence-scope');
const { user } = require('./authorization-baseline.cjs');

function matches(value, rule) {
  if (rule === undefined) return true;
  if (rule === null || typeof rule !== 'object') return value === rule;
  if (rule instanceof Date) return value instanceof Date && value.getTime() === rule.getTime();
  if (typeof rule.toFixed === 'function') return String(value) === rule.toFixed(0);
  return Object.entries(rule).every(([key, child]) => {
    if (key === 'is') return matches(value, child);
    if (key === 'in') return child.includes(value);
    if (key === 'gt') return value > child;
    if (key === 'lte') return value <= child;
    if (key.includes('_') && value?.[key] === undefined) return matches(value, child);
    if (key === 'not') return !matches(value, child);
    return value != null && matches(value[key], child);
  });
}
function project(row, select) {
  if (!row) return null;
  if (!select) return structuredClone(row);
  if (Array.isArray(row)) return row.map(value => project(value, select));
  return Object.fromEntries(Object.entries(select).map(([key, shape]) => [key, shape === true ? structuredClone(row[key]) : project(row[key], shape.select)]));
}

async function approvedOrderHarness() {
  const context = { contractVersion: shared.AI_CONTRACT_DRAFT_VERSION, requestId: 'composition-request', authorizedAt: new Date().toISOString(),
    audience: 'operator', actor: { kind: 'user', userId: 'operator-a' }, scope: { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' },
    access: { permissions: ['rental-os:order:create', 'rental-os:order:view'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
  const state = { user: user({ permissions: context.access.permissions }), session: true, member: true, workspace: 'workspace-a',
    entitled: true, policy: true, resourceAccess: true, trace: [], failures: [], prepares: 0, commits: 0, rollbacks: 0, ackLost: false,
    failAt: '', onOperation: undefined, clock: new Date(), records: {} };
  const body = { quoteId: 'quote-a', customerType: 'personal', customerId: 'customer-a', customerName: 'Synthetic customer',
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-a', startAt: '2026-10-07T10:00:00Z', endAt: '2026-10-08T10:00:00Z',
    lines: [{ itemGroupId: 'item-a', quantity: 1 }] };
  const quote = { id: 'quote-a', tenantId: 'tenant-a', quoteNo: 'Q-OFFLINE', categoryCode: 'camera', request: body,
    expiresAt: '2099-01-01T00:00:00.000Z', createdAt: new Date().toISOString(), payableAmount: 123, currency: 'CNY',
    ruleSnapshot: {}, pricingPlanVersion: '1', ruleVersion: '1' };
  const action = { actionId: 'action-a', toolCode: 'rental.order.commit', toolVersion: '1',
    input: { recordId: 'input-a', revision: 1, contentHash: requestFingerprint(body) },
    preview: { recordId: 'preview-a', revision: 1, contentHash: requestFingerprint(quote) },
    target: { resourceType: 'quote', resourceId: quote.id, version: '1' } };
  const payload = { contractVersion: shared.AI_PROPOSAL_DRAFT_VERSION, taskId: 'task-a', proposalId: 'proposal-a', revision: 1,
    audience: context.audience, scope: context.scope, actions: [action], atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt: '2099-01-01T00:00:00.000Z' };
  state.snapshots = { input: { ...action.input, scopeId: 'scope-a', taskId: 'task-a', actionId: action.actionId, payload: structuredClone(body) },
    preview: { ...action.preview, scopeId: 'scope-a', taskId: 'task-a', actionId: action.actionId, payload: structuredClone(quote) } };
  state.records = {
    aiTask: [{ id: 'task-a', scopeId: 'scope-a', scopeKind: 'WORKSPACE', scope: aiPersistenceScopeColumns(context.scope), ownerKind: 'USER', ownerId: 'operator-a',
      audience: 'OPERATOR', archivedAt: null, status: 'RUNNING', revision: 3, cancelRequestedAt: null }],
    aiRun: [{ id: 'run-a', scopeId: 'scope-a', taskId: 'task-a', revision: 2, fencingToken: '9', leaseOwnerId: 'worker-a',
      leaseExpiresAt: new Date('2099-01-01'), actorKind: 'USER', actorId: 'operator-a', status: 'RUNNING' }],
    aiStep: [{ id: 'step-a', scopeId: 'scope-a', taskId: 'task-a', actionId: 'action-a', runId: 'run-a', toolCode: action.toolCode,
      toolVersion: action.toolVersion, requestFingerprint: action.input.contentHash, status: 'RUNNING' }],
    aiProposal: [], aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], rentalOrder: [], rentalOrderIdempotencyRecord: [],
    businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant-a' }],
    quote: [structuredClone(quote)]
  };
  function client(records, inTransaction) {
    const db = {};
    const rows = model => (records ?? state.records)[model];
    const materialize = (model, row) => {
      if (model === 'aiProposalAction') return { ...row, step: rows('aiStep').find(step => step.actionId === row.actionId && step.scopeId === row.scopeId) };
      if (model === 'aiProposal') return { ...row, currentVersion: rows('aiProposalVersion').find(v => v.proposalId === row.id && v.revision === row.currentRevision) ?? null };
      return row;
    };
    const before = async (model, op, args) => {
      state.trace.push(`${inTransaction ? 'tx' : 'db'}.${model}.${op}`);
      if (state.onOperation) await state.onOperation({ model, op, args, records: records ?? state.records, inTransaction });
      if (state.failAt === `${model}.${op}`) { state.failures.push(state.failAt); throw Error(`synthetic ${state.failAt}`); }
    };
    for (const model of Object.keys(state.records)) db[model] = {
      findFirst: async (args = {}) => { await before(model, 'findFirst', args); return project(rows(model).map(row => materialize(model, row)).find(row => matches(row, args.where)), args.select); },
      findUnique: async (args = {}) => { await before(model, 'findUnique', args); return project(rows(model).map(row => materialize(model, row)).find(row => matches(row, args.where)), args.select); },
      findMany: async (args = {}) => { await before(model, 'findMany', args); return rows(model).filter(row => matches(row, args.where)).map(row => project(row, args.select)); },
      create: async args => {
        await before(model, 'create', args);
        const row = { ...structuredClone(args.data) };
        if (model === 'aiApprovalConsumption') assert.equal(rows(model).some(r => r.scopeId === row.scopeId && r.taskId === row.taskId && r.actionId === row.actionId), false);
        if (model === 'aiApprovedOrderSnapshot') {
          assert.ok(rows('aiProposalAction').some(a => a.scopeId === row.scopeId && a.taskId === row.taskId && a.proposalId === row.proposalId
            && a.proposalRevision === row.proposalRevision && a.actionId === row.actionId && a.requestFingerprint === row.actionFingerprint));
          assert.equal(rows(model).some(r => (r.scopeId === row.scopeId && r.recordId === row.recordId && r.revision === row.revision)
            || (r.scopeId === row.scopeId && r.taskId === row.taskId && r.proposalId === row.proposalId && r.proposalRevision === row.proposalRevision
              && r.actionId === row.actionId && r.kind === row.kind)), false);
        }
        if (model === 'rentalOrderIdempotencyRecord') { row.id = 'idempotency-a'; row.status = 'succeeded'; }
        rows(model).push(row); return project(materialize(model, row), args.select);
      },
      updateMany: async args => {
        await before(model, 'updateMany', args);
        let count = 0;
        for (const row of rows(model)) if (matches(materialize(model, row), args.where)) {
          count++;
          for (const [key, value] of Object.entries(args.data)) row[key] = value && typeof value === 'object' && 'increment' in value ? row[key] + value.increment : structuredClone(value);
        }
        return { count };
      }
    };
    if (inTransaction) Object.defineProperty(db, 'records', { value: records });
    return db;
  }
  const db = client(null, false);
  let queue = Promise.resolve();
  db.$transaction = async callback => {
    const preceding = queue;
    let release;
    queue = new Promise(resolve => { release = resolve; });
    await preceding;
    const records = structuredClone(state.records), tx = client(records, true);
    let committed = false;
    try {
      const result = await callback(tx);
      const wroteOrder = records.rentalOrder.length > state.records.rentalOrder.length;
      state.records = records;
      committed = true;
      if (state.afterTransactionCommit) await state.afterTransactionCommit();
      if (wroteOrder) state.commits++;
      if (wroteOrder && state.afterCommit) await state.afterCommit();
      if (wroteOrder && state.ackLost) throw Error('synthetic COMMIT applied, response lost');
      return result;
    } catch (error) { if (!committed) state.rollbacks++; throw error; }
    finally { release(); }
  };
  const proposal = await new AiProposalRepository(db).createPending({ scopeId: 'scope-a', taskId: 'task-a', payload,
    actions: [{ actionId: 'action-a', requestFingerprint: action.input.contentHash }] });
  const approval = await new PrismaAiApprovalRepository(db).decide({ scopeId: 'scope-a', taskId: 'task-a', proposalId: 'proposal-a',
    proposalRevision: 1, payload, reviewedPayloadHash: state.records.aiProposalVersion[0].payloadHash, decision: 'approved' },
  { actorKind: 'user', actorId: 'operator-a', audience: 'operator', scopeId: 'scope-a' });
  const command = { taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1, reviewedPayloadHash: state.records.aiProposalVersion[0].payloadHash,
    approvalId: approval.approvalId, actionId: 'action-a', lease: { runId: 'run-a', holderId: 'worker-a', revision: 2, fencingToken: '9' } };
  const auth = new AuthService({ getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience: 'operator', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.member ? state.user : undefined, listUserWorkspaces: async () => [] },
  { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-composition-secret' : undefined });
  const credentials = { current: async () => ({ requestId: 'composition-request', audience: 'operator',
    authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 })}` }) };
  const policy = { resolve: async (request, operation) => {
    state.trace.push(`policy.${operation}`);
    if (!state.policy || (operation === 'execute' && !state.entitled)) throw Error('synthetic policy denied');
    if (operation !== 'read') assert.equal(request.action.toolCode, 'rental.order.commit');
    const value = structuredClone(context); value.authorizedAt = new Date().toISOString(); return value;
  } };
  const quoteFacts = { findQuote: async (_tenant, id, tx) => structuredClone((tx?.records ?? state.records).quote.find(q => q.id === id)),
    consumeQuoteIfAvailable: async (_tenant, id, orderId, at, tx) => {
      if (state.failAt === 'quote.consume') { state.failures.push(state.failAt); throw Error('synthetic quote consume'); }
      const row = tx.records.quote.find(q => q.id === id);
      if (row.consumedAt) return false;
      row.consumedAt = at; row.consumedOrderId = orderId; return true;
    } };
  const core = {
    resolveWorkspaceId: () => { assert.equal(getRequestIdentity().workspaceId, 'workspace-a'); return 'workspace-a'; },
    getProfile: () => ({ categoryCode: 'camera' }), getWorkspaceCategory: async () => ({ code: 'camera' }), getBusinessSettings: () => ({}),
    listItemGroups: () => [], listPricingGroups: () => [], listCouponTemplates: () => [], listLocations: () => [], listOperators: () => [],
    prepareOrder: async (_tenant, request, name, storedQuote) => {
      assert.equal(getRequestIdentity().userId, 'operator-a'); assert.equal(name, 'Synthetic operator'); assert.equal(requestFingerprint(request), requestFingerprint(body));
      assert.equal(storedQuote.payableAmount, 123); state.prepares++;
      return { id: `order-${state.prepares}`, tenantId: 'tenant-a', workspaceId: 'workspace-a', status: 'draft', payableAmount: 123, quoteId: quote.id, lines: body.lines };
    },
    assertAvailabilityWithLocks: async (_tenant, _input, tx) => { assert.ok(tx.records); if (state.failAt === 'core.inventory') { state.failures.push(state.failAt); throw Error('synthetic inventory rejection'); } },
    getOrder: async (tenantId, id) => {
      assert.equal(getRequestIdentity().workspaceId, 'workspace-a');
      if (!state.resourceAccess) throw Error('synthetic resource denied');
      return structuredClone(state.records.rentalOrder.find(order => order.tenantId === tenantId && order.id === id));
    }
  };
  const business = { consumeQuote: (_tenant, _context, id) => structuredClone(state.records.quote.find(row => row.id === id)), assertOrderDaysOpenForConfirmation: () => {},
    validateCouponForOrder: () => null, applyOrderConfirmationToCache: () => {},
    // Declared historical-quote read port for scene assemblies that reach
    // business tools through this harness. Reads the harness's own seeded
    // quote snapshot only — never a re-quote, price rebuild or mutation.
    // Divergence from RentalBusinessService.getQuote: a missing id returns
    // null instead of NotFoundException; no current consumer in this harness
    // distinguishes the two, and AiOrderSavedQuoteSource treats null as
    // INVALID_RESPONSE (fail-closed) rather than 'missing'.
    getQuote: async (tenantId, _context, quoteId) =>
      structuredClone(state.records.quote.find(row => row.id === quoteId && row.tenantId === tenantId)) ?? null,
    // Declared-existence stub: satisfies the scene assembly's composition
    // requireMethod check only. The returned body does NOT match the
    // readiness read schema — any actual opening.read through this harness
    // fails closed with INVALID_RESPONSE. Not a readiness projection.
    tenantReadiness: async () => ({ sections: [] }) };
  const coreFacts = { findOrder: async (tenantId, id) => structuredClone(state.records.rentalOrder.find(o => o.tenantId === tenantId && o.id === id)),
    saveOrderAggregate: async (order, _lines, tx) => { await tx.rentalOrder.create({ data: order }); } };
  const confirmation = new RentalOrderConfirmationService(db, core, business, coreFacts, quoteFacts, new RentalIdempotencyRepository(db));
  const snapshots = { read: async () => structuredClone(state.snapshots) };
  // Declared-existence stub for composeAiAuthorizedBusinessTools's
  // composition check: scene assemblies reached through this harness (human
  // quote selection) require the risk tool's bounded report port. The body
  // does NOT match the report read schema — any actual risk read through
  // this harness fails closed with INVALID_RESPONSE. Not a report source.
  const reports = { getBoundedOperationReport: async () => ({ coverage: 'page_not_total', window: { from: null, to: null },
    totals: 'not_computed', items: [], source: 'synthetic_bounded_report' }) };

  const dependencies = { db, core, business, confirmation, quoteFacts, snapshots, policy, reports, guard: new ApiAuthGuard(auth, undefined, undefined, undefined, {}),
    credentials, toolVersion: '1', clock: () => new Date(Math.max(Date.now(), state.clock.getTime())) };
  state.trace.length = 0;
  return { dependencies, state, command, context, body, payload, action, auth, client };
}
module.exports = { approvedOrderHarness };
