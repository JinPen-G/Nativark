'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { modelHostHarness } = require('./fixtures/ai-native/task-model-host.cjs');
const { composeTaskModelHost } = require('../apps/api/src/modules/ai-native/runner/model-task-host.composition');

test('formal call task host assembles the original runner and persistent ledger without a default live configuration', async () => {
  const { composePersistedTaskCallGateway, composePersistedCallTaskModelHost } = require('../apps/api/src/modules/ai-native/task-model-gateway.composition');
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const h = await modelHostHarness();
  // Database delegates only, not a substitute Gateway/authority/budget. The
  // missing configuration is deliberate: no default profile or live evidence.
  const records = createTaskInputStore({ aiTenantModelConfiguration: [], systemParameterSet: [], aiPlatformModelConnection: [], aiProviderCapabilityEvidence: [] });
  for (const table of ['aiTenantModelConfiguration', 'systemParameterSet', 'aiPlatformModelConnection', 'aiProviderCapabilityEvidence']) h.db[table] = records.db[table];
  // Platform management is not exercised; its write delegate cannot fake a save.
  h.db.aiPlatformModelConnection.update = async () => { throw Error('unexpected platform write'); };
  let secrets = 0, sends = 0;
  const gateway = { secrets: { encrypt: () => { secrets++; throw Error('unexpected encryption'); },
    decrypt: () => { secrets++; throw Error('unexpected decryption'); } },
    platformProfileId: 'platform-profile-a', routeScene: 'chat', callPriceVersion: 'synthetic-calls-1',
    adapters: [{ provider: 'openai_chat_completions', features: ['text'],
      generate: async () => { sends++; throw Error('unexpected transport'); } }], audit: { append: async () => {} } };
  const dependencies = { ...h.authorization, db: h.db, clock: h.config.clock, guard: h.config.guard, taskId: 'task-a', ...gateway };
  const begin = h.trace.length;
  const assembled = composePersistedTaskCallGateway(dependencies);
  assert.equal(assembled.runtime.evidence, 'live');
  assert.equal(typeof assembled.financialEvidence.readDispatch, 'function');
  assert.deepEqual(h.trace.slice(begin), []);
  await assert.rejects(assembled.runtime.ports.routing.resolve({ tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'user-a' }, ['text']),
    error => ['AI_REVISION_CONFLICT', 'FORBIDDEN', 'AI_RESOURCE_UNAVAILABLE'].includes(error.code));
  const { runtime, priceVersion, financialEvidence, ...config } = h.config;
  const root = composePersistedCallTaskModelHost({ ...config, gateway });
  await assert.rejects(root.application.start(h.query), error => ['DISABLED', 'PROVIDER_UNAVAILABLE'].includes(error.code));
  assert.equal(sends, 0); assert.equal(secrets, 0);
  assert.equal(h.state.aiGatewayInvocation.length, 0);
  assert.equal(h.state.aiBudgetReservation.length, 0);
  assert.equal(h.state.aiGatewayAccountingReceipt.length, 0);
  assert.throws(() => composePersistedCallTaskModelHost({ ...config, gateway: { ...gateway, routeScene: 'reasoning' } }),
    error => error.code === 'CONFIG_INVALID');
  const { PrismaTaskBudgetAuthorizationSource } = require('../apps/api/src/modules/ai-native/budget/prisma-task-budget-authorization.source');
  const bound = new PrismaTaskBudgetAuthorizationSource(dependencies);
  const context = await bound.resolveContext();
  dependencies.taskId = 'task-b';
  h.state.aiGatewayInvocation.push({ scopeId: 'scope-a', callId: 'other-call', taskId: 'task-b', actorId: 'user-a' });
  await assert.rejects(bound.authorize('reserve', context, { association: { requestId: 'other-call', scope: context.scope } }),
    error => error.code === 'FORBIDDEN');
});

for (const mode of ['platform_managed', 'tenant_managed']) test(`explicit ${mode} settings enter the original model host without legacy tenant scene budgets`, async () => {
  const h = await modelHostHarness();
  h.state.aiTenantModelConfiguration.push({ tenantId: 'tenant-a', revision: 1, mode, serviceEnabled: true,
    settings: mode === 'tenant_managed' ? { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://synthetic.example.test/v1',
      model: 'synthetic-model', timeoutMs: 30000, maxConcurrent: 2, maxOutputTokens: 2048 } : null,
    credentialsEncrypted: mode === 'tenant_managed' ? 'v2:synthetic:YWJj:YWJj:YWJj' : null });
  h.state.aiBudgetPolicy = h.state.aiBudgetPolicy.filter(policy => policy.scopeKind === 'PLATFORM');
  const before = h.clone(h.state.aiBudgetPolicy);
  const result = await h.root.application.start(h.query);
  assert.equal(result.outcome.status, 'succeeded');
  assert.equal(h.modelControl.sent.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n);
  assert.deepEqual(h.state.aiBudgetPolicy, before);
});

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

for (const kind of ['image', 'audio']) test(`${kind} clarification resumes through current media authority and the original cumulative budget`, { timeout: 20000 }, async () => {
  const h = await clarificationHost(2, kind);
  assert.equal((await h.root.application.start(h.query)).outcome.status, 'paused');
  const original = h.clone(h.state.aiTaskActionInput[0]);
  const fingerprint = h.state.aiTaskExecutionBudget[0].policyFingerprint;
  for (let turn = 1; turn <= 2; turn++) {
    const pending = await h.root.application.readInput({ taskId: h.query.taskId });
    const submission = h.answer(pending);
    let result;
    if (turn === 1) {
      const sentBefore = h.modelControl.sent.length;
      await h.root.inputs.submit(submission);
      assert.equal(h.modelControl.sent.length, sentBefore, 'persisting an answer does not dispatch a model');
      const { taskId: _task, ...answer } = submission;
      const continued = await composeTaskModelHost(h.config).continueOriginalInput(answer);
      result = { continuation: continued.execution };
      const sentAfter = h.modelControl.sent.length;
      assert.equal((await composeTaskModelHost(h.config).continueOriginalInput(answer)).execution.reason, 'task_not_runnable');
      assert.equal(h.modelControl.sent.length, sentAfter, 'repeated continuation cannot replay the model');
    } else result = await composeTaskModelHost(h.config).application.resume(submission);
    assert.equal(result.continuation.kind, 'run_outcome', JSON.stringify(result));
    assert.equal(result.continuation.outcome.status, turn === 1 ? 'paused' : 'succeeded');
    assert.equal((await h.root.application.resume(submission)).continuation.reason, 'receipt_replayed');
    assert.equal(h.state.aiTaskExecutionBudget.length, 1);
    assert.equal(h.state.aiTaskExecutionBudget[0].policyFingerprint, fingerprint);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, BigInt(turn + 1));
    assert.equal(h.state.aiRun[turn].resourceOriginRunId, h.query.runId);
    assert.ok(h.state.aiRun[turn].startedAt instanceof Date);
    assert.equal(h.state.aiRun[turn].startedAt.toISOString(), h.config.clock().toISOString());
    const stored = h.state.aiTaskActionInput.at(-1).payload;
    assert.equal(stored.intent.requiredFeatures.includes(kind), true);
    assert.deepEqual(stored.media, original.payload.media);
    assert.equal(stored.intent.messages.at(-1).content[0].text.includes(submission.answers[0].value), true);
  }
  assert.deepEqual(h.state.aiTaskActionInput[0], original);
  assert.equal(h.modelControl.sent.length, 3);
  assert.equal(new Set(h.state.aiGatewayInvocation.map(row => row.callId)).size, 3);
  assert.equal(h.state.aiGatewayAccountingReceipt.length, 3);

  const revoked = await clarificationHost(1, kind);
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
    const successor = h.state.aiRun[turn], parent = h.state.aiRun[turn - 1];
    assert.ok(successor.startedAt instanceof Date, 'an activated successor run needs its own start timestamp');
    assert.equal(successor.startedAt.toISOString(), h.config.clock().toISOString());
    assert.ok(parent.endedAt instanceof Date); assert.equal(parent.status, 'SUCCEEDED');
    assert.ok(successor.startedAt >= parent.endedAt);
    const originalStartedAt = successor.startedAt.toISOString();
    const originalEndedAt = successor.endedAt?.toISOString() ?? null;
    const sentBeforeReplay = h.modelControl.sent.length;
    assert.equal((await composeTaskModelHost(h.config).application.resume(submission)).continuation.reason, 'receipt_replayed');
    assert.equal(h.state.aiRun[turn].startedAt.toISOString(), originalStartedAt);
    assert.equal(h.state.aiRun[turn].endedAt?.toISOString() ?? null, originalEndedAt);
    assert.equal(h.modelControl.sent.length, sentBeforeReplay);
  }
  assert.equal(h.state.aiRun[2].status, 'SUCCEEDED');
  assert.ok(h.state.aiRun[2].endedAt instanceof Date);
  assert.ok(h.state.aiRun[2].endedAt >= h.state.aiRun[2].startedAt);
  assert.deepEqual(h.state.aiTaskActionInput[0], originalInput);
  assert.deepEqual(h.state.aiTaskRunPlan[0], originalPlan);
  assert.equal(h.state.aiTask[0].status, 'SUCCEEDED');
  const rebuilt = composeTaskModelHost(h.config), beforeRead = h.clone(h.state);
  assert.equal((await rebuilt.readOriginalRecovery()).run.runId, h.state.aiRun[2].id);
  assert.equal((await rebuilt.recoverOriginal()).reason, 'task_not_runnable');
  assert.deepEqual(h.state, beforeRead);
  assert.equal(h.modelControl.sent.length, 3);
  assert.equal(new Set(h.modelControl.sent.map(r => r.callId)).size, 3);
  assert.equal(h.state.aiGatewayInvocation.length, 3);
  // Each original run now also records preparation and startup/final overhead;
  // these charges cannot disappear merely because the synthetic clock is idle.
  assert.equal(h.state.aiTaskExecutionCharge.length, 21);
  assert.equal(h.state.aiTaskExecutionCharge.filter(c => c.stepId != null).length, 12);
  assert.equal(h.state.aiTaskRunPreparation.length, 3);
  assert.equal(h.state.aiTaskRunOverhead.length, 6);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  assert.ok(h.state.aiRun.every(r => r.leaseOwnerId === null));
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, h.state.aiTaskResultArtifact.reduce((n, r) => n + r.outputBytes, 0n));
  assert.match(h.modelControl.sent[1].messages.at(-1).content, /clarification_answers/);
  assert.ok(h.modelControl.sent[2].messages.at(-1).content.includes(h.state.aiTaskInputReceipt[1].answers[0].value));
});

for (const pendingRegistration of [false, true]) test(`model clarification lost answer acknowledgement reads the same successor without redispatch${pendingRegistration ? ' with an untouched pending registration' : ''}`, { timeout: 20000 }, async () => {
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
  assert.ok(successor.startedAt instanceof Date);
  const originalStartedAt = successor.startedAt.toISOString();
  assert.equal(successor.endedAt ?? null, null, 'input receipt does not attest model completion');
  // A successor's plan may commit before the preparation reply is lost. The
  // explicit continuation must reuse that frozen plan under a new valid lease,
  // not regenerate its model input or treat it as already dispatched work.
  let planReplyLost = false;
  h.storeControl.beforeCommit = async draft => {
    if (!planReplyLost && draft.aiTaskRunPlan.some(row => row.runId === successor.id)
      && !h.state.aiTaskRunPlan.some(row => row.runId === successor.id)) {
      planReplyLost = true; h.storeControl.loseReply = true;
    }
  };
  await assert.rejects(composeTaskModelHost(h.config).application.start({ taskId: h.query.taskId, runId: successor.id }),
    error => ['AI_STORAGE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'].includes(error.code));
  h.storeControl.beforeCommit = null;
  assert.equal(planReplyLost, true);
  assert.equal(h.modelControl.sent.length, 1);
  assert.equal(h.state.aiStep.filter(row => row.runId === successor.id).length, 0);
  const originalPreparationCharges = h.clone(h.state.aiTaskExecutionCharge.filter(row => row.runId === successor.id));
  const originalPreparation = h.clone(h.state.aiTaskRunPreparation.find(row => row.runId === successor.id));
  assert.equal(originalPreparationCharges.length, 1);
  assert.equal(originalPreparationCharges.filter(row => row.stepId !== null).length, 0);
  const preparationCharge = originalPreparationCharges[0];
  assert.equal(preparationCharge.resource, 'ACTIVE_MS');
  assert.equal(preparationCharge.status, 'RECORDED');
  assert.equal(preparationCharge.actionId, null);
  assert.equal(preparationCharge.gatewayInvocationId, null);
  assert.ok(originalPreparation.completedAt && originalPreparation.measurementHash);
  assert.equal(originalPreparation.prepared, true, 'the original committed plan is observed, not new execution authority');
  assert.equal(originalPreparation.chargeId, preparationCharge.chargeId);
  assert.equal(preparationCharge.actualAmount, originalPreparation.activeMs);
  assert.equal(preparationCharge.outcomeFingerprint, originalPreparation.measurementHash);
  assert.equal(preparationCharge.evidenceRef, `preparation:${originalPreparation.id}`);
  assert.equal(h.state.aiGatewayInvocation.filter(row => row.runId === successor.id).length, 0);
  assert.equal(h.state.aiTaskExecutionPhaseStart.filter(row => row.runId === successor.id).length, 0);
  assert.equal(h.state.aiTaskResultArtifact.filter(row => row.runId === successor.id).length, 0);
  const originalSuccessorInput = h.clone(h.state.aiTaskActionInput.filter(row => row.runId === successor.id));
  const originalSuccessorPlan = h.clone(h.state.aiTaskRunPlan.find(row => row.runId === successor.id));
  assert.equal(originalPreparation.planHash, originalSuccessorPlan.planHash);
  const { parseTaskModelInput, continueTaskModelMaterial } = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const policy = { sceneCode: h.config.gatewayScene.sceneCode, maxOutputTokens: h.config.gatewayScene.maxOutputTokens };
  const previous = parseTaskModelInput(h.state.aiTaskActionInput.find(row => row.runId === h.query.runId).payload, policy);
  const expectedMaterial = continueTaskModelMaterial(previous,
    h.state.aiTaskResultArtifact.find(row => row.runId === h.query.runId).payload, h.state.aiTaskInputReceipt[0].answers, policy);
  assert.deepEqual(originalSuccessorInput[0].payload.intent.messages, expectedMaterial.messages);
  const released = h.state.aiRun.find(row => row.id === successor.id);
  assert.equal(released.leaseOwnerId, null);
  assert.equal(released.leaseExpiresAt, null);
  if (pendingRegistration) {
    const metadata = await h.root.authorization.tasks.readMetadata(h.query.taskId);
    const lease = await h.root.authorization.tasks.claimRun({ taskId: h.query.taskId, runId: successor.id,
      holderId: 'registration-only-host', leaseMs: 100000, expectedTaskRevision: metadata.revision,
      expectedRunRevision: released.revision, expectedFencingToken: released.fencingToken.toFixed(0) });
    await h.root.model.registrations.register({ taskId: h.query.taskId,
      registrationRef: originalSuccessorPlan.payload.steps[0].registrationRef, expectedTaskRevision: metadata.revision,
      lease: { runId: successor.id, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken } });
    const currentTask = await h.root.authorization.tasks.readMetadata(h.query.taskId), currentRun = h.state.aiRun.find(row => row.id === successor.id);
    await h.root.authorization.tasks.releaseRun({ taskId: h.query.taskId, runId: successor.id, holderId: lease.holderId,
      expectedTaskRevision: currentTask.revision, expectedRunRevision: currentRun.revision,
      expectedFencingToken: currentRun.fencingToken.toFixed(0) });
    assert.equal(h.state.aiStep.find(row => row.runId === successor.id).status, 'PENDING');
    assert.deepEqual(h.state.aiTaskExecutionCharge.filter(row => row.runId === successor.id), originalPreparationCharges);
    assert.deepEqual(h.state.aiTaskRunPreparation.find(row => row.id === originalPreparation.id), originalPreparation);
  }
  const rebuilt = composeTaskModelHost({ ...h.config, host: { holderId: 'continued-model-host', leaseMs: 100000 } });
  const { taskId: _task, ...answer } = submission;
  // Returned contradictory traces cannot turn PENDING into a no-consumption
  // proof. These are read-only fixture responses, never fabricated DB effects.
  if (pendingRegistration) {
    assert.deepEqual(h.state.aiTaskRunPlan.find(row => row.runId === successor.id), originalSuccessorPlan);
    assert.equal(require('../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint(originalSuccessorPlan.payload), originalPreparation.planHash);
  }
  for (const table of ['aiTaskExecutionCharge', 'aiGatewayInvocation', 'aiTaskExecutionPhaseStart', 'aiTaskResultArtifact']) {
    let observed = false;
    h.storeControl.beforeRead = async (name, query, view) => {
      if (name === table && query?.where?.runId === successor.id && view !== h.state
        && h.trace.at(-1) === `${table}.read`) {
        observed = true;
        view[table].push({ scopeId: 'scope-a', taskId: h.query.taskId, runId: successor.id });
      }
    };
    await assert.rejects(rebuilt.continueOriginalInput(answer), error => {
      assert.equal(error.code, 'AI_RESOURCE_UNAVAILABLE', `contradictory original trace: ${table}`);
      return true;
    });
    h.storeControl.beforeRead = null;
    assert.equal(observed, true);
    assert.deepEqual(h.state.aiTaskRunPlan.find(row => row.runId === successor.id), originalSuccessorPlan);
    assert.equal(h.modelControl.sent.length, 1);
    assert.equal(h.state.aiGatewayInvocation.length, 1);
    assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n);
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  }
  const parentArtifact = h.state.aiTaskResultArtifact.find(row => row.runId === h.query.runId);
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  let parentChanged = false;
  const transaction = h.db.$transaction.bind(h.db), parentBefore = h.clone(parentArtifact);
  h.db.$transaction = (work, options) => transaction(async tx => {
    if (options?.isolationLevel === 'RepeatableRead') {
      const read = tx.aiTaskResultArtifact.findUnique.bind(tx.aiTaskResultArtifact);
      tx.aiTaskResultArtifact.findUnique = async query => {
        const row = await read(query);
        if (row?.id !== parentArtifact.id) return row;
        parentChanged = true;
        const changed = h.clone(row);
        changed.payload.text += ' changed original result';
        changed.contentHash = requestFingerprint(changed.payload);
        changed.outputBytes = BigInt(Buffer.byteLength(JSON.stringify(changed.payload), 'utf8'));
        return changed;
      };
    }
    return work(tx);
  }, options);
  await assert.rejects(rebuilt.continueOriginalInput(answer), error => error.code === 'AI_ACCESS_DENIED');
  h.db.$transaction = transaction;
  assert.equal(parentChanged, true);
  assert.deepEqual(h.state.aiTaskResultArtifact.find(row => row.id === parentArtifact.id), parentBefore);
  assert.equal(h.modelControl.sent.length, 1);
  const continued = await rebuilt.continueOriginalInput(answer);
  const finished = continued.execution;
  assert.equal(finished.kind, 'run_outcome', JSON.stringify(finished));
  assert.equal(finished.outcome.status, 'succeeded');
  assert.deepEqual(h.state.aiTaskActionInput.filter(row => row.runId === successor.id), originalSuccessorInput);
  assert.deepEqual(h.state.aiTaskRunPlan.find(row => row.runId === successor.id), originalSuccessorPlan);
  assert.deepEqual(h.state.aiTaskRunPreparation.find(row => row.id === originalPreparation.id), originalPreparation);
  for (const charge of originalPreparationCharges) assert.deepEqual(h.state.aiTaskExecutionCharge.find(row => row.chargeId === charge.chargeId), charge);
  assert.equal(h.state.aiRun[1].startedAt.toISOString(), originalStartedAt);
  assert.ok(h.state.aiRun[1].endedAt instanceof Date);
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
    // The persistent runner now closes a known pre-reservation limit. Earlier
    // completed runs remain partial task success; the untouched successor fails.
    else assert.deepEqual(result.continuation, { kind: 'run_outcome',
      outcome: { status: 'partially_succeeded', completedSteps: 0, cleanupFailed: 0 } });
  }
  assert.equal(h.state.aiTask[0].status, 'PARTIALLY_SUCCEEDED');
  assert.equal(h.state.aiRun.at(-1).status, 'FAILED');
  assert.ok(h.state.aiRun.slice(0, -1).every(run => run.status === 'SUCCEEDED'));
  assert.equal(h.state.aiStep.at(-1).effect, 'NONE');
  assert.equal(h.state.aiStep.at(-1).resultRef, null);
  assert.equal(h.state.aiGatewayInvocation.filter(row => row.runId === h.state.aiRun.at(-1).id).length, 0);
  assert.equal(h.state.aiTaskExecutionCharge.filter(row => row.stepId === h.state.aiStep.at(-1).id).length, 0);
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
  assert.deepEqual(h.modelControl.sent, []);
  // Unknown publication acknowledgement is not proof that its live holder was
  // released. Preserve the original generation and forbid immediate re-entry.
  assert.equal(h.state.aiRun[0].leaseOwnerId, 'model-host');
  const before = h.clone(h.state);
  assert.deepEqual(await h.root.application.start(h.query), { kind: 'not_started', reason: 'lease_held' });
  assert.deepEqual(h.state, before); assert.deepEqual(h.modelControl.sent, []);
  const snapshot = await h.root.application.inspect(h.query); assert.equal(snapshot.plan, null); assert.equal(snapshot.resources, null);
});

test('model host refuses a changed route after durable step start but before invocation registration', async () => {
  const h = await modelHostHarness(); let changed = false;
  h.storeControl.beforeCommit = async draft => {
    if (!changed && draft.aiStep[0]?.status === 'RUNNING') { changed = true; draft.aiProviderProfile[0].configRevision++; }
  };
  const result = await h.root.application.start(h.query);
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'unknown');
  assert.equal(result.outcome.completedSteps, 0);
  assert.equal(changed, true); assert.equal(h.state.aiStep[0].status, 'UNKNOWN');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.ok(h.state.aiTaskExecutionCharge.every(charge => charge.status === 'UNKNOWN'));
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
  if (!complete) { h.config.host = { holderId: 'model-host', leaseMs: 1000 }; h.root = composeTaskModelHost(h.config); }
  if (!complete) h.modelControl.onInvoke = async () => { throw Error('synthetic interrupted transport'); };
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && args.data?.status === 'SUCCEEDED' || name === 'aiRun' && args.data?.leaseOwnerId === null) throw Error('synthetic interrupted worker');
  };
  await assert.rejects(h.root.application.start(h.query)); h.storeControl.beforeWrite = null;
  const artifacts = h.clone(h.state.aiTaskResultArtifact), invocation = h.clone(h.state.aiGatewayInvocation);
  const charges = h.state.aiTaskExecutionCharge.map(c => c.chargeId), fence = h.state.aiRun[0].fencingToken.toFixed(0);
  let result;
  if (complete) result = await h.root.reconcileOriginal();
  else {
    h.control.now = new Date(h.control.now.getTime() + 1001);
    const rebuilt = composeTaskModelHost({ ...h.config, host: { holderId: 'recovery-host', leaseMs: 1000 } });
    result = await rebuilt.recoverOriginal();
  }
  assert.equal(result.outcome.status, complete ? 'succeeded' : 'unknown');
  assert.deepEqual(h.state.aiTaskResultArtifact, artifacts); assert.deepEqual(h.state.aiGatewayInvocation, invocation);
  assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), charges);
  assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), complete ? fence : (BigInt(fence) + 1n).toString());
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, complete ? 1n : 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, complete ? 0n : 1n); assert.equal(h.modelControl.sent.length, 1);
});

test('model host cancellation during dispatch preserves original unknown occupancy and never emits a fresh invocation', async () => {
  const h = await modelHostHarness();
  await assert.rejects(h.root.requestCancelOriginal({ taskId: 'other-task', expectedRevision: h.state.aiTask[0].revision }),
    e => e.code === 'AI_INVALID_INPUT');
  h.modelControl.onInvoke = async () => {
    const requested = await h.root.requestCancelOriginal({ expectedRevision: h.state.aiTask[0].revision });
    assert.equal(requested.cancellation, 'requested_not_rollback');
    assert.equal(requested.retryable, false);
  };
  const result = await h.root.application.start(h.query);
  assert.equal(result.outcome.status, 'unknown'); assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.modelControl.sent.length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
  const invocation = h.clone(h.state.aiGatewayInvocation), accounting = h.clone(h.state.aiGatewayAccountingReceipt);
  assert.equal(accounting.length, 1); assert.equal(accounting[0].inputTokens, 1n); assert.equal(accounting[0].outputTokens, 2n);
  assert.match(accounting[0].usageHash, /^[a-f0-9]{64}$/);
  const originalCharges = h.clone(h.state.aiTaskExecutionCharge), budget = h.clone(h.state.aiTaskExecutionBudget[0]);
  const cancelled = h.clone(h.state);
  h.identity.session = false;
  await assert.rejects(composeTaskModelHost(h.config).readOriginalRecovery(), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(composeTaskModelHost(h.config).recoverOriginal(), e => e.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.state, cancelled);
  h.identity.session = true;
  const recovered = await composeTaskModelHost({ ...h.config, host: { holderId: 'cancel-recovery-host', leaseMs: 100000 } }).recoverOriginal();
  assert.equal(recovered.outcome.status, 'unknown');
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.deepEqual(h.state.aiGatewayInvocation, invocation); assert.deepEqual(h.state.aiGatewayAccountingReceipt, accounting);
  for (const row of originalCharges) assert.deepEqual(h.state.aiTaskExecutionCharge.find(current => current.chargeId === row.chargeId), row);
  assert.equal(h.state.aiTaskExecutionBudget[0].policyFingerprint, budget.policyFingerprint);
  assert.equal(h.state.aiTaskExecutionBudget[0].maxActiveMs, budget.maxActiveMs);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 1n); assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
  assert.equal(h.state.aiGatewayInvocation.length, 1); assert.equal(h.modelControl.sent.length, 1);
});
