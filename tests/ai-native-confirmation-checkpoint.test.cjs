'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const { AiTaskTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-task-transition.repository');
const { aiTaskAccessFromContext } = require('../apps/api/src/modules/ai-native/ai-task.repository');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { fingerprintAiProposalDraft } = require('../apps/api/src/modules/ai-native/proposal-binding-draft');
const { AI_TASK_DRAFT_VERSION, AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION, AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION } = require('../packages/shared/src/index.ts');
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
  await assert.rejects(h.repository.pauseConfirmation(h.command), name === 'missing phase receipt'
    ? error => error.code === 'AI_RESULT_UNKNOWN' : refused);
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
  await assert.rejects(h.repository.pauseConfirmation(h.command), error => error.code === 'AI_RESULT_UNKNOWN');
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

test('phase reader keeps proposal, snapshot and decision reads in the caller transaction', async () => {
  const h = await waitingReaderHarness(), models = ['aiTask', 'aiStep', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApprovedOrderSnapshot', 'aiApproval'];
  const before = clone(h.state.records);
  await h.dependencies.db.$transaction(async tx => {
    const originals = models.map(name => [name, h.dependencies.db[name].findFirst]);
    for (const [name] of originals) h.dependencies.db[name].findFirst = async () => { throw Error(`outside transaction: ${name}`); };
    const command = { ...h.key, checkpointRef: h.receipt.id, lease: h.input.lease };
    try {
      const droppedTransaction = new PrismaTaskConfirmationCheckpointSource({ readWaiting: input => h.root.waiting.readWaiting(input) }, h.root.source, h.dependencies.clock);
      await assert.rejects(droppedTransaction.read(command, tx), 'dropping the caller transaction must fail rather than trust a committed snapshot');
      const observed = await h.source.read(command, tx);
      assert.equal(observed.checkpointRef, h.receipt.id); assert.equal(observed.planHash, h.phase.planHash);
    } finally { for (const [name, original] of originals) h.dependencies.db[name].findFirst = original; }
  });
  assert.deepEqual(h.state.records, before, 'read-only checkpoint proof cannot execute, consume or rewrite original facts');
});

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
]) test(name === 'disabled current policy'
  ? 'phase reader preserves the original checkpoint while disabled policy blocks new plan authority'
  : `phase reader rejects ${name} instead of granting a checkpoint`, async () => {
  const h = await waitingReaderHarness();
  if (name !== 'missing phase delegate') mutate(h);
  const read = () => h.dependencies.db.$transaction(async tx => {
    if (name === 'missing phase delegate') mutate(h, tx);
    return h.source.read({ ...h.key, checkpointRef: h.receipt.id, lease: h.input.lease }, tx);
  });
  if (name === 'disabled current policy') {
    const before = clone(h.state.records), observed = await read();
    assert.equal(observed.stepId, h.key.stepId); assert.equal(observed.checkpointRef, h.receipt.id);
    assert.equal(observed.planHash, before.aiTaskRunPlan[0].planHash);
    await assert.rejects(h.root.source.authorize(before.aiTaskRunPlan[0].payload, h.input.lease), refused);
    assert.deepEqual(h.state.records, before, 'historical observation cannot grant execution or consume reservations');
  } else await assert.rejects(read());
  assert.equal(h.state.records.rentalOrder.length, 0);
});

async function publishedContinuationHarness(approve = true) {
  const { composeTaskOrderHost } = require('../apps/api/src/modules/ai-native/runner/order-task-host.composition');
  const h = await controlledApprovedOrderHarness({ initializeOnly: true });
  Object.assign(h.state.records.aiTask[0], { status: 'QUEUED', inputRef: null,
    sceneCode: h.dependencies.scene.code, sceneVersion: h.dependencies.scene.version });
  Object.assign(h.state.records.aiRun[0], { status: 'QUEUED', leaseOwnerId: null, leaseExpiresAt: null });
  let ticks = 0; const monotonic = () => ++ticks, host = { holderId: 'order-host', leaseMs: 100000 };
  const root = composeTaskOrderHost({ ...h.dependencies, host, monotonic,
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a', order: h.body, limits: h.limits } });
  assert.equal((await root.application.start({ taskId: 'task-a', runId: 'run-a' })).outcome.status, 'paused');
  const receipt = h.state.records.aiTaskExecutionPhaseReceipt[0];
  if (approve) await root.orders.approvals.decide('task-a', { ...receipt.payload.proposal,
    decision: 'approve', reviewVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION });
  const command = { taskId: 'task-a', runId: 'run-a', stepId: receipt.stepId, checkpointRef: receipt.id,
    expectedTaskRevision: h.state.records.aiTask[0].revision, proposal: clone(receipt.payload.proposal) };
  return { ...h, root, command, host, monotonic };
}

test('published original plan continuation uses original host CAS and cumulative budget without quote selection', { timeout: 30000 }, async () => {
  const h = await publishedContinuationHarness();
  const { composePublishedOrderTaskContinuation } = require('../apps/api/src/modules/ai-native/runner/published-order-task-continuation.composition');
  const planHash = h.state.records.aiTaskRunPlan[0].planHash;
  const budgetKey = { scopeId: h.state.records.aiTaskExecutionBudget[0].scopeId, taskId: h.state.records.aiTaskExecutionBudget[0].taskId };
  const inputCount = h.state.records.aiTaskActionInput.length, policyCount = h.state.records.aiTaskPlanPolicy.length;
  const out = await composePublishedOrderTaskContinuation({ ...h.dependencies, monotonic: h.monotonic },
    { host: h.host, limits: h.limits }).continueConfirmation(h.command);
  assert.equal(out.kind, 'run_outcome'); assert.equal(out.outcome.status, 'succeeded');
  assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  assert.equal(h.state.records.aiTaskRunPlan[0].planHash, planHash);
  assert.deepEqual({ scopeId: h.state.records.aiTaskExecutionBudget[0].scopeId,
    taskId: h.state.records.aiTaskExecutionBudget[0].taskId }, budgetKey);
  assert.equal(h.state.records.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.records.aiTaskActionInput.length, inputCount);
  assert.equal(h.state.records.aiTaskPlanPolicy.length, policyCount);
  assert.equal(h.state.records.aiTaskQuoteSelection.length, 0);
});

test('published plan refuses absent approval, wrong wait, stale revision, unknown and changed limits before claiming', { timeout: 30000 }, async () => {
  const { composePublishedOrderTaskContinuation } = require('../apps/api/src/modules/ai-native/runner/published-order-task-continuation.composition');
  for (const name of ['absent approval', 'wrong checkpoint', 'stale task', 'unknown task', 'different limits']) {
    const h = await publishedContinuationHarness(name !== 'absent approval'), command = clone(h.command), limits = clone(h.limits);
    if (name === 'wrong checkpoint') command.checkpointRef = '00000000-0000-4000-8000-000000000002';
    if (name === 'stale task') command.expectedTaskRevision++;
    if (name === 'unknown task') { h.state.records.aiTask[0].status = 'WAITING_EXTERNAL'; h.state.records.aiStep[0].status = 'UNKNOWN'; }
    if (name === 'different limits') limits.maxSteps++;
    const before = clone(h.state.records);
    await assert.rejects(composePublishedOrderTaskContinuation({ ...h.dependencies, monotonic: h.monotonic },
      { host: h.host, limits }).continueConfirmation(command), refused);
    assert.deepEqual(h.state.records, before, name + ' must not claim or publish work');
    assert.equal(h.state.records.rentalOrder.length, 0);
  }
});

test('published plan aborted request cannot claim a lease or invent configuration', async () => {
  const h = await publishedContinuationHarness();
  const { composePublishedOrderTaskContinuation } = require('../apps/api/src/modules/ai-native/runner/published-order-task-continuation.composition');
  const controller = new AbortController(); controller.abort(); const before = clone(h.state.records);
  const out = await composePublishedOrderTaskContinuation(h.dependencies, { host: h.host, limits: h.limits })
    .continueConfirmation(h.command, controller.signal);
  assert.equal(out.kind, 'not_started'); assert.equal(out.reason, 'host_aborted'); assert.deepEqual(h.state.records, before);
  assert.throws(() => composePublishedOrderTaskContinuation(h.dependencies, undefined), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
});

test('authorized original body read uses one complete before-after plan envelope', { timeout: 30000 }, async () => {
  const h = await publishedContinuationHarness();
  const { composePublishedOrderTaskContinuation } = require('../apps/api/src/modules/ai-native/runner/published-order-task-continuation.composition');
  const { PrismaTaskPlanInputSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-input.source');
  const { PrismaAuthorizedApprovedOrderInputSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-authorized-approved-order-input.source');
  const authorize = PrismaTaskPlanInputSource.prototype.authorize;
  const read = PrismaAuthorizedApprovedOrderInputSource.prototype.readAuthorized;
  let planChecks = 0;
  const checksPerBody = [];
  PrismaTaskPlanInputSource.prototype.authorize = async function (...args) { planChecks++; return authorize.apply(this, args); };
  PrismaAuthorizedApprovedOrderInputSource.prototype.readAuthorized = async function (...args) {
    const before = planChecks;
    try { return await read.apply(this, args); }
    finally { checksPerBody.push(planChecks - before); }
  };
  try {
    const result = await composePublishedOrderTaskContinuation({ ...h.dependencies, monotonic: h.monotonic },
      { host: h.host, limits: h.limits }).continueConfirmation(h.command);
    assert.equal(result.outcome.status, 'succeeded');
    assert.ok(checksPerBody.length > 0);
    assert.ok(checksPerBody.every(count => count === 2), 'each original body read retains two complete plan checks, not nested duplicate pairs');
    assert.equal(h.state.records.rentalOrder.length, 1);
    assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  } finally {
    PrismaTaskPlanInputSource.prototype.authorize = authorize;
    PrismaAuthorizedApprovedOrderInputSource.prototype.readAuthorized = read;
  }
});

async function assertMalformedBodyEnvelopeRefused(mode) {
  const { PrismaTaskPlanInputSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-input.source');
  const { composePublishedOrderTaskContinuation } = require('../apps/api/src/modules/ai-native/runner/published-order-task-continuation.composition');
  const { orderContextHash } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order.source');
    const h = await publishedContinuationHarness();
    const envelope = PrismaTaskPlanInputSource.prototype.withAuthorizedOrderInput;
    const authorize = PrismaTaskPlanInputSource.prototype.authorizeOrderInput;
    let fallbackCalls = 0;
    PrismaTaskPlanInputSource.prototype.authorizeOrderInput = async function (...args) { fallbackCalls++; return authorize.apply(this, args); };
    PrismaTaskPlanInputSource.prototype.withAuthorizedOrderInput = async function (reference, tx, read) {
      let callbackProof;
      const callback = mode === 'missing_read' ? async () => ({ body: h.body, bindingHash: 'a'.repeat(64) }) : async proof => {
        callbackProof = clone(proof);
        const value = await read(proof);
        if (mode === 'source_row_changed') {
          const row = await tx.aiTaskActionInput.findFirst({ where: { id: reference.inputRef, scopeId: reference.scopeId, taskId: reference.taskId } });
          const changed = clone(row.payload); changed.lines[0].quantity++;
          await tx.aiTaskActionInput.updateMany({ where: { id: row.id, scopeId: row.scopeId, taskId: row.taskId }, data: { payload: changed } });
        }
        return value;
      };
      const result = await envelope.call(this, reference, tx, callback);
      if (mode === 'changed_reference') result.current.reference.inputRef = 'another-input';
      if (mode === 'proof_substitution') {
        const different = clone(result.current);
        different.bindingHash = (different.bindingHash[0] === 'a' ? 'b' : 'a') + different.bindingHash.slice(1);
        result.original = clone(different); result.current = clone(different);
        result.value.bindingHash = requestFingerprint({ ...different, context: orderContextHash(different.context) });
      }
      if (mode === 'swallowed_repeat') { try { await read(callbackProof); } catch { /* The authority cannot erase a callback violation. */ } }
      return result;
    };
    try {
      let outcome;
      try { outcome = await composePublishedOrderTaskContinuation({ ...h.dependencies, monotonic: h.monotonic },
        { host: h.host, limits: h.limits }).continueConfirmation(h.command); }
      catch (error) { assert.ok(['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN', 'AI_REVISION_CONFLICT'].includes(error.code)); }
      if (outcome) assert.notEqual(outcome.outcome.status, 'succeeded');
      assert.equal(fallbackCalls, 0, 'a broken offered envelope cannot borrow the legacy path');
      assert.equal(h.state.records.rentalOrder.length, 0);
      assert.equal(h.state.records.aiApprovalConsumption.length, 0);
    } finally {
      PrismaTaskPlanInputSource.prototype.withAuthorizedOrderInput = envelope;
      PrismaTaskPlanInputSource.prototype.authorizeOrderInput = authorize;
    }
}

test('malformed offered body envelope never falls back or submits Core', { timeout: 30000 }, async () => {
  for (const mode of ['missing_read', 'changed_reference', 'source_row_changed']) await assertMalformedBodyEnvelopeRefused(mode);
});
test('body envelope cannot substitute the callback proof with returned witnesses', { timeout: 30000 }, async () => {
  await assertMalformedBodyEnvelopeRefused('proof_substitution');
});
test('body envelope cannot swallow a repeated callback violation', { timeout: 30000 }, async () => {
  await assertMalformedBodyEnvelopeRefused('swallowed_repeat');
});

test('committed receipt replay keeps outer snapshot checks without regenerating them inside consumption', { timeout: 30000 }, async () => {
  const h = await publishedContinuationHarness();
  const { composePublishedOrderTaskContinuation } = require('../apps/api/src/modules/ai-native/runner/published-order-task-continuation.composition');
  const { PrismaApprovedOrderSnapshotSource } = require('../apps/api/src/modules/ai-native/approval-execution/prisma-approved-order-snapshot.source');
  const { PrismaAiApprovalConsumptionRepository } = require('../apps/api/src/modules/ai-native/prisma-approval-consumption.repository');
  const read = PrismaApprovedOrderSnapshotSource.prototype.read;
  const create = PrismaAiApprovalConsumptionRepository.prototype.createOrderTransaction;
  let snapshots = 0;
  const replaySnapshots = [];
  PrismaApprovedOrderSnapshotSource.prototype.read = async function (...args) { snapshots++; return read.apply(this, args); };
  PrismaAiApprovalConsumptionRepository.prototype.createOrderTransaction = function (...args) {
    const participant = create.apply(this, args), replay = participant.replay;
    participant.replay = async (...values) => {
      const before = snapshots;
      try { return await replay.apply(participant, values); }
      finally { replaySnapshots.push(snapshots - before); }
    };
    return participant;
  };
  try {
    const result = await composePublishedOrderTaskContinuation({ ...h.dependencies, monotonic: h.monotonic },
      { host: h.host, limits: h.limits }).continueConfirmation(h.command);
    assert.equal(result.outcome.status, 'succeeded');
    assert.ok(snapshots > 0, 'original immutable snapshot checks still enclose receipt replay');
    assert.ok(replaySnapshots.length > 0);
    assert.ok(replaySnapshots.every(count => count === 0), 'consumption replays current read authority, not another full material projection');
    assert.equal(h.state.records.rentalOrder.length, 1);
    assert.equal(h.state.records.aiApprovalConsumption.length, 1);
  } finally {
    PrismaApprovedOrderSnapshotSource.prototype.read = read;
    PrismaAiApprovalConsumptionRepository.prototype.createOrderTransaction = create;
  }
});

test('original continuation retains measured unknown when result read throws after Core commit', { timeout: 30000 }, async () => {
  const h = await publishedContinuationHarness();
  const { AiTaskRepositoryError } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const { composePublishedOrderTaskContinuation } = require('../apps/api/src/modules/ai-native/runner/published-order-task-continuation.composition');
  const planHash = h.state.records.aiTaskRunPlan[0].planHash;
  let lostResult = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (!lostResult && !inTransaction && model === 'aiApprovalConsumption' && op === 'findFirst'
      && records.aiApprovalConsumption.some(row => row.status === 'COMMITTED')) {
      lostResult = true;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
  };
  const first = await composePublishedOrderTaskContinuation({ ...h.dependencies, monotonic: h.monotonic },
    { host: h.host, limits: h.limits }).continueConfirmation(h.command);
  assert.equal(lostResult, true, 'lose the result read only after the original Core COMMIT');
  assert.equal(first.outcome.status, 'unknown');
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.aiApprovalConsumption[0].status, 'COMMITTED');
  assert.equal(h.state.records.aiTaskExecutionPhaseStart.length, 2);
  assert.equal(h.state.records.aiTaskExecutionPhaseReceipt.length, 2, 'the measured callback failure must not erase its original phase');
  const secondStart = h.state.records.aiTaskExecutionPhaseStart.find(row => row.sequence === 2);
  const unknownReceipt = h.state.records.aiTaskExecutionPhaseReceipt.find(row => row.phaseId === secondStart.id);
  assert.equal(unknownReceipt.kind, 'unknown');
  assert.equal(unknownReceipt.payload.effectState, 'unresolved');
  assert.equal(unknownReceipt.businessResultRef, null);
  assert.equal(h.state.records.aiTaskExecutionBudget[0].consumedSteps, 0n);
  assert.equal(h.state.records.aiTaskExecutionBudget[0].reservedSteps, 1n);
  const run = h.state.records.aiRun[0];
  await h.root.authorization.tasks.claimRecoveryRun({ taskId: 'task-a', runId: 'run-a', ...h.host,
    expectedTaskRevision: h.state.records.aiTask[0].revision, expectedRunRevision: run.revision,
    expectedFencingToken: run.fencingToken.toFixed(0) });
  const recovered = await h.root.application.reconcile({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(recovered.outcome.status, 'succeeded');
  assert.equal(h.state.records.rentalOrder.length, 1, 'original receipt recovery never creates a second order');
  assert.equal(h.state.prepares, 1);
  assert.equal(h.state.records.aiApproval.length, 1);
  assert.equal(h.state.records.aiTaskRunPlan[0].planHash, planHash);
  assert.equal(h.state.records.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.records.aiTaskExecutionBudget[0].reservedSteps, 0n);
});

test('order host produces two measured phases and settles original charges through explicit approved continuation', async () => {
  const { composeTaskOrderHost } = require('../apps/api/src/modules/ai-native/runner/order-task-host.composition');
  const h = await controlledApprovedOrderHarness({ initializeOnly: true });
  const readQuote = h.dependencies.quoteFacts.findQuote.bind(h.dependencies.quoteFacts);
  h.dependencies.quoteFacts = { findQuote: async (...args) => {
    const identity = require('../apps/api/src/common/request-identity').getRequestIdentity();
    assert.equal(identity?.workspaceId, 'workspace-a', 'all preparation quote reads retain the original Guard-owned workspace');
    return readQuote(...args);
  } };
  Object.assign(h.state.records.aiTask[0], { status: 'QUEUED' });
  Object.assign(h.state.records.aiRun[0], { status: 'QUEUED', leaseOwnerId: null, leaseExpiresAt: null });
  let ticks = 0, phaseCommitReplies = 0;
  const transaction = h.dependencies.db.$transaction.bind(h.dependencies.db);
  h.dependencies.db.$transaction = async (callback, options) => {
    let phaseWritten = false;
    const result = await transaction(async tx => {
      const create = tx.aiTaskExecutionPhaseReceipt.create.bind(tx.aiTaskExecutionPhaseReceipt);
      tx.aiTaskExecutionPhaseReceipt.create = async args => {
        phaseWritten = true; ticks += 23;
        return create(args);
      };
      return callback(tx);
    }, options);
    if (phaseWritten) { phaseCommitReplies++; ticks += 17; }
    return result;
  };
  const root = composeTaskOrderHost({ ...h.dependencies, host: { holderId: 'order-host', leaseMs: 100000 },
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a', order: h.body, limits: h.limits },
    monotonic: () => ++ticks });
  assert.equal(h.state.records.aiStep.length, 0); assert.equal(h.state.records.aiTaskExecutionPhaseStart.length, 0);
  const result = await root.application.start({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'paused');
  const r = h.state.records, receipt = r.aiTaskExecutionPhaseReceipt[0];
  assert.equal(r.aiTask[0].status, 'WAITING_CONFIRMATION'); assert.equal(r.aiStep[0].status, 'RUNNING');
  assert.equal(r.aiTaskExecutionPhaseStart.length, 1); assert.equal(r.aiTaskExecutionPhaseReceipt.length, 1);
  assert.equal(receipt.kind, 'confirmation'); assert.equal(receipt.activeMs, 1n);
  assert.equal(receipt.outputBytes, BigInt(Buffer.byteLength(JSON.stringify(receipt.payload), 'utf8')));
  assert.equal(r.aiTaskResultArtifact[0].outcome, 'RUNNING'); assert.equal(r.aiTaskResultArtifact[0].completeMeasurement, false);
  const stepCharges = r.aiTaskExecutionCharge.filter(c => c.stepId === r.aiStep[0].id);
  assert.equal(stepCharges.length, 3); assert.ok(stepCharges.every(c => c.status === 'RESERVED'));
  const firstRunCharges = r.aiTaskExecutionCharge.filter(c => c.stepId === null);
  assert.equal(firstRunCharges.length, 3); assert.ok(firstRunCharges.every(c => c.resource === 'ACTIVE_MS' && c.status === 'RECORDED'));
  assert.equal(r.aiTaskRunPreparation.length, 1); assert.equal(r.aiTaskRunPreparation[0].prepared, true);
  assert.equal(r.aiTaskRunOverhead.length, 2);
  const startup = r.aiTaskRunOverhead.find(row => row.segment === 'startup');
  const beforeOrder = r.aiTaskRunOverhead.find(row => row.segment === 'pre:order-a');
  assert.ok(startup && beforeOrder);
  assert.deepEqual(r.aiTaskRunPreparation[0].completedAt, startup.startedAt, 'preparation and startup share one original clock boundary');
  assert.deepEqual(startup.completedAt, beforeOrder.startedAt, 'startup remains metered until the original step handoff');
  assert.ok(beforeOrder.activeMs >= 40n, 'phase SQL and COMMIT reply belong to the original orchestration reservation');
  assert.equal(phaseCommitReplies, 1);
  assert.equal(r.aiTaskExecutionBudget[0].consumedSteps, 0n); assert.equal(r.aiTaskExecutionBudget[0].reservedSteps, 1n);
  assert.equal(r.aiApproval.length, 0); assert.equal(r.rentalOrder.length, 0); assert.equal(h.state.prepares, 0);
  const charges = stepCharges.map(c => ({ id: c.chargeId, fingerprint: c.requestFingerprint, fence: c.fencingToken.toFixed(0) }));
  assert.equal((await root.application.continueConfirmation({ taskId: 'task-a', runId: 'run-a', checkpointRef: receipt.id })).reason, 'confirmation_lease_unavailable');
  await root.orders.approvals.readProposal('task-a', receipt.payload.proposal);
  await root.orders.approvals.decide('task-a', { ...receipt.payload.proposal, decision: 'approve', reviewVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION });
  const beforeRun = h.state.records.aiRun[0], beforeTask = h.state.records.aiTask[0];
  await root.authorization.tasks.claimRecoveryRun({ taskId: 'task-a', runId: 'run-a', holderId: 'order-host', leaseMs: 100000,
    expectedTaskRevision: beforeTask.revision, expectedRunRevision: beforeRun.revision, expectedFencingToken: beforeRun.fencingToken.toFixed(0) });
  const finished = await root.application.continueConfirmation({ taskId: 'task-a', runId: 'run-a', checkpointRef: receipt.id });
  assert.equal(finished.kind, 'run_outcome'); assert.equal(finished.outcome.status, 'succeeded');
  const after = h.state.records, second = after.aiTaskExecutionPhaseReceipt.find(p => p.kind === 'succeeded');
  assert.equal(after.aiTaskExecutionPhaseStart.length, 2); assert.equal(after.aiTaskExecutionPhaseReceipt.length, 2);
  assert.equal(after.aiStep.length, 1); assert.equal(after.aiStep[0].resultRef, second.id); assert.equal(after.aiStep[0].effect, 'COMMITTED');
  assert.equal(after.rentalOrder.length, 1); assert.equal(second.businessResultRef, after.rentalOrder[0].id); assert.equal(h.state.prepares, 1);
  assert.deepEqual(after.aiTaskExecutionCharge.filter(c => c.stepId === after.aiStep[0].id)
    .map(c => ({ id: c.chargeId, fingerprint: c.requestFingerprint, fence: c.fencingToken.toFixed(0) })), charges);
  assert.ok(after.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  assert.equal(phaseCommitReplies, 2, 'one receipt COMMIT per original phase, not a repeated business call');
  assert.equal(receipt.activeMs + second.activeMs, 2n, 'human wait and result persistence do not rewrite original tool time');
  const runActive = after.aiTaskRunPreparation.reduce((sum, row) => sum + row.activeMs, 0n)
    + after.aiTaskRunOverhead.reduce((sum, row) => sum + row.activeMs, 0n);
  assert.ok(after.aiTaskRunOverhead.filter(row => row.activeMs >= 40n).length >= 2, 'both phase COMMIT replies remain metered');
  assert.equal(after.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(after.aiTaskExecutionBudget[0].consumedActiveMs, runActive + receipt.activeMs + second.activeMs);
  assert.equal(after.aiTaskExecutionBudget[0].maxActiveMs, BigInt(h.limits.maxTotalMs));
  assert.equal(after.aiTaskExecutionBudget[0].consumedOutputBytes, receipt.outputBytes + second.outputBytes);
  assert.equal(after.aiTaskExecutionBudget[0].reservedSteps, 0n); assert.equal(after.aiTask[0].status, 'SUCCEEDED');
});

test('original confirmation resume rejects a rewritten lease deadline before further work and preserves its committed lineage', { timeout: 30000 }, async () => {
  const { composeTaskOrderHost } = require('../apps/api/src/modules/ai-native/runner/order-task-host.composition');
  for (const offset of [60000, -1000]) {
    const h = await controlledApprovedOrderHarness({ initializeOnly: true });
    Object.assign(h.state.records.aiTask[0], { status: 'QUEUED' });
    Object.assign(h.state.records.aiRun[0], { status: 'QUEUED', leaseOwnerId: null, leaseExpiresAt: null });
    let ticks = 0;
    const root = composeTaskOrderHost({ ...h.dependencies, host: { holderId: 'original-resume-host', leaseMs: 100000 },
      task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a', order: h.body, limits: h.limits },
      monotonic: () => ++ticks });
    assert.equal((await root.application.start({ taskId: 'task-a', runId: 'run-a' })).outcome.status, 'paused');
    const receipt = h.state.records.aiTaskExecutionPhaseReceipt[0];
    await root.orders.approvals.readProposal('task-a', receipt.payload.proposal);
    await root.orders.approvals.decide('task-a', { ...receipt.payload.proposal, decision: 'approve', reviewVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION });
    const beforeClaim = h.state.records;
    await root.authorization.tasks.claimRecoveryRun({ taskId: 'task-a', runId: 'run-a', holderId: 'original-resume-host', leaseMs: 100000,
      expectedTaskRevision: beforeClaim.aiTask[0].revision, expectedRunRevision: beforeClaim.aiRun[0].revision,
      expectedFencingToken: beforeClaim.aiRun[0].fencingToken.toFixed(0) });
    const before = clone(h.state.records), counts = { resume: 0, metadata: 0, plan: 0, resource: 0, execute: 0, release: 0 };
    // Keep the actual repository/adapter COMMIT. Only corrupt the final port's
    // returned deadline; that cannot renew the stored lease or grant cleanup.
    const deps = root.runner.deps, resume = deps.confirmation.resume.bind(deps.confirmation);
    deps.confirmation.resume = async command => {
      counts.resume++;
      const committed = await resume(command);
      committed.lease.expiresAt = new Date(Date.parse(committed.lease.expiresAt) + offset).toISOString();
      return committed;
    };
    const watch = (owner, method, key) => {
      const original = owner[method].bind(owner);
      owner[method] = (...args) => { counts[key]++; return original(...args); };
    };
    watch(deps.leases, 'readMetadata', 'metadata'); watch(deps.leases, 'releaseRun', 'release');
    watch(deps.plan, 'resolve', 'plan'); watch(deps.resources, 'open', 'resource');
    watch(deps.effects, 'continueConfirmation', 'execute');
    const command = { taskId: 'task-a', runId: 'run-a', checkpointRef: receipt.id };
    await assert.rejects(root.application.continueConfirmation(command), error => error.code === 'AI_RESULT_UNKNOWN');
    assert.deepEqual(counts, { resume: 1, metadata: 1, plan: 0, resource: 0, execute: 0, release: 0 });
    const after = h.state.records;
    assert.equal(after.aiTask[0].status, 'RUNNING'); assert.equal(after.aiTask[0].revision, before.aiTask[0].revision + 1);
    assert.equal(after.aiRun[0].revision, before.aiRun[0].revision + 1);
    assert.equal(after.aiRun[0].leaseOwnerId, before.aiRun[0].leaseOwnerId);
    assert.equal(after.aiRun[0].leaseExpiresAt.getTime(), before.aiRun[0].leaseExpiresAt.getTime());
    assert.equal(after.aiRun[0].fencingToken.toFixed(0), before.aiRun[0].fencingToken.toFixed(0));
    for (const table of ['aiStep', 'aiApproval', 'aiApprovalConsumption', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge',
      'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt', 'aiTaskResultArtifact', 'aiTaskRunPlan', 'aiTaskActionInput', 'rentalOrder']) {
      assert.deepEqual(after[table], before[table], table);
    }
    assert.ok(after.aiTaskExecutionCharge.every(charge => charge.status === 'RESERVED'));
    assert.equal(h.state.prepares, 0); assert.equal(after.rentalOrder.length, 0);
    assert.equal(after.aiTaskEvent.length, before.aiTaskEvent.length + 1);
    assert.deepEqual(after.aiTaskEvent.at(-1).payload.data, { from: 'waiting_confirmation', to: 'running', reason: 'resume' });
    // The durable resume is not repeated to recover its malformed response.
    await assert.rejects(root.application.continueConfirmation(command), error => error.code === 'AI_ACCESS_DENIED');
    assert.equal(counts.resume, 1); assert.equal(counts.release, 0); assert.equal(counts.execute, 0);
    assert.equal(after.aiTaskEvent.length, before.aiTaskEvent.length + 1);
  }
});

test('order confirmation publishes its checkpoint when a human decision wins the pause race', async () => {
  const { composeTaskOrderHost } = require('../apps/api/src/modules/ai-native/runner/order-task-host.composition');
  for (const decision of ['approve', 'reject']) {
    const h = await controlledApprovedOrderHarness({ initializeOnly: true });
    Object.assign(h.state.records.aiTask[0], { status: 'QUEUED' });
    Object.assign(h.state.records.aiRun[0], { status: 'QUEUED', leaseOwnerId: null, leaseExpiresAt: null });
    let ticks = 0;
    const root = composeTaskOrderHost({ ...h.dependencies, host: { holderId: 'order-host', leaseMs: 100000 },
      task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a', order: h.body, limits: h.limits },
      monotonic: () => ++ticks });
    const pause = root.taskTransitions.pauseConfirmation.bind(root.taskTransitions);
    let raced = false;
    root.taskTransitions.pauseConfirmation = async command => {
      const first = h.state.records.aiTaskExecutionPhaseReceipt.find(row => row.id === command.checkpointRef);
      assert.ok(first); assert.equal(h.state.records.aiTask[0].status, 'RUNNING');
      await root.orders.approvals.decide('task-a', { ...first.payload.proposal, decision,
        reviewVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION });
      raced = true;
      return pause(command);
    };
    const started = await root.application.start({ taskId: 'task-a', runId: 'run-a' });
    assert.equal(raced, true); assert.equal(started.outcome.status, 'paused');
    const records = h.state.records, first = records.aiTaskExecutionPhaseReceipt[0];
    assert.equal(records.aiTask[0].status, 'WAITING_CONFIRMATION');
    const pauseEvent = records.aiTaskEvent.find(row => row.payload?.data?.to === 'waiting_confirmation');
    assert.deepEqual(Object.keys(pauseEvent.payload.confirmation).sort(), ['checkpointRef', 'phaseId'], 'pause is not continuation authority');
    assert.equal(records.aiApproval.length, 1); assert.equal(records.rentalOrder.length, 0);
    assert.equal(records.aiTaskExecutionPhaseStart.length, 1); assert.equal(records.aiTaskExecutionPhaseReceipt.length, 1);
    const current = records.aiRun[0];
    await root.authorization.tasks.claimRecoveryRun({ taskId: 'task-a', runId: 'run-a', holderId: 'order-host', leaseMs: 100000,
      expectedTaskRevision: records.aiTask[0].revision, expectedRunRevision: current.revision,
      expectedFencingToken: current.fencingToken.toFixed(0) });
    const completed = await root.application.continueConfirmation({ taskId: 'task-a', runId: 'run-a', checkpointRef: first.id });
    assert.equal(completed.outcome.status, decision === 'approve' ? 'succeeded' : 'failed');
    assert.equal(h.state.records.aiApproval.length, 1, 'continue the exact original decision, never decide again');
    assert.equal(h.state.records.rentalOrder.length, decision === 'approve' ? 1 : 0);
    if (decision === 'reject') {
      assert.equal(h.state.records.aiTaskExecutionPhaseStart.length, 1, 'rejected continuation must only recover the original phase');
      assert.equal(h.state.records.aiTaskExecutionPhaseReceipt.length, 1);
      assert.equal(h.state.records.aiApprovalConsumption.length, 0);
    }
  }
});

test('original confirmation-only phase permits plan change or expiry, never a later unknown phase', async () => {
  const { composeTaskOrderHost } = require('../apps/api/src/modules/ai-native/runner/order-task-host.composition');
  for (const expired of [false, true]) {
    const h = await controlledApprovedOrderHarness({ initializeOnly: true });
    Object.assign(h.state.records.aiTask[0], { status: 'QUEUED' });
    Object.assign(h.state.records.aiRun[0], { status: 'QUEUED', leaseOwnerId: null, leaseExpiresAt: null });
    let ticks = 0;
    const root = composeTaskOrderHost({ ...h.dependencies, host: { holderId: 'order-host', leaseMs: 100000 },
      task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a', order: h.body, limits: h.limits }, monotonic: () => ++ticks });
    assert.equal((await root.application.start({ taskId: 'task-a', runId: 'run-a' })).outcome.status, 'paused');
    const first = h.state.records.aiTaskExecutionPhaseReceipt[0], original = first.payload.proposal;
    assert.equal(h.state.records.aiStep[0].effect, 'POSSIBLE');
    if (expired) {
      const view = await root.orders.approvals.readOriginal('task-a', original);
      h.state.clock = new Date(Math.max(Date.parse(view.deterministic.decisionExpiresAt), Date.parse(view.deterministic.quoteExpiresAt)) + 1);
      for (const policy of h.state.records.aiTaskActionPolicy) policy.expiresAt = new Date('2100-01-01');
    }
    const request = { draftVersion: 'ain-approval-application-draft-1', original, intent: expired ? 'inspect' : 'change_plan' };
    const before = clone(h.state.records);
    const eligible = await root.orders.application.readReprepareEligibility('task-a', request);
    assert.equal(eligible.state, expired ? 'expired' : 'change_requested');
    assert.equal(eligible.canRequestReprepare, true);
    assert.deepEqual(h.state.records, before, 'eligibility is observation, not new input/approval or budget reset');
    const start = h.state.records.aiTaskExecutionPhaseStart[0];
    h.state.records.aiTaskExecutionPhaseStart.push({ ...clone(start), id: 'later-original-phase', sequence: 2,
      previousReceiptId: first.id, decisionRef: 'uncertain-original-decision' });
    assert.equal((await root.orders.application.readReprepareEligibility('task-a', request)).state, 'unknown');
  }
});

async function storedOrderPlanHarness() {
  const { composeTaskOrderHost } = require('../apps/api/src/modules/ai-native/runner/order-task-host.composition');
  const h = await controlledApprovedOrderHarness({ initializeOnly: true });
  const limits = { ...h.limits, maxOutputBytes: 8192 };
  await h.root.policy.put({ expectedRevision: 1, enabled: true, limits, expiresAt: '2099-01-01T00:00:00Z' });
  const bodyB = { ...clone(h.body), quoteId: 'quote-b' };
  h.state.records.quote.push({ ...clone(h.state.records.quote[0]), id: 'quote-b', quoteNo: 'Q-OFFLINE-B', request: bodyB });
  const run = h.state.records.aiRun[0];
  const lease = { taskId: 'task-a', runId: 'run-a', holderId: run.leaseOwnerId, revision: run.revision,
    fencingToken: run.fencingToken.toFixed(0), expiresAt: run.leaseExpiresAt.toISOString() };
  // These are the actual existing guarded publication/plan ports; no model list
  // or new batching DTO can create a plan or approve either action here.
  for (const [registrationRef, input] of [['order-a', h.body], ['order-b', bodyB]]) {
    await h.root.source.publishOrderInput({ taskId: 'task-a', registrationRef,
      expectedTaskRevision: h.state.records.aiTask[0].revision, lease, input });
  }
  await h.root.plans.savePlan({ taskId: 'task-a', runId: 'run-a', taskRevision: h.state.records.aiTask[0].revision,
    steps: ['order-a', 'order-b'].map(registrationRef => ({ registrationRef, operation: 'idempotent',
      toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION })), limits }, lease);
  const planHash = h.state.records.aiTaskRunPlan[0].planHash;
  // Stage an already-published queued task with explicit storage leaves, just
  // as the existing single-action host case; this is not a native scheduling proof.
  Object.assign(h.state.records.aiTask[0], { status: 'QUEUED' });
  Object.assign(h.state.records.aiRun[0], { status: 'QUEUED', leaseOwnerId: null, leaseExpiresAt: null });
  let ticks = 0;
  const root = composeTaskOrderHost({ ...h.dependencies, host: { holderId: 'order-host', leaseMs: 100000 },
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a', limits }, monotonic: () => ++ticks });
  const decide = async (receipt, decision) => {
    const view = await root.orders.approvals.readProposal('task-a', receipt.payload.proposal);
    assert.equal(view.proposal.payload.atomicity, 'single_action');
    assert.equal(view.deterministic.order.customer.id, h.body.customerId);
    const approved = await root.orders.approvals.decide('task-a', { ...receipt.payload.proposal,
      decision, reviewVersion: AI_APPROVAL_ORDER_REVIEW_DRAFT_VERSION });
    const current = h.state.records.aiRun[0];
    await root.authorization.tasks.claimRecoveryRun({ taskId: 'task-a', runId: 'run-a', holderId: 'order-host', leaseMs: 100000,
      expectedTaskRevision: h.state.records.aiTask[0].revision, expectedRunRevision: current.revision,
      expectedFencingToken: current.fencingToken.toFixed(0) });
    return approved;
  };
  return { ...h, root, planHash, decide };
}

test('original rejected confirmation settles without a new execution phase, including cancellation before continuation', async () => {
  for (const cancelled of [false, true]) {
    const h = await storedOrderPlanHarness();
    const started = await h.root.application.start({ taskId: 'task-a', runId: 'run-a' });
    assert.equal(started.outcome.status, 'paused');
    const first = h.state.records.aiTaskExecutionPhaseReceipt[0];
    await h.decide(first, 'reject');
    if (cancelled) Object.assign(h.state.records.aiTask[0], { status: 'CANCEL_REQUESTED', cancelRequestedAt: h.dependencies.clock() });
    const run = h.state.records.aiRun[0], lease = { taskId: 'task-a', runId: 'run-a', holderId: run.leaseOwnerId,
      revision: run.revision, fencingToken: run.fencingToken.toFixed(0), expiresAt: run.leaseExpiresAt.toISOString() };
    const before = clone(h.state.records), prepares = h.state.prepares;
    const { scopeId: _scopeId, ...originalBinding } = first.payload.binding;
    const binding = { ...originalBinding, lease };
    const waiting = await h.root.orders.waiting.readWaiting(binding);
    assert.equal(waiting.receipt?.kind, 'recorded'); assert.equal(waiting.receipt.record.decision, 'rejected');
    const witnessed = await h.root.orders.waiting.reconcile(binding);
    assert.equal(witnessed.kind, 'failed', 'recorded rejection plus the sole confirmation phase proves no submission');
    const observed = await h.root.evidence.readOrderPhaseResult(lease, first.stepId, first.id);
    assert.equal(observed.result.kind, 'failed'); assert.equal(observed.result.errorCode, 'AI_BUSINESS_REJECTED');
    assert.equal(observed.result.resultRef, first.id);
    assert.deepEqual(h.state.records, before, 'original rejection observation cannot rewrite the phase or execute Core');
    assert.equal(h.state.prepares, prepares); assert.equal(h.state.records.aiApprovalConsumption.length, 0);
    // A later phase start breaks the no-submission witness, even if its response
    // is missing. A rejected decision alone must never erase that unknown.
    h.state.records.aiTaskExecutionPhaseStart.push({ ...clone(h.state.records.aiTaskExecutionPhaseStart[0]), id: 'later-phase', sequence: 2,
      previousReceiptId: first.id, decisionRef: waiting.receipt.record.approvalId });
    assert.equal((await h.root.orders.waiting.reconcile(binding)).kind, 'unknown');
  }
});

for (const failure of ['rejected', 'unknown']) test(`stored order plan retains the first Core result when its successor is ${failure}`, async () => {
  const h = await storedOrderPlanHarness();
  const started = await h.root.application.start({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(started.kind, 'run_outcome'); assert.equal(started.outcome.status, 'paused');
  assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApproval.length, 0);
  const first = h.state.records.aiTaskExecutionPhaseReceipt[0];
  const approvalA = await h.decide(first, 'approve');
  const continued = await h.root.application.continueConfirmation({ taskId: 'task-a', runId: 'run-a', checkpointRef: first.id });
  assert.equal(continued.kind, 'run_outcome'); assert.equal(continued.outcome.status, 'paused');
  const afterFirst = h.state.records, originalOrder = clone(afterFirst.rentalOrder[0]);
  assert.equal(afterFirst.rentalOrder.length, 1); assert.equal(originalOrder.quoteId, 'quote-a');
  assert.equal(afterFirst.aiApproval.length, 1, 'the first approval cannot authorize its successor');
  assert.equal(afterFirst.aiApprovalConsumption.length, 1); assert.equal(afterFirst.aiTaskExecutionBudget[0].consumedSteps, 1n);
  const second = afterFirst.aiTaskExecutionPhaseReceipt.find(r => r.kind === 'confirmation' && r.stepId !== first.stepId);
  assert.ok(second); assert.notEqual(second.payload.proposal.proposalId, first.payload.proposal.proposalId);
  const budgetId = afterFirst.aiTaskExecutionBudget[0].id;
  if (failure === 'unknown') h.state.failAt = 'core.inventory';
  await h.decide(second, failure === 'rejected' ? 'reject' : 'approve');
  const outcome = await h.root.application.continueConfirmation({ taskId: 'task-a', runId: 'run-a', checkpointRef: second.id });
  assert.equal(outcome.kind, 'run_outcome');
  assert.equal(outcome.outcome.status, failure === 'rejected' ? 'partially_succeeded' : 'unknown');
  const after = h.state.records;
  assert.equal(after.rentalOrder.length, 1); assert.deepEqual(after.rentalOrder[0], originalOrder);
  assert.equal(after.aiApprovalConsumption.filter(r => r.status === 'COMMITTED').length, 1);
  assert.equal(after.aiTaskRunPlan[0].planHash, h.planHash); assert.equal(after.aiTaskActionInput.length, 2);
  assert.equal(after.aiTaskExecutionBudget.length, 1); assert.equal(after.aiTaskExecutionBudget[0].id, budgetId);
  assert.equal(after.aiStep[0].status, 'SUCCEEDED'); assert.equal(after.aiStep[0].effect, 'COMMITTED');
  assert.equal(after.aiTask[0].status, failure === 'rejected' ? 'PARTIALLY_SUCCEEDED' : 'WAITING_EXTERNAL');
  if (failure === 'rejected') {
    assert.equal(after.aiTaskExecutionBudget[0].consumedSteps, 2n); assert.equal(after.aiTaskExecutionBudget[0].reservedSteps, 0n);
  } else {
    assert.equal(after.aiTaskExecutionBudget[0].consumedSteps, 1n); assert.equal(after.aiTaskExecutionBudget[0].reservedSteps, 1n);
    const prepares = h.state.prepares;
    await h.root.application.reconcile({ taskId: 'task-a', runId: 'run-a' });
    assert.equal(h.state.prepares, prepares, 'unknown recovery cannot retry the Core action');
    assert.deepEqual(h.state.records.rentalOrder[0], originalOrder);
  }
  const replay = await h.root.orders.reconcile({ taskId: 'task-a', proposalId: first.payload.proposal.proposalId,
    proposalRevision: first.payload.proposal.proposalRevision, reviewedPayloadHash: first.payload.proposal.reviewedPayloadHash,
    approvalId: approvalA.approvalId, actionId: first.payload.binding.actionId,
    lease: { runId: 'run-a', holderId: 'order-host', revision: h.state.records.aiRun[0].revision,
      fencingToken: h.state.records.aiRun[0].fencingToken.toFixed(0) } });
  assert.equal(replay.order.id, originalOrder.id); assert.equal(h.state.records.rentalOrder.length, 1);
});

test('stored order plan cannot replace missing inputs, changed plans or an unavailable explicit selection', async () => {
  const { composeTaskOrderHost } = require('../apps/api/src/modules/ai-native/runner/order-task-host.composition');
  for (const variation of ['missing_plan', 'changed_plan', 'explicit_selection_unavailable']) {
    const h = await storedOrderPlanHarness();
    let root = h.root;
    if (variation === 'missing_plan') h.state.records.aiTaskRunPlan = [];
    if (variation === 'changed_plan') h.state.records.aiTaskRunPlan[0].payload.steps[1].registrationRef = 'injected-step';
    if (variation === 'explicit_selection_unavailable') root = composeTaskOrderHost({ ...h.dependencies,
      host: { holderId: 'order-host', leaseMs: 100000 }, task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'order-a',
        limits: clone(h.state.records.aiTaskRunPlan[0].payload.limits) },
      selectedOrder: { taskId: 'task-a', runId: 'run-a', read: async () => undefined } });
    await assert.rejects(root.application.start({ taskId: 'task-a', runId: 'run-a' }),
      error => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_STORAGE_UNAVAILABLE'].includes(error.code));
    assert.equal(h.state.records.rentalOrder.length, 0); assert.equal(h.state.records.aiApproval.length, 0);
    assert.equal(h.state.records.aiTaskActionInput.length, 2, 'a refused plan cannot publish replacement inputs');
  }
});
