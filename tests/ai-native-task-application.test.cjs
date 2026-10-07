'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composeAuthorizedReadonlyPersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
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
