'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composeAuthorizedReadonlyPersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition');
const { PrismaTaskTakeoverRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-takeover.repository');
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
