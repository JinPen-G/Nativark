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
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'UNKNOWN'));
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
  await assert.rejects(root.runner.run(h.claim()), e => e.code === 'AI_STORAGE_UNAVAILABLE');
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
  await assert.rejects(root.runner.run(h.claim()), e => e.code === 'AI_STORAGE_UNAVAILABLE');
  h.storeControl.beforeWrite = null;
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, mode !== 'unknown');
  h.control.execute = async () => assert.fail('cancelled recovery must never execute again');
  const lease = { ...h.held(), purpose: 'recovery_only' };
  return { h, root, lease };
}

for (const mode of ['success', 'failure', 'unknown']) test(`cancelled ${mode} recovery consumes the held lease and original evidence without claiming again`, async () => {
  const { h, root, lease } = await stoppedAfterCancellation(mode);
  const artifacts = h.clone(h.state.aiTaskResultArtifact), plans = h.clone(h.state.aiTaskRunPlan);
  const actionId = h.state.aiStep[0].actionId, chargeIds = h.state.aiTaskExecutionCharge.map(c => c.chargeId), start = h.trace.length;
  const result = await root.runner.recover(lease);
  assert.equal(result.status, mode === 'unknown' ? 'unknown' : 'cancelled');
  assert.equal(result.completedSteps, mode === 'success' ? 1 : 0);
  assert.equal(h.state.aiTask[0].status, mode === 'unknown' ? 'CANCEL_REQUESTED' : 'CANCELLED');
  assert.equal(h.state.aiStep[0].status, mode === 'unknown' ? 'RUNNING' : mode === 'success' ? 'SUCCEEDED' : 'FAILED');
  assert.equal(h.state.aiStep[0].effect, 'NONE'); assert.equal(h.state.aiStep.length, 1); assert.equal(h.state.aiStep[0].actionId, actionId);
  assert.equal(h.state.aiStep[0].resultRef, mode === 'unknown' ? null : artifacts[0].id);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), lease.fencingToken); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiTaskRunPlan, plans);
  assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), chargeIds);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === (mode === 'unknown' ? 'UNKNOWN' : 'RECORDED')));
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, mode === 'unknown' ? 0n : 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, mode === 'unknown' ? 1n : 0n);
  assert.equal(h.trace.slice(start).some(entry => /^(aiStep|aiTaskResultArtifact|aiTaskExecutionCharge|aiTaskExecutionBudget)\.create$/u.test(entry)), false);
  assert.equal(h.state.operationLog.length, 0); assert.deepEqual(h.executions, ['input-clarify']);
  const page = await root.events.readPage({ taskId: 'task-a', after: '0', limit: 100 });
  assert.equal(page.events.filter(e => e.type === 'step.changed' && ['succeeded', 'failed'].includes(e.data.status)).length, mode === 'unknown' ? 0 : 1);
  assert.equal(page.events.filter(e => e.type === 'task.transition' && e.data.to === 'cancelled').length, mode === 'unknown' ? 0 : 1);
});

test('cancelled recovery preserves a recovered result but does not invent an unregistered plan tail', async () => {
  const { h, root, lease } = await stoppedAfterCancellation('success', true);
  const artifacts = h.clone(h.state.aiTaskResultArtifact), chargeIds = h.state.aiTaskExecutionCharge.map(c => c.chargeId);
  await assert.rejects(root.runner.recover(lease), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED'); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].resultRef, artifacts[0].id);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), lease.fencingToken); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n);
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), chargeIds);
  assert.deepEqual(h.executions, ['input-clarify']);
  const snapshot = await root.recovery.read({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(snapshot.steps[0].status, 'succeeded'); assert.equal(snapshot.resources.counters.steps.consumed, '1');
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
