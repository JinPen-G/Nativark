'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { modelHostHarness } = require('./fixtures/ai-native/task-model-host.cjs');
const { composeTaskModelHost } = require('../apps/api/src/modules/ai-native/runner/model-task-host.composition');

test('image model host executes the original queued task with one invocation, original accounting and resource charges', async () => {
  const h = await modelHostHarness('image');
  const result = await h.root.application.start(h.query);
  assert.equal(result.kind, 'run_outcome');
  assert.equal(result.outcome.status, 'succeeded', JSON.stringify(result));
  assert.equal(h.state.aiStep[0].toolCode, 'ai.model.image');
  assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.equal(h.modelControl.sent.length, 1);
  assert.equal(h.state.aiGatewayInvocation[0].intentHash, h.state.aiTaskActionInput[0].fingerprint);
  assert.equal(h.state.aiGatewayAccountingReceipt.length, 1);
  assert.equal(h.state.aiBudgetReservation.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n);
  assert.equal(h.state.aiTaskExecutionCharge.length, 4);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  const revoked = await modelHostHarness('image'); revoked.modelControl.mediaActive = false;
  await assert.rejects(revoked.root.application.start(revoked.query), error => error.code === 'CAPABILITY_UNSUPPORTED');
  assert.equal(revoked.state.aiGatewayInvocation.length, 0);
  assert.equal(revoked.modelControl.sent.length, 0);
});

test('model host starts queued task and run, publishes under one lease, then settles the original invocation and four resources', async () => {
  const h = await modelHostHarness(), originalFence = h.state.aiRun[0].fencingToken, start = h.trace.length;
  h.state.aiTaskActionPolicy = h.state.aiTaskActionPolicy.filter(row => !['request_input', 'submit_input', 'resume_input'].includes(row.operation));
  h.config.task.material.messages[0].content[0].text = 'late caller mutation';
  h.storeControl.beforeWrite = async (name, args, data) => {
    if (name === 'aiGatewayInvocation') {
      assert.equal(data.aiTask[0].status, 'RUNNING'); assert.equal(data.aiRun[0].status, 'RUNNING');
      assert.equal(data.aiStep[0].status, 'RUNNING'); assert.equal(data.aiStep[0].effect, 'POSSIBLE');
      assert.deepEqual(h.modelControl.sent, []);
    }
  };
  const result = await h.root.application.start(h.query);
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'succeeded');
  assert.equal(h.state.aiTask[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskInputRequest.length, 0);
  assert.equal(h.state.aiTaskInputReceipt.length, 0);
  await assert.rejects(h.root.authorization.authority.resolve(h.query.taskId, 'request_input'), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.aiStep[0].effect, 'NONE'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), originalFence.add(1).toFixed(0));
  assert.equal(h.state.aiTaskActionInput.length, 1); assert.equal(h.state.aiTaskRunPlan.length, 1); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.modelControl.sent.length, 1);
  assert.equal(h.modelControl.sent[0].messages[0].content, 'Explain authorized facts.');
  assert.equal(h.state.aiGatewayInvocation[0].callId, h.state.aiTaskActionInput[0].payload.intent.requestId);
  assert.equal(h.state.aiStep[0].resultRef, h.state.aiTaskResultArtifact[0].id);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 0n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.equal(h.state.aiTaskExecutionCharge.length, 4); assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  assert.equal(h.state.aiBudgetReservation.length, 1); assert.equal(h.state.aiGatewayAccountingReceipt.length, 1);
  assert.equal(h.state.aiGatewayAccountingReceipt[0].inputTokens, 1n); assert.equal(h.state.aiGatewayAccountingReceipt[0].outputTokens, 2n);
  const trace = h.trace.slice(start);
  assert.ok(trace.indexOf('aiTaskActionInput.create') < trace.indexOf('aiTaskRunPlan.create'));
  assert.ok(trace.indexOf('aiTaskRunPlan.create') < trace.indexOf('aiStep.create'));
  assert.ok(trace.indexOf('aiStep.create') < trace.indexOf('aiGatewayInvocation.create'));
  const snapshot = await h.root.application.inspect(h.query);
  assert.equal(snapshot.steps[0].status, 'succeeded'); assert.equal(snapshot.resources.counters.calls.consumed, '1');
  assert.equal(JSON.stringify(snapshot).includes('vault-a'), false); assert.equal(JSON.stringify(snapshot).includes('Synthetic model result'), false);
  const page = await h.root.application.readEvents({ taskId: h.query.taskId, after: '0', limit: 100 });
  assert.equal(page.events.filter(e => e.type === 'step.changed' && e.data.status === 'succeeded').length, 1);
});

async function clarificationHost(turns, kind) {
  const h = await modelHostHarness(kind);
  h.config.inputSource = {
    resolve: async binding => h.state.aiRun.find(r => r.id === binding.runId).sequence <= turns
      ? { kind: 'required', contract: structuredClone(h.contract), inputRef: binding.inputRef, inputHash: binding.inputHash,
        expiresAt: '2026-10-07T12:00:00Z' } : { kind: 'not_required' },
    validateAnswers: async binding => ({ disposition: 'context_only', planHash: binding.planHash, inputRef: binding.inputRef, inputHash: binding.inputHash })
  };
  const root = composeTaskModelHost(h.config);
  const answer = pending => ({ draftVersion: h.contract.draftVersion, taskId: h.query.taskId, requestId: pending.requestId,
    expectedRevision: pending.revision, submissionKey: `answer-${pending.requestId}`,
    answers: [{ fieldId: 'clarification_text', value: `Answer for ${pending.requestId}` }] });
  return { ...h, root, answer };
}

test('image clarification resumes through current media authority and the original cumulative budget', { timeout: 20000 }, async () => {
  const h = await clarificationHost(2, 'image');
  assert.equal((await h.root.application.start(h.query)).outcome.status, 'paused');
  const original = h.clone(h.state.aiTaskActionInput[0]);
  const fingerprint = h.state.aiTaskExecutionBudget[0].policyFingerprint;
  for (let turn = 1; turn <= 2; turn++) {
    const pending = await h.root.application.readInput({ taskId: h.query.taskId });
    const submission = h.answer(pending);
    const result = await composeTaskModelHost(h.config).application.resume(submission);
    assert.equal(result.continuation.kind, 'run_outcome', JSON.stringify(result));
    assert.equal(result.continuation.outcome.status, turn === 1 ? 'paused' : 'succeeded');
    assert.equal((await h.root.application.resume(submission)).continuation.reason, 'receipt_replayed');
    assert.equal(h.state.aiTaskExecutionBudget.length, 1);
    assert.equal(h.state.aiTaskExecutionBudget[0].policyFingerprint, fingerprint);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, BigInt(turn + 1));
    assert.equal(h.state.aiRun[turn].resourceOriginRunId, h.query.runId);
    const stored = h.state.aiTaskActionInput.at(-1).payload;
    assert.equal(stored.intent.requiredFeatures.includes('image'), true);
    assert.deepEqual(stored.media, original.payload.media);
    assert.equal(stored.intent.messages.at(-1).content[0].text.includes(submission.answers[0].value), true);
  }
  assert.deepEqual(h.state.aiTaskActionInput[0], original);
  assert.equal(h.modelControl.sent.length, 3);
  assert.equal(new Set(h.state.aiGatewayInvocation.map(row => row.callId)).size, 3);
  assert.equal(h.state.aiGatewayAccountingReceipt.length, 3);

  const revoked = await clarificationHost(1, 'image');
  assert.equal((await revoked.root.application.start(revoked.query)).outcome.status, 'paused');
  const pending = await revoked.root.application.readInput({ taskId: revoked.query.taskId });
  revoked.modelControl.mediaActive = false;
  const rejected = await revoked.root.application.resume(revoked.answer(pending));
  assert.equal(rejected.continuation.kind, 'unavailable');
  assert.equal(revoked.modelControl.sent.length, 1);
  assert.equal(revoked.state.aiGatewayInvocation.length, 1);
  assert.equal(revoked.state.aiTaskExecutionBudget[0].consumedCalls, 1n);
});

test('model clarification creates successive frozen runs without resetting the original task budget', { timeout: 20000 }, async () => {
  const h = await clarificationHost(2);
  assert.equal((await h.root.application.start(h.query)).outcome.status, 'paused');
  const originalInput = h.clone(h.state.aiTaskActionInput[0]), originalPlan = h.clone(h.state.aiTaskRunPlan[0]);
  const policyFingerprint = h.state.aiTaskExecutionBudget[0].policyFingerprint;
  for (let turn = 1; turn <= 2; turn++) {
    const pending = await h.root.application.readInput({ taskId: h.query.taskId });
    const submission = h.answer(pending);
    const result = await composeTaskModelHost(h.config).application.resume(submission);
    assert.equal(result.continuation.kind, 'run_outcome', JSON.stringify(result));
    assert.equal(result.continuation.outcome.status, turn === 1 ? 'paused' : 'succeeded');
    assert.equal((await h.root.application.resume(submission)).continuation.reason, 'receipt_replayed');
    assert.equal(h.state.aiRun.length, turn + 1);
    assert.equal(h.state.aiTaskExecutionBudget.length, 1);
    assert.equal(h.state.aiTaskExecutionBudget[0].policyFingerprint, policyFingerprint);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, BigInt(turn + 1));
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, BigInt(turn + 1));
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, BigInt((turn + 1) * 10));
    assert.equal(h.state.aiRun[turn].resourceOriginRunId, h.query.runId);
    assert.equal(h.state.aiRun[turn].inputReceiptId, result.receipt.receiptId);
  }
  assert.deepEqual(h.state.aiTaskActionInput[0], originalInput);
  assert.deepEqual(h.state.aiTaskRunPlan[0], originalPlan);
  assert.equal(h.state.aiTask[0].status, 'SUCCEEDED');
  assert.equal(h.modelControl.sent.length, 3);
  assert.equal(new Set(h.modelControl.sent.map(r => r.callId)).size, 3);
  assert.equal(h.state.aiGatewayInvocation.length, 3);
  assert.equal(h.state.aiTaskExecutionCharge.length, 12);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  assert.ok(h.state.aiRun.every(r => r.leaseOwnerId === null));
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, h.state.aiTaskResultArtifact.reduce((n, r) => n + r.outputBytes, 0n));
  assert.match(h.modelControl.sent[1].messages.at(-1).content, /clarification_answers/);
  assert.ok(h.modelControl.sent[2].messages.at(-1).content.includes(h.state.aiTaskInputReceipt[1].answers[0].value));
});

test('model clarification lost answer acknowledgement reads the same successor without redispatch', { timeout: 20000 }, async () => {
  const h = await clarificationHost(1);
  assert.equal((await h.root.application.start(h.query)).outcome.status, 'paused');
  const pending = await h.root.application.readInput({ taskId: h.query.taskId }), submission = h.answer(pending);
  h.storeControl.beforeCommit = async draft => {
    if (draft.aiTaskInputReceipt.length && !h.state.aiTaskInputReceipt.length) h.storeControl.loseReply = true;
  };
  await assert.rejects(h.root.application.resume(submission), e => e.code === 'AI_RESULT_UNKNOWN');
  h.storeControl.beforeCommit = null;
  assert.equal(h.state.aiRun.length, 2);
  assert.equal(h.state.aiTaskInputReceipt.length, 1);
  assert.equal(h.modelControl.sent.length, 1);
  const replay = await h.root.application.resume(submission);
  assert.equal(replay.continuation.reason, 'receipt_replayed');
  assert.equal(h.modelControl.sent.length, 1);
  const successor = h.state.aiRun[1];
  assert.equal(successor.inputReceiptId, replay.receipt.receiptId);
  const finished = await composeTaskModelHost(h.config).application.start({ taskId: h.query.taskId, runId: successor.id });
  assert.equal(finished.outcome.status, 'succeeded');
  assert.equal(h.modelControl.sent.length, 2);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 2n);
});

test('model clarification cannot obtain new quota by creating another run', { timeout: 20000 }, async () => {
  const h = await clarificationHost(4);
  assert.equal((await h.root.application.start(h.query)).outcome.status, 'paused');
  const fingerprint = h.state.aiTaskExecutionBudget[0].policyFingerprint;
  for (let turn = 1; turn <= 4; turn++) {
    const pending = await h.root.application.readInput({ taskId: h.query.taskId });
    const result = await h.root.application.resume(h.answer(pending));
    if (turn < 4) assert.equal(result.continuation.outcome.status, 'paused');
    else assert.deepEqual(result.continuation, { kind: 'unavailable', errorCode: 'AI_RUN_LIMIT' });
  }
  assert.equal(h.modelControl.sent.length, 4);
  assert.equal(h.state.aiGatewayInvocation.length, 4);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].policyFingerprint, fingerprint);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 4n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 4n);
  assert.equal(h.state.aiTaskExecutionBudget[0].maxCalls, 4n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.equal(h.state.aiStep.at(-1).status, 'PENDING');
  assert.ok(h.state.aiRun.every(r => r.leaseOwnerId === null));
});

test('model host cannot substitute an absent financial reader or price version', async () => {
  const h = await modelHostHarness(), before = h.clone(h.state);
  assert.throws(() => composeTaskModelHost({ ...h.config, financialEvidence: undefined }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => composeTaskModelHost({ ...h.config, priceVersion: undefined }));
  assert.deepEqual(h.state, before); assert.deepEqual(h.modelControl.sent, []);
});

for (const mode of ['membership', 'ai_closed']) test(`model host checks ${mode} before any new preparation or claim`, async () => {
  const h = await modelHostHarness();
  if (mode === 'membership') h.identity.membership = false; else h.state.aiBudgetPolicy[0].enabled = false;
  const before = h.clone(h.state);
  await assert.rejects(h.root.application.start(h.query), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, before); assert.deepEqual(h.modelControl.sent, []);
});

test('model host leaves original publication after a lost acknowledgement without starting a step', async () => {
  const h = await modelHostHarness(); let lost = false;
  h.storeControl.beforeCommit = async draft => {
    if (!lost && draft.aiTaskActionInput.length) { lost = true; h.storeControl.loseReply = true; }
  };
  await assert.rejects(h.root.application.start(h.query), e => e.code === 'AI_RESULT_UNKNOWN');
  h.storeControl.beforeCommit = null;
  assert.equal(lost, true); assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.equal(h.state.aiTaskRunPlan.length, 0); assert.equal(h.state.aiStep.length, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
  assert.deepEqual(h.modelControl.sent, []); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  const snapshot = await h.root.application.inspect(h.query); assert.equal(snapshot.plan, null); assert.equal(snapshot.resources, null);
});

test('model host refuses a changed route after durable step start but before invocation registration', async () => {
  const h = await modelHostHarness(); let changed = false;
  h.storeControl.beforeCommit = async draft => {
    if (!changed && draft.aiStep[0]?.status === 'RUNNING') { changed = true; draft.aiProviderProfile[0].configRevision++; }
  };
  await assert.rejects(h.root.application.start(h.query));
  assert.equal(changed, true); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.deepEqual(h.modelControl.sent, []);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedSteps, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 0n);
});

test('model host keeps missing provider usage unknown and never settles it as zero', async () => {
  const h = await modelHostHarness(); h.modelControl.result = { text: 'No usage returned' };
  const result = await h.root.application.start(h.query);
  assert.equal(result.outcome.status, 'unknown'); assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
  assert.equal(h.state.aiStep[0].status, 'UNKNOWN'); assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n); assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 1n);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'UNKNOWN'));
  assert.equal(h.modelControl.sent.length, 1); assert.equal(h.modelControl.events.includes('settle'), false);
});

for (const complete of [true, false]) test(`model host recovery reads ${complete ? 'completed' : 'unknown'} original evidence with the already-held lease and no new call`, async () => {
  const h = await modelHostHarness();
  if (!complete) h.modelControl.onInvoke = async () => { throw Error('synthetic interrupted transport'); };
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && args.data?.status === 'SUCCEEDED' || name === 'aiRun' && args.data?.leaseOwnerId === null) throw Error('synthetic interrupted worker');
  };
  await assert.rejects(h.root.application.start(h.query)); h.storeControl.beforeWrite = null;
  const artifacts = h.clone(h.state.aiTaskResultArtifact), invocation = h.clone(h.state.aiGatewayInvocation);
  const charges = h.state.aiTaskExecutionCharge.map(c => c.chargeId), fence = h.state.aiRun[0].fencingToken.toFixed(0);
  const result = await h.root.application.reconcile(h.query);
  assert.equal(result.outcome.status, complete ? 'succeeded' : 'unknown');
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiGatewayInvocation, invocation);
  assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), charges);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), fence); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, complete ? 1n : 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, complete ? 0n : 1n); assert.equal(h.modelControl.sent.length, 1);
});

test('model host cancellation during dispatch preserves original unknown occupancy and never emits a fresh invocation', async () => {
  const h = await modelHostHarness();
  h.modelControl.onInvoke = async () => h.root.taskTransitions.transition({ taskId: h.query.taskId,
    expectedRevision: h.state.aiTask[0].revision, to: 'cancel_requested', reason: 'cancel_requested' });
  const result = await h.root.application.start(h.query);
  assert.equal(result.outcome.status, 'unknown'); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.modelControl.sent.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
});
