'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { PrismaTaskTakeoverRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-takeover.repository');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const runSettled = (h, root, extra) => Promise.allSettled([root.runner.run({ ...h.claim(), ...extra })]);
async function takeOver(h, root) {
  const old = h.held();
  const next = await new PrismaTaskTakeoverRepository(h.db, root.authorization.authority, () => h.control.now).takeover({
    taskId: 'task-a', runId: 'run-a', previousHolderId: old.holderId, holderId: 'human-a',
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: old.revision, expectedFencingToken: old.fencingToken, leaseMs: 100000
  });
  return { old, next };
}

for (const mode of ['permissions', 'platform', 'tenant', 'scene', 'subscription']) test(`real authorization stops the next effect after committed first success and ${mode} withdrawal`, async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(); let changed = false;
  h.storeControl.beforeCommit = async draft => {
    if (changed || draft.aiStep[0]?.status !== 'SUCCEEDED' || !draft.aiTaskExecutionCharge.length || !draft.aiTaskExecutionCharge.every(c => c.status === 'RECORDED')) return;
    changed = true;
    if (mode === 'permissions') h.identity.user.permissions = [];
    else if (mode === 'subscription') draft.tenant[0].subscription.endAt = h.control.now;
    else draft.aiBudgetPolicy[['platform', 'tenant', 'scene'].indexOf(mode)].enabled = false;
  };
  await runSettled(h, root);
  assert.equal(changed, true); assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.completeMeasurement).length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
});

test('ordinary persisted answers resume the original run with cumulative resources and current per-step authorization', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(); h.control.needsInput = true;
  assert.equal((await root.runner.run(h.claim())).status, 'paused');
  const before = h.clone(h.state.aiTaskExecutionBudget[0]), plan = h.clone(h.state.aiTaskRunPlan), originalRun = h.state.aiRun[0].id;
  h.control.now = new Date(h.control.now.getTime() + 60000);
  const receipt = await h.submit(root);
  assert.deepEqual(h.state.aiTaskExecutionBudget[0], before);
  h.control.execute = async input => {
    assert.equal(input.runId, originalRun); assert.equal(input.clarifications[0].receiptId, receipt.receiptId);
    return { kind: 'succeeded', payload: { synthetic: true } };
  };
  assert.equal((await h.compose().runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']); assert.deepEqual(h.state.aiTaskRunPlan, plan);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, before.consumedActiveMs + 10n);
  assert.equal(h.state.aiTaskInputReceipt.length, 1);
});

test('a consumed clarification is not new execution entitlement when AI is disabled', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(); h.control.needsInput = true;
  await root.runner.run(h.claim()); h.state.aiBudgetPolicy[0].enabled = false;
  const before = h.clone(h.state.aiTaskExecutionBudget[0]);
  assert.ok(await root.inputs.readPending('task-a'));
  const receipt = await h.submit(root);
  assert.equal((await h.submit(root)).receiptId, receipt.receiptId);
  await assert.rejects(root.runner.run(h.claim()));
  assert.deepEqual(h.state.aiTaskExecutionBudget[0], before); assert.deepEqual(h.executions, ['input-clarify']);
});

test('AI closes during actual consumed-input reading before the next effect', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(); h.control.needsInput = true;
  await root.runner.run(h.claim()); await h.submit(root); let changed = false;
  h.storeControl.beforeRead = async (name, _args, data) => {
    if (changed || name !== 'aiTaskInputReceipt' || data.aiStep[1]?.status !== 'RUNNING') return;
    await Promise.resolve(); changed = true; data.aiBudgetPolicy[0].enabled = false;
  };
  await runSettled(h, root);
  assert.equal(changed, true); assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiTaskInputReceipt.length, 1);
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.completeMeasurement).length, 1);
});

test('permissions revoked while persisted execution policies are read prevent the first executor', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(); let changed = false;
  h.storeControl.beforeRead = async name => {
    if (changed || name !== 'aiBudgetPolicy' || !h.state.aiTaskResultArtifact.length) return;
    await Promise.resolve(); changed = true; h.identity.user.permissions = [];
  };
  await runSettled(h, root);
  assert.equal(changed, true); assert.deepEqual(h.executions, []);
  assert.equal(h.state.aiTaskResultArtifact.some(a => a.completeMeasurement), false);
});

for (const mode of ['cancel', 'takeover']) test(`an actual ${mode} during execution authorization cannot dispatch the old holder`, { timeout: 10000 }, async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), entered = deferred(), release = deferred();
  const original = h.authorization.credentials.current; let blocked = false;
  h.authorization.credentials.current = async () => {
    const marker = h.trace.lastIndexOf('aiTaskResultArtifact.create');
    const outsideTransaction = h.trace.lastIndexOf('transaction.begin') < h.trace.lastIndexOf('transaction.commit');
    if (!blocked && marker >= 0 && outsideTransaction && h.trace.slice(marker).includes('aiBudgetPolicy.read')) {
      blocked = true; entered.resolve(); await release.promise;
    }
    return original();
  };
  const running = runSettled(h, root);
  await entered.promise;
  try {
    if (mode === 'cancel') await root.taskTransitions.transition({ taskId: 'task-a', expectedRevision: h.state.aiTask[0].revision, to: 'cancel_requested', reason: 'cancel_requested' });
    else await takeOver(h, root);
  } finally { release.resolve(); }
  await running;
  assert.deepEqual(h.executions, []);
  assert.equal(h.state.aiTaskResultArtifact.some(a => a.completeMeasurement), false);
  if (mode === 'takeover') assert.equal(h.state.aiRun[0].leaseOwnerId, 'human-a');
  else assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
});

test('takeover during an already-dispatched tool refuses late artifact and old-holder cleanup', { timeout: 10000 }, async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), entered = deferred(), release = deferred();
  h.control.execute = async () => { entered.resolve(); await release.promise; return { kind: 'succeeded', payload: { synthetic: 'late' } }; };
  const running = runSettled(h, root); await entered.promise;
  const { old } = await takeOver(h, root); release.resolve(); await running;
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiTaskResultArtifact.some(a => a.completeMeasurement), false);
  assert.equal(h.state.aiRun[0].leaseOwnerId, 'human-a');
  await assert.rejects(root.authorization.tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: old.holderId,
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: h.state.aiRun[0].revision, expectedFencingToken: old.fencingToken }));
});

async function completedArtifactBeforeStepCommit() {
  const h = await authorizedRunnerHarness(), root = h.compose();
  h.storeControl.beforeWrite = async (name, args) => { if (name === 'aiStep' && args.data?.status === 'SUCCEEDED') throw Error('synthetic step commit failure'); };
  await runSettled(h, root); h.storeControl.beforeWrite = null;
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, true);
  // An uncertain step acknowledgement deliberately keeps the live holder.
  // Only expiry permits reclaiming its lease; it does not prove rollback or
  // authorize re-executing the tool. Recovery still consumes the original artifact.
  assert.equal(h.state.aiRun[0].leaseOwnerId, 'worker-a');
  await assert.rejects(root.runner.run({ ...h.claim(), recovery: true }), error => error.code === 'AI_REVISION_CONFLICT');
  h.control.now = new Date(h.state.aiRun[0].leaseExpiresAt);
  return { h, root };
}

test('recovery-only claim reconciles a committed artifact without registering or dispatching remaining new work', async () => {
  const { h, root } = await completedArtifactBeforeStepCommit();
  const artifact = h.clone(h.state.aiTaskResultArtifact);
  await runSettled(h, root, { recovery: true });
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.deepEqual(h.state.aiTaskResultArtifact, artifact);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
});

test('AI-off recovery still reads and accounts a committed artifact without a new execution grant', async () => {
  const { h, root } = await completedArtifactBeforeStepCommit(); h.state.aiBudgetPolicy[0].enabled = false;
  await runSettled(h, root, { recovery: true });
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal((await root.authorization.tasks.readMetadata('task-a')).status, 'running');
});

test('formal input receipt transaction rolls back before commit and replays a lost commit response without dispatch', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(); h.control.needsInput = true;
  await root.runner.run(h.claim()); const before = h.clone(h.state);
  h.storeControl.beforeWrite = async name => { if (name === 'aiTaskEvent') throw Error('synthetic event failure'); };
  await assert.rejects(h.submit(root)); assert.deepEqual(h.state, before);
  h.storeControl.beforeWrite = null; h.storeControl.loseReply = true;
  await assert.rejects(h.submit(root)); assert.equal(h.state.aiTaskInputReceipt.length, 1);
  assert.equal((await h.submit(h.compose())).replayed, true);
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal((await h.compose().runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
});
