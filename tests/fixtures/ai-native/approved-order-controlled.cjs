'use strict';
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Prisma } = require('../../../apps/api/node_modules/@prisma/client');
const { AI_TOOL_DRAFT_VERSION } = require('../../../packages/shared/src/index.ts');
const { persistedApprovedOrderHarness } = require('./approved-order-persisted.cjs');
const { clone, matches } = require('./task-input-store.cjs');
const { composeControlledApprovedOrder } = require('../../../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition');
const { PrismaAiApprovalRepository } = require('../../../apps/api/src/modules/ai-native/ai-approval-repository');

// Actual formal publisher/plan/registration, authorization, preparation, approval,
// Core confirmation and idempotency. Database and Core business facts remain doubles.
async function controlledApprovedOrderHarness() {
  const h = await persistedApprovedOrderHarness(), { state } = h;
  state.user.permissions.push('system:params:manage');
  for (const table of ['aiStep', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiApprovalConsumption',
    'aiApprovedOrderSnapshot', 'aiTaskActionInput', 'aiTaskPlanPolicy', 'aiTaskRunPlan', 'aiTaskEvent', 'aiTaskResultArtifact']) state.records[table] = [];
  Object.assign(state.records.aiTask[0], { eventCursor: 0n });
  state.records.aiRun[0].fencingToken = new Prisma.Decimal('9');
  Object.assign(state.records.quote[0], { chargeLines: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [],
    appliedDiscountPlanIds: [], discountEvaluations: [], serviceSnapshots: [], rentalAmount: 123, discountAmount: 0,
    couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, receivableAmount: 123 });
  function client(records, inTransaction) {
    const rows = name => (records ?? state.records)[name];
    const related = (name, row) => name === 'aiProposalAction' ? { ...row, step: rows('aiStep').find(s => s.actionId === row.actionId && s.scopeId === row.scopeId) }
      : name === 'aiProposal' ? { ...row, currentVersion: rows('aiProposalVersion').find(v => v.proposalId === row.id && v.revision === row.currentRevision) ?? null } : row;
    const project = (row, select) => !row ? null : !select ? clone(row) : Array.isArray(row) ? row.map(value => project(value, select)) : Object.fromEntries(Object.entries(select).map(([k, rule]) =>
      [k, rule === true ? clone(row[k]) : project(row[k], rule.select)]));
    const before = async (model, op, args) => {
      if (state.onOperation) await state.onOperation({ model, op, args, records: records ?? state.records, inTransaction });
    };
    const db = { $queryRaw: async () => [] };
    for (const model of Object.keys(state.records)) db[model] = {
      findFirst: async (args = {}) => { await before(model, 'findFirst', args); return project(rows(model).map(r => related(model, r)).find(r => matches(r, args.where ?? {})), args.select); },
      findUnique: async args => {
        await before(model, 'findUnique', args);
        const where = Object.keys(args.where).length === 1 && Object.keys(args.where)[0].includes('_') ? Object.values(args.where)[0] : args.where;
        return project(rows(model).map(r => related(model, r)).find(r => matches(r, where)), args.select);
      },
      findMany: async (args = {}) => { await before(model, 'findMany', args); return rows(model).filter(r => matches(r, args.where ?? {})).slice(0, args.take).map(r => project(related(model, r), args.select)); },
      create: async args => {
        await before(model, 'create', args);
        const row = { revision: 1, ...clone(args.data) };
        if (model === 'rentalOrderIdempotencyRecord') { row.id = 'idempotency-a'; row.status = 'succeeded'; }
        if (model === 'aiApprovalConsumption') assert.equal(rows(model).some(r => r.scopeId === row.scopeId && r.taskId === row.taskId && r.actionId === row.actionId), false);
        rows(model).push(row); return project(related(model, row), args.select);
      },
      updateMany: async args => {
        await before(model, 'updateMany', args); let count = 0;
        for (const row of rows(model)) if (matches(related(model, row), args.where)) {
          count++; for (const [k, v] of Object.entries(args.data)) row[k] = v && typeof v === 'object' && 'increment' in v ? row[k] + v.increment : clone(v);
        }
        return { count };
      }
    };
    if (inTransaction) db.records = records;
    return db;
  }
  const db = client(null, false), active = new AsyncLocalStorage(); let queue = Promise.resolve();
  db.$transaction = callback => {
    // Independent authorization read transactions are not nested MySQL locks.
    if (active.getStore()) return callback(client(null, false));
    const work = queue.then(() => active.run(true, async () => {
      const records = clone(state.records); let committed = false;
      try {
        const result = await callback(client(records, true)), wrote = records.rentalOrder.length > state.records.rentalOrder.length;
        state.records = records; committed = true;
        if (wrote) state.commits++;
        if (wrote && state.ackLost) throw Error('synthetic COMMIT applied, response lost');
        return result;
      } catch (error) { if (!committed) state.rollbacks++; throw error; }
    }));
    queue = work.catch(() => {}); return work;
  };
  Object.assign(h.dependencies.db, db);
  const dependencies = { ...h.dependencies, ...h.policyDependencies, scene: { code: 'rental.order.explain', version: '1' } };
  const compose = () => composeControlledApprovedOrder(dependencies), root = compose();
  const limits = { maxSteps: 4, maxCalls: 4, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096, maxConcurrent: 1 };
  await root.policy.put({ expectedRevision: null, enabled: true, limits, expiresAt: '2099-01-01T00:00:00Z' });
  const lease = () => ({ taskId: 'task-a', runId: 'run-a', holderId: state.records.aiRun[0].leaseOwnerId,
    revision: state.records.aiRun[0].revision, fencingToken: state.records.aiRun[0].fencingToken.toFixed(0), expiresAt: state.records.aiRun[0].leaseExpiresAt.toISOString() });
  const published = await root.source.publishOrderInput({ taskId: 'task-a', registrationRef: 'order-a', expectedTaskRevision: state.records.aiTask[0].revision, lease: lease(), input: h.body });
  await root.plans.savePlan({ taskId: 'task-a', runId: 'run-a', taskRevision: state.records.aiTask[0].revision, limits,
    steps: [{ registrationRef: 'order-a', operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease());
  const { taskId, expiresAt, ...held } = lease();
  const registered = await root.registrations.register({ taskId, registrationRef: 'order-a', expectedTaskRevision: state.records.aiTask[0].revision, lease: held });
  const step = state.records.aiStep.find(s => s.id === registered.stepId);
  assert.equal(step.status, 'PENDING');
  // Hosting/transition authority belongs to AIN06. This smoke explicitly starts
  // the registered step by fixture mutation; it does not prove a running worker.
  step.status = 'RUNNING';
  const prepareCommand = { taskId, proposalId: 'proposal-a', proposalRevision: 1, actionId: step.actionId,
    expiresAt: h.payload.expiresAt, lease: { ...held, revision: state.records.aiRun[0].revision } };
  const pending = await root.prepare(prepareCommand);
  assert.equal(state.records.aiApproval.length, 0);
  assert.equal(state.records.rentalOrder.length, 0);
  const approve = async () => {
    const approval = await new PrismaAiApprovalRepository(h.dependencies.db, h.dependencies.clock).decide({ scopeId: 'scope-a', taskId,
      proposalId: 'proposal-a', proposalRevision: 1, payload: state.records.aiProposalVersion[0].payload,
      reviewedPayloadHash: pending.reviewedPayloadHash, decision: 'approved' },
    { scopeId: 'scope-a', actorKind: 'user', actorId: 'operator-a', audience: 'operator' });
    return { ...prepareCommand, expiresAt: undefined, reviewedPayloadHash: pending.reviewedPayloadHash, approvalId: approval.approvalId };
  };
  return { ...h, root, compose, dependencies, published, registered, prepareCommand, pending,
    approve: async () => { const { expiresAt: _, ...command } = await approve(); return command; } };
}
module.exports = { controlledApprovedOrderHarness };
