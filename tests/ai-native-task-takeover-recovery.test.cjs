'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

// Real authorization, takeover, runner and repositories; storage and executor facts are synthetic.
async function interrupted(complete = true) {
  const h = await authorizedRunnerHarness();
  const saved = h.state.aiTaskRunPlan[0]; saved.payload.steps = saved.payload.steps.slice(0, 1); saved.planHash = requestFingerprint(saved.payload);
  const root = h.compose();
  if (!complete) h.control.execute = async () => { throw Error('synthetic interrupted response'); };
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && args.data?.status === 'SUCCEEDED' || name === 'aiRun' && args.data?.leaseOwnerId === null) throw Error('synthetic stopped worker');
  };
  await assert.rejects(root.runner.run(h.claim())); h.storeControl.beforeWrite = null;
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, complete); assert.deepEqual(h.executions, ['input-clarify']);
  h.control.execute = async () => assert.fail('takeover recovery must not execute');
  const lease = h.held();
  const command = { taskId: lease.taskId, runId: lease.runId, previousHolderId: lease.holderId, holderId: 'human-a',
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken, leaseMs: 100000 };
  return { h, root, lease, command };
}

test('takeover consumes its current lease to recover the original artifact without a second claim', async () => {
  const { h, root, lease, command } = await interrupted();
  const artifact = h.clone(h.state.aiTaskResultArtifact), actionId = h.state.aiStep[0].actionId, charges = h.state.aiTaskExecutionCharge.map(c => c.chargeId);
  assert.equal((await root.takeoverAndRecover(command)).status, 'succeeded');
  assert.equal(h.state.operationLog.length, 1); assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), String(BigInt(lease.fencingToken) + 1n));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.equal(h.state.aiTask[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n); assert.equal(h.state.aiStep[0].actionId, actionId);
  assert.deepEqual(h.state.aiTaskResultArtifact, artifact); assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), charges);
  assert.deepEqual(h.executions, ['input-clarify']);
});

test('unjudgeable original result remains unknown after takeover without new output or charges', async () => {
  const { h, root, command } = await interrupted(false), before = h.clone(h.state.aiTaskResultArtifact);
  assert.equal((await root.takeoverAndRecover(command)).status, 'unknown');
  assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL'); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'UNKNOWN'));
  assert.deepEqual(h.state.aiTaskResultArtifact, before); assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
});

test('competing takeover-and-recover requests have one winner and one accounting result', async () => {
  const { h, root, command } = await interrupted();
  const results = await Promise.allSettled([root.takeoverAndRecover(command), root.takeoverAndRecover({ ...command, holderId: 'human-b' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled' && r.value.status === 'succeeded').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'AI_REVISION_CONFLICT').length, 1);
  assert.equal(h.state.operationLog.length, 1); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.deepEqual(h.executions, ['input-clarify']);
});

test('takeover permission cannot replace the separate current recovery policy', async () => {
  const { h, root, command } = await interrupted();
  h.state.aiTaskActionPolicy = h.state.aiTaskActionPolicy.filter(p => p.operation !== 'claim_recovery_run');
  await assert.rejects(root.takeoverAndRecover(command), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.operationLog.length, 1); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n); assert.deepEqual(h.executions, ['input-clarify']);
});

for (const timing of ['before', 'after']) test(`host interruption ${timing} takeover cannot dispatch or strand an acknowledged lease`, async () => {
  const { h, root, command } = await interrupted(), controller = new AbortController();
  if (timing === 'before') controller.abort();
  else h.storeControl.beforeCommit = async draft => { if (draft.operationLog.length) controller.abort(); };
  assert.equal((await root.takeoverAndRecover(command, controller.signal)).status, 'unavailable');
  assert.equal(h.state.operationLog.length, timing === 'before' ? 0 : 1);
  assert.equal(h.state.aiRun[0].leaseOwnerId, timing === 'before' ? command.previousHolderId : null);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n); assert.deepEqual(h.executions, ['input-clarify']);
});
