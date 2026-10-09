'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
const { PrismaTaskPlanInputSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-input.source');
const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');

async function settingsInputSetup({ normal = false } = {}) {
  const { composePersistedSettingsTaskInput } = require('../apps/api/src/modules/ai-native/settings-task-input.composition');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], rentalApprovedSettingsChange: [],
    aiProposal: [], aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], rentalApprovedSettingsOperation: [],
    aiTaskExecutionPhaseStart: [], aiTaskExecutionPhaseReceipt: [],
    businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant-a', status: 'ACTIVE', categoryVersionId: 'category-a', categoryAdoptionRevision: 1 }] });
  h.state.aiTaskRunPlan.length = 0;
  h.identity.user.permissions.push('rental-os:rules:manage', 'system:params:manage');
  h.state.aiTaskActionPolicy.find(p => p.operation === 'transition_task').requiredPermissions = ['rental-os:rules:manage'];
  const settings = { tenantId: 'tenant-a', notifications: { enabledEvents: ['order.created'], editableChannels: ['email'] } };
  const material = { id: 'change-a', tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'user-a', changeKey: 'original-key',
    baseRevision: 1, baseSettingsHash: requestFingerprint(settings), categoryVersionId: 'category-a', categoryAdoptionRevision: 1,
    beforeNotifications: settings.notifications, afterNotifications: { enabledEvents: ['order.created'], editableChannels: ['sms'] },
    expiresAt: '2026-10-07T12:00:00.000Z' };
  const changeHash = requestFingerprint(material);
  h.state.rentalApprovedSettingsChange.push({ ...material, changeHash, expiresAt: new Date(material.expiresAt), createdAt: h.control.now });
  const current = { settingsRevision: 1, settings };
  // Only persisted facts/Core read and database are doubles. Auth, Guard, plan
  // source, policy, plan repository and step registration are actual code.
  const root = composePersistedSettingsTaskInput({ ...h.authorization, db: h.db,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    core: { readVersionedBusinessSettings: async () => structuredClone(current) }, holderId: 'worker-a',
    scene: { code: 'synthetic-clarification', version: '1' }, clock: () => new Date(h.control.now) });
  const { composeApprovedSettingsApplication } = require('../apps/api/src/modules/ai-native/approval-execution/approved-settings-application.composition');
  const dependencies = { ...h.authorization, db: h.db,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    core: { readVersionedBusinessSettings: async () => structuredClone(current) }, holderId: 'worker-a',
    scene: { code: 'synthetic-clarification', version: '1' }, clock: () => new Date(h.control.now) };
  const app = composeApprovedSettingsApplication(dependencies);
  await root.policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: '2027-01-01T00:00:00Z' });
  if (normal) {
    h.state.aiTask[0].status = 'QUEUED';
    h.state.aiRun[0].status = 'QUEUED';
  }
  const lease = normal ? null : await root.tasks.claimRun(h.claim());
  const reference = { changeId: 'change-a', changeHash };
  const publish = (input = reference) => app.publishTaskInput({ taskId: 'task-a', registrationRef: 'settings-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input });
  const plan = { ...h.clone(h.plan), taskRevision: h.state.aiTask[0].revision,
    steps: [{ registrationRef: 'settings-a', operation: 'idempotent', toolCode: 'tenant.notifications.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] };
  return { ...h, root, app, lease, publish, reference, current, plan, dependencies };
}

test('settings participant accepts the runner POSSIBLE start, not an unstarted or foreign holder step', async () => {
  const h = await settingsInputSetup();
  await h.publish(); await h.root.plans.savePlan(h.plan, h.lease);
  const { taskId, expiresAt, ...lease } = h.lease;
  const registered = await h.root.registrations.register({ taskId, registrationRef: 'settings-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease });
  const step = h.state.aiStep.find(s => s.id === registered.stepId);
  // Persisted state emitted by the idempotent start transition. No external action.
  step.status = 'RUNNING'; step.effect = 'POSSIBLE';
  const { ApprovedSettingsTaskAuthority } = require('../apps/api/src/modules/ai-native/approval-execution/approved-settings-task.authority');
  const authority = new ApprovedSettingsTaskAuthority({ ...h.authorization, db: h.db, holderId: 'worker-a',
    scene: { code: 'synthetic-clarification', version: '1' }, clock: () => new Date(h.control.now) });
  const held = async () => h.db.$transaction(async tx => authority.heldStep(await authority.resolve(taskId, 'execute', tx),
    step.id, h.reference, tx, h.lease.runId));
  assert.equal((await held()).id, step.id);
  h.state.aiStep[0].effect = 'NONE'; await assert.rejects(held());
  h.state.aiStep[0].effect = 'POSSIBLE'; h.state.aiRun[0].leaseOwnerId = 'other-worker'; await assert.rejects(held());
});

async function settingsWaitingSetup(options = {}) {
  const h = await settingsInputSetup(options);
  const { RENTAL_CATEGORY_DEFINITIONS } = require('@rental-os/shared');
  // Database row-lock/category facts are offline substitutes; proposal and
  // decision creation, Guard, current task authorization and executor are real.
  const transaction = h.db.$transaction;
  h.db.$transaction = (work, options) => transaction(tx => work({ ...tx,
    $queryRaw: async () => [{ categoryCode: 'CAMERA', categoryVersionId: 'category-a', categoryAdoptionRevision: 1, status: 'ACTIVE' }],
    rentalCategoryVersion: { findUnique: async () => ({ categoryCode: 'CAMERA', structureVersion: 1, status: 'published',
      definition: structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(d => d.code === 'camera')) }) }
  }), options);
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  h.dependencies.core.previewNotificationSettings = async () => ({ settingsRevision: 1,
    baseSettingsHash: requestFingerprint(h.current.settings), before: h.current.settings.notifications,
    binding: { categoryVersionId: 'category-a', adoptionRevision: 1 } });
  h.state.aiTaskActionPolicy.push({ ...h.state.aiTaskActionPolicy.find(p => p.operation === 'transition_task'),
    operation: 'decide_approval', requiredPermissions: ['rental-os:rules:manage'] });
  if (options.normal) return h;
  await h.publish(); await h.root.plans.savePlan(h.plan, h.lease);
  const { taskId, expiresAt, ...lease } = h.lease;
  const registered = await h.root.registrations.register({ taskId, registrationRef: 'settings-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease });
  const step = h.state.aiStep.find(s => s.id === registered.stepId);
  step.status = 'RUNNING'; step.effect = 'POSSIBLE';
  const { composeApprovedSettingsWaiting } = require('../apps/api/src/modules/ai-native/approval-execution/approved-settings-waiting.executor');
  const waiting = composeApprovedSettingsWaiting(h.dependencies);
  const input = { taskId, runId: h.lease.runId, stepId: step.id, actionId: step.actionId,
    inputRef: step.inputRef, fingerprint: step.requestFingerprint,
    lease: { ...h.lease, revision: h.state.aiRun[0].revision } };
  const signal = new AbortController().signal;
  return { ...h, waiting, input, signal };
}

test('settings executor prepares the actual proposal, waits for a real decision and never treats absence as commit', async () => {
  const h = await settingsWaitingSetup(), { waiting, input, signal } = h;
  const first = await waiting.execute(input, signal);
  assert.equal(first.kind, 'paused'); assert.equal(first.pause, 'confirmation');
  assert.equal(h.state.aiProposal.length, 1); assert.equal(h.state.aiApproval.length, 0);
  assert.equal((await waiting.execute(input, signal)).kind, 'paused');
  assert.equal(h.state.aiProposal.length, 1);
  assert.equal((await waiting.reconcile(input)).kind, 'unknown');
  const observed = await waiting.readWaiting(input);
  await waiting.application.decide({ ...observed.reference, decision: 'reject' });
  const rejected = await waiting.execute(input, signal);
  assert.equal(rejected.kind, 'failed'); assert.equal(rejected.errorCode, 'AI_APPROVAL_REJECTED');
  assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  h.identity.membership = false;
  await assert.rejects(waiting.readWaiting(input));
});

test('settings approved execution consumes the original approval and recovers only the original operation receipt', async () => {
  const h = await settingsWaitingSetup(), { waiting, input, signal } = h;
  let writes = 0;
  // Only Core storage is replaced. Actual application/approval participant
  // commits and validates its durable consumption in the database transaction.
  h.dependencies.core.commitNotificationSettings = async (_tenant, notifications) => {
    writes++; h.current.settingsRevision++; h.current.settings.notifications = structuredClone(notifications);
    return structuredClone(h.current);
  };
  h.dependencies.core.refreshCommittedBusinessSettings = async () => {};
  assert.equal((await waiting.execute(input, signal)).kind, 'paused');
  const observed = await waiting.readWaiting(input);
  await waiting.application.decide({ ...observed.reference, decision: 'approve' });
  const result = await waiting.execute(input, signal);
  assert.equal(result.kind, 'succeeded'); assert.equal(writes, 1);
  assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(result.payload.businessResultRef, h.state.aiApprovalConsumption[0].resultRef);
  const recovered = await waiting.reconcile({ ...input, lease: { ...input.lease, purpose: 'recovery_only' } });
  assert.equal(recovered.kind, 'succeeded'); assert.equal(writes, 1);
  assert.equal(recovered.payload.businessResultRef, result.payload.businessResultRef);
  await assert.rejects(waiting.reconcile({ ...input, actionId: 'foreign-action' }));
  assert.equal(writes, 1);
});

async function settingsNormalHostSetup() {
  const h = await settingsWaitingSetup({ normal: true });
  const { composeTaskSettingsHost } = require('../apps/api/src/modules/ai-native/runner/settings-task-host.composition');
  let ticks = 0, timerId = 0;
  const timers = new Map();
  const rebuild = () => composeTaskSettingsHost({ ...h.dependencies, host: { holderId: 'worker-a', leaseMs: 100000 },
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: 'settings-a', change: h.reference, limits: h.plan.limits },
    monotonic: () => ++ticks,
    runnerClock: { now: () => ticks, setTimeout: (callback, delayMs) => {
      const id = ++timerId; timers.set(id, { callback, due: ticks + delayMs }); return id;
    }, clearTimeout: id => timers.delete(id) } });
  return { ...h, rebuild, timers };
}

test('settings normal host starts through the runner and persists an approval checkpoint without business writes', { timeout: 20000 }, async t => {
  const h = await settingsNormalHostSetup();
  const transaction = h.db.$transaction;
  let open = 0, nested = 0;
  h.db.$transaction = (work, options) => {
    if (open) nested++;
    return transaction(async tx => { open++; try { return await work(tx); } catch (error) { t.diagnostic(error.stack); throw error; } finally { open--; } }, options);
  };
  const host = h.rebuild(), timers = h.timers;
  const result = await host.application.start({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'paused', JSON.stringify({ result,
    steps: h.state.aiStep, phases: h.state.aiTaskExecutionPhaseReceipt, trace: h.trace.slice(-20) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  assert.equal(h.state.aiTask[0].status, 'WAITING_CONFIRMATION');
  assert.equal(h.state.aiStep[0].status, 'RUNNING'); assert.equal(h.state.aiStep[0].effect, 'POSSIBLE');
  assert.equal(h.state.aiTaskExecutionPhaseReceipt.length, 1);
  assert.equal(h.state.aiTaskExecutionPhaseReceipt[0].payload.version, 'approved-settings-wait-1');
  assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  assert.equal(h.state.aiTaskExecutionCharge.length, 3);
  const checkpoint = h.state.aiTaskExecutionPhaseReceipt[0], proposal = checkpoint.payload.proposal;
  const checkpointRequest = { taskId: 'task-a', runId: 'run-a', stepId: h.state.aiStep[0].id };
  const publishedCheckpoint = await host.application.readConfirmation(checkpointRequest);
  assert.equal(publishedCheckpoint.checkpointRef, checkpoint.id);
  assert.equal(publishedCheckpoint.execution, 'not_attested');
  assert.equal(h.state.aiApproval.length, 0);
  await assert.rejects(host.application.readConfirmation({ ...checkpointRequest, stepId: 'other-step' }));
  const { composeAiSettingsBusinessConsumer } = require('../apps/api/src/modules/ai-native/scenes/settings-business-consumer.composition');
  const consumer = composeAiSettingsBusinessConsumer({ ...h.dependencies, settingsHost: host });
  const preparation = { draftVersion: 'ain-approved-settings-draft-1', taskId: 'task-a', runId: 'run-a', stepId: h.state.aiStep[0].id,
    proposalId: proposal.proposalId, proposalRevision: proposal.proposalRevision, changeId: h.reference.changeId, changeHash: h.reference.changeHash };
  const material = await consumer.read({ preparation });
  assert.equal(material.mode, 'read_only'); assert.equal(material.businessOutcome, 'not_observed');
  assert.equal(material.currentMatchesChangeBase, true); assert.equal(material.review.change.changeId, h.reference.changeId);
  assert.equal(material.decision.state, 'not_observed');
  const handoff = await consumer.humanHandoff({ preparation });
  assert.equal(handoff.reference.taskId, 'task-a'); assert.equal(handoff.continuation, 'not_invoked_use_original_settings_host');
  assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  await assert.rejects(consumer.read({ preparation: { ...preparation, taskId: 'other-task' } }));
  await assert.rejects(composeAiSettingsBusinessConsumer().read({ preparation }));
  const permissions = [...h.identity.user.permissions];
  h.identity.user.permissions.length = 0;
  await assert.rejects(host.application.readConfirmation(checkpointRequest));
  await assert.rejects(consumer.read({ preparation }), 'revoked current identity cannot receive the old change');
  h.identity.user.permissions.push(...permissions);
  h.dependencies.core.commitNotificationSettings = async (_tenant, notifications) => {
    h.current.settingsRevision++; h.current.settings.notifications = structuredClone(notifications);
    return structuredClone(h.current);
  };
  h.dependencies.core.refreshCommittedBusinessSettings = async () => {};
  await host.settings.application.decide({ draftVersion: 'ain-approved-settings-draft-1', taskId: 'task-a',
    proposalId: proposal.proposalId, proposalRevision: proposal.proposalRevision, reviewedPayloadHash: proposal.reviewedPayloadHash, decision: 'approve' });
  const run = h.state.aiRun[0];
  await host.authorization.tasks.claimRecoveryRun({ taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', leaseMs: 100000,
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0) });
  const finished = await host.application.continueConfirmation({ taskId: 'task-a', runId: 'run-a', checkpointRef: checkpoint.id });
  assert.equal(finished.kind, 'run_outcome'); assert.equal(finished.outcome.status, 'succeeded', JSON.stringify({ finished,
    phases: h.state.aiTaskExecutionPhaseReceipt, operations: h.state.rentalApprovedSettingsOperation, trace: h.trace.slice(-12) },
    (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  assert.equal(h.state.aiTaskExecutionPhaseReceipt.length, 2);
  assert.equal(h.state.rentalApprovedSettingsOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.aiStep[0].effect, 'COMMITTED');
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
  assert.equal(nested, 0, 'receipt completion reuses the owning step transaction');
  assert.equal(timers.size, 0);
  const business = await consumer.read({ preparation, operationKey: h.state.rentalApprovedSettingsOperation[0].operationKey });
  assert.equal(business.businessOutcome, 'committed'); assert.equal(business.currentMatchesChangeBase, false);
  assert.equal(business.operation.receipt.changeId, preparation.changeId);
  await assert.rejects(host.application.readConfirmation(checkpointRequest), 'terminal tasks cannot expose a live waiting checkpoint');
});

test('settings normal host cancellation blocks confirmation and preserves unresolved original charges', { timeout: 20000 }, async () => {
  const h = await settingsNormalHostSetup(), host = h.rebuild(), key = { taskId: 'task-a', runId: 'run-a' };
  assert.equal((await host.application.start(key)).outcome.status, 'paused');
  const checkpoint = h.state.aiTaskExecutionPhaseReceipt[0], originalCharges = h.state.aiTaskExecutionCharge.map(c => c.chargeId);
  await assert.rejects(host.application.requestCancel({ taskId: 'other-task', expectedRevision: h.state.aiTask[0].revision }));
  const cancelled = await host.application.requestCancel({ taskId: key.taskId, expectedRevision: h.state.aiTask[0].revision });
  assert.equal(cancelled.cancellation, 'requested_not_rollback');
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  await assert.rejects(host.application.continueConfirmation({ ...key, checkpointRef: checkpoint.id }));
  const rebuilt = h.rebuild();
  await rebuilt.authorization.tasks.claimRecoveryRun(h.claim());
  const lease = h.held();
  await assert.rejects(rebuilt.inputs.source.publishSettingsInput({ taskId: key.taskId, registrationRef: 'new-settings',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: h.reference }));
  assert.equal((await rebuilt.application.reconcile(key)).outcome.status, 'unknown');
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  assert.equal(h.state.aiApprovalConsumption.length, 0);
  assert.equal(h.state.aiTaskExecutionPhaseStart.length, 1);
  assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), originalCharges);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'UNKNOWN'));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.timers.size, 0);
});

for (const mode of ['missing operation', 'cancelled committed operation']) test(`settings normal host recovers ${mode} without executing again`, { timeout: 20000 }, async () => {
  const h = await settingsNormalHostSetup(), host = h.rebuild(), key = { taskId: 'task-a', runId: 'run-a' };
  let calls = 0;
  h.dependencies.core.commitNotificationSettings = async (_tenant, notifications) => {
    calls++;
    if (mode === 'missing operation') throw Error('synthetic Core commit unavailable');
    h.current.settingsRevision++; h.current.settings.notifications = structuredClone(notifications);
    return structuredClone(h.current);
  };
  h.dependencies.core.refreshCommittedBusinessSettings = async () => {};
  assert.equal((await host.application.start(key)).outcome.status, 'paused');
  const originalPlan = h.clone(h.state.aiTaskRunPlan), originalInput = h.clone(h.state.aiTaskActionInput);
  const originalCharges = h.state.aiTaskExecutionCharge.map(c => c.chargeId);
  const checkpoint = h.state.aiTaskExecutionPhaseReceipt[0], proposal = checkpoint.payload.proposal;
  await host.settings.application.decide({ draftVersion: 'ain-approved-settings-draft-1', taskId: key.taskId,
    proposalId: proposal.proposalId, proposalRevision: proposal.proposalRevision,
    reviewedPayloadHash: proposal.reviewedPayloadHash, decision: 'approve' });
  await host.authorization.tasks.claimRecoveryRun(h.claim());
  if (mode === 'cancelled committed operation') h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && args.data?.status === 'SUCCEEDED') throw Error('synthetic result bookkeeping unavailable');
  };
  const continued = host.application.continueConfirmation({ ...key, checkpointRef: checkpoint.id });
  if (mode === 'missing operation') {
    assert.equal((await continued).outcome.status, 'unknown');
    assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
  } else {
    await assert.rejects(continued);
    assert.equal(h.state.rentalApprovedSettingsOperation.length, 1);
    assert.equal(h.state.aiStep[0].status, 'RUNNING');
    assert.equal(h.state.aiTaskExecutionPhaseReceipt[1].kind, 'succeeded');
    h.storeControl.beforeWrite = null;
    await host.application.requestCancel({ taskId: key.taskId, expectedRevision: h.state.aiTask[0].revision });
  }
  assert.equal(calls, 1);
  const rebuilt = h.rebuild();
  await rebuilt.authorization.tasks.claimRecoveryRun(h.claim());
  const lease = h.held();
  await assert.rejects(rebuilt.inputs.source.publishSettingsInput({ taskId: key.taskId, registrationRef: 'new-settings',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: h.reference }));
  const result = await rebuilt.application.reconcile(key);
  assert.equal(result.outcome.status, mode === 'missing operation' ? 'unknown' : 'succeeded', JSON.stringify({ step: h.state.aiStep,
    charges: h.state.aiTaskExecutionCharge, trace: h.trace.slice(-20) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  assert.equal(h.state.aiTask[0].status, mode === 'missing operation' ? 'WAITING_EXTERNAL' : 'SUCCEEDED');
  assert.equal(h.state.rentalApprovedSettingsOperation.length, mode === 'missing operation' ? 0 : 1);
  assert.equal(h.state.aiApprovalConsumption.length, mode === 'missing operation' ? 0 : 1);
  assert.equal(calls, 1, 'reconciliation never re-enters Core commit');
  assert.deepEqual(h.state.aiTaskRunPlan, originalPlan);
  assert.deepEqual(h.state.aiTaskActionInput, originalInput);
  assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), originalCharges);
  assert.equal(h.state.aiTaskExecutionPhaseStart.length, 2);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === (mode === 'missing operation' ? 'UNKNOWN' : 'RECORDED')));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.timers.size, 0);
  h.identity.membership = false;
  await assert.rejects(rebuilt.application.reconcile(key));
});

test('settings original change produces a policy-bound plan and PENDING step with the original domain hash', async () => {
  const h = await settingsInputSetup();
  const published = await h.publish();
  assert.equal((await h.publish()).id, published.id);
  await h.root.plans.savePlan(h.plan, h.lease);
  const { taskId, expiresAt, ...lease } = h.lease;
  const registered = await h.root.registrations.register({ taskId, registrationRef: 'settings-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease });
  const step = h.state.aiStep.find(s => s.id === registered.stepId);
  assert.equal(step.inputRef, h.reference.changeId);
  assert.equal(step.requestFingerprint, h.reference.changeHash);
  assert.equal(step.status, 'PENDING');
  assert.equal(step.effect, 'NONE');
  assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.deepEqual(h.state.aiTaskActionInput[0].payload, h.reference);
  assert.equal(h.current.settingsRevision, 1);
  h.state.businessWorkspace[0].categoryAdoptionRevision++;
  await assert.rejects(h.root.source.authorize(h.plan, { ...h.lease, revision: h.state.aiRun[0].revision }));
});

test('settings publication rejects foreign owner, changed configuration and withdrawn original write permission', async () => {
  const h = await settingsInputSetup();
  h.state.rentalApprovedSettingsChange[0].actorId = 'other-user';
  await assert.rejects(h.publish());
  h.state.rentalApprovedSettingsChange[0].actorId = 'user-a';
  h.current.settingsRevision = 2;
  await assert.rejects(h.publish());
  h.current.settingsRevision = 1;
  h.state.rentalApprovedSettingsChange[0].afterNotifications.editableChannels = ['wechat'];
  await assert.rejects(h.publish());
  h.state.rentalApprovedSettingsChange[0].afterNotifications.editableChannels = ['sms'];
  h.identity.user.permissions = h.identity.user.permissions.filter(p => p !== 'rental-os:rules:manage');
  await assert.rejects(h.publish());
  assert.equal(h.state.aiTaskActionInput.length, 0);
});

test('settings input lost acknowledgement is read by the original task/run/reference without a new write', async () => {
  const h = await settingsInputSetup();
  const key = { taskId: 'task-a', runId: 'run-a', registrationRef: 'settings-a' };
  assert.deepEqual(await h.app.readTaskInputReceipt(key), { state: 'not_observed', nextAction: 'read_task_input' });
  h.storeControl.beforeCommit = async draft => {
    if (draft.aiTaskActionInput.length && !h.state.aiTaskActionInput.length) h.storeControl.loseReply = true;
  };
  await assert.rejects(h.publish(), e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'read_task_input' && !e.retryable);
  const { settingsApplicationError, settingsContract } = require('../apps/api/src/modules/ai-native/approval-execution/approved-settings-contracts');
  const { AiTaskPlanInputResultUnknownError } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-input.source');
  assert.equal(settingsContract('AiApprovedSettingsErrorDraft', settingsApplicationError(new AiTaskPlanInputResultUnknownError('read_task_input')), true).nextAction, 'read_task_input');
  const writes = h.trace.filter(v => v.endsWith('.create')).length;
  const receipt = await h.app.readTaskInputReceipt(key);
  assert.equal(receipt.state, 'published');
  assert.equal(receipt.execution, 'not_attested');
  assert.deepEqual(receipt.input, h.reference);
  assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.equal(h.trace.filter(v => v.endsWith('.create')).length, writes);
  h.identity.membership = false;
  await assert.rejects(h.app.readTaskInputReceipt(key));
});
async function setup() {
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [] });
  h.state.aiTaskRunPlan.length = 0;
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: 'synthetic-clarification', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'rental.catalog.search', version: AI_TOOL_DRAFT_VERSION }], limits: h.clone(h.plan.limits), expiresAt: new Date('2026-10-07T12:00:00Z') });
  const auth = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock: () => new Date(h.control.now) });
  const source = new PrismaTaskPlanInputSource(h.db, auth.authority, auth.execution, () => new Date(h.control.now));
  const lease = await auth.tasks.claimRun(h.claim());
  const publish = patch => source.publishCatalogInput({ taskId: 'task-a', registrationRef: 'catalog-a', expectedTaskRevision: h.state.aiTask[0].revision,
    lease, input: { limit: 10 }, ...patch });
  const plan = { ...h.clone(h.plan), steps: [{ registrationRef: 'catalog-a', operation: 'readonly', toolCode: 'rental.catalog.search', toolVersion: AI_TOOL_DRAFT_VERSION }] };
  return { ...h, auth, source, lease, publish, plan };
}
test('input publication is immutable and a reconstructed source returns the same bound plan proof', async () => {
  const h = await setup();
  const first = await h.publish(), replay = await h.publish();
  assert.equal(replay.id, first.id); assert.equal(replay.replayed, true);
  assert.equal(h.state.aiTaskActionInput.length, 1);
  await assert.rejects(h.publish({ input: { limit: 11 } }), e => e.code === 'AI_REVISION_CONFLICT');
  const proof = await h.source.authorize(h.plan, h.lease);
  const rebuilt = new PrismaTaskPlanInputSource(h.db, h.auth.authority, h.auth.execution, () => new Date(h.control.now));
  assert.deepEqual(await rebuilt.authorize(h.plan, h.lease), proof);
});
for (const [label, mutate] of [
  ['missing policy', h => { h.state.aiTaskPlanPolicy.length = 0; }],
  ['disabled policy', h => { h.state.aiTaskPlanPolicy[0].enabled = false; }],
  ['expired policy', h => { h.state.aiTaskPlanPolicy[0].expiresAt = h.control.now; }],
  ['wrong scope policy', h => { h.state.aiTaskPlanPolicy[0].scopeId = 'other'; }],
  ['empty allowed tools', h => { h.state.aiTaskPlanPolicy[0].allowedTools = []; }],
  ['withdrawn membership', h => { h.identity.membership = false; }],
  ['missing subscription entitlement', h => { h.state.subscriptionFeatureCatalog.length = 0; }],
]) test(`input publication denies ${label} without rows`, async () => {
  const h = await setup(); mutate(h);
  await assert.rejects(h.publish()); assert.equal(h.state.aiTaskActionInput.length, 0);
});
test('strict existing input schema rejects credentials, unknown fields and invalid bounds', async () => {
  const h = await setup();
  for (const input of [{ limit: 10, apiKey: 'synthetic-forbidden' }, { limit: 0 }, { limit: 101 }, { limit: '10' }]) await assert.rejects(h.publish({ input }));
  assert.equal(h.state.aiTaskActionInput.length, 0);
});
test('plan ceilings and tool substitution are checked against persisted scene policy', async () => {
  const h = await setup(); await h.publish();
  await assert.rejects(h.source.authorize({ ...h.plan, limits: { ...h.plan.limits, maxCalls: 5 } }, h.lease));
  await assert.rejects(h.source.authorize({ ...h.plan, steps: [{ ...h.plan.steps[0], toolCode: 'rental.order.commit' }] }, h.lease));
});
test('lost input commit acknowledgement preserves one row and requires reconcile', async () => {
  const h = await setup();
  h.storeControl.beforeCommit = async draft => {
    if (draft.aiTaskActionInput.length && !h.state.aiTaskActionInput.length) h.storeControl.loseReply = true;
  };
  await assert.rejects(h.publish(), e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false && e.nextAction === 'reconcile');
  assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.equal((await h.publish()).replayed, true);
});
test('scene policy changed between first read and locked read rolls back input publication', async () => {
  const h = await setup();
  h.storeControl.beforeRead = async (name, _args, data) => {
    if (name === 'aiTaskPlanPolicy' && h.trace.includes('row.lock') && data !== h.state) data.aiTaskPlanPolicy[0].revision++;
  };
  await assert.rejects(h.publish());
  assert.equal(h.state.aiTaskActionInput.length, 0);
});
test('concurrent same reference publication produces one immutable row; a different body cannot reuse it', async () => {
  const h = await setup();
  const results = await Promise.all([h.publish(), h.publish()]);
  assert.equal(results[0].id, results[1].id);
  assert.equal(h.state.aiTaskActionInput.length, 1);
  await assert.rejects(h.publish({ input: { limit: 9 } }));
});
test('scene step ceiling prevents extra inputs and a saved plan closes its input set', async () => {
  const h = await setup(); h.state.aiTaskPlanPolicy[0].limits.maxSteps = 1;
  await h.publish();
  await assert.rejects(h.publish({ registrationRef: 'catalog-b' }));
  assert.equal(h.state.aiTaskActionInput.length, 1);
  h.state.aiTaskPlanPolicy[0].limits.maxSteps = 2;
  h.state.aiTaskRunPlan.push({ scopeId: 'scope-a', taskId: 'task-a', runId: 'run-a' });
  await assert.rejects(h.publish({ registrationRef: 'catalog-b' }));
  assert.equal(h.state.aiTaskActionInput.length, 1);
});
test('executor input read rejects unregistered step and another run even when input exists', async () => {
  const h = await setup(), published = await h.publish();
  const binding = { taskId: 'task-a', runId: 'run-a', stepId: 'missing-step', actionId: 'forged-action',
    inputRef: published.id, fingerprint: h.state.aiTaskActionInput[0].fingerprint, lease: h.lease };
  await assert.rejects(h.source.readForExecution(binding));
  await assert.rejects(h.source.readForExecution({ ...binding, runId: 'other-run' }));
});
async function composed() {
  const h = await setup();
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { composePersistedCatalogTaskRunner } = require('../apps/api/src/modules/ai-native/runner/persisted-catalog-runner.composition');
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const calls = [];
  const root = composePersistedCatalogTaskRunner({ db: h.db, authorization: h.authorization,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    core: { listItemGroups: async tenantId => {
      calls.push({ tenantId, identity: getRequestIdentity() });
      if (h.control.onRead) await h.control.onRead();
      return [{ id: 'group-a', tenantId: 'tenant-a', code: 'CAMERA', name: 'Synthetic camera', categoryCode: 'photography', status: 'enabled', unit: '台', internalNote: 'must-not-project' }];
    } }, wall: () => new Date(h.control.now), monotonic: () => ++h.control.tick });
  await root.source.publishCatalogInput({ taskId: 'task-a', registrationRef: 'catalog-a', expectedTaskRevision: h.state.aiTask[0].revision, lease: h.lease, input: { limit: 10 } });
  await root.evidence.savePlan(h.plan, h.lease);
  await h.auth.tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: h.lease.holderId,
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: h.state.aiRun[0].revision, expectedFencingToken: h.state.aiRun[0].fencingToken.toFixed(0) });
  return { ...h, root, calls };
}
test('actual policy/input/Guard/Core reader drives persistent runner without synthetic plan, registration or executor grants', async () => {
  const h = await composed();
  assert.equal((await h.root.runner.run(h.claim())).status, 'succeeded');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].tenantId, 'tenant-a');
  assert.equal(h.calls[0].identity.workspaceId, 'workspace-a');
  assert.equal(h.state.aiStep[0].inputRef, h.state.aiTaskActionInput[0].id);
  const artifact = h.state.aiTaskResultArtifact[0];
  assert.equal(artifact.outcome, 'SUCCEEDED');
  assert.equal(artifact.payload.items[0].name, 'Synthetic camera');
  assert.equal(JSON.stringify(artifact.payload).includes('must-not-project'), false);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
});
for (const [label, mutate] of [
  ['policy revision change', h => { h.state.aiTaskPlanPolicy[0].revision++; }],
  ['input tamper', h => { h.state.aiTaskActionInput[0].payload.limit = 11; }],
  ['permission withdrawal', h => { h.identity.user.permissions = []; }],
  ['missing policy', h => { h.state.aiTaskPlanPolicy.length = 0; }],
  ['workspace switch', h => { h.identity.workspace = 'workspace-b'; }],
]) test(`actual composed runner rejects ${label} before Core`, async () => {
  const h = await composed(); mutate(h);
  await Promise.allSettled([h.root.runner.run(h.claim())]);
  assert.equal(h.calls.length, 0);
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.completeMeasurement).length, 0);
});
test('Guard revalidation rejects revoked identity during real Core read, without fabricated success', async () => {
  const h = await composed(); h.control.onRead = () => { h.identity.membership = false; };
  await Promise.allSettled([h.root.runner.run(h.claim())]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.outcome === 'SUCCEEDED').length, 0);
  assert.notEqual(h.state.aiTask[0].status, 'SUCCEEDED');
});
test('fresh authorization timestamps do not change the immutable input or executing identity', async () => {
  const h = await composed();
  h.storeControl.beforeRead = async () => { h.control.now = new Date(h.control.now.getTime() + 1); };
  assert.equal((await h.root.runner.run(h.claim())).status, 'succeeded');
  assert.equal(h.calls.length, 1);
});
test('interrupted actual readonly Core leaves a durable waiting task and unknown occupancy without invalid step transition', async () => {
  const h = await composed();
  h.control.onRead = () => { throw new Error('synthetic interrupted Core read'); };
  const result = await h.root.runner.run(h.claim());
  assert.equal(result.status, 'unknown');
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, false);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'UNKNOWN'));
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.outcome === 'SUCCEEDED').length, 0);
  assert.equal((await h.root.runner.run({ ...h.claim(), holderId: 'recovery-worker', recovery: true })).status, 'unknown');
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
});
async function completedReadBeforeStepCommit() {
  const h = await composed(); let failed = false;
  h.storeControl.beforeWrite = async (name, args) => {
    if (name === 'aiStep' && args.data.status === 'SUCCEEDED' && !failed) {
      failed = true; throw new Error('synthetic step transaction failure after durable result');
    }
  };
  await assert.rejects(h.root.runner.run(h.claim()));
  assert.equal(h.state.aiTaskResultArtifact[0].completeMeasurement, true);
  return h;
}
test('new worker recovers an actual completed read artifact after step transaction failure without calling Core twice', async () => {
  const h = await completedReadBeforeStepCommit();
  const originalFence = h.state.aiTaskResultArtifact[0].fencingToken.toFixed(0);
  const recovered = await h.root.runner.run({ ...h.claim(), holderId: 'recovery-worker', recovery: true });
  assert.equal(recovered.status, 'succeeded');
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.aiTaskResultArtifact.length, 1);
  assert.equal(h.state.aiTaskResultArtifact[0].fencingToken.toFixed(0), originalFence);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTask[0].status, 'SUCCEEDED');
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === 'RECORDED'));
});
for (const [name, mutate] of [
  ['future artifact fence', h => { h.state.aiTaskResultArtifact[0].fencingToken = new (require('../apps/api/node_modules/@prisma/client').Prisma.Decimal)(999); }],
  ['artifact content tamper', h => { h.state.aiTaskResultArtifact[0].payload = { forged: true }; }],
  ['charge from other scope', h => { h.state.aiTaskExecutionCharge[0].scopeId = 'foreign'; }],
  ['withdrawn membership', h => { h.identity.membership = false; }],
  ['changed policy revision', h => { h.state.aiTaskPlanPolicy[0].revision++; }],
]) test(`cross-generation readonly recovery refuses ${name} without new Core call`, async () => {
  const h = await completedReadBeforeStepCommit(); mutate(h);
  await Promise.allSettled([h.root.runner.run({ ...h.claim(), holderId: 'recovery-worker', recovery: true })]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.notEqual(h.state.aiTask[0].status, 'SUCCEEDED');
});
