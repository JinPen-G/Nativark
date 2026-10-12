'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composeAuthorizedReadonlyPersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition');
const query = { taskId: 'task-a', runId: 'run-a' };
const noWrites = (h, start) => assert.equal(h.trace.slice(start).some(entry => /\.(create|update|upsert)$/u.test(entry) || entry === 'row.lock'), false);
const make = async () => { const h = await authorizedRunnerHarness(); return { h, root: composeAuthorizedReadonlyPersistentTaskInputRunner(h.configuration()) }; };

// Real current authorization, runner, result authority and reader; only storage/plan/input/executor facts are synthetic.
test('released partial work exposes original results, task-wide counters and existing wire events without claiming or writing', async () => {
  const { h, root } = await make(), controller = new AbortController();
  h.storeControl.beforeCommit = async draft => {
    if (draft.aiTaskExecutionCharge.length && draft.aiTaskExecutionCharge.every(c => c.status === 'RECORDED')) controller.abort();
  };
  assert.equal((await root.runner.run(h.claim(), controller.signal)).status, 'unavailable');
  h.storeControl.beforeCommit = null;
  const before = h.clone(h.state), start = h.trace.length;
  const snapshot = await root.recovery.read(query);
  assert.equal(snapshot.task.status, 'running'); assert.equal(snapshot.task.eventCursor, h.state.aiTask[0].eventCursor.toString());
  assert.equal(snapshot.run.fencingToken, h.state.aiRun[0].fencingToken.toFixed(0)); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(snapshot.steps.length, 1); assert.equal(snapshot.steps[0].status, 'succeeded'); assert.equal(snapshot.steps[0].effect, 'none');
  assert.equal(snapshot.steps[0].actionId, h.state.aiStep[0].actionId); assert.equal(snapshot.steps[0].resultRef, h.state.aiTaskResultArtifact[0].id);
  assert.equal(snapshot.steps[0].artifacts[0].completeMeasurement, true);
  assert.deepEqual(snapshot.steps[0].charges.map(c => c.chargeId).sort(), h.state.aiTaskExecutionCharge.map(c => c.chargeId).sort());
  assert.equal(snapshot.resources.counters.steps.consumed, '1'); assert.equal(snapshot.resources.counters.steps.reserved, '0');
  for (const [resource, field] of [['calls', 'Calls'], ['active_ms', 'ActiveMs'], ['output_bytes', 'OutputBytes']]) {
    assert.equal(snapshot.resources.counters[resource].consumed, h.state.aiTaskExecutionBudget[0][`consumed${field}`].toString());
    assert.equal(snapshot.resources.counters[resource].reserved, h.state.aiTaskExecutionBudget[0][`reserved${field}`].toString());
  }
  const page = await root.events.readPage({ taskId: 'task-a', after: '0', limit: 100 });
  assert.equal(page.nextCursor, snapshot.task.eventCursor); assert.ok(page.events.some(e => e.type === 'step.changed' && e.data.status === 'succeeded'));
  assert.equal(JSON.stringify({ snapshot, page }).includes('"payload"'), false);
  assert.equal(JSON.stringify(page).includes('"initiator"'), false);
  assert.deepEqual(h.state, before); noWrites(h, start); assert.deepEqual(h.executions, ['input-clarify']);
});

test('terminal payload requires the step original result reference and unknown payload stays hidden', async () => {
  const { h, root } = await make();
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  const artifact = h.state.aiTaskResultArtifact[0], step = h.state.aiStep[0];
  const input = { taskId: 'task-a', resultId: artifact.id };
  assert.equal((await root.results.read(input)).status, 'succeeded');
  const reference = step.resultRef;
  step.resultRef = null;
  await assert.rejects(root.results.read(input), e => e.code === 'AI_STORAGE_UNAVAILABLE');
  step.resultRef = reference;
  artifact.completeMeasurement = false;
  const unknown = await root.results.read(input);
  assert.equal(unknown.status, 'unknown'); assert.equal(unknown.payload, null);
  artifact.completeMeasurement = true; artifact.outcome = 'UNKNOWN'; step.status = 'UNKNOWN';
  assert.equal((await root.results.read(input)).payload, null, 'unknown cannot become a result through a measurement flag');
});

test('an incomplete artifact remains running and unknown occupied resources stay reserved in the read model', async () => {
  const { h, root } = await make(); h.control.execute = async () => { throw Error('synthetic interrupted result'); };
  assert.equal((await root.runner.run(h.claim())).status, 'unknown');
  const before = h.clone(h.state), start = h.trace.length, snapshot = await root.recovery.read(query);
  assert.equal(snapshot.task.status, 'waiting_external'); assert.equal(snapshot.steps[0].status, 'running');
  assert.equal(snapshot.steps[0].resultRef, null); assert.equal(snapshot.steps[0].artifacts[0].completeMeasurement, false);
  assert.ok(snapshot.steps[0].charges.every(c => c.status === 'unknown' && c.actualAmount === null));
  assert.equal(snapshot.resources.counters.steps.consumed, '0'); assert.equal(snapshot.resources.counters.steps.reserved, '1');
  assert.deepEqual(h.state, before); noWrites(h, start); assert.deepEqual(h.executions, ['input-clarify']);
});

test('completed measurement before a refused step commit is visible without falsely publishing terminal step success', async () => {
  const { h, root } = await make();
  h.storeControl.beforeWrite = async (name, args) => { if (name === 'aiStep' && args.data?.status === 'SUCCEEDED') throw Error('synthetic refused step commit'); };
  await assert.rejects(root.runner.run(h.claim())); h.storeControl.beforeWrite = null;
  const before = h.clone(h.state), start = h.trace.length, snapshot = await root.recovery.read(query);
  assert.equal(snapshot.steps[0].status, 'running'); assert.equal(snapshot.steps[0].resultRef, null);
  assert.equal(snapshot.steps[0].artifacts[0].outcome, 'succeeded'); assert.equal(snapshot.steps[0].artifacts[0].completeMeasurement, true);
  assert.equal(snapshot.resources.counters.steps.consumed, '0'); assert.equal(snapshot.resources.counters.steps.reserved, '1');
  assert.deepEqual(h.state, before); noWrites(h, start);
});

test('no budget or steps is absence, not zero accounting or permission to dispatch', async () => {
  const { h, root } = await make(), before = h.clone(h.state), start = h.trace.length;
  const snapshot = await root.recovery.read(query);
  assert.equal(snapshot.resources, null); assert.deepEqual(snapshot.steps, []); assert.equal(snapshot.plan.planHash, h.state.aiTaskRunPlan[0].planHash);
  await assert.rejects(root.recovery.read({ ...query, holderId: 'new-worker' }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(root.recovery.read({ ...query, runId: 'foreign-run' }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(h.state, before); noWrites(h, start); assert.deepEqual(h.executions, []);
});

test('AI closure does not erase already-observed cancellation receipts or replace the independent read permission', async () => {
  const { h, root } = await make();
  h.control.execute = async () => {
    await root.taskTransitions.transition({ taskId: 'task-a', expectedRevision: h.state.aiTask[0].revision, to: 'cancel_requested', reason: 'cancel_requested' });
    return { kind: 'succeeded', payload: { synthetic: 'observed-before-cancel-settlement' } };
  };
  assert.equal((await root.runner.run(h.claim())).status, 'cancelled'); h.state.aiBudgetPolicy[0].enabled = false;
  const start = h.trace.length, snapshot = await root.recovery.read(query);
  assert.equal(snapshot.task.status, 'cancelled'); assert.ok(snapshot.task.cancelRequestedAt); assert.equal(snapshot.steps[0].status, 'succeeded');
  assert.equal(snapshot.resources.counters.steps.consumed, '1'); noWrites(h, start);
  h.state.aiTaskActionPolicy = h.state.aiTaskActionPolicy.filter(p => p.operation !== 'read_step_terminal');
  await assert.rejects(root.recovery.read(query), e => e.code === 'AI_ACCESS_DENIED');
});

for (const mode of ['membership', 'workspace']) test(`buffered references do not escape after ${mode} changes during the snapshot read`, async () => {
  const { h, root } = await make(), before = h.clone(h.state), start = h.trace.length;
  h.storeControl.beforeRead = async name => {
    if (name === 'aiTaskResultArtifact') {
      if (mode === 'membership') h.identity.membership = false;
      else h.identity.workspace = 'workspace-b';
    }
  };
  await assert.rejects(root.recovery.read(query), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, before); noWrites(h, start);
});

test('foreign scope rows stay invisible and malformed original artifact identity fails closed', async () => {
  const { h, root } = await make(); h.control.execute = async () => { throw Error('synthetic unknown'); };
  await root.runner.run(h.claim());
  h.state.aiTaskResultArtifact.push({ ...h.clone(h.state.aiTaskResultArtifact[0]), scopeId: 'foreign-scope', taskId: 'foreign-task', id: 'foreign-result' });
  const snapshot = await root.recovery.read(query);
  assert.equal(snapshot.steps[0].artifacts.length, 1); assert.notEqual(snapshot.steps[0].artifacts[0].resultRef, 'foreign-result');
  h.state.aiTaskResultArtifact[0].actionId = 'wrong-original-action';
  await assert.rejects(root.recovery.read(query), e => e.code === 'AI_STORAGE_UNAVAILABLE');
});

test('persisted COMMITTED metadata is preserved as a fact only, without inventing a measurement or replaying an approval', async () => {
  const { h, root } = await make();
  // Explicitly synthetic stored write facts for the reader, not a Core write/approval execution test.
  h.state.aiStep.push({ id: 'synthetic-write-step', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', sequence: 1, revision: 3,
    actionId: 'synthetic-committed-action', requestFingerprint: 'b'.repeat(64), toolCode: 'rental.order.commit', toolVersion: '1',
    status: 'SUCCEEDED', effect: 'COMMITTED', inputRef: 'original-write-input', resultRef: 'original-core-receipt', errorCode: null });
  const before = h.clone(h.state), start = h.trace.length, snapshot = await root.recovery.read(query);
  assert.equal(snapshot.steps[0].effect, 'committed'); assert.equal(snapshot.steps[0].resultRef, 'original-core-receipt');
  assert.deepEqual(snapshot.steps[0].artifacts, []); assert.deepEqual(snapshot.steps[0].charges, []); assert.equal(snapshot.resources, null);
  assert.deepEqual(h.state, before); noWrites(h, start); assert.deepEqual(h.executions, []);
});
