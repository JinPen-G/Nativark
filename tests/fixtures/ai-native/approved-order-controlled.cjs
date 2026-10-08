'use strict';
const assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { Prisma } = require('../../../apps/api/node_modules/@prisma/client');
const { AI_TOOL_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION } = require('../../../packages/shared/src/index.ts');
const { persistedApprovedOrderHarness } = require('./approved-order-persisted.cjs');
const { clone, matches } = require('./task-input-store.cjs');
const { composeControlledApprovedOrder } = require('../../../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition');

// Actual formal publisher/plan/registration, authorization, preparation, approval,
// Core confirmation and idempotency. Database and Core business facts remain doubles.
async function controlledApprovedOrderHarness({ prepare = true, initializeOnly = false, decisionExpiresAt } = {}) {
  const h = await persistedApprovedOrderHarness(), { state } = h;
  state.user.permissions.push('system:params:manage');
  state.records.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId: 'task-a', operation: 'decide_approval', revision: 1,
    requiredPermissions: ['rental-os:order:create'], expiresAt: new Date('2099-01-01') });
  for (const table of ['aiStep', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiApprovalConsumption',
    'aiApprovedOrderSnapshot', 'aiTaskActionInput', 'aiTaskPlanPolicy', 'aiTaskRunPlan', 'aiTaskEvent', 'aiTaskResultArtifact', 'aiApprovalReprepare',
    'aiTaskOriginalRequest', 'aiTaskQuoteSelection',
    'aiTaskExecutionBudget', 'aiTaskExecutionCharge', 'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt',
    'aiTaskInputRequest', 'aiTaskInputReceipt']) state.records[table] = [];
  Object.assign(state.records.aiTask[0], { eventCursor: 0n });
  state.records.aiRun[0].fencingToken = new Prisma.Decimal('9');
  Object.assign(state.records.quote[0], { chargeLines: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [],
    appliedDiscountPlanIds: [], discountEvaluations: [], serviceSnapshots: [], rentalAmount: 123, discountAmount: 0,
    couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, receivableAmount: 123 });
  function client(records, inTransaction) {
    const rows = name => (records ?? state.records)[name];
    const related = (name, row) => name === 'aiTask' ? { ...row, runs: rows('aiRun').filter(run => run.taskId === row.id)
      .map(run => ({ ...run, executionPlan: rows('aiTaskRunPlan').find(plan => plan.runId === run.id) ?? null })) }
      : name === 'aiRun' ? { ...row, task: related('aiTask', rows('aiTask').find(task => task.id === row.taskId)) }
      : name === 'aiProposalAction' ? { ...row, step: rows('aiStep').find(s => s.actionId === row.actionId && s.scopeId === row.scopeId) }
      : name === 'aiProposal' ? { ...row, currentVersion: rows('aiProposalVersion').find(v => v.proposalId === row.id && v.revision === row.currentRevision) ?? null } : row;
    const project = (row, select) => !row ? null : !select ? clone(row) : Array.isArray(row) ? row.map(value => project(value, select)) : Object.fromEntries(Object.entries(select).map(([k, rule]) =>
      [k, rule === true ? clone(row[k]) : project(row[k], rule.select)]));
    const before = async (model, op, args) => {
      if (state.onOperation) await state.onOperation({ model, op, args, records: records ?? state.records, inTransaction });
    };
    const db = {
      $queryRaw: async query => {
        if (!query.sql.includes('FROM ai_approval_reprepares')) return [];
        await before('aiApprovalReprepare', 'read', query);
        const [scopeId, operationKey] = query.values;
        return clone(rows('aiApprovalReprepare').filter(row => row.scopeId === scopeId && row.operationKey === operationKey));
      },
      $executeRaw: async query => {
        assert.ok(query.sql.startsWith('INSERT INTO ai_approval_reprepares'));
        await before('aiApprovalReprepare', 'insert', query);
        const names = query.sql.match(/\((.*?)\) VALUES/s)[1].split(',').map(key => key.trim().replaceAll('`', ''));
        const row = Object.fromEntries(names.map((name, i) => [name, clone(query.values[i])]));
        const duplicate = rows('aiApprovalReprepare').some(r => r.scopeId === row.scopeId && (r.operationKey === row.operationKey
          || r.originalTaskId === row.originalTaskId && r.originalProposalId === row.originalProposalId && r.originalRevision === row.originalRevision
          || r.replacementTaskId === row.replacementTaskId && r.replacementActionId === row.replacementActionId));
        if (duplicate) throw Object.assign(Error('synthetic duplicate key'), { code: 'P2002' });
        rows('aiApprovalReprepare').push(row);
        return 1;
      }
    };
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
        const row = { ...(model.startsWith('aiTaskExecutionPhase') ? {} : { revision: 1 }), ...clone(args.data) };
        if (model === 'aiTask') Object.assign(row, { scope: clone(rows('aiScope').find(scope => scope.id === row.scopeId)),
          archivedAt: null, cancelRequestedAt: null, resultRef: null });
        if (model === 'aiRun') Object.assign(row, { leaseOwnerId: null, leaseExpiresAt: null });
        if (model === 'aiTaskExecutionBudget') for (const prefix of ['reserved', 'consumed']) for (const resource of ['Steps', 'Calls', 'ActiveMs', 'OutputBytes']) row[`${prefix}${resource}`] ??= 0n;
        if (model === 'aiTaskExecutionCharge') Object.assign(row, { gatewayInvocationId: null, actualAmount: null, evidenceRef: null, outcomeFingerprint: null, ...row });
        if (model === 'rentalOrderIdempotencyRecord') { row.id = 'idempotency-a'; row.status = 'succeeded'; }
        if (model === 'aiApprovalConsumption') {
          row.createdAt ??= h.dependencies.clock(); row.updatedAt ??= h.dependencies.clock();
          assert.equal(rows(model).some(r => r.scopeId === row.scopeId && r.taskId === row.taskId && r.actionId === row.actionId), false);
        }
        rows(model).push(row); return project(related(model, row), args.select);
      },
      upsert: async args => {
        await before(model, 'upsert', args);
        const where = Object.keys(args.where).length === 1 && Object.keys(args.where)[0].includes('_') ? Object.values(args.where)[0] : args.where;
        const row = rows(model).find(r => matches(r, where));
        if (!row) return db[model].create({ data: args.create, select: args.select });
        await db[model].updateMany({ where, data: args.update });
        return project(related(model, row), args.select);
      },
      updateMany: async args => {
        await before(model, 'updateMany', args); let count = 0;
        for (const row of rows(model)) if (matches(related(model, row), args.where)) {
          count++; for (const [k, v] of Object.entries(args.data)) {
            if (v && typeof v === 'object' && 'increment' in v) row[k] = row[k] instanceof Prisma.Decimal ? row[k].add(v.increment) : row[k] + v.increment;
            else if (v && typeof v === 'object' && 'decrement' in v) row[k] = row[k] instanceof Prisma.Decimal ? row[k].sub(v.decrement) : row[k] - v.decrement;
            else row[k] = clone(v);
          }
          if (model === 'aiApprovalConsumption') row.updatedAt = h.dependencies.clock();
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
        const decided = records.aiApproval.length > state.records.aiApproval.length;
        const proposed = records.aiProposal.length > state.records.aiProposal.length;
        const reprepared = records.aiApprovalReprepare.length > state.records.aiApprovalReprepare.length;
        state.records = records; committed = true;
        if (wrote) state.commits++;
        if (wrote && state.ackLost) throw Error('synthetic COMMIT applied, response lost');
        if (decided && state.decisionAckLost) throw Error('synthetic approval COMMIT applied, response lost');
        if (proposed && state.proposalAckLost) throw Error('synthetic proposal COMMIT applied, response lost');
        if (reprepared && state.reprepareAckLost) throw Error('synthetic reprepare COMMIT applied, response lost');
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
  if (initializeOnly) {
    Object.assign(state.records.aiTask[0], { createdAt: dependencies.clock(), updatedAt: dependencies.clock() });
    for (const operation of ['claim_run', 'claim_recovery_run', 'release_run', 'read_step_terminal', 'read_events']) state.records.aiTaskActionPolicy.push({
      scopeId: 'scope-a', taskId: 'task-a', operation, revision: 1, expiresAt: new Date('2099-01-01'),
      requiredPermissions: [operation === 'claim_run' ? 'rental-os:order:create' : 'rental-os:order:view'] });
    return { ...h, root, compose, dependencies, limits };
  }
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
    expiresAt: decisionExpiresAt ?? h.payload.expiresAt, lease: { ...held, revision: state.records.aiRun[0].revision } };
  const executorInput = () => ({ taskId, runId: held.runId, stepId: step.id, actionId: step.actionId,
    inputRef: published.id, fingerprint: step.requestFingerprint, lease: lease() });
  if (!prepare) return { ...h, root, compose, dependencies, published, registered, executorInput };
  const pending = await root.prepare(prepareCommand);
  assert.equal(state.records.aiApproval.length, 0);
  assert.equal(state.records.rentalOrder.length, 0);
  const review = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: 'proposal-a', proposalRevision: 1,
    reviewedPayloadHash: pending.reviewedPayloadHash };
  const approve = async () => {
    const approval = await root.approvals.decide(taskId, { ...review, decision: 'approve' });
    const { expiresAt: _, ...command } = prepareCommand;
    return { ...command, reviewedPayloadHash: review.reviewedPayloadHash, approvalId: approval.approvalId };
  };
  return { ...h, root, compose, dependencies, published, registered, prepareCommand, pending, review, approve, executorInput };
}
module.exports = { controlledApprovedOrderHarness };
