'use strict';
const { load } = require('./fixtures/ai-native/rental-compatibility-source.cjs');
const test = require('node:test'), assert = require('node:assert/strict');
const { getEventListeners } = require('node:events');
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

// Run orchestration is measured separately from the three original Step charges.
function assertRunTime(h) {
  const rows = h.state.aiTaskExecutionCharge.filter(row => row.stepId === null);
  assert.equal(rows.length, h.state.aiTaskRunOverhead.length);
  for (const row of rows) {
    const original = h.state.aiTaskRunOverhead.find(value => value.id === row.chargeId);
    assert.ok(original?.completedAt); assert.equal(row.status, 'RECORDED');
    assert.equal(row.resource, 'ACTIVE_MS'); assert.equal(row.actualAmount, original.activeMs);
    assert.equal(row.taskId, 'task-a'); assert.equal(row.runId, 'run-a');
    assert.equal(row.leaseOwnerId, original.leaseOwnerId);
    assert.equal(row.fencingToken.toFixed(0), original.fencingToken.toFixed(0));
    for (const key of ['actionId', 'stepFingerprint', 'gatewayInvocationId']) assert.equal(row[key], null);
  }
  const time = h.state.aiTaskExecutionCharge.filter(row => row.resource === 'ACTIVE_MS');
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs,
    time.filter(row => row.status === 'RECORDED').reduce((n, row) => n + row.actualAmount, 0n));
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedActiveMs,
    time.filter(row => row.status !== 'RECORDED').reduce((n, row) => n + row.amount, 0n));
}
function assertUnknownStep(h) {
  const step = h.state.aiStep[0], rows = h.state.aiTaskExecutionCharge.filter(row => row.stepId === step.id);
  assert.deepEqual(rows.map(row => row.resource).sort(), ['ACTIVE_MS', 'OUTPUT_BYTES', 'STEPS']);
  assert.ok(rows.every(row => row.status === 'UNKNOWN' && row.actionId === step.actionId
    && row.stepFingerprint === step.requestFingerprint && row.taskId === step.taskId && row.runId === step.runId));
  assert.equal(h.state.aiTaskExecutionCharge.length, rows.length + h.state.aiTaskRunOverhead.length);
  assertRunTime(h);
}
const firstStepRecorded = state => {
  const step = state.aiStep[0], rows = state.aiTaskExecutionCharge.filter(row => row.stepId === step?.id);
  return step?.status === 'SUCCEEDED' && rows.length === 3 && rows.every(row => row.status === 'RECORDED');
};

// Real authorization, runner and repositories; the database and registered executor are explicit offline doubles.
test('pre-aborted host signal does not claim a lease, mutate rows or dispatch', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController();
  const before = h.clone(h.state); h.trace.length = 0; controller.abort();
  assert.deepEqual(await root.runner.run(h.claim(), controller.signal), { status: 'unavailable', completedSteps: 0, cleanupFailed: 0 });
  assert.deepEqual(h.state, before); assert.deepEqual(h.trace, []); assert.deepEqual(h.executions, []);
});

for (const phase of ['claim', 'registration']) test(`host abort at ${phase} commit stops new work and releases the actual lease`, async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController(); let interrupted = false;
  h.storeControl.beforeCommit = async draft => {
    if (interrupted || draft.aiRun[0].leaseOwnerId !== 'worker-a' || (phase === 'registration' && !draft.aiStep.length)) return;
    interrupted = true; controller.abort();
  };
  const result = await root.runner.run(h.claim(), controller.signal);
  assert.equal(interrupted, true); assert.equal(result.status, 'unavailable');
  assert.deepEqual(h.executions, []); assert.equal(h.state.aiTaskResultArtifact.length, 0);
  assert.equal(h.state.aiTaskExecutionCharge.filter(row => row.stepId !== null).length, 0);
  assertRunTime(h); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTask[0].cancelRequestedAt, null);
});

test('host interruption reaches an in-flight executor and late success cannot replace unknown evidence', { timeout: 10000 }, async () => {
  const h = await authorizedRunnerHarness(), controller = new AbortController(), entered = deferred(), late = deferred(), returned = deferred();
  const timers = new Map();
  const config = h.configuration(); config.clock = { now: () => 0, setTimeout: callback => { timers.set(callback, callback); return callback; }, clearTimeout: handle => timers.delete(handle) };
  const root = load('@rental-os/ai-native-server/runtime/runner/authorized-persistent-task-input.composition').composeAuthorizedPersistentTaskInputRunner(config);
  let effectSignal;
  h.control.execute = async (_input, signal) => { effectSignal = signal; entered.resolve(); await late.promise; returned.resolve(); return { kind: 'succeeded', payload: { synthetic: 'late' } }; };
  let result, error, settled = false;
  const pending = root.runner.run(h.claim(), controller.signal).then(value => { result = value; settled = true; }, reason => { error = reason; settled = true; });
  await entered.promise; controller.abort();
  await new Promise(resolve => setImmediate(resolve));
  const interruptedPromptly = settled, signalledPromptly = effectSignal.aborted;
  if (!settled) for (const expire of [...timers.values()]) expire();
  await pending; late.resolve(); await returned.promise; await new Promise(resolve => setImmediate(resolve));
  assert.ifError(error); assert.equal(interruptedPromptly, true); assert.equal(signalledPromptly, true);
  assert.equal(result.status, 'unknown'); assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
  assert.equal(h.state.aiTask[0].cancelRequestedAt, null); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assertUnknownStep(h);
  const actionId = h.state.aiStep[0].actionId, charges = h.clone(h.state.aiTaskExecutionCharge);
  const chargeIds = new Set(charges.map(row => row.chargeId));
  assert.equal((await h.compose().runner.run({ ...h.claim(), recovery: true })).status, 'unknown');
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].actionId, actionId);
  assert.deepEqual(h.state.aiTaskExecutionCharge.filter(row => chargeIds.has(row.chargeId)), charges);
  assert.ok(h.state.aiTaskExecutionCharge.filter(row => !chargeIds.has(row.chargeId)).every(row => row.stepId === null));
  assertUnknownStep(h);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0); assert.equal(timers.size, 0);
});

test('host abort after the first recorded result preserves it without registering the next action', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController(); let interrupted = false;
  h.storeControl.beforeCommit = async draft => {
    if (interrupted || !firstStepRecorded(draft)) return;
    interrupted = true; controller.abort();
  };
  const result = await root.runner.run(h.claim(), controller.signal);
  assert.equal(interrupted, true); assert.equal(result.status, 'unavailable'); assert.equal(result.completedSteps, 1);
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTask[0].cancelRequestedAt, null); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal((await h.compose().runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
});

test('abort with a lost artifact COMMIT reply still reads the original result and accounts it once', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController(); let lost = false;
  h.storeControl.beforeCommit = async draft => {
    if (lost || !draft.aiTaskResultArtifact[0]?.completeMeasurement) return;
    lost = true; h.storeControl.loseReply = true; controller.abort();
  };
  const result = await root.runner.run(h.claim(), controller.signal);
  assert.equal(lost, true); assert.equal(result.status, 'unavailable'); assert.equal(result.completedSteps, 1);
  assert.deepEqual(h.executions, ['input-clarify']); assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiStep[0].resultRef, h.state.aiTaskResultArtifact[0].id);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, h.state.aiTaskResultArtifact[0].outputBytes);
  const original = h.clone(h.state.aiTaskResultArtifact[0]);
  const charges = h.clone(h.state.aiTaskExecutionCharge.filter(row => row.stepId !== null));
  assert.deepEqual(await h.compose().runner.run({ ...h.claim(), recovery: true }),
    { status: 'unavailable', completedSteps: 1, cleanupFailed: 0 });
  assert.deepEqual(h.state.aiTaskExecutionCharge.filter(row => row.stepId !== null), charges);
  assert.equal(h.state.aiTask[0].status, 'RUNNING'); assertRunTime(h);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.deepEqual(h.state.aiTaskResultArtifact[0], original); assert.deepEqual(h.executions, ['input-clarify']);
});

test('host abort during execution authorization cannot dispatch when credentials eventually return', { timeout: 10000 }, async () => {
  const h = await authorizedRunnerHarness(), controller = new AbortController(), entered = deferred(), release = deferred();
  const { composePersistedTaskAuthorization } = load('@rental-os/ai-native-server/runtime/task-authorization.composition');
  const { composeCurrentAuthorizedPersistentTaskInputRunner } = load('@rental-os/ai-native-server/runtime/runner/authorized-persistent-task-input.composition');
  const current = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock: h.configuration().wall });
  let executionRead = false;
  const root = composeCurrentAuthorizedPersistentTaskInputRunner(h.configuration(), { ...current,
    execution: { authorize: async taskId => {
      executionRead = true;
      try { return await current.execution.authorize(taskId); } finally { executionRead = false; }
    } } });
  const original = h.authorization.credentials.current; let blocked = false;
  h.authorization.credentials.current = async () => {
    if (!blocked && executionRead) {
      blocked = true; entered.resolve(); await release.promise;
    }
    return original();
  };
  const pending = root.runner.run(h.claim(), controller.signal);
  await entered.promise; assert.equal(blocked, true);
  assert.equal(h.state.aiTaskResultArtifact.length, 1); controller.abort();
  try {
    assert.equal((await pending).status, 'unknown');
    assert.deepEqual(h.executions, []); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  } finally { release.resolve(); }
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.executions, []); assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assertUnknownStep(h);
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
});

test('abort during metadata read does not acquire a lease after the read returns', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController(), before = h.clone(h.state);
  h.storeControl.beforeRead = async name => { if (name === 'aiTask') controller.abort(); };
  assert.equal((await root.runner.run(h.claim(), controller.signal)).status, 'unavailable');
  assert.deepEqual(h.state, before); assert.deepEqual(h.executions, []);
});

test('executor rejection cleans up the host listener while retaining interrupted accounting', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController();
  h.control.execute = async () => { throw Error('synthetic lost executor response'); };
  assert.equal((await root.runner.run(h.claim(), controller.signal)).status, 'unknown');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const before = h.clone(h.state); controller.abort(); await Promise.resolve();
  assert.deepEqual(h.state, before); assert.equal(h.state.aiTask[0].cancelRequestedAt, null);
  assertUnknownStep(h);
});

test('host abort cannot skip a required input checkpoint before remaining work', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController();
  h.control.needsInput = true;
  h.storeControl.beforeCommit = async draft => {
    if (firstStepRecorded(draft)) controller.abort();
  };
  assert.equal((await root.runner.run(h.claim(), controller.signal)).status, 'paused');
  assert.equal(controller.signal.aborted, true);
  assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT'); assert.equal(h.state.aiTaskInputRequest.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n); assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
});

test('an input requirement with no remaining step still fails closed when the host aborts', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController();
  h.control.needsInput = true;
  const saved = h.state.aiTaskRunPlan[0]; saved.payload.steps = saved.payload.steps.slice(0, 1);
  saved.planHash = load('@rental-os/platform-contracts/request-fingerprint').requestFingerprint(saved.payload);
  h.storeControl.beforeCommit = async draft => {
    if (firstStepRecorded(draft)) controller.abort();
  };
  await assert.rejects(root.runner.run(h.claim(), controller.signal), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(controller.signal.aborted, true);
  assert.equal(h.state.aiTask[0].status, 'RUNNING'); assert.equal(h.state.aiTaskInputRequest.length, 0);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
});

test('normal completion removes host abort listeners and a later abort cannot change durable success', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose(), controller = new AbortController();
  assert.equal((await root.runner.run(h.claim(), controller.signal)).status, 'succeeded');
  assert.equal(getEventListeners(controller.signal, 'abort').length, 0);
  const before = h.clone(h.state); controller.abort(); await Promise.resolve();
  assert.deepEqual(h.state, before);
});
