'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composeAuthorizedReadonlyPersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition');
const { PrismaTaskTakeoverRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-takeover.repository');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const cancel = (h, root) => root.taskTransitions.transition({ taskId: 'task-a', expectedRevision: h.state.aiTask[0].revision, to: 'cancel_requested', reason: 'cancel_requested' });

// Real persisted authorization, result authority and runner; only storage, plan/input sources and executor are synthetic.
for (const mode of ['success', 'failure', 'lost_reply']) test(`cancellation during execution preserves the ${mode} receipt and settles without a new action`, async () => {
  const h = await authorizedRunnerHarness(), root = composeAuthorizedReadonlyPersistentTaskInputRunner(h.configuration());
  let lost = false;
  if (mode === 'lost_reply') h.storeControl.beforeCommit = async draft => {
    if (!lost && draft.aiTaskResultArtifact[0]?.completeMeasurement) { lost = true; h.storeControl.loseReply = true; }
  };
  h.control.execute = async () => {
    await cancel(h, root);
    return mode === 'failure' ? { kind: 'failed', errorCode: 'AI_BUSINESS_REJECTED', payload: { synthetic: 'rejected' } }
      : { kind: 'succeeded', payload: { synthetic: 'observed' } };
  };
  const result = await root.runner.run(h.claim());
  assert.equal(result.status, 'cancelled'); assert.equal(result.completedSteps, mode === 'failure' ? 0 : 1);
  assert.equal(h.state.aiTask[0].status, 'CANCELLED'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].status, mode === 'failure' ? 'FAILED' : 'SUCCEEDED');
  assert.equal(h.state.aiStep[0].resultRef, h.state.aiTaskResultArtifact[0].id);
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, true);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, h.state.aiTaskResultArtifact[0].outputBytes);
  if (mode === 'lost_reply') assert.equal(lost, true);
});

test('cancellation cannot turn an interrupted result into a settled cancellation or refund', async () => {
  const h = await authorizedRunnerHarness(), root = composeAuthorizedReadonlyPersistentTaskInputRunner(h.configuration());
  h.control.execute = async () => { await cancel(h, root); throw Error('synthetic unknown result'); };
  assert.equal((await root.runner.run(h.claim())).status, 'unknown');
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  const stepCharges = h.state.aiTaskExecutionCharge.filter(c => c.stepId === h.state.aiStep[0].id);
  assert.equal(stepCharges.length, 3); assert.ok(stepCharges.every(c => c.status === 'UNKNOWN'));
  const runCharges = h.state.aiTaskExecutionCharge.filter(c => c.stepId === null);
  assert.equal(runCharges.length, h.state.aiTaskRunOverhead.length);
  assert.equal(h.state.aiTaskExecutionCharge.length, stepCharges.length + runCharges.length);
  assert.ok(runCharges.every(c => c.resource === 'ACTIVE_MS' && c.status === 'RECORDED'
    && h.state.aiTaskRunOverhead.some(row => row.id === c.chargeId && row.completedAt && row.activeMs === c.actualAmount)));
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 1n);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.deepEqual(h.executions, ['input-clarify']);
});

test('cancellation followed by takeover still rejects the old worker late result and cleanup', async () => {
  const h = await authorizedRunnerHarness(), root = composeAuthorizedReadonlyPersistentTaskInputRunner(h.configuration());
  h.control.execute = async () => {
    await cancel(h, root); const old = h.held();
    await new PrismaTaskTakeoverRepository(h.db, root.authorization.authority, () => h.control.now).takeover({
      taskId: 'task-a', runId: 'run-a', previousHolderId: old.holderId, holderId: 'human-a', expectedTaskRevision: h.state.aiTask[0].revision,
      expectedRunRevision: old.revision, expectedFencingToken: old.fencingToken, leaseMs: 100000 });
    return { kind: 'succeeded', payload: { synthetic: 'late' } };
  };
  await assert.rejects(root.runner.run(h.claim()), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.equal(h.state.aiRun[0].leaseOwnerId, 'human-a');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.equal(h.state.aiStep[0].status, 'RUNNING'); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
  assert.deepEqual(h.executions, ['input-clarify']);
});

async function stoppedAfterCancellation(mode, keepTail = false) {
  const h = await authorizedRunnerHarness();
  if (!keepTail) {
    const saved = h.state.aiTaskRunPlan[0];
    saved.payload.steps = saved.payload.steps.slice(0, 1); saved.planHash = requestFingerprint(saved.payload);
  }
  const root = composeAuthorizedReadonlyPersistentTaskInputRunner(h.configuration());
  h.control.execute = async () => {
    await cancel(h, root);
    if (mode === 'unknown') throw Error('synthetic interrupted result');
    return mode === 'failure' ? { kind: 'failed', errorCode: 'AI_BUSINESS_REJECTED', payload: { synthetic: 'rejected' } }
      : { kind: 'succeeded', payload: { synthetic: 'observed' } };
  };
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && ['SUCCEEDED', 'FAILED'].includes(args.data?.status)
      || name === 'aiRun' && args.data?.leaseOwnerId === null) throw Error('synthetic stopped worker');
  };
  await assert.rejects(root.runner.run(h.claim()), e => e.code === 'AI_RESULT_UNKNOWN');
  h.storeControl.beforeWrite = null;
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, mode !== 'unknown');
  h.control.execute = async () => assert.fail('cancelled recovery must never execute again');
  const lease = { ...h.held(), purpose: 'recovery_only' };
  return { h, root, lease };
}

// Recovery's new local observation time is metered separately. It must not
// overwrite or refund the interrupted execution interval, or create a Step,
// invocation, result artifact or business action under a different identity.
function assertOriginalTimeAndObservation(h, before, lease, settled = true) {
  const timeIds = new Set(before.aiTaskRunOverhead.map(row => row.id));
  const chargeIds = new Set(before.aiTaskExecutionCharge.map(row => row.chargeId));
  assert.deepEqual(h.state.aiTaskRunOverhead.filter(row => timeIds.has(row.id)), before.aiTaskRunOverhead);
  assert.deepEqual(h.state.aiTaskExecutionCharge.filter(row => timeIds.has(row.chargeId)),
    before.aiTaskExecutionCharge.filter(row => timeIds.has(row.chargeId)));
  const observed = h.state.aiTaskExecutionCharge.filter(row => !chargeIds.has(row.chargeId));
  assert.ok(observed.length > 0);
  assert.ok(observed.every(row => row.resource === 'ACTIVE_MS' && row.stepId === null && row.actionId === null
    && row.stepFingerprint === null && row.gatewayInvocationId === null && row.taskId === lease.taskId
    && row.runId === lease.runId && row.leaseOwnerId === lease.holderId && row.fencingToken.toFixed(0) === lease.fencingToken
    && (settled ? row.status === 'RECORDED' && row.actualAmount > 0n : ['RECORDED', 'UNKNOWN'].includes(row.status))));
  const budget = h.state.aiTaskExecutionBudget[0];
  const time = h.state.aiTaskExecutionCharge.filter(row => row.resource === 'ACTIVE_MS');
  assert.equal(budget.reservedActiveMs, time.filter(row => row.status !== 'RECORDED').reduce((n, row) => n + row.amount, 0n));
  assert.equal(budget.consumedActiveMs, time.filter(row => row.status === 'RECORDED').reduce((n, row) => n + row.actualAmount, 0n));
  for (const field of ['policyVersion', 'policyFingerprint', 'maxSteps', 'maxCalls', 'maxActiveMs', 'maxOutputBytes']) {
    assert.deepEqual(budget[field], before.aiTaskExecutionBudget[0][field]);
  }
  assert.deepEqual(h.state.aiGatewayInvocation, before.aiGatewayInvocation);
}

for (const mode of ['success', 'failure', 'unknown']) test(`cancelled ${mode} recovery preserves original results and unresolved time without claiming again`, async () => {
  const { h, root, lease } = await stoppedAfterCancellation(mode);
  const before = h.clone(h.state);
  h.storeControl.beforeCommit = async () => { h.control.tick += 1; };
  const artifacts = h.clone(h.state.aiTaskResultArtifact), plans = h.clone(h.state.aiTaskRunPlan);
  const actionId = h.state.aiStep[0].actionId, chargeIds = h.state.aiTaskExecutionCharge.filter(c => c.stepId !== null).map(c => c.chargeId), start = h.trace.length;
  const result = await root.runner.recover(lease);
  assert.equal(result.status, mode === 'unknown' ? 'unknown' : 'unavailable');
  if (mode !== 'unknown') assert.equal(result.nextAction, 'manual_handoff');
  assert.equal(result.completedSteps, mode === 'success' ? 1 : 0);
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.state.aiStep[0].status, mode === 'unknown' ? 'RUNNING' : mode === 'success' ? 'SUCCEEDED' : 'FAILED');
  assert.equal(h.state.aiStep[0].effect, 'NONE'); assert.equal(h.state.aiStep.length, 1); assert.equal(h.state.aiStep[0].actionId, actionId);
  assert.equal(h.state.aiStep[0].resultRef, mode === 'unknown' ? null : artifacts[0].id);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), lease.fencingToken); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiTaskRunPlan, plans);
  const stepCharges = h.state.aiTaskExecutionCharge.filter(c => c.stepId !== null);
  assert.deepEqual(stepCharges.map(c => c.chargeId), chargeIds);
  assert.ok(stepCharges.every(c => c.status === (mode === 'unknown' ? 'UNKNOWN' : 'RECORDED')));
  assertOriginalTimeAndObservation(h, before, lease);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, mode === 'unknown' ? 0n : 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, mode === 'unknown' ? 1n : 0n);
  assert.equal(h.trace.slice(start).some(entry => /^(aiStep|aiTaskResultArtifact|aiTaskExecutionBudget)\.create$/u.test(entry)), false);
  assert.equal(h.state.operationLog.length, 0); assert.deepEqual(h.executions, ['input-clarify']);
  const page = await root.events.readPage({ taskId: 'task-a', after: '0', limit: 100 });
  assert.equal(page.events.filter(e => e.type === 'step.changed' && ['succeeded', 'failed'].includes(e.data.status)).length, mode === 'unknown' ? 0 : 1);
  assert.equal(page.events.filter(e => e.type === 'task.transition' && e.data.to === 'cancelled').length, 0);
});

test('cancelled recovery preserves a recovered result but does not invent an unregistered plan tail', async () => {
  const { h, root, lease } = await stoppedAfterCancellation('success', true);
  const before = h.clone(h.state), artifacts = h.clone(h.state.aiTaskResultArtifact);
  const chargeIds = h.state.aiTaskExecutionCharge.filter(c => c.stepId !== null).map(c => c.chargeId);
  assert.deepEqual(await root.runner.recover(lease), { status: 'unavailable', completedSteps: 1,
    cleanupFailed: 0, nextAction: 'manual_handoff' });
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].resultRef, artifacts[0].id);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), lease.fencingToken); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n);
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts);
  assert.deepEqual(h.state.aiTaskExecutionCharge.filter(c => c.stepId !== null).map(c => c.chargeId), chargeIds);
  assertOriginalTimeAndObservation(h, before, lease, false);
  assert.deepEqual(h.executions, ['input-clarify']);
  const snapshot = await root.recovery.read({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(snapshot.steps[0].status, 'succeeded'); assert.equal(snapshot.resources.counters.steps.consumed, '1');
});

test('cancelled recovery rejects changed original time provenance before reserving an observation', async () => {
  for (const [mutate, code] of [
    [h => { h.state.aiTaskRunOverhead.at(-1).originHash = '0'.repeat(64); }, 'AI_RESULT_UNKNOWN'],
    [h => { const row = h.state.aiTaskRunOverhead.at(-1);
      h.state.aiTaskExecutionCharge.find(charge => charge.chargeId === row.id).runId = 'other-run'; }, 'AI_RESULT_UNKNOWN'],
    [h => { h.state.aiTaskRunOverhead.at(-1).completedAt = new Date(h.control.now); }, 'AI_ACCESS_DENIED']
  ]) {
    const { h, root, lease } = await stoppedAfterCancellation('success'); mutate(h);
    const before = h.clone(h.state);
    await assert.rejects(root.runner.recover(lease), error => error.code === code);
    for (const table of ['aiStep', 'aiTaskResultArtifact', 'aiTaskExecutionCharge', 'aiTaskExecutionBudget', 'aiTaskRunOverhead']) {
      assert.deepEqual(h.state[table], before[table]);
    }
    assert.deepEqual(h.executions, ['input-clarify']);
  }
});

// Exercise the closed production reader too: the generic runner double above
// does not include its post-read execution-admission check. Storage and this
// bounded Core page are explicit offline substitutes, not native acceptance.
async function closedReadCancellation(mode) {
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { composePersistedReadonlyBusinessTaskHost } = require('../apps/api/src/modules/ai-native/runner/persisted-catalog-runner.composition');
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [] });
  h.state.aiTaskRunPlan.length = 0;
  h.state.aiTask[0].status = 'QUEUED'; h.state.aiRun[0].status = 'QUEUED';
  h.state.aiRun[0].leaseOwnerId = null; h.state.aiRun[0].leaseExpiresAt = null;
  h.identity.user.permissions.push('system:params:manage', 'rental-core:catalog:view');
  let root, reads = 0;
  root = composePersistedReadonlyBusinessTaskHost({ db: h.db, authorization: h.authorization,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    wall: () => new Date(h.control.now), monotonic: () => ++h.control.tick,
    core: { listItemGroupsPage: async tenantId => {
      reads++; assert.equal(tenantId, 'tenant-a'); assert.equal(getRequestIdentity().workspaceId, 'workspace-a');
      if (mode === 'cancel') await cancel(h, root);
      else h.identity.user.permissions = [];
      return { rows: [{ id: 'group-a', tenantId, categoryCode: 'CAMERA', code: 'group-a',
        name: 'Original observed item', status: 'enabled', unit: 'item' }], truncated: false, nextCursor: null,
        configurationVersion: 'c'.repeat(64), source: 'persisted_workspace_configuration' };
    } }, host: { holderId: 'closed-read-worker', leaseMs: 100000 },
    task: { taskId: 'task-a', runId: 'run-a', limits: h.plan.limits,
      steps: [{ registrationRef: 'catalog-original', toolCode: 'rental.catalog.search', input: { limit: 10 } }] },
    scene: { code: 'synthetic-clarification', version: '1' } });
  await root.policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: '2027-01-01T00:00:00Z' });
  return { h, root, reads: () => reads };
}

test('closed readonly composition preserves its completed Core result after cancellation without a new admission', async () => {
  const { h, root, reads } = await closedReadCancellation('cancel');
  const result = await root.application.start({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(result.outcome.status, 'cancelled'); assert.equal(result.outcome.completedSteps, 1);
  assert.equal(reads(), 1); assert.equal(h.state.aiTask[0].status, 'CANCELLED');
  assert.equal(h.state.aiRun[0].status, 'CANCELLED'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiStep.length, 1); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, true);
  assert.equal(h.state.aiTaskResultArtifact[0].payload.items[0].name, 'Original observed item');
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
});

test('closed readonly composition cannot begin a Core read after an existing cancel request', async () => {
  const { h, root, reads } = await closedReadCancellation('pre_cancel');
  await cancel(h, root);
  await Promise.allSettled([root.application.start({ taskId: 'task-a', runId: 'run-a' })]);
  assert.equal(reads(), 0); assert.equal(h.state.aiStep.length, 0);
  assert.equal(h.state.aiTaskResultArtifact.length, 0); assert.equal(h.state.aiTaskExecutionBudget.length, 0);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
});

test('closed readonly composition still refuses delivery and success when current read authority is revoked', async () => {
  const { h, root, reads } = await closedReadCancellation('revoked');
  await Promise.allSettled([root.application.start({ taskId: 'task-a', runId: 'run-a' })]);
  assert.equal(reads(), 1); assert.notEqual(h.state.aiTask[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskResultArtifact.filter(row => row.completeMeasurement).length, 0);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
});

test('an existing cancelled lease does not replace the current recovery permission', async () => {
  const { h, root, lease } = await stoppedAfterCancellation('success');
  h.state.aiTaskActionPolicy = h.state.aiTaskActionPolicy.filter(p => p.operation !== 'claim_recovery_run');
  const steps = h.clone(h.state.aiStep), artifacts = h.clone(h.state.aiTaskResultArtifact), charges = h.clone(h.state.aiTaskExecutionCharge);
  await assert.rejects(root.runner.recover(lease), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state.aiStep, steps); assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiTaskExecutionCharge, charges);
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 1n);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), lease.fencingToken); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.deepEqual(h.executions, ['input-clarify']);
});
