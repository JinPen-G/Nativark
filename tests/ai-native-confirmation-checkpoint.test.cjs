'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { AiTaskTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-task-transition.repository');
const { aiTaskAccessFromContext } = require('../apps/api/src/modules/ai-native/ai-task.repository');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { fingerprintAiProposalDraft } = require('../apps/api/src/modules/ai-native/proposal-binding-draft');
const { AI_TASK_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } = require('../packages/shared/src/index.ts');
const { contexts } = require('./fixtures/ai-native/contract-consumer.cjs');
const { createTaskInputStore, clone } = require('./fixtures/ai-native/task-input-store.cjs');
const { controlledApprovedOrderHarness } = require('./fixtures/ai-native/approved-order-controlled.cjs');
const { PrismaTaskConfirmationCheckpointSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-confirmation-checkpoint.source');
const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');

// This tests the actual task transaction against a phase-source double, not phase persistence or MySQL locks.
function harness() {
  const now = new Date('2026-10-03T00:01:00Z'), expiresAt = '2026-10-03T01:00:00Z';
  const context = clone(contexts[0]), access = aiTaskAccessFromContext(context, 'task-a', now);
  const input = { quoteId: 'quote-a' }, fingerprint = requestFingerprint(input);
  const lease = { taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', revision: 5, fencingToken: '9', expiresAt };
  const plan = { taskId: 'task-a', runId: 'run-a', taskRevision: 3,
    steps: [{ registrationRef: 'order-a', operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }],
    limits: { maxSteps: 4, maxCalls: 4, maxConcurrent: 1, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096 } };
  const payload = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, taskId: 'task-a', proposalId: 'proposal-a', revision: 1,
    audience: context.audience, scope: context.scope, atomicity: 'single_action', failurePolicy: 'stop_and_reconcile', expiresAt,
    actions: [{ actionId: 'action-a', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION,
      input: { recordId: 'input-snapshot-a', revision: 1, contentHash: fingerprint },
      preview: { recordId: 'preview-a', revision: 1, contentHash: 'b'.repeat(64) },
      target: { resourceType: 'quote', resourceId: 'quote-a', version: 'price-1' } }] };
  const proposalHash = fingerprintAiProposalDraft(payload);
  const store = createTaskInputStore({
    aiTask: [{ id: 'task-a', scopeId: 'scope-a', scopeKind: access.scope.kind, scope: access.scope,
      audience: access.audience, ownerKind: access.actorKind, ownerId: access.actorId, archivedAt: null,
      contractVersion: AI_TASK_DRAFT_VERSION, status: 'RUNNING', revision: 3, eventCursor: 7n, cancelRequestedAt: null }],
    aiRun: [{ id: 'run-a', scopeId: 'scope-a', taskId: 'task-a', status: 'RUNNING', revision: 5,
      leaseOwnerId: lease.holderId, leaseExpiresAt: new Date(expiresAt), fencingToken: new Prisma.Decimal('9'), actorKind: access.actorKind, actorId: access.actorId }],
    aiStep: [{ id: 'step-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', sequence: 1, revision: 2,
      actionId: 'action-a', requestFingerprint: fingerprint, inputRef: 'input-a', resultRef: null,
      toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION, status: 'RUNNING', effect: 'POSSIBLE' }],
    aiTaskRunPlan: [{ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', planHash: requestFingerprint(plan),
      authorityHash: 'c'.repeat(64), policyVersion: 'policy-1', payload: plan }],
    aiTaskActionInput: [{ id: 'input-a', scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a',
      toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION, payload: input, fingerprint, policyRevision: 1, expiresAt: new Date(expiresAt) }],
    aiTaskEvent: [], aiTaskResultArtifact: [], aiTaskExecutionCharge: [],
    aiProposal: [{ id: 'proposal-a', scopeId: 'scope-a', taskId: 'task-a', status: 'PENDING_CONFIRMATION', stateRevision: 1, currentRevision: null }],
    aiProposalVersion: [{ scopeId: 'scope-a', taskId: 'task-a', proposalId: 'proposal-a', revision: 1, payloadHash: proposalHash, payload, expiresAt: new Date(expiresAt) }],
    aiProposalAction: [{ scopeId: 'scope-a', taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1, actionId: 'action-a', sequence: 1, requestFingerprint: fingerprint }],
    aiApproval: []
  });
  const proof = { scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a', stepId: 'step-a', checkpointRef: 'receipt-a', phaseId: 'phase-a',
    kind: 'confirmation', actionId: 'action-a', inputRef: 'input-a', stepRevision: 2, stepFingerprint: fingerprint,
    planHash: requestFingerprint(plan), contentHash: 'd'.repeat(64), leaseOwnerId: 'worker-a', fencingToken: '9', runRevision: 5,
    proposalId: 'proposal-a', proposalRevision: 1, reviewedPayloadHash: proposalHash };
  const control = { reads: 0, revoked: false, onRead: null, missing: false };
  const authority = { resolve: async () => { if (control.revoked) throw Error('synthetic revoked'); return clone(context); } };
  const source = { read: async (value, tx) => {
    assert.notEqual(tx, store.db); assert.equal(value.lease.fencingToken, lease.fencingToken); control.reads++;
    if (control.onRead) await control.onRead(tx);
    if (control.missing) throw Error('missing original phase receipt');
    return clone(proof);
  } };
  const repository = new AiTaskTransitionRepository(store.db, authority, () => new Date(now), source);
  const command = { taskId: 'task-a', stepId: 'step-a', expectedTaskRevision: 3, expectedStepRevision: 2, checkpointRef: 'receipt-a', lease };
  return { ...store, storeControl: store.control, proof, control, source, authority, repository, command, now };
}
const refused = error => ['AI_INVALID_INPUT', 'AI_ACCESS_DENIED', 'AI_REVISION_CONFLICT', 'AI_RESOURCE_UNAVAILABLE', 'AI_STORAGE_UNAVAILABLE'].includes(error.code);

test('confirmation checkpoint changes only task/run and one event after transaction-local evidence checks', async () => {
  const h = harness(), beforeStep = clone(h.state.aiStep), beforeArtifact = clone(h.state.aiTaskResultArtifact);
  const result = await h.repository.pauseConfirmation(h.command);
  assert.equal(result.event.type, 'task.transition'); assert.equal(result.event.data.to, 'waiting_confirmation');
  assert.equal(result.event.taskRevision, 4); assert.equal(result.runRevision, 6); assert.equal(result.stepRevision, 2);
  assert.equal(h.state.aiTask[0].status, 'WAITING_CONFIRMATION'); assert.equal(h.state.aiRun[0].fencingToken.toFixed(0), '9');
  assert.deepEqual(h.state.aiStep, beforeStep); assert.deepEqual(h.state.aiTaskResultArtifact, beforeArtifact);
  assert.equal(h.state.aiTaskEvent.length, 1); assert.equal(h.state.aiTaskExecutionCharge.length, 0); assert.equal(h.control.reads, 2);
  assert.deepEqual(h.state.aiTaskEvent[0].payload.confirmation, { checkpointRef: 'receipt-a', phaseId: 'phase-a' });
});

for (const [name, change] of [
  ['foreign receipt run', h => { h.proof.runId = 'run-b'; }],
  ['stale phase step revision', h => { h.proof.stepRevision++; }],
  ['changed input', h => { h.state.aiTaskActionInput[0].payload.quoteId = 'changed'; }],
  ['changed plan', h => { h.state.aiTaskRunPlan[0].payload.steps = []; }],
  ['non-pending proposal', h => { h.state.aiProposal[0].status = 'CONFIRMED'; }],
  ['existing decision', h => { h.state.aiApproval.push({ scopeId: 'scope-a', taskId: 'task-a', proposalId: 'proposal-a', proposalRevision: 1 }); }],
  ['expired proposal', h => { h.state.aiProposalVersion[0].expiresAt = new Date('2000-01-01'); }],
  ['cancel intent', h => { h.state.aiTask[0].cancelRequestedAt = new Date(h.now); }],
  ['stale fence', h => { h.state.aiRun[0].fencingToken = new Prisma.Decimal('10'); }],
  ['readonly effect', h => { h.state.aiStep[0].effect = 'NONE'; }],
  ['missing phase receipt', h => { h.control.missing = true; }],
  ['revocation during evidence read', h => { h.control.onRead = async () => { h.control.revoked = true; }; }]
]) test(`confirmation checkpoint rejects ${name} and rolls back its task reservation`, async () => {
  const h = harness(); change(h); const before = clone(h.state);
  await assert.rejects(h.repository.pauseConfirmation(h.command), refused);
  assert.deepEqual(h.state, before); assert.equal(h.trace.includes('transaction.commit'), false);
});

test('confirmation checkpoint rejects boolean proofs and a missing source before starting a transaction', async () => {
  const h = harness();
  await assert.rejects(h.repository.pauseConfirmation({ ...h.command, approved: true }), refused);
  const repository = new AiTaskTransitionRepository(h.db, h.authority, () => new Date(h.now));
  await assert.rejects(repository.pauseConfirmation(h.command), refused);
  assert.equal(h.trace.length, 0);
});

test('confirmation checkpoint lost acknowledgement preserves the pause and cannot repeat the transaction', async () => {
  const h = harness(); h.storeControl.loseReply = true;
  await assert.rejects(h.repository.pauseConfirmation(h.command), error => error.code === 'AI_STORAGE_UNAVAILABLE');
  assert.equal(h.state.aiTask[0].status, 'WAITING_CONFIRMATION'); assert.equal(h.state.aiTaskEvent.length, 1);
  await assert.rejects(h.repository.pauseConfirmation(h.command), refused);
  assert.equal(h.state.aiTaskEvent.length, 1); assert.equal(h.state.aiRun[0].revision, 6); assert.equal(h.state.aiStep[0].revision, 2);
});

async function waitingReaderHarness() {
  const h = await controlledApprovedOrderHarness({ prepare: false }), input = h.executorInput();
  const result = await h.root.waiting.execute(input, new AbortController().signal);
  assert.equal(result.kind, 'paused');
  const records = h.state.records, step = records.aiStep[0], now = h.dependencies.clock();
  step.effect = 'POSSIBLE';
  const key = { scopeId: step.scopeId, taskId: input.taskId, runId: input.runId, stepId: input.stepId };
  const phase = { ...key, id: 'phase-a', originalArtifactId: 'artifact-a', inputRef: input.inputRef,
    stepsChargeId: 'charge-steps', activeMsChargeId: 'charge-active', outputBytesChargeId: 'charge-output',
    actionId: input.actionId, leaseOwnerId: input.lease.holderId, stepFingerprint: input.fingerprint,
    planHash: records.aiTaskRunPlan[0].planHash, fencingToken: new Prisma.Decimal(input.lease.fencingToken),
    runRevision: input.lease.revision, stepRevision: step.revision, sequence: 1, previousReceiptId: null, decisionRef: null, createdAt: now };
  const receipt = { ...key, id: 'receipt-a', phaseId: phase.id, kind: 'confirmation', errorCode: null,
    payload: result.payload, contentHash: requestFingerprint(result.payload), activeMs: 17n,
    outputBytes: BigInt(Buffer.byteLength(JSON.stringify(result.payload), 'utf8')), proposalId: result.payload.proposal.proposalId,
    proposalRevision: result.payload.proposal.proposalRevision, reviewedPayloadHash: result.payload.proposal.reviewedPayloadHash,
    decisionRef: null, businessResultRef: null, createdAt: now };
  records.aiTaskExecutionPhaseStart = [phase]; records.aiTaskExecutionPhaseReceipt = [receipt];
  records.aiTaskResultArtifact = [{ ...key, id: phase.originalArtifactId, actionId: input.actionId, stepFingerprint: input.fingerprint,
    leaseOwnerId: input.lease.holderId, fencingToken: new Prisma.Decimal(input.lease.fencingToken), outcome: 'RUNNING', errorCode: null,
    payload: {}, contentHash: requestFingerprint({}), outputBytes: 0n, activeMs: 0n, completeMeasurement: false, createdAt: now }];
  records.aiTaskExecutionCharge = [['STEPS', phase.stepsChargeId, 1n], ['ACTIVE_MS', phase.activeMsChargeId, 1000n], ['OUTPUT_BYTES', phase.outputBytesChargeId, 4096n]]
    .map(([resource, chargeId, amount]) => ({ ...key, actionId: input.actionId, stepFingerprint: input.fingerprint,
      leaseOwnerId: input.lease.holderId, fencingToken: new Prisma.Decimal(input.lease.fencingToken),
      resource, chargeId, amount, status: 'RESERVED', gatewayInvocationId: null }));
  const source = new PrismaTaskConfirmationCheckpointSource(h.root.waiting, h.root.source, h.dependencies.clock);
  const command = { taskId: input.taskId, stepId: input.stepId, expectedTaskRevision: records.aiTask[0].revision,
    expectedStepRevision: step.revision, checkpointRef: receipt.id, lease: input.lease };
  const authority = composePersistedTaskAuthorization(h.dependencies).authority;
  const repository = new AiTaskTransitionRepository(h.dependencies.db, authority, h.dependencies.clock, source);
  return { ...h, source, command, repository, phase, receipt, key, input };
}

test('phase reader uses the real waiting reader and task transaction while preserving seeded phase facts and reservations', async () => {
  const h = await waitingReaderHarness(), before = clone(h.state.records);
  const result = await h.repository.pauseConfirmation(h.command);
  assert.equal(result.event.data.to, 'waiting_confirmation');
  assert.equal(result.stepRevision, before.aiStep[0].revision);
  assert.equal(h.state.records.aiTask[0].status, 'WAITING_CONFIRMATION');
  for (const name of ['aiStep', 'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt', 'aiTaskResultArtifact', 'aiTaskExecutionCharge', 'rentalOrder', 'aiApproval']) {
    assert.deepEqual(h.state.records[name], before[name], name);
  }
});

for (const [name, mutate] of [
  ['missing phase delegate', (_h, tx) => { delete tx.aiTaskExecutionPhaseReceipt; }],
  ['missing receipt', h => { h.state.records.aiTaskExecutionPhaseReceipt = []; }],
  ['foreign phase step', h => { h.phase.stepId = 'foreign-step'; }],
  ['changed payload', h => { h.receipt.payload.effectState = 'committed'; }],
  ['unmeasured byte claim', h => { h.receipt.outputBytes++; }],
  ['changed original charge', h => { h.state.records.aiTaskExecutionCharge[0].fencingToken = new Prisma.Decimal('99'); }],
  ['disabled current policy', h => { h.state.records.aiTaskPlanPolicy[0].enabled = false; }]
]) test(`phase reader rejects ${name} instead of granting a checkpoint`, async () => {
  const h = await waitingReaderHarness();
  if (name !== 'missing phase delegate') mutate(h);
  await assert.rejects(h.dependencies.db.$transaction(async tx => {
    if (name === 'missing phase delegate') mutate(h, tx);
    return h.source.read({ ...h.key, checkpointRef: h.receipt.id, lease: h.input.lease }, tx);
  }));
  assert.equal(h.state.records.rentalOrder.length, 0);
});
