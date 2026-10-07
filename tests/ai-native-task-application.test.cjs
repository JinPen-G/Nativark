'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composeAuthorizedReadonlyPersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
const query = { taskId: 'task-a', runId: 'run-a' }, host = { holderId: 'application-worker', leaseMs: 100000 };
const noWrites = (h, start) => assert.equal(h.trace.slice(start).some(entry => /\.(create|update|upsert)$/u.test(entry) || entry === 'row.lock'), false);
async function make(status = 'QUEUED') {
  const h = await authorizedRunnerHarness(); h.state.aiTask[0].status = status;
  const root = composeAuthorizedReadonlyPersistentTaskInputRunner(h.configuration());
  return { h, root, app: root.createApplication(host) };
}

// Production authorization/application/runner/repositories; storage, initial plan/input and tool responses are synthetic.
for (const status of ['QUEUED', 'RUNNING']) test(`application starts an existing ${status} task from stored revisions and its server-bound holder`, async () => {
  const { h, root, app } = await make(status), plan = h.clone(h.state.aiTaskRunPlan), originalFence = h.state.aiRun[0].fencingToken;
  const result = await app.start(query);
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'succeeded'); assert.equal(result.outcome.completedSteps, 2);
  assert.equal(h.state.aiTask[0].status, 'SUCCEEDED'); assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), originalFence.add(1).toFixed(0));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n); assert.equal(h.state.aiStep.length, 2);
  assert.deepEqual(h.state.aiTaskRunPlan, plan); assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.ok(h.state.aiTaskResultArtifact.every(a => a.leaseOwnerId === host.holderId && a.completeMeasurement));
  const page = await root.events.readPage({ taskId: 'task-a', after: '0', limit: 100 });
  assert.equal(page.events.filter(e => e.type === 'task.transition' && e.data.reason === 'start').length, status === 'QUEUED' ? 1 : 0);
  if (status === 'QUEUED') assert.equal(page.events[0].data.reason, 'start');
  const before = h.clone(h.state), trace = h.trace.length;
  await assert.rejects(app.start(query), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, before); noWrites(h, trace);
});

for (const mode of ['absent', 'empty']) test(`a ${mode} persisted plan leaves the task unstarted without a claim or fabricated rows`, async () => {
  const { h, app } = await make();
  if (mode === 'absent') h.state.aiTaskRunPlan = [];
  else { const saved = h.state.aiTaskRunPlan[0]; saved.payload.steps = []; saved.planHash = requestFingerprint(saved.payload); }
  const before = h.clone(h.state), trace = h.trace.length;
  assert.deepEqual(await app.start(query), { kind: 'not_started', reason: 'plan_unavailable' });
  assert.deepEqual(h.state, before); noWrites(h, trace); assert.deepEqual(h.executions, []);
});

test('application input cannot supply a holder, revisions, fence, plan or authority', async () => {
  const { h, app, root } = await make(), trace = h.trace.length;
  for (const key of ['holderId', 'expectedTaskRevision', 'expectedRunRevision', 'expectedFencingToken', 'recovery', 'plan', 'authorization']) {
    await assert.rejects(app.start({ ...query, [key]: 'caller-value' }), e => e.code === 'AI_INVALID_INPUT');
  }
  assert.throws(() => root.createApplication(undefined), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => root.createApplication({ ...host, leaseMs: 120001 }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  noWrites(h, trace); assert.deepEqual(h.executions, []);
});

test('an invisible task or foreign run cannot be claimed through the application', async () => {
  const { h, app } = await make(), before = h.clone(h.state), trace = h.trace.length;
  await assert.rejects(app.start({ ...query, runId: 'foreign-run' }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  h.identity.workspace = 'workspace-b';
  await assert.rejects(app.start(query), e => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE'].includes(e.code));
  assert.deepEqual(h.state, before); noWrites(h, trace); assert.deepEqual(h.executions, []);
});

for (const status of ['WAITING_INPUT', 'WAITING_CONFIRMATION', 'WAITING_EXTERNAL', 'CANCEL_REQUESTED']) test(`start cannot implicitly resume ${status}`, async () => {
  const { h, app } = await make(status); if (status === 'CANCEL_REQUESTED') h.state.aiTask[0].cancelRequestedAt = h.control.now;
  const before = h.clone(h.state), trace = h.trace.length;
  await assert.rejects(app.start(query), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, before); noWrites(h, trace); assert.deepEqual(h.executions, []);
});

test('a live holder cannot be adopted or displaced by start', async () => {
  const { h, app } = await make();
  h.state.aiRun[0].leaseOwnerId = 'other-worker'; h.state.aiRun[0].leaseExpiresAt = new Date(h.control.now.getTime() + 50000);
  const before = h.clone(h.state), trace = h.trace.length;
  assert.deepEqual(await app.start(query), { kind: 'not_started', reason: 'lease_held' });
  assert.deepEqual(h.state, before); noWrites(h, trace); assert.deepEqual(h.executions, []);
});

for (const mode of ['closed', 'revoked_during_read']) test(`current authority ${mode} prevents application dispatch`, async () => {
  const { h, app } = await make(), before = h.clone(h.state), trace = h.trace.length;
  if (mode === 'closed') h.state.aiBudgetPolicy[0].enabled = false;
  else h.storeControl.beforeRead = async name => { if (name === 'aiTaskRunPlan') h.identity.membership = false; };
  await assert.rejects(app.start(query), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), before.aiRun[0].fencingToken.toFixed(0));
  assert.equal(h.state.aiTask[0].status, 'QUEUED'); noWrites(h, trace); assert.deepEqual(h.executions, []);
});

test('stale claim inputs fail CAS without retrying or falling back to a different lease', async () => {
  const { h, app } = await make(); let attempts = 0;
  h.storeControl.beforeWrite = async (name, args, data) => {
    if (name === 'aiRun' && args.data?.leaseOwnerId === host.holderId) { attempts++; data.aiRun[0].revision++; }
  };
  await assert.rejects(app.start(query), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal(attempts, 1); assert.equal(h.state.aiTask[0].status, 'QUEUED'); assert.equal(h.state.aiStep.length, 0);
  assert.deepEqual(h.executions, []);
});

for (const phase of ['claim', 'start_transition']) test(`an uncertain ${phase} acknowledgement is not reported as not_started or blindly retried`, async () => {
  const { h, app } = await make(); let attempts = 0;
  if (phase === 'claim') {
    const update = h.db.aiRun.updateMany;
    h.db.aiRun.updateMany = async args => {
      const result = await update(args);
      if (args.data?.leaseOwnerId === host.holderId) { attempts++; throw Error('synthetic lost claim reply'); }
      return result;
    };
  } else h.storeControl.beforeCommit = async draft => {
    if (draft.aiTask[0].status === 'RUNNING' && !draft.aiStep.length) { attempts++; h.storeControl.loseReply = true; }
  };
  await assert.rejects(app.start(query), e => e.code === 'AI_STORAGE_UNAVAILABLE');
  assert.equal(attempts, 1); assert.equal(h.state.aiTask[0].status, phase === 'claim' ? 'QUEUED' : 'RUNNING');
  assert.equal(h.state.aiRun[0].leaseOwnerId, host.holderId); assert.equal(h.state.aiStep.length, 0);
  assert.deepEqual(h.executions, []);
});

for (const timing of ['before', 'during_preflight']) test(`host abort ${timing} leaves the existing task unstarted`, async () => {
  const { h, app } = await make(), controller = new AbortController(), before = h.clone(h.state), trace = h.trace.length;
  if (timing === 'before') controller.abort();
  else h.storeControl.beforeRead = async name => { if (name === 'aiTaskRunPlan') controller.abort(); };
  assert.deepEqual(await app.start(query, controller.signal), { kind: 'not_started', reason: 'host_aborted' });
  assert.deepEqual(h.state, before); noWrites(h, trace); assert.deepEqual(h.executions, []);
});

async function waiting() {
  const { h, root, app } = await make(); h.control.needsInput = true;
  assert.equal((await app.start(query)).outcome.status, 'paused');
  const pending = await app.readInput({ taskId: query.taskId });
  const submission = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: query.taskId, requestId: pending.requestId,
    expectedRevision: pending.revision, submissionKey: 'application-answer', answers: [{ fieldId: 'clarification_text', value: 'Explain only' }] };
  return { h, root, app, submission };
}
const noMutations = (h, trace) => assert.equal(h.trace.slice(trace).some(entry => /\.(create|update|upsert)$/u.test(entry)), false);

test('application resume consumes the original clarification receipt and continues once with cumulative accounting', async () => {
  const { h, app, submission } = await waiting(), original = h.clone(h.state.aiTaskResultArtifact[0]), seen = [];
  h.control.execute = async binding => { seen.push(binding); return { kind: 'succeeded', payload: { synthetic: 'continued' } }; };
  const result = await app.resume(submission);
  assert.equal(result.receipt.status, 'input_received'); assert.equal(result.receipt.replayed, false);
  assert.equal(result.continuation.kind, 'run_outcome'); assert.equal(result.continuation.outcome.status, 'succeeded');
  assert.deepEqual(h.state.aiTaskResultArtifact[0], original); assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n);
  assert.equal(h.state.aiTaskInputReceipt.length, 1); assert.equal(h.state.aiTaskInputRequest[0].status, 'CONSUMED');
  assert.equal(seen[0].clarifications[0].receiptId, result.receipt.receiptId); assert.deepEqual(seen[0].clarifications[0].answers, submission.answers);
  const before = h.clone(h.state), trace = h.trace.length, replay = await app.resume(submission);
  assert.equal(replay.receipt.receiptId, result.receipt.receiptId); assert.equal(replay.receipt.replayed, true);
  assert.deepEqual(replay.continuation, { kind: 'not_started', reason: 'receipt_replayed' });
  assert.deepEqual(h.state, before); noMutations(h, trace);
  await assert.rejects(app.resume({ ...submission, answers: [{ fieldId: 'clarification_text', value: 'Different' }] }), e => e.code === 'AI_REVISION_CONFLICT');
  assert.deepEqual(h.state, before); assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
});

for (const mode of ['old_revision', 'revoked', 'cancelled', 'ordinary_chat']) test(`application resume rejects ${mode} without a new execution`, async () => {
  const { h, app, root, submission } = await waiting();
  if (mode === 'revoked') h.identity.membership = false;
  if (mode === 'cancelled') await root.taskTransitions.transition({ taskId: query.taskId, expectedRevision: h.state.aiTask[0].revision, to: 'cancel_requested', reason: 'cancel_requested' });
  const before = h.clone(h.state), trace = h.trace.length;
  await assert.rejects(app.resume(mode === 'old_revision' ? { ...submission, expectedRevision: 2 }
    : mode === 'ordinary_chat' ? { taskId: query.taskId, message: 'yes, go ahead' } : submission), e => e.code === (mode === 'revoked'
      ? 'AI_ACCESS_DENIED' : mode === 'ordinary_chat' ? 'AI_INVALID_INPUT' : 'AI_REVISION_CONFLICT'));
  assert.deepEqual(h.state, before); noMutations(h, trace); assert.deepEqual(h.executions, ['input-clarify']);
});

test('application resume retains input acceptance when AI execution is closed, and replay cannot relaunch it', async () => {
  const { h, app, submission } = await waiting(); h.state.aiBudgetPolicy[0].enabled = false;
  const result = await app.resume(submission);
  assert.equal(result.receipt.replayed, false); assert.equal(h.state.aiTask[0].status, 'RUNNING');
  assert.deepEqual(result.continuation, { kind: 'unavailable', errorCode: 'AI_ACCESS_DENIED' });
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  h.state.aiBudgetPolicy[0].enabled = true;
  assert.equal((await app.resume(submission)).continuation.reason, 'receipt_replayed');
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal((await app.start(query)).outcome.status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
});

test('application resume does not execute after an unknown submission acknowledgement or its later receipt replay', async () => {
  const { h, app, submission } = await waiting(); let lost = false;
  h.storeControl.beforeCommit = async draft => { if (!lost && draft.aiTaskInputReceipt.length) { lost = true; h.storeControl.loseReply = true; } };
  await assert.rejects(app.resume(submission), e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false);
  assert.equal(lost, true); h.storeControl.beforeCommit = null;
  const before = h.clone(h.state), trace = h.trace.length, replay = await app.resume(submission);
  assert.equal(replay.receipt.replayed, true); assert.equal(replay.continuation.reason, 'receipt_replayed');
  assert.deepEqual(h.state, before); noMutations(h, trace); assert.deepEqual(h.executions, ['input-clarify']);
});

test('application resume host abort suppresses continuation without discarding the explicitly submitted answer', async () => {
  const { h, app, submission } = await waiting(), controller = new AbortController(); controller.abort();
  const result = await app.resume(submission, controller.signal);
  assert.equal(result.receipt.status, 'input_received'); assert.equal(result.receipt.replayed, false);
  assert.deepEqual(result.continuation, { kind: 'not_started', reason: 'host_aborted' });
  assert.equal(h.state.aiTaskInputReceipt.length, 1); assert.equal(h.state.aiTask[0].status, 'RUNNING');
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
});

test('application resume withholds buffered receipt after membership is revoked at the input commit', async () => {
  const { h, app, submission } = await waiting();
  h.storeControl.beforeCommit = async draft => { if (draft.aiTaskInputReceipt.length) h.identity.membership = false; };
  await assert.rejects(app.resume(submission), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskInputReceipt.length, 1); assert.deepEqual(h.executions, ['input-clarify']);
});

test('application resume preserves the receipt but marks an uncertain continuation claim unavailable, not unstarted', async () => {
  const { h, app, submission } = await waiting(), update = h.db.aiRun.updateMany; let claims = 0;
  h.db.aiRun.updateMany = async args => {
    const result = await update(args);
    if (args.data?.leaseOwnerId === host.holderId) { claims++; throw Error('synthetic lost continuation claim reply'); }
    return result;
  };
  const result = await app.resume(submission);
  assert.equal(result.receipt.status, 'input_received'); assert.deepEqual(result.continuation, { kind: 'unavailable', errorCode: 'AI_STORAGE_UNAVAILABLE' });
  assert.equal(claims, 1); assert.equal(h.state.aiRun[0].leaseOwnerId, host.holderId); assert.deepEqual(h.executions, ['input-clarify']);
});

test('application reads existing snapshots, bounded wire events and input contracts without execution rights or a lease', async () => {
  const { h, app } = await waiting(); h.state.aiBudgetPolicy[0].enabled = false;
  const before = h.clone(h.state), trace = h.trace.length;
  assert.equal((await app.inspect(query)).steps[0].status, 'succeeded');
  const page = await app.readEvents({ taskId: query.taskId, after: '0', limit: 1 });
  assert.equal(page.events.length, 1); assert.equal(page.hasMore, true); assert.equal(JSON.stringify(page).includes('initiator'), false);
  assert.equal((await app.readInput({ taskId: query.taskId })).contract.code, 'synthetic-clarification');
  assert.deepEqual(h.state, before); noMutations(h, trace);
  await assert.rejects(app.readEvents({ taskId: query.taskId, after: '0', limit: 101 }), e => e.code === 'AI_INVALID_INPUT');
  h.state.aiTaskActionPolicy = h.state.aiTaskActionPolicy.filter(p => p.operation !== 'read_step_terminal');
  await assert.rejects(app.inspect(query), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal((await app.readEvents({ taskId: query.taskId, after: page.nextCursor, limit: 1 })).events.length, 1);
  h.state.aiTaskActionPolicy = h.state.aiTaskActionPolicy.filter(p => p.operation !== 'read_events');
  await assert.rejects(app.readEvents({ taskId: query.taskId, after: '0', limit: 1 }), e => e.code === 'AI_ACCESS_DENIED');
});

for (const complete of [true, false]) test(`application reconcile uses its held lease and original ${complete ? 'complete' : 'unknown'} evidence without claiming`, async () => {
  const { h, app } = await make(), saved = h.state.aiTaskRunPlan[0];
  saved.payload.steps = saved.payload.steps.slice(0, 1); saved.planHash = requestFingerprint(saved.payload);
  if (!complete) h.control.execute = async () => { throw Error('synthetic interrupted result'); };
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && args.data?.status === 'SUCCEEDED' || name === 'aiRun' && args.data?.leaseOwnerId === null) throw Error('synthetic stopped worker');
  };
  await assert.rejects(app.start(query), e => e.code === 'AI_STORAGE_UNAVAILABLE'); h.storeControl.beforeWrite = null;
  const fence = h.state.aiRun[0].fencingToken.toFixed(0), artifacts = h.clone(h.state.aiTaskResultArtifact), charges = h.state.aiTaskExecutionCharge.map(c => c.chargeId);
  const result = await app.reconcile(query);
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, complete ? 'succeeded' : 'unknown');
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), fence); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), charges);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, complete ? 1n : 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, complete ? 0n : 1n); assert.deepEqual(h.executions, ['input-clarify']);
});

for (const holder of [null, 'another-worker']) test(`application reconcile cannot acquire or adopt ${holder ?? 'a released lease'}`, async () => {
  const { h, app } = await waiting();
  if (holder) { h.state.aiRun[0].leaseOwnerId = holder; h.state.aiRun[0].leaseExpiresAt = new Date(h.control.now.getTime() + 50000); }
  const before = h.clone(h.state), trace = h.trace.length;
  assert.deepEqual(await app.reconcile(query), { kind: 'not_started', reason: 'recovery_lease_unavailable' });
  await assert.rejects(app.reconcile({ ...query, holderId: holder ?? host.holderId }), e => e.code === 'AI_INVALID_INPUT');
  assert.deepEqual(h.state, before); noMutations(h, trace);
});
