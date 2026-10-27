'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', lib: ['es2022'], experimentalDecorators: true, emitDecoratorMetadata: true } });
const { taskInputHarness } = require('./fixtures/ai-native/task-input-harness.cjs');

test('actual persistent runner continues a second step within cumulative output budget', async () => {
  const h = await taskInputHarness();
  const result = await h.make().runner.run(h.claim());
  assert.equal(result.status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 20n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedOutputBytes, 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes,
    h.state.aiTaskResultArtifact.reduce((n, artifact) => n + artifact.outputBytes, 0n));
});

test('exhausted cumulative output prevents the next effect without resetting any counters', async () => {
  const h = await taskInputHarness();
  h.control.execute = async () => ({ kind: 'succeeded', payload: 'x'.repeat(4094) });
  await assert.rejects(h.make().runner.run(h.claim()), e => e.code === 'AI_RUN_LIMIT');
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedOutputBytes, 4096n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedOutputBytes, 0n);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
});

// Actual runner/resource/evidence repositories; invocation preparation, provider
// outcomes and financial dispatch reader are explicit offline doubles, not live I/O.
async function countedModelHarness(mode = 'observed', maxCalls = 2) {
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { CountingTaskModelInvocationPreparation } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.task-bound');
  const { PrismaCountTokensReceipts, countTokensCallId, countTokensSceneCode } = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.receipt');
  const h = await taskInputHarness({ aiScope: [{ id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant-a', workspaceId: 'workspace-a', scopeKey: 'workspace:8:tenant-a:11:workspace-a' }], aiBudgetReservation: [], aiTaskActionInput: [] });
  const abort = new AbortController(), counts = [], generations = [];
  const config = { configId: 'profile-a', configRevision: 1, credentialRef: 'synthetic-vault', protocol: 'anthropic_messages',
    provider: 'synthetic', model: 'synthetic-model', serviceMode: 'tenant_managed', tenantId: 'tenant-a', configurationScope: { kind: 'tenant', tenantId: 'tenant-a' } };
  const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
  const model = require('../apps/api/src/modules/ai-native/model-input/task-model-input');
  const policy = { sceneCode: 'synthetic-clarification', maxOutputTokens: 32 };
  const intent = model.taskModelIntent('task-a', 'run-a', 'clarify', policy.sceneCode,
    { messages: [{ role: 'user', content: [{ kind: 'text', text: 'Synthetic bounded input' }] }], maxOutputTokens: 32 });
  const body = { mode: 'invoke', intent, configuration: config, priceVersion: 'generation-price',
    routingHash: 'e'.repeat(64), identityHash: model.taskModelIdentity(h.context()) };
  const fingerprint = model.taskModelFingerprint(body, policy);
  h.state.aiTaskActionInput.push({ id: 'input-clarify', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a',
    registrationRef: 'clarify', toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION, payload: body,
    fingerprint, expiresAt: new Date(h.control.now.getTime() + 100000) });
  const registration = h.registrationAuthority.resolve;
  h.registrationAuthority.resolve = async command => ({ ...await registration(command), toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION, requestFingerprint: fingerprint });
  h.plan.steps = [{ registrationRef: 'clarify', operation: 'external_unknown', toolCode: 'ai.model.text', toolVersion: AI_TOOL_DRAFT_VERSION }];
  h.plan.limits.maxCalls = maxCalls;
  Object.assign(h.state.aiTaskRunPlan[0], { payload: h.clone(h.plan), planHash: hash(h.plan) });
  const invocations = new CountingTaskModelInvocationPreparation({ prepare: async (ref, lease, signal) => {
    assert.equal(signal.aborted, false);
    const step = h.state.aiStep.find(row => row.id === ref.registered.stepId);
    const invocation = await h.db.aiGatewayInvocation.create({ data: { id: 'invocation-a', scopeId: 'scope-a', taskId: 'task-a',
      runId: 'run-a', stepId: step.id, actionId: step.actionId, stepFingerprint: step.requestFingerprint, actorId: 'user-a',
      callId: intent.requestId, sceneCode: 'synthetic-clarification', mode: 'invoke', intentHash: fingerprint, registrationHash: 'a'.repeat(64),
      configuration: config, configurationHash: hash(config), priceVersion: 'generation-price', maxOutputTokens: 32,
      leaseOwnerId: lease.holderId, fencingToken: new Prisma.Decimal(lease.fencingToken), expiresAt: new Date(lease.expiresAt) } });
    if (mode === 'registration_abort') abort.abort();
    return { invocationId: invocation.id };
  } }, { taskCount: async (_command, signal) => {
    assert.equal(signal.aborted, false);
    assert.equal(h.state.aiTaskResultArtifact.length, 1);
    assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
    assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 2n);
    counts.push('count'); h.control.tick += 10;
    const invocation = h.state.aiGatewayInvocation[0], countCallId = countTokensCallId(invocation.callId);
    const receipt = { version: 'ai-count-tokens-receipt-1', state: mode === 'unknown' ? 'unknown' : 'observed',
      tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'user-a', callId: invocation.callId, countCallId,
      invocationId: invocation.id, scopeId: 'scope-a', sceneCode: invocation.sceneCode, protocol: config.protocol, model: config.model,
      registrationHash: invocation.registrationHash, intentHash: invocation.intentHash, configurationHash: invocation.configurationHash,
      priceVersion: invocation.priceVersion, maxOutputTokens: 32, method: 'provider_count_tokens_receipt', countRequestHash: 'c'.repeat(64),
      admission: { reservationId: 'count-budget', sceneCode: countTokensSceneCode(invocation.sceneCode), unit: 'calls' },
      observedAt: h.control.now.toISOString(), expiresAt: new Date(h.control.now.getTime() + 60000).toISOString(),
      ...(mode === 'unknown' ? {} : { inputTokens: 12 }) };
    await h.db.aiBudgetReservation.create({ data: { id: 'count-budget', scopeId: 'scope-a', scopeKind: 'WORKSPACE',
      tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, actorId: receipt.actorId, callId: countCallId,
      requestId: countCallId, idempotencyKey: countCallId, runId: invocation.runId, stepId: invocation.stepId, actionId: invocation.actionId,
      sceneCode: receipt.admission.sceneCode, priceVersion: 'count-price', configurationHash: hash(config), configRevision: 1,
      unitKind: 'calls', reservedCalls: 1, actualCalls: mode === 'unknown' ? null : 1,
      status: mode === 'unknown' ? 'pending_reconciliation' : 'settled', dispatchState: mode === 'unknown' ? 'unknown' : 'completed' } });
    const receipts = new PrismaCountTokensReceipts(h.db);
    await receipts.claimDispatch({ tenantId: receipt.tenantId, workspaceId: receipt.workspaceId, actorId: receipt.actorId,
      callId: receipt.callId, reservationId: receipt.admission.reservationId, registrationHash: receipt.registrationHash,
      intentHash: receipt.intentHash, configurationHash: receipt.configurationHash, countRequestHash: receipt.countRequestHash });
    await receipts.append(receipt);
    if (mode === 'abort') abort.abort();
    return receipt;
  }, publish: async () => { assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 1n); } });
  const configuration = { ...h.configuration(), invocations, toolCatalog: { resolve: async () => ({ modelCall: true }) },
    financialEvidence: { readDispatch: async () => ({ state: 'dispatched', reservationId: 'generation-budget', requestId: intent.requestId,
      callId: intent.requestId, actorId: 'user-a', scopeKey: 'WORKSPACE:scope-a', runId: 'run-a', stepId: h.state.aiStep[0].id,
      actionId: h.state.aiStep[0].actionId, sceneCode: 'synthetic-clarification', priceVersion: 'generation-price',
      configurationHash: hash(config), configRevision: 1, dispatchToken: 'generation-dispatch' }) },
    executors: { resolve: async () => ({ operation: 'external_unknown', execute: async () => {
      generations.push('generation'); h.control.tick += 10;
      await h.db.aiGatewayAccountingReceipt.create({ data: { scopeId: 'scope-a', scopeKind: 'WORKSPACE', taskId: 'task-a',
        invocationId: 'invocation-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', reservationId: 'generation-budget',
        admissionId: 'generation-admission', dispatchToken: 'generation-dispatch', requestHash: 'd'.repeat(64), state: 'dispatched' } });
      await h.db.aiInvocationAdmission.create({ data: { id: 'generation-admission', tenantId: 'tenant-a', workspaceId: 'workspace-a',
        actorId: 'user-a', callId: intent.requestId, requestHash: 'd'.repeat(64), profileId: config.configId,
        dispatchId: 'generation-dispatch', status: 'completed', revokedAt: null } });
      return { kind: 'succeeded', payload: { draftVersion: 'ain-c03-draft-2', requestId: intent.requestId,
        actual: config, evidence: 'mock', status: 'completed', text: 'Synthetic response', toolRequests: [],
        usage: { kind: 'reported', inputTokens: 12, outputTokens: 2 } } };
    } }) } };
  const { PrismaModelStepEvidenceAuthority } = require('../apps/api/src/modules/ai-native/model-input/prisma-model-step-evidence.authority');
  const { AiStepTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-step-transition.repository');
  configuration.transitions = new AiStepTransitionRepository(h.db,
    new PrismaModelStepEvidenceAuthority(h.db, h.taskAuthority, h.planAuthority, policy, configuration.financialEvidence,
      () => new Date(h.control.now)), () => new Date(h.control.now));
  const root = require('../apps/api/src/modules/ai-native/runner/persistent-task-runner.composition').composePersistentTaskRunner(configuration);
  return { ...h, root, counts, generations, abort };
}

test('counted model consumes two persistent CALLS with one marker and exact count replay', async () => {
  const h = await countedModelHarness();
  assert.equal((await h.root.runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.counts, ['count']); assert.deepEqual(h.generations, ['generation']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 0n);
  assert.equal(h.state.aiTaskExecutionCharge.length, 5);
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiTaskResultArtifact[0].activeMs, 20n);
});

for (const mode of ['unknown', 'abort']) test(`count ${mode} keeps its original marker and never generates`, async () => {
  const h = await countedModelHarness(mode);
  assert.equal((await h.root.runner.run(h.claim(), h.abort.signal)).status, 'unknown');
  assert.deepEqual(h.counts, ['count']); assert.deepEqual(h.generations, []);
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, 2n);
  const original = h.clone(h.state.aiGatewayInvocation[0]);
  assert.equal((await h.root.runner.run({ ...h.claim(), recovery: true })).status, 'unknown');
  assert.deepEqual(h.counts, ['count']); assert.deepEqual(h.generations, []);
  assert.deepEqual(h.state.aiGatewayInvocation[0], original);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, mode === 'abort' ? 1n : 0n);
  assert.equal(h.state.aiTaskExecutionBudget[0].reservedCalls, mode === 'abort' ? 1n : 2n);
});

test('registration acknowledged before CALLS interruption retains the original unresolved invocation', async () => {
  const h = await countedModelHarness('registration_abort');
  assert.equal((await h.root.runner.run(h.claim(), h.abort.signal)).status, 'unknown');
  assert.equal(h.state.aiGatewayInvocation.length, 1);
  assert.equal(h.state.aiTaskExecutionCharge.length, 3);
  const original = h.clone(h.state.aiGatewayInvocation[0]);
  assert.equal(h.state.aiStep[0].status, 'UNKNOWN');
  assert.equal((await h.root.runner.run({ ...h.claim(), recovery: true })).status, 'unknown');
  assert.deepEqual(h.state.aiGatewayInvocation[0], original);
  assert.deepEqual(h.counts, []); assert.deepEqual(h.generations, []);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedCalls, 0n);
});

test('one remaining task CALLS allowance prevents both count and generation', async () => {
  const h = await countedModelHarness('observed', 1);
  assert.equal((await h.root.runner.run(h.claim())).status, 'unknown');
  assert.deepEqual(h.counts, []); assert.deepEqual(h.generations, []);
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
});

test('two workers cannot claim and execute the same remaining steps', async () => {
  const h = await taskInputHarness(), claim = h.claim();
  const results = await Promise.allSettled([h.make().runner.run(claim), h.make().runner.run({ ...claim, holderId: 'workerId-b' })]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && r.reason.code === 'AI_REVISION_CONFLICT').length, 1);
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
});
