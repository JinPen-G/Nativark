'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' } });
const { AI_TASK_INPUT_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
const { PrismaTaskInputRepository } = require('../apps/api/src/modules/ai-native/task-input/prisma-task-input.repository');
const { composePersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/task-input/persistent-task-input.composition');
const { taskInputHarness } = require('./fixtures/ai-native/task-input-harness.cjs');
const contract = { draftVersion: AI_TASK_INPUT_DRAFT_VERSION, code: 'synthetic-clarification', version: '1', fields: [
  { fieldId: 'clarification_text', kind: 'text', label: 'Additional context', required: true, maxLength: 100 }
] };
async function setup() {
  const h = await taskInputHarness({ aiTaskInputRequest: [], aiTaskInputReceipt: [] }, {
    aiTaskInputRequest: [['scopeId', 'taskId', 'id'], ['scopeId', 'taskId', 'runId', 'stepId', 'planHash']],
    aiTaskInputReceipt: [['scopeId', 'taskId', 'requestId'], ['scopeId', 'taskId', 'submissionKey']]
  });
  h.control.invalidAnswers = false;
  h.source = {
    resolve: async b => b.registrationRef === 'clarify'
      ? { kind: 'required', contract: structuredClone(h.control.contract ?? contract), inputRef: b.inputRef, inputHash: b.inputHash, expiresAt: '2026-10-06T18:00:00Z' }
      : { kind: 'not_required' },
    validateAnswers: async b => ({ disposition: h.control.invalidAnswers ? 'plan_changed' : 'context_only', planHash: b.planHash, inputRef: b.inputRef, inputHash: b.inputHash })
  };
  h.compose = () => composePersistentTaskInputRunner({ ...h.configuration(), inputSource: h.source });
  h.inputs = () => h.compose().inputs;
  h.run = () => h.compose().runner.run(h.claim());
  h.submit = patch => h.inputs().submit({ draftVersion: AI_TASK_INPUT_DRAFT_VERSION, taskId: 'task-a', requestId: h.state.aiTaskInputRequest[0].id,
    expectedRevision: 1, submissionKey: 'answer-a', answers: [{ fieldId: 'clarification_text', value: 'Explain the existing order only' }], ...patch });
  return h;
}

test('production runner persists input wait, releases, consumes one receipt, and continues original remaining step', async () => {
  const h = await setup(), plan = h.clone(h.state.aiTaskRunPlan);
  assert.equal((await h.run()).status, 'paused');
  assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT');
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiStep.length, 1); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  const request = h.state.aiTaskInputRequest[0], before = h.clone(h.state.aiTaskExecutionBudget[0]);
  assert.equal(request.basisResultRef, h.state.aiStep[0].resultRef);
  assert.ok(h.trace.indexOf('aiTaskInputRequest.create') < h.trace.lastIndexOf('authority:release_run'));
  h.control.now = new Date(h.control.now.getTime() + 60000);
  const receipt = await h.submit();
  assert.equal(receipt.status, 'input_received'); assert.equal(receipt.replayed, false);
  assert.equal(h.state.aiTask[0].status, 'RUNNING');
  assert.deepEqual(h.state.aiTaskExecutionBudget[0], before, 'waiting and answering do not reset or invent resource use');
  const revision = h.state.aiTask[0].revision, eventCount = h.state.aiTaskEvent.length;
  assert.equal((await h.submit()).receiptId, receipt.receiptId);
  assert.equal(h.state.aiTask[0].revision, revision); assert.equal(h.state.aiTaskEvent.length, eventCount);
  h.control.execute = async binding => {
    assert.equal(binding.inputRef, 'input-continue');
    assert.deepEqual(binding.clarifications, [{ requestId: request.id, receiptId: receipt.receiptId, answers: [{ fieldId: 'clarification_text', value: 'Explain the existing order only' }] }]);
    return { kind: 'succeeded', payload: { synthetic: true } };
  };
  assert.equal((await h.run()).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.deepEqual(h.state.aiTaskRunPlan, plan);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 20n);
  assert.equal(h.state.aiTaskInputReceipt.length, 1);
});

test('pending question refresh archives the old contract without restarting or resetting resources', async () => {
  const h = await setup(); await h.run();
  const prior = h.clone(h.state.aiTaskInputRequest[0]), budget = h.clone(h.state.aiTaskExecutionBudget);
  const plan = h.clone(h.state.aiTaskRunPlan), runs = h.clone(h.state.aiRun);
  h.control.contract = { ...structuredClone(contract), version: '2', fields: [
    { ...contract.fields[0], label: 'Current configuration requires a new answer' }
  ] };
  await assert.rejects(h.inputs().readPending('task-a'));
  const command = { taskId: 'task-a', requestId: prior.id, expectedRevision: prior.revision };
  const beforeRefresh = h.clone(h.state);
  h.storeControl.beforeWrite = async name => { if (name === 'aiTaskEvent') throw Error('synthetic archive failure'); };
  await assert.rejects(h.inputs().refreshPending(command), e => e.code === 'AI_STORAGE_UNAVAILABLE');
  assert.deepEqual(h.state, beforeRefresh);
  h.storeControl.beforeWrite = null;
  const refreshed = await h.inputs().refreshPending(command);
  assert.equal(refreshed.revision, 2); assert.equal(refreshed.contract.version, '2');
  assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT');
  assert.deepEqual(h.state.aiTaskExecutionBudget, budget); assert.deepEqual(h.state.aiTaskRunPlan, plan);
  assert.deepEqual(h.state.aiRun, runs); assert.deepEqual(h.executions, ['input-clarify']);
  const event = h.state.aiTaskEvent.at(-1);
  assert.equal(event.type, 'task.input_refreshed');
  assert.equal(event.payload.previousRequest.contractHash, prior.contractHash);
  assert.equal(event.payload.previousRequest.revision, 1);
  const archivedEvents = h.state.aiTaskEvent;
  h.state.aiTaskEvent = archivedEvents.filter(row => row.type !== 'task.input_refreshed');
  await assert.rejects(h.inputs().readPending('task-a'), e => e.code === 'AI_ACCESS_DENIED');
  h.state.aiTaskEvent = archivedEvents;
  await assert.rejects(h.submit(), e => e.code === 'AI_REVISION_CONFLICT');
  await assert.rejects(h.inputs().refreshPending(command), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal((await h.inputs().readPending('task-a')).revision, 2);
  const events = h.state.aiTaskEvent.length;
  assert.equal((await h.inputs().refreshPending({ ...command, expectedRevision: 2 })).revision, 2);
  assert.equal(h.state.aiTaskEvent.length, events);
  const answer = await h.submit({ expectedRevision: 2 });
  assert.equal(answer.status, 'input_received');
  assert.equal((await h.submit({ expectedRevision: 2 })).receiptId, answer.receiptId);
  assert.deepEqual(h.state.aiTaskExecutionBudget, budget);
});

for (const [name, patch] of [
  ['confirmed', { confirmed: true }], ['actor', { actor: 'other' }], ['scope', { scope: 'other' }],
  ['tool', { toolCode: 'rental.order.commit' }], ['amount', { answers: [{ fieldId: 'amount', value: 1 }] }],
  ['unknown field', { answers: [{ fieldId: 'quantity', value: 2 }] }], ['stale revision', { expectedRevision: 2 }]
]) test(`input receipt refuses ${name} without resuming`, async () => {
  const h = await setup(); await h.run();
  await assert.rejects(h.submit(patch));
  assert.equal(h.state.aiTaskInputReceipt.length, 0); assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT');
});

for (const mutation of ['owner', 'scope', 'expired', 'plan', 'confirmation', 'cancelled', 'fence', 'effects']) {
  test(`input receipt fails closed for ${mutation}`, async () => {
    const h = await setup(); await h.run();
    if (mutation === 'owner') h.control.context.actor.userId = 'other';
    if (mutation === 'scope') h.control.context.scope.workspaceId = 'other';
    if (mutation === 'expired') h.control.now = new Date('2026-10-07T12:00:00Z');
    if (mutation === 'plan') h.state.aiTaskRunPlan[0].planHash = 'b'.repeat(64);
    if (mutation === 'confirmation') h.state.aiTask[0].status = 'WAITING_CONFIRMATION';
    if (mutation === 'cancelled') await h.aggregate.transition({ taskId: 'task-a', expectedRevision: h.state.aiTask[0].revision, to: 'cancel_requested', reason: 'cancel_requested' });
    if (mutation === 'fence') h.state.aiRun[0].fencingToken = h.state.aiRun[0].fencingToken.add(1);
    if (mutation === 'effects') h.control.invalidAnswers = true;
    const before = h.clone(h.state);
    await assert.rejects(h.submit()); assert.deepEqual(h.state, before);
  });
}

test('receipt/event failure rolls the input transaction back, COMMIT reply loss replays only persisted facts', async () => {
  const h = await setup(); await h.run();
  const before = h.clone(h.state);
  h.storeControl.beforeWrite = async name => { if (name === 'aiTaskEvent') throw Error('synthetic event failure'); };
  await assert.rejects(h.submit(), e => e.code === 'AI_STORAGE_UNAVAILABLE'); assert.deepEqual(h.state, before);
  h.storeControl.beforeWrite = null; h.storeControl.loseReply = true;
  await assert.rejects(h.submit(), e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'reconcile' && e.retryable === false);
  assert.equal(h.state.aiTaskInputReceipt.length, 1); assert.equal(h.state.aiTask[0].status, 'RUNNING');
  const count = h.state.aiTaskEvent.length;
  assert.equal((await h.submit()).replayed, true); assert.equal(h.state.aiTaskEvent.length, count);
  assert.deepEqual(h.executions, ['input-clarify']);
});

test('lost waiting COMMIT reports unknown while retaining the completed step and original input request', async () => {
  const h = await setup();
  h.storeControl.beforeWrite = async name => { if (name === 'aiTaskInputRequest') h.storeControl.loseReply = true; };
  await assert.rejects(h.run(), e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'reconcile' && !e.retryable);
  assert.equal(h.state.aiTaskInputRequest.length, 1);
  assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT');
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.deepEqual(h.executions, ['input-clarify']);
  h.storeControl.beforeWrite = null;
  assert.equal((await h.run()).status, 'paused');
  assert.equal(h.state.aiTaskInputRequest.length, 1);
  assert.deepEqual(h.executions, ['input-clarify']);
});

test('read-only pending query acknowledgement loss does not claim an unknown business write', async () => {
  const h = await setup(); await h.run();
  const before = h.clone(h.state);
  h.storeControl.loseReply = true;
  await assert.rejects(h.inputs().readPending('task-a'), e => e.code === 'AI_STORAGE_UNAVAILABLE');
  assert.deepEqual(h.state, before);
});

test('two answers consume once; altered replay is refused', async () => {
  const h = await setup(); await h.run();
  const answers = await Promise.all([h.submit(), h.submit()]);
  assert.equal(answers.filter(r => !r.replayed).length, 1); assert.equal(answers[0].receiptId, answers[1].receiptId);
  await assert.rejects(h.submit({ answers: [{ fieldId: 'clarification_text', value: 'different' }] }));
  await assert.rejects(h.submit({ submissionKey: 'different-key' }));
  assert.equal(h.state.aiTaskInputReceipt.length, 1);
});

for (const failure of ['before_wait_commit', 'lost_wait_reply']) test(`waiting transaction recovery handles ${failure} without rerunning its completed step`, async () => {
  const h = await setup();
  h.storeControl.beforeWrite = async name => {
    if (name !== 'aiTaskInputRequest') return;
    if (failure === 'before_wait_commit') throw Error('synthetic wait insert failed');
    h.storeControl.loseReply = true;
  };
  await assert.rejects(h.run());
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.deepEqual(h.executions, ['input-clarify']);
  h.storeControl.beforeWrite = null;
  if (failure === 'before_wait_commit') {
    assert.equal(h.state.aiTaskInputRequest.length, 0); assert.equal(h.state.aiTask[0].status, 'RUNNING');
    assert.equal((await h.run()).status, 'paused');
  } else {
    assert.equal(h.state.aiTaskInputRequest.length, 1); assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT');
    assert.equal((await h.run()).status, 'paused');
    await assert.rejects(h.submit(), e => e.code === 'AI_REVISION_CONFLICT');
    h.control.now = new Date(h.control.now.getTime() + 100001);
  }
  await h.submit(); assert.equal((await h.run()).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
});

test('waiting view reads original contract only for its current owner and pending state', async () => {
  const h = await setup(); assert.equal(await h.inputs().readPending('task-a'), null);
  await h.run(); const view = await h.inputs().readPending('task-a');
  assert.deepEqual(view.contract, contract); assert.equal(view.requestId, h.state.aiTaskInputRequest[0].id);
  assert.equal('inputRef' in view, false); assert.equal('actorId' in view, false);
  h.control.context.actor.userId = 'other'; await assert.rejects(h.inputs().readPending('task-a'));
});

test('waiting view cannot expose candidate labels after the registered source becomes unavailable', async () => {
  const h = await setup(); await h.run();
  h.source.resolve = async () => { throw Error('synthetic candidate access revoked'); };
  await assert.rejects(h.inputs().readPending('task-a'));
});

test('current authorization loss while checking an answer leaves no receipt or resume', async () => {
  const h = await setup(); await h.run(); const before = h.clone(h.state), original = h.source.validateAnswers;
  h.source.validateAnswers = async (...args) => { h.control.revoked = true; return original(...args); };
  await assert.rejects(h.submit()); assert.deepEqual(h.state, before);
});

test('cancellation racing an answer has only one task-revision winner and preserves completed facts', async () => {
  for (const answerFirst of [true, false]) {
    const h = await setup(); await h.run(); const revision = h.state.aiTask[0].revision;
    const cancel = () => h.aggregate.transition({ taskId: 'task-a', expectedRevision: revision, to: 'cancel_requested', reason: 'cancel_requested' });
    const results = await Promise.allSettled(answerFirst ? [h.submit(), cancel()] : [cancel(), h.submit()]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
    assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiTaskResultArtifact.length, 1);
    assert.deepEqual(h.executions, ['input-clarify']);
  }
});

test('real takeover fences a lost waiting response and rejects old input and holder writes', async () => {
  const { PrismaTaskTakeoverRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-takeover.repository');
  const h = await setup();
  h.storeControl.beforeWrite = async name => { if (name === 'aiTaskInputRequest') h.storeControl.loseReply = true; };
  await assert.rejects(h.run()); h.storeControl.beforeWrite = null;
  const old = h.held();
  const takeover = new PrismaTaskTakeoverRepository(h.db, h.taskAuthority, () => h.control.now);
  const fresh = await takeover.takeover({ taskId: 'task-a', runId: 'run-a', previousHolderId: old.holderId, holderId: 'human-a',
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: old.revision, expectedFencingToken: old.fencingToken, leaseMs: 100000 });
  await assert.rejects(h.submit());
  await assert.rejects(h.tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: old.holderId,
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: fresh.revision, expectedFencingToken: old.fencingToken }));
  await assert.rejects(h.make().evidence.capture(old, h.state.aiStep[0].id, new AbortController().signal, async () => assert.fail('old holder cannot execute')));
  assert.equal(h.state.aiRun[0].leaseOwnerId, 'human-a'); assert.equal(h.state.operationLog.length, 1);
  assert.equal(h.state.aiTaskInputReceipt.length, 0); assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT');
});

test('expired consumed input replays its original receipt without fresh execution authorization', async () => {
  const h = await setup(); await h.run(); const receipt = await h.submit();
  h.control.now = new Date('2026-10-08T12:00:00Z');
  assert.equal((await h.submit()).receiptId, receipt.receiptId);
  assert.deepEqual(h.executions, ['input-clarify']);
});

for (const field of ['inputRef', 'inputHash', 'basisResultRef', 'contractHash', 'createdBy', 'waitingTaskRevision']) test(`tampered persisted ${field} cannot supply recovery evidence`, async () => {
  const h = await setup(); await h.run();
  h.state.aiTaskInputRequest[0][field] = field === 'waitingTaskRevision' ? 99 : 'tampered';
  await assert.rejects(h.submit()); assert.equal(h.state.aiTaskInputReceipt.length, 0);
});

test('registry revision changing during answer validation prevents consumption', async () => {
  const h = await setup(); await h.run();
  const originalResolve = h.source.resolve, originalValidate = h.source.validateAnswers;
  h.source.validateAnswers = async (...args) => {
    h.source.resolve = async b => ({ ...await originalResolve(b), contract: { ...contract, version: '2' } });
    return originalValidate(...args);
  };
  await assert.rejects(h.submit());
  assert.equal(h.state.aiTaskInputReceipt.length, 0); assert.equal(h.state.aiTask[0].status, 'WAITING_INPUT');
});

test('resumed step refuses a withdrawn or revised input registry before reading answers', async () => {
  const h = await setup(); await h.run(); await h.submit();
  const lease = await h.tasks.claimRun(h.claim());
  const original = h.source.resolve;
  h.source.resolve = async b => ({ ...await original(b), contract: { ...contract, version: '2' } });
  await assert.rejects(h.inputs().readForStep(lease, 'continue'));
  assert.deepEqual(h.executions, ['input-clarify']);
});

test('missing measured basis or source cannot fabricate an input receipt', async () => {
  const h = await setup(); await h.run();
  h.state.aiTaskResultArtifact[0].completeMeasurement = false;
  await assert.rejects(h.submit()); assert.equal(h.state.aiTaskInputReceipt.length, 0);
  assert.throws(() => new PrismaTaskInputRepository(h.db, h.tasks, h.planAuthority, undefined), /AI_RESOURCE_UNAVAILABLE/);
  assert.throws(() => h.make({ afterSucceeded() {} }), /AI_RESOURCE_UNAVAILABLE/);
  assert.throws(() => composePersistentTaskInputRunner(h.configuration()), /AI_RESOURCE_UNAVAILABLE/);
});

test('persisted cumulative call and activity counters survive resume and original-charge replay', async () => {
  const h = await setup(); await h.run();
  const budget = h.state.aiTaskExecutionBudget[0];
  budget.consumedCalls = 2n; budget.consumedActiveMs += 100n;
  const before = h.clone(budget);
  await h.submit(); assert.deepEqual(h.state.aiTaskExecutionBudget[0], before);
  assert.equal((await h.run()).status, 'succeeded');
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, before.consumedActiveMs + 10n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, before.consumedSteps + 1n);
});

test('tampering a consumed receipt cannot feed later tools or replay a response', async () => {
  const h = await setup(); await h.run(); await h.submit();
  h.state.aiTaskInputReceipt[0].answers[0].value = 'modified after consume';
  await assert.rejects(h.submit());
  await assert.rejects(h.run());
  assert.deepEqual(h.executions, ['input-clarify']);
});

test('seeded persisted unknown recovery keeps original receipt and never executes a tool or consumes input', async () => {
  const h = await setup(); await h.run();
  h.state.aiTask[0].status = 'WAITING_EXTERNAL';
  h.state.aiStep[0].status = 'UNKNOWN'; h.state.aiStep[0].effect = 'POSSIBLE'; h.state.aiStep[0].errorCode = 'AI_RESULT_UNKNOWN';
  h.state.aiTaskResultArtifact[0].outcome = 'UNKNOWN'; h.state.aiTaskResultArtifact[0].completeMeasurement = false;
  for (const charge of h.state.aiTaskExecutionCharge) charge.status = 'UNKNOWN';
  const artifact = h.clone(h.state.aiTaskResultArtifact);
  assert.equal((await h.make(h.inputs()).runner.run({ ...h.claim(), recovery: true })).status, 'unknown');
  assert.deepEqual(h.executions, ['input-clarify']); assert.deepEqual(h.state.aiTaskResultArtifact, artifact);
  assert.equal(h.state.aiTaskInputReceipt.length, 0); assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
});
