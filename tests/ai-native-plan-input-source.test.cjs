'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false,
  // Node's isolated consumer smoke uses CJS; frontend production remains ESM
  // and is separately checked with the actual admin tsconfig.
  moduleTypes: { [`${process.cwd().replace(/\\/g, '/')}/apps/admin/src/**`]: 'cjs' },
  compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
const { PrismaTaskPlanInputSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-input.source');
const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');

async function settingsInputSetup({ normal = false, cancellationEvidence = false } = {}) {
  const { composePersistedSettingsTaskInput } = require('../apps/api/src/modules/ai-native/settings-task-input.composition');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], rentalApprovedSettingsChange: [],
    aiProposal: [], aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], rentalApprovedSettingsOperation: [],
    aiTaskExecutionPhaseStart: [], aiTaskExecutionPhaseReceipt: [],
    ...(cancellationEvidence ? { aiBudgetReservation: [] } : {}),
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

// Notification reconfirmation uses fresh canonical tasks, original services
// and explicit in-memory Core/transaction/clock facts, not live configuration.
async function settingsReconfirmationSetup({ start = true } = {}) {
  const h = await settingsWaitingSetup({ normal: true, cancellationEvidence: true });
  h.storeControl.settingsSchemaDefaults = true;
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { composeTaskSettingsHost } = require('../apps/api/src/modules/ai-native/runner/settings-task-host.composition');
  const { composeRequestBoundSettingsTaskCreation, composeRequestBoundSettingsReconfirmation } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { ConflictException } = require('@nestjs/common');
  let writes = 0, ticks = 0, timerId = 0;
  const timers = new Map();
  h.dependencies.core.previewNotificationSettings = async (_tenant, notifications) => ({
    settingsRevision: h.current.settingsRevision, baseSettingsHash: requestFingerprint(h.current.settings),
    before: h.clone(h.current.settings.notifications), after: h.clone(notifications),
    binding: { categoryVersionId: 'category-a', adoptionRevision: 1 }
  });
  h.dependencies.core.commitNotificationSettings = async (_tenant, notifications, _actor, expected) => {
    if (expected.baseRevision !== h.current.settingsRevision || expected.baseSettingsHash !== requestFingerprint(h.current.settings))
      throw new ConflictException('synthetic current Core settings CAS conflict');
    h.current.settingsRevision++; h.current.settings.notifications = h.clone(notifications); writes++;
    return h.clone(h.current);
  };
  h.dependencies.core.refreshCommittedBusinessSettings = async () => {};
  const transaction = h.db.$transaction;
  h.db.$transaction = async (work, options) => {
    const before = h.clone(h.current), count = writes;
    try { return await transaction(work, options); }
    catch (error) { Object.assign(h.current, before); writes = count; throw error; }
  };
  const { credentials, ...dependencies } = h.dependencies;
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const options = { enabled: true, audience: 'operator' };
  const creation = composeRequestBoundSettingsTaskCreation(dependencies, options);
  const reconfirmation = composeRequestBoundSettingsReconfirmation(dependencies, options);
  const original = { creationKey: 'notification-original-task', changeKey: 'original-key' };
  const created = await creation.create(request, original), taskId = created.receipt.taskId, runId = created.receipt.runId;
  const templates = h.clone(h.state.aiTaskActionPolicy.filter(row => row.taskId === 'task-a'));
  const install = task => h.state.aiTaskActionPolicy.push(...h.clone(templates).map(row => ({ ...row, taskId: task })));
  install(taskId);
  const runnerClock = { now: () => ticks, setTimeout: (callback, delayMs) => {
    const id = ++timerId; timers.set(id, { callback, due: ticks + delayMs }); return id;
  }, clearTimeout: id => timers.delete(id) };
  const build = (task, run, change) => composeTaskSettingsHost({ ...h.dependencies,
    host: { holderId: 'worker-a', leaseMs: 100000 }, task: { taskId: task, runId: run,
      registrationRef: `settings-change:${change.changeId}`, change, limits: h.plan.limits },
    monotonic: () => ++ticks, runnerClock });
  const host = build(taskId, runId, h.reference);
  if (start) assert.equal((await host.application.start({ taskId, runId })).outcome.status, 'paused');
  const cancel = async () => {
    const { AiTaskTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-task-transition.repository');
    const authorization = composePersistedTaskAuthorization(h.dependencies);
    const transitions = new AiTaskTransitionRepository(h.db, authorization.authority, h.dependencies.clock);
    const task = () => h.state.aiTask.find(row => row.id === taskId);
    await transitions.transition({ taskId, expectedRevision: task().revision, to: 'cancel_requested', reason: 'cancel_requested' });
    if (!start) await transitions.settleUnstartedCancellation({ taskId, expectedRevision: task().revision,
      to: 'cancelled', reason: 'cancel_settled' }, runId);
    else {
      const run = h.state.aiRun.find(row => row.id === runId);
      const claim = { taskId, runId, holderId: 'worker-a', leaseMs: 100000, expectedTaskRevision: task().revision,
        expectedRunRevision: run.revision, expectedFencingToken: run.fencingToken.toFixed(0) };
      const received = await authorization.tasks.claimRecoveryRun(claim);
      const { snapshotAiTaskRunnerClaimLease } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');
      const lease = { ...snapshotAiTaskRunnerClaimLease(claim, received), purpose: received.purpose };
      assert.equal(lease.purpose, 'recovery_only');
      await host.runner.recover(lease);
    }
    assert.equal(task().status, 'CANCELLED');
  };
  const continueApproved = async (root, task, run, checkpointRef) => {
    const authorization = composePersistedTaskAuthorization(h.dependencies);
    const currentTask = h.state.aiTask.find(row => row.id === task), currentRun = h.state.aiRun.find(row => row.id === run);
    const claim = { taskId: task, runId: run, holderId: 'worker-a', leaseMs: 100000,
      expectedTaskRevision: currentTask.revision, expectedRunRevision: currentRun.revision, expectedFencingToken: currentRun.fencingToken.toFixed(0) };
    const received = await authorization.tasks.claimRecoveryRun(claim);
    require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service').snapshotAiTaskRunnerClaimLease(claim, received);
    return root.application.continueConfirmation({ taskId: task, runId: run, checkpointRef });
  };
  return { ...h, request, creation, reconfirmation, original, taskId, runId, host, build, install, cancel, continueApproved,
    writes: () => writes };
}

test('AIN16 settings reconfirmation closes stale original then requires a new frozen change proposal approval and one Core CAS', { timeout: 60000 }, async () => {
  const h = await settingsReconfirmationSetup();
  h.current.settingsRevision = 2;
  h.current.settings.notifications = { enabledEvents: ['order.created', 'order.cancelled'], editableChannels: ['email'] };
  h.current.settings.retainedOtherConfiguration = { unchanged: true };
  const desired = { enabledEvents: ['order.created', 'order.cancelled'], editableChannels: ['sms'] };
  const command = { original: h.original, notifications: desired, expiresAt: '2026-10-07T12:00:00Z' };
  const difference = await h.reconfirmation.readUpdatedDifference(h.request, command);
  assert.equal(difference.originalBaseMatches, false); assert.equal(difference.current.settingsRevision, 2);
  assert.deepEqual(difference.fields[0].before, h.current.settings.notifications);
  const input = { ...command, reviewHash: difference.reviewHash };
  await assert.rejects(h.reconfirmation.prepareReconfirmedChange(h.request, input));
  await h.cancel();
  const oldInput = h.state.aiTaskActionInput.find(row => row.taskId === h.taskId), oldStep = h.state.aiStep.find(row => row.taskId === h.taskId);
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  assert.equal(oldStep.inputRef, oldInput.id); assert.equal(oldInput.id, h.reference.changeId);
  assert.equal(oldInput.fingerprint, requestFingerprint(h.reference));
  assert.equal(oldStep.requestFingerprint, h.reference.changeHash);
  assert.notEqual(oldInput.fingerprint, oldStep.requestFingerprint);
  const oldRows = () => h.clone(Object.fromEntries(['aiTask', 'aiRun', 'aiStep', 'aiTaskRunPlan', 'aiTaskActionInput',
    'aiTaskExecutionBudget', 'aiTaskExecutionCharge', 'aiTaskRunPreparation', 'aiTaskEvent'].map(name => [name,
      h.state[name].filter(row => row.taskId === h.taskId || row.id === h.taskId)])));
  const frozen = oldRows(), count = h.state.aiTask.length;
  const prepared = await h.reconfirmation.prepareReconfirmedChange(h.request, input);
  assert.equal(prepared.change.baseRevision, 2); assert.equal(prepared.task, 'not_created_by_preparation');
  assert.equal(prepared.approval, 'fresh_proposal_and_approval_required');
  assert.equal(h.state.aiTask.length, count); assert.equal(h.writes(), 0);
  const created = await h.creation.create(h.request, prepared.reference);
  assert.notEqual(created.receipt.taskId, h.taskId); h.install(created.receipt.taskId);
  const change = { changeId: prepared.change.changeId, changeHash: prepared.change.changeHash };
  const host = h.build(created.receipt.taskId, created.receipt.runId, change);
  assert.equal((await host.application.start({ taskId: created.receipt.taskId, runId: created.receipt.runId })).outcome.status, 'paused');
  const step = h.state.aiStep.find(row => row.taskId === created.receipt.taskId);
  const wait = await host.application.readConfirmation({ taskId: created.receipt.taskId, runId: created.receipt.runId, stepId: step.id });
  const continuation = { taskId: created.receipt.taskId, runId: created.receipt.runId, checkpointRef: wait.checkpointRef };
  const beforeDecision = h.clone(h.state);
  assert.deepEqual(await host.application.continueConfirmation(continuation), { kind: 'not_started', reason: 'confirmation_lease_unavailable' });
  await assert.rejects(host.application.continueOriginalConfirmation(continuation), error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(h.clone(h.state), beforeDecision); assert.equal(h.writes(), 0);
  assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  await h.app.decide({ draftVersion: 'ain-approved-settings-draft-1', taskId: created.receipt.taskId,
    proposalId: wait.proposal.proposalId, proposalRevision: wait.proposal.proposalRevision,
    reviewedPayloadHash: wait.proposal.reviewedPayloadHash, decision: 'approve' });
  const finished = await h.continueApproved(host, created.receipt.taskId, created.receipt.runId, wait.checkpointRef);
  assert.equal(finished.outcome.status, 'succeeded'); assert.equal(h.writes(), 1);
  assert.equal(h.current.settingsRevision, 3); assert.deepEqual(h.current.settings.notifications, desired);
  assert.deepEqual(h.current.settings.retainedOtherConfiguration, { unchanged: true });
  assert.equal(h.state.rentalApprovedSettingsOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.rentalApprovedSettingsOperation[0].changeId, prepared.change.changeId);
  assert.deepEqual(oldRows(), frozen);
});

test('AIN16 settings reconfirmation observes lost preparation ACK and rejects altered review duplicate tasks or withdrawn access', { timeout: 60000 }, async () => {
  const h = await settingsReconfirmationSetup({ start: false });
  await h.cancel();
  const command = { original: h.original, notifications: { enabledEvents: ['order.created'], editableChannels: ['sms'] },
    expiresAt: '2026-10-07T12:00:00Z' };
  const difference = await h.reconfirmation.readUpdatedDifference(h.request, command), input = { ...command, reviewHash: difference.reviewHash };
  const count = h.state.rentalApprovedSettingsChange.length, tasks = h.state.aiTask.length;
  const originalTask = h.clone(h.state.aiTask.find(row => row.id === h.taskId));
  h.state.aiTask.push({ ...h.clone(originalTask), id: 'another-original-settings-task', creationKey: 'another-key', status: 'QUEUED', cancelRequestedAt: null });
  await assert.rejects(h.reconfirmation.prepareReconfirmedChange(h.request, input));
  assert.equal(h.state.rentalApprovedSettingsChange.length, count);
  h.state.aiTask.pop();
  await assert.rejects(h.reconfirmation.prepareReconfirmedChange(h.request, { ...input, reviewHash: '0'.repeat(64) }));
  await assert.rejects(h.reconfirmation.prepareReconfirmedChange(h.request, { ...input, changeKey: 'caller-key' }));
  let lost = false;
  h.storeControl.beforeWrite = name => {
    if (!lost && name === 'rentalApprovedSettingsChange') { lost = true; h.storeControl.loseReply = true; }
  };
  await assert.rejects(h.reconfirmation.prepareReconfirmedChange(h.request, input), error => error.code === 'AI_RESULT_UNKNOWN');
  h.storeControl.beforeWrite = null;
  assert.equal(lost, true); assert.equal(h.state.rentalApprovedSettingsChange.length, count + 1);
  assert.equal(h.state.aiTask.length, tasks); assert.equal(h.writes(), 0); assert.equal(h.state.aiApproval.length, 0);
  const before = h.clone(h.state), observed = await h.reconfirmation.readReconfirmedChange(h.request, { original: h.original });
  assert.equal(observed.receipt.state, 'prepared_not_approved'); assert.deepEqual(h.clone(h.state), before);
  h.identity.membership = false;
  await assert.rejects(h.reconfirmation.readReconfirmedChange(h.request, { original: h.original }));
  assert.deepEqual(h.clone(h.state), before);
});

// Notification recovery ACK acceptance uses only new canonical fixture tasks.
async function notificationRecoveryAckSetup() {
  const h = await settingsReconfirmationSetup();
  const step = h.state.aiStep.find(row => row.taskId === h.taskId);
  const wait = await h.host.application.readConfirmation({ taskId: h.taskId, runId: h.runId, stepId: step.id });
  await h.app.decide({ draftVersion: 'ain-approved-settings-draft-1', taskId: h.taskId,
    proposalId: wait.proposal.proposalId, proposalRevision: wait.proposal.proposalRevision,
    reviewedPayloadHash: wait.proposal.reviewedPayloadHash, decision: 'approve' });
  const command = { taskId: h.taskId, runId: h.runId, checkpointRef: wait.checkpointRef };
  const invoke = (mode, signal) => mode === 'continue'
    ? h.host.application.continueOriginalConfirmation(command, signal)
    : h.host.application.reconcileOriginal({ taskId: h.taskId, runId: h.runId }, signal);
  return { ...h, command, invoke };
}

test('AIN16 notification recovery ACK accepts the exact original CAS before one approved Core submission', { timeout: 60000 }, async () => {
  const h = await notificationRecoveryAckSetup(), tasks = h.host.authorization.tasks;
  const claim = tasks.claimRecoveryRun.bind(tasks); const received = [];
  tasks.claimRecoveryRun = async command => {
    const ack = await claim(command);
    received.push({ command: h.clone(command), ack: h.clone(ack) }); return ack;
  };
  const result = await h.invoke('continue');
  assert.equal(result.outcome.status, 'succeeded'); assert.equal(h.writes(), 1);
  assert.equal(received.length, 1);
  const { command, ack } = received[0];
  assert.equal(ack.taskId, h.taskId); assert.equal(ack.runId, h.runId); assert.equal(ack.holderId, command.holderId);
  assert.equal(ack.revision, command.expectedRunRevision + 1);
  assert.equal(BigInt(ack.fencingToken), BigInt(command.expectedFencingToken) + 1n);
  assert.equal(ack.purpose, 'recovery_only'); assert.ok(Number.isFinite(Date.parse(ack.expiresAt)));
  assert.equal(h.current.settingsRevision, 2);
  assert.equal(h.state.rentalApprovedSettingsOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.rentalApprovedSettingsOperation[0].changeId, h.reference.changeId);
  assert.equal(h.state.aiGatewayInvocation.length, 0);
});

test('AIN16 notification recovery ACK rejects wrong purpose or fencing before delegate and preserves the committed lease', { timeout: 60000 }, async () => {
  for (const mode of ['continue', 'reconcile']) for (const wrong of ['missing_purpose', 'wrong_purpose', 'wrong_fencing']) {
    const h = await notificationRecoveryAckSetup(), tasks = h.host.authorization.tasks;
    const claim = tasks.claimRecoveryRun.bind(tasks); let committed, claims = 0, delegates = 0, releases = 0;
    const release = tasks.releaseRun.bind(tasks);
    tasks.releaseRun = async (...args) => { releases++; return release(...args); };
    for (const method of ['continueConfirmation', 'recover']) {
      const original = h.host.runner[method].bind(h.host.runner);
      h.host.runner[method] = async (...args) => { delegates++; return original(...args); };
    }
    tasks.claimRecoveryRun = async command => {
      claims++; const ack = await claim(command); committed = h.clone(h.state);
      if (wrong === 'missing_purpose') { const { purpose, ...rest } = ack; return rest; }
      return { ...ack, ...(wrong === 'wrong_purpose' ? { purpose: 'execution_allowed' } : { fencingToken: command.expectedFencingToken }) };
    };
    await assert.rejects(h.invoke(mode), error => error.code === 'AI_RESULT_UNKNOWN', `${mode}/${wrong}`);
    assert.equal(claims, 1); assert.equal(delegates, 0); assert.equal(releases, 0);
    assert.ok(committed); assert.deepEqual(h.clone(h.state), committed);
    assert.equal(h.writes(), 0); assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
    assert.equal(h.state.aiApproval.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 0);
    assert.equal(h.state.aiRun.find(row => row.id === h.runId).leaseOwnerId, 'worker-a');
  }
});

test('AIN16 notification recovery ACK loss or abort after claim remains unknown without reread dispatch or release', { timeout: 60000 }, async () => {
  const { AiTaskRepositoryError } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  for (const mode of ['continue', 'reconcile']) for (const stopped of ['lost_reply', 'aborted_reply']) {
    const h = await notificationRecoveryAckSetup(), tasks = h.host.authorization.tasks, controller = new AbortController();
    const claim = tasks.claimRecoveryRun.bind(tasks); let committed, claims = 0, delegates = 0, releases = 0;
    const release = tasks.releaseRun.bind(tasks);
    tasks.releaseRun = async (...args) => { releases++; return release(...args); };
    for (const method of ['continueConfirmation', 'recover']) {
      const original = h.host.runner[method].bind(h.host.runner);
      h.host.runner[method] = async (...args) => { delegates++; return original(...args); };
    }
    tasks.claimRecoveryRun = async command => {
      claims++; const ack = await claim(command); committed = h.clone(h.state);
      if (stopped === 'aborted_reply') { controller.abort(); return ack; }
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    };
    await assert.rejects(h.invoke(mode, controller.signal), error => error.code === 'AI_RESULT_UNKNOWN', `${mode}/${stopped}`);
    assert.equal(claims, 1); assert.equal(delegates, 0); assert.equal(releases, 0);
    assert.ok(committed); assert.deepEqual(h.clone(h.state), committed);
    assert.equal(h.writes(), 0); assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
    assert.equal(h.state.aiApproval.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 0);
    assert.equal(h.state.aiRun.find(row => row.id === h.runId).leaseOwnerId, 'worker-a');
  }
});

// Ordinary-name acceptance uses the existing serialized Prisma-shaped store.
// Auth/Guard/ALS, plan/input/Step repositories, name CAS and approvals are real;
// storage/session/catalog facts are explicit doubles, not MySQL or HTTP proof.
async function profileInputSetup({ start = true, normal = false, cancellationEvidence = false, policyReceipts = false } = {}) {
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { composeApprovedProfileApplication } = require('../apps/api/src/modules/ai-native/approval-execution/approved-profile-application.composition');
  const { composePersistedProfileTaskInput } = require('../apps/api/src/modules/ai-native/approval-execution/approved-profile-registration.source');
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], customerApprovedProfileChange: [],
    customerApprovedProfileOperation: [], aiProposal: [], aiProposalVersion: [], aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [],
    aiTaskExecutionPhaseStart: [], aiTaskExecutionPhaseReceipt: [],
    customerProfile: [{ id: 'customer-a', tenantId: 'tenant-a', customerType: 'personal', name: 'Original customer',
      ordinaryRevision: 1, status: 'active', mergedIntoCustomerId: null, email: 'retained@example.test', phone: 'synthetic-phone', identityVerified: false }],
    customerMembership: [{ tenantId: 'tenant-a', customerId: 'customer-a' }],
    // Only cancellation fixtures configure the original absence-witness table;
    // a missing delegate is not evidence that no reservation exists.
    ...(cancellationEvidence ? { aiBudgetReservation: [] } : {}), ...(policyReceipts ? { operationLog: [] } : {}) });
  h.state.aiTaskRunPlan.length = 0;
  h.identity.user.permissions.push('rental-os:member:view', 'rental-os:member:manage', 'system:params:manage');
  h.state.aiTaskActionPolicy.find(p => p.operation === 'transition_task').requiredPermissions = ['rental-os:member:manage'];
  h.state.aiTaskActionPolicy.push({ ...h.state.aiTaskActionPolicy.find(p => p.operation === 'transition_task'), operation: 'decide_approval' });
  const dependencies = { ...h.authorization, db: h.db, holderId: 'worker-a',
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    scene: { code: 'synthetic-clarification', version: '1' }, clock: () => new Date(h.control.now) };
  const app = composeApprovedProfileApplication(dependencies), root = composePersistedProfileTaskInput(dependencies);
  await root.policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: '2027-01-01T00:00:00Z' });
  if (normal) { h.state.aiTask[0].status = 'QUEUED'; h.state.aiRun[0].status = 'QUEUED'; }
  let lease = normal ? null : await root.tasks.claimRun(h.claim());
  const change = await app.prepareChange({ customerId: 'customer-a', changeKey: 'original-profile-change', baseRevision: 1,
    name: 'Reviewed customer', expiresAt: '2026-10-07T12:00:00Z' });
  const reference = { customerId: change.customerId, changeId: change.changeId, changeHash: change.changeHash };
  const registrationRef = `profile-change:${change.changeId}`;
  if (normal) return { ...h, root, app, dependencies, reference, registrationRef, lease };
  const publication = await root.inputs.publishProfileInput({ taskId: 'task-a', registrationRef,
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: reference });
  assert.equal(publication.id, change.changeId);
  const plan = { ...h.clone(h.plan), taskRevision: h.state.aiTask[0].revision,
    steps: [{ registrationRef, operation: 'idempotent', toolCode: 'membership.profile.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] };
  await root.plans.savePlan(plan, lease);
  const leaseCommand = () => ({ runId: lease.runId, holderId: lease.holderId, revision: lease.revision, fencingToken: lease.fencingToken });
  const registered = await root.registrations.register({ taskId: 'task-a', registrationRef,
    expectedTaskRevision: h.state.aiTask[0].revision, lease: leaseCommand() });
  assert.equal(registered.replayed, false);
  lease = { ...lease, revision: registered.runRevision };
  let stepRevision = registered.stepRevision;
  if (start) {
    const { AiStepTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-step-transition.repository');
    const { PrismaTaskOrderStartAuthority } = require('../apps/api/src/modules/ai-native/runner/prisma-task-order-start.authority');
    const transitions = new AiStepTransitionRepository(h.db,
      new PrismaTaskOrderStartAuthority(h.db, root.authority, root.source, dependencies.clock, 'membership.profile.commit'), dependencies.clock);
    const started = await transitions.transition({ taskId: 'task-a', stepId: registered.stepId, expectedTaskRevision: registered.taskRevision,
      expectedStepRevision: registered.stepRevision, evidenceId: `start-${registered.stepId}`, reason: 'start', lease: leaseCommand() });
    lease = { ...lease, revision: started.runRevision }; stepRevision = started.event.data.stepRevision;
  }
  const prepare = { taskId: 'task-a', proposalId: 'profile-proposal-a', proposalRevision: 1, stepId: registered.stepId, ...reference };
  const held = () => { const { taskId: _, ...value } = lease; return value; };
  return { ...h, root, app, dependencies, reference, registrationRef, registered, plan, prepare, held, lease, stepRevision };
}

test('ordinary-name original input and start feed a real proposal, approval and one isolated name CAS', async () => {
  const h = await profileInputSetup();
  assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].status, 'RUNNING'); assert.equal(h.state.aiStep[0].effect, 'POSSIBLE');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1); assert.equal(h.state.customerApprovedProfileOperation.length, 0);
  const ref = await h.app.prepareProposal(h.prepare, h.held());
  const review = await h.app.readProposal(ref);
  assert.deepEqual(review.change.fields, [{ field: 'name', before: 'Original customer', after: 'Reviewed customer' }]);
  assert.equal(review.change.sharing, 'tenant_member_master_not_workspace_order_access');
  assert.equal(h.state.aiApproval.length, 0);
  const decision = await h.app.decide({ ...ref, decision: 'approve' });
  assert.equal(decision.businessUpdate, 'not_created_by_decision');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  const command = { ...ref, approvalId: decision.approval.approvalId, operationKey: 'profile-original-operation' };
  const receipt = await h.app.commitApprovedChange(command, h.held());
  assert.equal(receipt.resultRevision, 2); assert.equal(receipt.resultName, 'Reviewed customer');
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.customerProfile[0].email, 'retained@example.test'); assert.equal(h.state.customerProfile[0].phone, 'synthetic-phone');
  assert.equal(h.state.customerProfile[0].identityVerified, false);
  assert.deepEqual(await h.app.commitApprovedChange(command, h.held()), receipt);
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  await assert.rejects(h.app.commitApprovedChange({ ...command, operationKey: 'another-operation' }, h.held()));
  // Historical receipts retain the original result after an unrelated writer
  // and expiry. Reading them cannot reacquire a lease or recreate a Step.
  h.state.customerProfile[0].ordinaryRevision = 3; h.state.customerProfile[0].name = 'Later human edit';
  h.control.now = new Date('2026-10-08T12:00:00Z');
  const before = h.clone(h.state), original = await h.app.readOriginalOperation({ customerId: 'customer-a', operationKey: command.operationKey });
  assert.equal(original.state, 'committed'); assert.deepEqual(original.receipt, receipt); assert.deepEqual(h.clone(h.state), before);
  h.identity.user.permissions = h.identity.user.permissions.filter(p => !p.startsWith('rental-os:member:'));
  await assert.rejects(h.app.readOriginalOperation({ customerId: 'customer-a', operationKey: command.operationKey }));
});

test('ordinary-name COMMIT reply loss preserves one operation/consumption and recovers only its original receipt', async () => {
  const h = await profileInputSetup(), ref = await h.app.prepareProposal(h.prepare, h.held());
  const decision = await h.app.decide({ ...ref, decision: 'approve' });
  const command = { ...ref, approvalId: decision.approval.approvalId, operationKey: 'profile-lost-reply' };
  h.storeControl.loseReply = true;
  await assert.rejects(h.app.commitApprovedChange(command, h.held()), e => e.code === 'PROFILE_RESULT_UNKNOWN');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  const before = h.clone(h.state), result = await h.app.readOriginalOperation({ customerId: 'customer-a', operationKey: command.operationKey });
  assert.equal(result.state, 'committed'); assert.equal(result.receipt.resultRevision, 2); assert.deepEqual(h.clone(h.state), before);
});

test('ordinary-name unstarted Step, missing approval policy, foreign lease and concurrent edit cannot commit', async () => {
  const unstarted = await profileInputSetup({ start: false });
  await assert.rejects(unstarted.app.prepareProposal(unstarted.prepare, unstarted.held()));
  assert.equal(unstarted.state.aiProposal.length, 0);
  const h = await profileInputSetup(), ref = await h.app.prepareProposal(h.prepare, h.held());
  const policy = h.state.aiTaskActionPolicy.find(p => p.operation === 'decide_approval');
  policy.requiredPermissions = ['rental-os:order:view'];
  await assert.rejects(h.app.decide({ ...ref, decision: 'approve' }));
  assert.equal(h.state.aiApproval.length, 0); policy.requiredPermissions = ['rental-os:member:manage'];
  const decision = await h.app.decide({ ...ref, decision: 'approve' });
  const command = { ...ref, approvalId: decision.approval.approvalId, operationKey: 'profile-no-commit' };
  await assert.rejects(h.app.commitApprovedChange(command, { ...h.held(), holderId: 'foreign-worker' }));
  h.state.customerProfile[0].ordinaryRevision = 2; h.state.customerProfile[0].name = 'Concurrent human edit';
  await assert.rejects(h.app.commitApprovedChange(command, h.held()));
  assert.equal(h.state.customerApprovedProfileOperation.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
  assert.equal(h.state.customerProfile[0].name, 'Concurrent human edit');
});

test('ordinary-name normal host uses original confirmation phases, one CAS and historical receipt without redispatch', { timeout: 30000 }, async () => {
  const h = await profileInputSetup({ normal: true });
  const { composeTaskProfileHost } = require('../apps/api/src/modules/ai-native/runner/profile-task-host.composition');
  const rebuild = () => composeTaskProfileHost({ ...h.dependencies, host: { holderId: 'worker-a', leaseMs: 100000 },
    task: { taskId: 'task-a', runId: 'run-a', registrationRef: h.registrationRef, change: h.reference, limits: h.plan.limits },
    monotonic: () => ++h.control.tick });
  const host = rebuild(), started = await host.application.start({ taskId: 'task-a', runId: 'run-a' });
  assert.equal(started.kind, 'run_outcome'); assert.equal(started.outcome.status, 'paused');
  assert.equal(h.state.aiTask[0].status, 'WAITING_CONFIRMATION');
  assert.equal(h.state.aiStep.length, 1); assert.equal(h.state.aiStep[0].status, 'RUNNING');
  assert.equal(h.state.aiTaskExecutionPhaseReceipt.length, 1);
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1); assert.equal(h.state.aiApproval.length, 0);
  const checkpoint = h.state.aiTaskExecutionPhaseReceipt[0]; assert.equal(checkpoint.payload.version, 'approved-profile-wait-1');
  const key = { taskId: 'task-a', runId: 'run-a', stepId: h.state.aiStep[0].id };
  assert.equal((await host.application.readConfirmation(key)).checkpointRef, checkpoint.id);
  const proposal = checkpoint.payload.proposal;
  const decided = await host.profile.application.decide({ taskId: 'task-a', proposalId: proposal.proposalId,
    proposalRevision: proposal.proposalRevision, payloadHash: proposal.reviewedPayloadHash, decision: 'approve' });
  assert.equal(decided.businessUpdate, 'not_created_by_decision'); assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  // Explicit original recovery claim is server-owned. No tuple is inferred from
  // a missing write reply; the actual CAS acknowledgement remains required.
  const claim = await host.authorization.tasks.claimRecoveryRun(h.claim());
  assert.equal(claim.holderId, 'worker-a');
  const continued = await rebuild().application.continueConfirmation({ taskId: 'task-a', runId: 'run-a', checkpointRef: checkpoint.id });
  assert.equal(continued.kind, 'run_outcome'); assert.equal(continued.outcome.status, 'succeeded');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2); assert.equal(h.state.customerProfile[0].name, 'Reviewed customer');
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.aiTaskExecutionPhaseStart.length, 2); assert.equal(h.state.aiTaskExecutionPhaseReceipt.length, 2);
  assert.equal(h.state.aiTaskExecutionBudget.length, 1);
  const before = h.clone(h.state), history = await rebuild().application.readConfirmationHistory(key);
  assert.equal(history.execution, 'read_only_no_claim_or_dispatch');
  const receipt = await host.profile.application.readOriginalOperation({ customerId: 'customer-a', operationKey: h.state.customerApprovedProfileOperation[0].operationKey });
  assert.equal(receipt.state, 'committed'); assert.equal(receipt.receipt.resultRevision, 2); assert.deepEqual(h.clone(h.state), before);
});

test('ordinary-name postcommit withdrawal reports unknown, retains the original CAS and denies revoked receipt delivery', async () => {
  const h = await profileInputSetup(), ref = await h.app.prepareProposal(h.prepare, h.held());
  const decision = await h.app.decide({ ...ref, decision: 'approve' });
  h.storeControl.beforeCommit = () => { h.identity.membership = false; };
  await assert.rejects(h.app.commitApprovedChange({ ...ref, approvalId: decision.approval.approvalId,
    operationKey: 'profile-withdrawn-delivery' }, h.held()), e => e.code === 'PROFILE_RESULT_UNKNOWN');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  await assert.rejects(h.app.readOriginalOperation({ customerId: 'customer-a', operationKey: 'profile-withdrawn-delivery' }));
});

// Original request binding and metadata creation, not an HTTP/server fixture.
// Only storage/session/catalog rows are synthetic; no policy writer is invoked.
async function profileRequestSetup(cancellationEvidence = false, policyReceipts = false) {
  const h = await profileInputSetup({ normal: true, cancellationEvidence, policyReceipts });
  const { composeRequestBoundProfileWorkflow } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const { credentials, ...dependencies } = h.dependencies;
  const requests = composeRequestBoundProfileWorkflow(dependencies, { enabled: true, audience: 'operator', host: { holderId: 'worker-a', leaseMs: 100000 } });
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  return { ...h, requests, request, requestDependencies: dependencies };
}

test('ordinary-name request workflow creates one original Task, hands off the actual wait and completes the original CAS', { timeout: 60000 }, async () => {
  const h = await profileRequestSetup(), beforeTasks = h.state.aiTask.length;
  await assert.rejects(h.requests.createTask({ headers: {} }, h.reference));
  await assert.rejects(h.requests.createTask(h.request, { ...h.reference, creationKey: 'caller-replacement-key' }));
  const created = await h.requests.createTask(h.request, h.reference);
  assert.equal(created.receipt.replayed, false); assert.equal(h.state.aiTask.length, beforeTasks + 1);
  const replay = await h.requests.createTask(h.request, h.reference);
  assert.equal(replay.receipt.replayed, true); assert.equal(replay.receipt.taskId, created.receipt.taskId);
  assert.equal(replay.receipt.runId, created.receipt.runId); assert.equal(h.state.aiStep.length, 0);
  const taskId = created.receipt.taskId, runId = created.receipt.runId;
  // These are deliberately declared rows for this newly created synthetic
  // task, not a production manager/action-policy writer or an old ACK task.
  const templates = h.clone(h.state.aiTaskActionPolicy.filter(p => p.taskId === 'task-a'));
  h.state.aiTaskActionPolicy.push(...templates.map(p => ({ ...p, taskId })));
  const started = await h.requests.start(h.request, h.reference);
  assert.equal(started.kind, 'run_outcome'); assert.equal(started.outcome.status, 'paused');
  const prepared = await h.requests.humanHandoff(h.request, h.reference);
  assert.equal(prepared.task.taskId, taskId); assert.equal(prepared.run.runId, runId);
  assert.equal(prepared.mode, 'human_handoff_only'); assert.equal(prepared.continuation, 'not_invoked_use_original_profile_host');
  assert.equal(prepared.currentMatchesChangeBase, true); assert.equal(prepared.change.baseRevision, 1);
  assert.equal(prepared.change.fields[0].field, 'name'); assert.equal(prepared.confirmation.execution, 'not_attested');
  assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  await assert.rejects(h.requests.decide(h.request, { ...h.reference, decision: 'approve', approvalId: 'caller-approval' }));
  await h.requests.decide(h.request, { ...h.reference, decision: 'approve' });
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  const continued = await h.requests.continueConfirmation(h.request, h.reference);
  assert.equal(continued.kind, 'run_outcome'); assert.equal(continued.outcome.status, 'succeeded');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2); assert.equal(h.state.customerApprovedProfileOperation.length, 1);
  assert.equal(h.state.aiApprovalConsumption.length, 1);
  const before = h.clone(h.state), result = await h.requests.read(h.request, h.reference);
  assert.equal(result.businessOutcome, 'committed'); assert.equal(result.operation.receipt.resultRevision, 2);
  assert.equal(result.currentMatchesChangeBase, false); assert.equal(result.execution, 'not_attested');
  assert.deepEqual(h.clone(h.state), before);
  await assert.rejects(h.requests.continueConfirmation(h.request, h.reference));
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  h.identity.membership = false; await assert.rejects(h.requests.read(h.request, h.reference));
});

test('ordinary-name lost creation acknowledgement reads the same Task after expiry without recreating it or widening permissions', async () => {
  const h = await profileRequestSetup(), beforeTasks = h.state.aiTask.length;
  h.storeControl.beforeWrite = name => { if (name === 'aiTask') h.storeControl.loseReply = true; };
  await assert.rejects(h.requests.createTask(h.request, h.reference), e => e.code === 'AI_RESULT_UNKNOWN');
  assert.equal(h.state.aiTask.length, beforeTasks + 1);
  h.storeControl.beforeWrite = null;
  const first = await h.requests.readCreation(h.request, h.reference);
  assert.equal(first.receipt.state, 'observed');
  h.control.now = new Date('2026-10-08T12:00:00Z');
  const before = h.clone(h.state), old = await h.requests.readCreation(h.request, h.reference);
  assert.equal(old.receipt.state, 'observed'); assert.equal(old.receipt.task.taskId, first.receipt.task.taskId);
  assert.equal(old.receipt.task.runId, first.receipt.task.runId); assert.deepEqual(h.clone(h.state), before);
  await assert.rejects(h.requests.createTask(h.request, h.reference));
  assert.equal(h.state.aiTask.length, beforeTasks + 1); assert.equal(h.state.aiStep.length, 0);
  assert.equal(h.state.aiTaskActionPolicy.filter(p => p.taskId === first.receipt.task.taskId).length, 0);
  h.identity.user.permissions = h.identity.user.permissions.filter(p => !p.startsWith('rental-os:member:'));
  await assert.rejects(h.requests.readCreation(h.request, h.reference));
});

async function profileLifecycleSetup(cancellationEvidence = false) {
  const h = await profileRequestSetup(cancellationEvidence), created = await h.requests.createTask(h.request, h.reference);
  const taskId = created.receipt.taskId, runId = created.receipt.runId;
  h.state.aiTaskActionPolicy.push(...h.clone(h.state.aiTaskActionPolicy.filter(row => row.taskId === 'task-a')).map(row => ({ ...row, taskId })));
  const task = () => h.state.aiTask.find(row => row.id === taskId);
  return { ...h, created, taskId, runId, task };
}

// Generic member entry reuses the original profile workflow and actual member
// service. Only the old store's relation projection and declared task policies
// are adapted; there is no order, account/qualification or full-profile writer.
async function genericMemberNameEntrySetup(seedTaskPolicies = true, policyReceipts = false) {
  const h = await profileRequestSetup(true, policyReceipts), clone = h.clone;
  h.identity.user.permissions = h.identity.user.permissions.filter(permission => !permission.startsWith('rental-os:order:'));
  h.state.customerProfile[0].phoneMasked = '138****0001'; h.state.customerMembership[0].status = 'active';
  h.state.customerProfile.push({ ...clone(h.state.customerProfile[0]), id: 'customer-b', email: 'second@example.test',
    phone: 'synthetic-second-phone', phoneMasked: '139****0002' });
  h.state.customerMembership.push({ tenantId: 'tenant-a', customerId: 'customer-b', status: 'active' });
  h.state.customerProfile.push({ ...clone(h.state.customerProfile[0]), id: 'foreign-member', tenantId: 'other-tenant' });
  h.state.customerMembership.push({ tenantId: 'other-tenant', customerId: 'foreign-member', status: 'active' });
  for (const policy of h.state.aiTaskActionPolicy) policy.requiredPermissions =
    ['read_metadata', 'read_events', 'read_step_terminal'].includes(policy.operation) ? ['rental-os:member:view'] : ['rental-os:member:manage'];
  const readProfiles = h.db.customerProfile.findMany.bind(h.db.customerProfile);
  const queries = [];
  h.db.customerProfile.findMany = async args => {
    queries.push(clone(args));
    assert.deepEqual(args.select, { id: true, name: true, phoneMasked: true, membership: { select: { status: true } } });
    assert.equal(args.where.tenantId, 'tenant-a'); assert.deepEqual(args.where.membership, { isNot: null });
    const { membership, name, ...where } = args.where;
    const rows = await readProfiles({ ...args, where, select: undefined });
    return rows.filter(row => (!name?.contains || row.name.includes(name.contains))
      && h.state.customerMembership.some(link => link.tenantId === row.tenantId && link.customerId === row.id))
      .map(row => ({ id: row.id, name: row.name, phoneMasked: row.phoneMasked,
        membership: { status: h.state.customerMembership.find(link => link.tenantId === row.tenantId && link.customerId === row.id).status } }));
  };
  const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
  const { CustomerOperationsRepository } = require('../apps/api/src/modules/platform/customer-operations.repository');
  const members = new MembershipService(h.db, new CustomerOperationsRepository(h.db));
  members.savePersonalMember = async () => { throw Error('Generic entry must not call full-profile save'); };
  const profiles = { ...h.requests, createTask: async (...args) => {
    const created = await h.requests.createTask(...args), taskId = created.receipt.taskId;
    // The real server's policy producer is a separate main-tree responsibility.
    // These exact new-task fixture rows require the ORIGINAL member permissions.
    if (seedTaskPolicies && !h.state.aiTaskActionPolicy.some(row => row.taskId === taskId)) h.state.aiTaskActionPolicy.push(
      ...clone(h.state.aiTaskActionPolicy.filter(row => row.taskId === 'task-a')).map(row => ({ ...row, taskId })));
    return created;
  } };
  const { composeMemberProfileChangeFlow } = require('../apps/api/src/modules/ai-native/scenes/member-profile-change-flow');
  const flow = composeMemberProfileChangeFlow({ db: h.db, guard: h.dependencies.guard, memberships: members, profiles, clock: h.dependencies.clock });
  const query = { limit: 10, name: 'Original customer' };
  const discovered = await flow.discover(h.request, query);
  assert.equal(discovered.page.candidates.length, 2); assert.equal(discovered.page.scope.kind, 'tenant');
  const selected = discovered.page.candidates[1]; // Explicit second same-name result, never a default first.
  const command = { query, customerId: selected.customerId, selectionHash: discovered.selectionHash,
    requestKey: 'explicit-second-member-name', name: 'Human selected ordinary name', expiresAt: '2026-10-07T12:00:00Z' };
  const locator = { customerId: command.customerId, requestKey: command.requestKey };
  return { ...h, flow, profiles, members, queries, discovered, command, locator };
}

test('AIN16 human member consumer uses explicit same-name choice, original manager admission and one Core result or original unknown read', { timeout: 120000 }, async () => {
  const Module = require('node:module'), fs = require('node:fs'), path = require('node:path'), shared = require('@rental-os/shared');
  const { composeMemberNameRequests, AiMemberNameController } = require('../apps/api/src/modules/ai-native/member-name.application');
  const { createMemberNameSession, memberNameStore } = require('../apps/admin/src/features/ai-native/member-name-session');
  const { plainToInstance } = require('class-transformer'), { validateSync } = require('class-validator');
  const { ExecutionContextHost } = require('@nestjs/core/helpers/execution-context-host');
  const dto = require('../apps/api/src/modules/ai-native/member-name.dto');
  const httpFile = require.resolve('../apps/admin/src/api/http'), queryFile = require.resolve('../apps/admin/src/app/queryClient');
  const previousHttp = Module._cache[httpFile], previousQuery = Module._cache[queryFile], calls = [], memory = new Map();
  let controller, h, key, expectedLocator, epoch = 1, switchEpoch = false, loseDelivery = false;
  const sessionSignal = new AbortController().signal;
  Module._cache[queryFile] = { id: queryFile, filename: queryFile, loaded: true, exports: {
    currentSessionSignal: () => sessionSignal, currentSessionEpoch: () => epoch } };
  Module._cache[httpFile] = { id: httpFile, filename: httpFile, loaded: true, exports: { http: {
    post: async (url, body, options) => {
      const action = url.split('/').at(-1); calls.push({ action, body: structuredClone(body), url });
      assert.equal(url, `/${shared.AI_MEMBER_NAME_HTTP.basePath}/${shared.AI_MEMBER_NAME_HTTP[action]}`);
      assert.equal(options.timeout, 12000); assert.equal(options.signal.aborted, false);
      if (action === 'prepare' || action === 'execute') {
        const saved = JSON.parse(memory.get(key)); assert.deepEqual(saved.locator, expectedLocator);
        assert.deepEqual(Object.keys(saved), ['locator', 'operation']); assert.equal(saved.operation, action);
        assert.doesNotMatch(memory.get(key), /selectionHash|reviewHash|confirmationHash|before|after|Human new name/);
      }
      const type = { availability: dto.AiMemberNameAvailabilityDto, discover: dto.AiMemberNameDiscoverDto,
        inspect: dto.AiMemberNameSelectionDto, prepare: dto.AiMemberNamePrepareDto, read: dto.AiMemberNameReadDto, execute: dto.AiMemberNameExecuteDto }[action];
      // Matches the actual global Nest pipe; raw body is also independently
      // parsed by the closed shared schema in the Controller/application.
      assert.deepEqual(validateSync(plainToInstance(type, body), { whitelist: true, forbidUnknownValues: false }), []);
      const request = { ...h.request, body, method: 'POST', originalUrl: '/api' + url, url: '/api' + url };
      await h.dependencies.guard.canActivate(new ExecutionContextHost([request]));
      let response;
      try { response = await controller[action](request, body); }
      catch (error) {
        console.log(JSON.stringify({ memberActionFailure: action, publicCode: error.getResponse?.().code,
          originalOperations: h.state.customerApprovedProfileOperation.length,
          taskStatuses: h.state.aiTask.map(row => row.status), stepStatuses: h.state.aiStep.map(row => row.status) }));
        throw error;
      }
      if (action === 'execute' && loseDelivery) {
        loseDelivery = false;
        const { HttpException } = require('@nestjs/common');
        throw new HttpException({ code: 'AI_RESULT_UNKNOWN', retryable: false }, 409);
      }
      if (switchEpoch) { switchEpoch = false; epoch++; }
      return { data: { data: response, requestId: 'synthetic-member-human' } };
    }
  } } };
  try {
    const { aiMemberNameApi } = require('../apps/admin/src/api/aiMemberName');
    assert.match(require.resolve('@rental-os/shared'), /[\\/]shared[\\/]dist[\\/]index\.js$/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@rental-os/shared')), '../package.json'), 'utf8')).version, '0.1.0');
    for (const loseReply of [false, true]) {
      h = await genericMemberNameEntrySetup(false, true);
      const originalProfiles = h.clone(h.state.customerProfile), taskCount = h.state.aiTask.length;
      controller = new AiMemberNameController(composeMemberNameRequests({ ...h.requestDependencies, memberships: h.members },
        { enabled: true, host: { holderId: 'worker-a', leaseMs: 100000 } }));
      key = `synthetic-member-human-${loseReply}`;
      const storage = { getItem: value => memory.get(value) ?? null, setItem: (name, value) => memory.set(name, value), removeItem: value => memory.delete(value) };
      const store = memberNameStore(key, storage); let active = true;
      let session = createMemberNameSession({ tenantId: 'tenant-a', current: () => active, api: aiMemberNameApi, store, changed() {} });
      const beforeRead = h.clone(h.state); await session.availability(); await session.discover({ limit: 20, name: 'Original customer' });
      assert.deepEqual(h.state, beforeRead); assert.equal(session.view.frame.candidates.length, 2);
      assert.ok(session.view.frame.candidates.every(row => row.phone === undefined && row.email === undefined));
      const chosen = session.view.frame.candidates[1]; // Explicit second same-name human choice.
      expectedLocator = { customerId: chosen.customerId, requestKey: `human-member-${loseReply}` };
      await session.inspect(chosen.customerId, 'Human new name', expectedLocator.requestKey);
      assert.equal(session.view.frame.phase, 'difference_ready'); assert.equal(session.view.frame.change.before, 'Original customer');
      assert.equal(session.view.frame.change.after, 'Human new name'); assert.equal(memory.has(key), false);
      const inspected = h.clone(h.state); await session.prepare();
      assert.equal(session.view.frame.phase, 'waiting_confirmation'); assert.equal(session.view.pending, null); assert.equal(memory.has(key), false);
      assert.equal(h.state.aiTask.length, taskCount + 1); assert.equal(h.state.aiApproval.length, 0);
      assert.deepEqual(h.state.customerProfile, originalProfiles); assert.equal(h.state.customerApprovedProfileOperation.length, 0);
      const taskId = session.view.frame.task.taskId;
      assert.equal(h.state.aiTaskActionPolicy.filter(row => row.taskId === taskId).length, 8);
      assert.equal(h.state.operationLog.length, 8); assert.ok(h.state.customerApprovedProfileChange.length > inspected.customerApprovedProfileChange.length);
      if (loseReply) {
        // Lose delivery AFTER the original server has returned its Core receipt.
        // The runner may itself observe a database ACK loss; that does not model
        // this separate consumer-response boundary.
        loseDelivery = true;
        await assert.rejects(session.execute(), error => error.getResponse().code === 'AI_RESULT_UNKNOWN'); assert.equal(loseDelivery, false);
        assert.deepEqual(session.view.pending, { locator: expectedLocator, operation: 'execute' });
        const dispatches = calls.filter(row => row.action === 'execute').length;
        await assert.rejects(async () => session.execute()); assert.equal(calls.filter(row => row.action === 'execute').length, dispatches);
        session.dispose(); const callsBeforeReload = calls.length;
        session = createMemberNameSession({ tenantId: 'tenant-a', current: () => active, api: aiMemberNameApi, store, changed() {} });
        assert.equal(calls.length, callsBeforeReload); await session.read();
        assert.deepEqual(calls.at(-1).body, { locator: expectedLocator });
      } else await session.execute();
      assert.equal(session.view.frame.phase, 'completed'); assert.equal(session.view.frame.operation.resultRevision, 2);
      assert.equal(session.view.frame.operation.resultName, 'Human new name'); assert.equal(session.view.pending, null); assert.equal(memory.has(key), false);
      assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
      const receiptId = session.view.frame.operation.receiptId, final = h.clone(h.state);
      await session.read(); assert.equal(session.view.frame.operation.receiptId, receiptId); assert.deepEqual(h.state, final);
      const expected = h.clone(originalProfiles); Object.assign(expected.find(row => row.id === chosen.customerId), { name: 'Human new name', ordinaryRevision: 2 });
      assert.deepEqual(h.state.customerProfile, expected);
      await assert.rejects(controller.discover({ ...h.request, body: { query: { limit: 20 }, actorId: 'forged' } }, { query: { limit: 20 } }),
        error => error.getResponse().code === 'AI_INVALID_INPUT');
      switchEpoch = true; await assert.rejects(aiMemberNameApi.read(expectedLocator, new AbortController().signal), /AI_SCOPE_CHANGED/);
      assert.deepEqual(h.state, final);

      const previousKey = key, previousLocator = expectedLocator; key = `stale-member-human-${loseReply}`;
      const stale = createMemberNameSession({ tenantId: 'tenant-a', current: () => true, api: aiMemberNameApi,
        store: memberNameStore(key, storage), changed() {} });
      await stale.availability(); await stale.discover({ limit: 20, name: 'Original customer' });
      const stalePerson = stale.view.frame.candidates[0]; expectedLocator = { customerId: stalePerson.customerId, requestKey: `stale-${loseReply}` };
      await stale.inspect(stalePerson.customerId, 'Newly reviewed name', expectedLocator.requestKey);
      // Explicit concurrent-editor fact, not a new writer or relaxed CAS.
      h.state.customerProfile.find(row => row.id === stalePerson.customerId).ordinaryRevision++;
      const changedBefore = h.clone(h.state); await stale.prepare();
      assert.equal(stale.view.frame.phase, 'difference_stale_not_saved'); assert.equal(stale.view.pending, null);
      assert.equal(memory.has(key), false); assert.deepEqual(h.state, changedBefore); stale.dispose();
      key = previousKey; expectedLocator = previousLocator;

      // Necessary locator refusals: damaged data, unconfirmed persistence and
      // an original record arriving from another tab must prevent dispatch.
      const damagedStorage = { getItem: () => '{}', setItem() { throw Error('must not overwrite'); }, removeItem() {} };
      const damaged = createMemberNameSession({ tenantId: 'tenant-a', current: () => true, api: aiMemberNameApi,
        store: memberNameStore('damaged', damagedStorage), changed() {} });
      assert.equal(damaged.view.locatorDamaged, true); const beforeDamaged = calls.length;
      await assert.rejects(async () => damaged.discover({ limit: 20 })); assert.equal(calls.length, beforeDamaged); damaged.dispose();
      const deniedStore = memberNameStore('no-ack', { getItem: () => null, setItem() {}, removeItem() {} });
      const denied = createMemberNameSession({ tenantId: 'tenant-a', current: () => true, api: aiMemberNameApi, store: deniedStore, changed() {} });
      await denied.availability(); await denied.discover({ limit: 20, name: 'Original customer' });
      const available = denied.view.frame.candidates[0]; await denied.inspect(available.customerId, 'Another human name', `no-ack-${loseReply}`);
      const beforeDenied = calls.length; await assert.rejects(denied.prepare(), /AI_OPERATION_LOCATOR_UNCONFIRMED/);
      assert.equal(calls.length, beforeDenied); denied.dispose();
      const originalRecord = JSON.stringify({ locator: expectedLocator, operation: 'execute' }); let tabRecord = null;
      const concurrentStore = memberNameStore('concurrent', { getItem: () => tabRecord, setItem: (_key, value) => { tabRecord = value; }, removeItem() { tabRecord = null; } });
      const concurrent = createMemberNameSession({ tenantId: 'tenant-a', current: () => true, api: aiMemberNameApi, store: concurrentStore, changed() {} });
      await concurrent.availability(); await concurrent.discover({ limit: 20, name: 'Original customer' });
      await concurrent.inspect(concurrent.view.frame.candidates[0].customerId, 'Another human name', `concurrent-${loseReply}`);
      tabRecord = originalRecord; const beforeConcurrent = calls.length;
      await assert.rejects(concurrent.prepare(), /AI_OPERATION_LOCATOR_ALREADY_EXISTS/); assert.equal(tabRecord, originalRecord);
      assert.equal(calls.length, beforeConcurrent); assert.deepEqual(concurrent.view.pending.locator, expectedLocator); concurrent.dispose();
      active = false; session.dispose();
    }
    const source = rel => fs.readFileSync(path.join(process.cwd(), rel), 'utf8');
    assert.match(source('packages/shared/src/index.ts'), /export \* from '.\/ai-member-name'/);
    assert.match(source('apps/api/src/app.module.ts'), /AiMemberNameController/); assert.match(source('apps/api/src/app.module.ts'), /AI_NATIVE_MEMBER_NAME_PROVIDER/);
    assert.match(source('apps/api/src/contracts/openapi-document.ts'), /AI_MEMBER_NAME_CONTRACTS\[action\]/);
    assert.match(source('apps/admin/src/features/ai-native/TaskCenterPage.tsx'), /<MemberNameFlow/);
    assert.match(source('apps/admin/src/features/ai-native/MemberNameFlow.tsx'), /<ConfirmAction/);
    assert.doesNotMatch(source('apps/admin/src/features/ai-native/MemberNameFlow.tsx'), /registrationRef|reviewHash|confirmationHash[^}]*Input/);
  } finally {
    if (previousHttp) Module._cache[httpFile] = previousHttp; else delete Module._cache[httpFile];
    if (previousQuery) Module._cache[queryFile] = previousQuery; else delete Module._cache[queryFile];
  }
});

test('AIN16 original member task gets explicit real-manager policies and one approved Core update without fixture policy seeding', { timeout: 120000 }, async () => {
  const h = await genericMemberNameEntrySetup(false, true);
  const inspection = await h.flow.inspect(h.request, h.command);
  const prepared = await h.flow.prepare(h.request, { ...h.command, reviewHash: inspection.reviewHash });
  const created = await h.requests.createTask(h.request, prepared.reference), taskId = created.receipt.taskId;
  assert.equal(h.state.aiTaskActionPolicy.filter(row => row.taskId === taskId).length, 0);
  const { composeRequestBoundProfileWorkflow } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const workflow = composeRequestBoundProfileWorkflow(h.requestDependencies, { enabled: true, audience: 'operator',
    host: { holderId: 'worker-a', leaseMs: 100000 }, taskPolicyConfiguration: { executionEnabled: true, ttlMs: 120000 } });
  const policies = { configure: value => workflow.configureTaskActions(h.request, value),
    read: value => workflow.readTaskActionAdmission(h.request, value) };
  const intent = { ...prepared.reference, decision: 'allow_original_member_name_task' };
  const permissions = [...h.identity.user.permissions];
  h.identity.user.permissions = permissions.filter(value => value !== 'system:params:manage');
  await assert.rejects(policies.configure(intent)); assert.equal(h.state.aiTaskActionPolicy.filter(row => row.taskId === taskId).length, 0);
  h.identity.user.permissions = permissions;
  const beforeProfiles = h.clone(h.state.customerProfile), beforeApprovals = h.state.aiApproval.length;
  const configured = await policies.configure(intent);
  assert.equal(configured.state, 'recorded'); assert.equal(configured.items.length, 8);
  assert.equal(h.state.aiTaskActionPolicy.filter(row => row.taskId === taskId).length, 8);
  assert.equal(h.state.operationLog.length, 8); assert.equal(h.state.aiApproval.length, beforeApprovals);
  assert.deepEqual(h.state.customerProfile, beforeProfiles); assert.equal(h.state.aiStep.length, 0);
  assert.ok(configured.items.every(item => item.mutation.state === 'recorded' && item.mutation.policy.revision === 1));
  assert.ok(configured.items.every(item => item.mutation.policy.requiredPermissions.length === 1
    && item.mutation.policy.requiredPermissions[0].startsWith('rental-os:member:')));
  const originalPolicies = h.clone(h.state.aiTaskActionPolicy), originalLogs = h.clone(h.state.operationLog);
  const replay = await policies.configure(intent); assert.equal(replay.replayed, true);
  assert.deepEqual(h.state.aiTaskActionPolicy, originalPolicies); assert.deepEqual(h.state.operationLog, originalLogs);
  assert.equal((await h.requests.start(h.request, prepared.reference)).outcome.status, 'paused');
  await h.requests.decide(h.request, { ...prepared.reference, decision: 'approve' });
  assert.deepEqual(h.state.customerProfile, beforeProfiles);
  assert.equal((await h.requests.continueConfirmation(h.request, prepared.reference)).outcome.status, 'succeeded');
  const result = await h.requests.read(h.request, prepared.reference);
  assert.equal(result.businessOutcome, 'committed'); assert.equal(result.operation.receipt.resultRevision, 2);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.customerProfile.find(row => row.id === prepared.reference.customerId).name, h.command.name);
  h.control.now = new Date(h.control.now.getTime() + 180000);
  const old = await policies.read(prepared.reference);
  assert.equal(old.state, 'recorded'); assert.deepEqual(h.state.aiTaskActionPolicy, originalPolicies);
  assert.equal((await policies.configure(intent)).replayed, true);
  assert.deepEqual(h.state.aiTaskActionPolicy, originalPolicies); assert.deepEqual(h.state.operationLog, originalLogs);
});

test('AIN16 generic member entry explicit second same-name choice reaches original approval and one Core name update without order permission', { timeout: 120000 }, async () => {
  const h = await genericMemberNameEntrySetup(), beforeProfiles = h.clone(h.state.customerProfile), beforeTasks = h.state.aiTask.length;
  assert.ok(h.identity.user.permissions.every(permission => !permission.startsWith('rental-os:order:')));
  assert.ok(h.discovered.page.candidates.every(row => row.name === 'Original customer' && row.email === undefined && row.phone === undefined));
  assert.notEqual(h.command.customerId, h.discovered.page.candidates[0].customerId);
  const inspected = await h.flow.inspect(h.request, h.command);
  assert.equal(inspected.ordinaryRevision, 1); assert.equal(inspected.fields[0].source.scope.kind, 'tenant');
  const prepared = await h.flow.prepare(h.request, { ...h.command, reviewHash: inspected.reviewHash });
  assert.equal(prepared.state, 'prepared'); assert.equal(prepared.reference.customerId, h.command.customerId);
  assert.deepEqual(h.state.customerProfile, beforeProfiles); assert.equal(h.state.aiTask.length, beforeTasks);
  const begun = await h.flow.beginReview(h.request, { ...h.locator, decision: 'start_original_profile_review' });
  assert.equal(begun.execution.outcome.status, 'paused'); assert.equal(h.state.aiTask.length, beforeTasks + 1);
  const taskId = begun.created.receipt.taskId, runId = begun.created.receipt.runId;
  const waiting = await h.profiles.humanHandoff(h.request, prepared.reference);
  assert.equal(waiting.task.taskId, taskId); assert.equal(waiting.run.runId, runId); assert.equal(waiting.change.fields[0].after, h.command.name);
  assert.equal(h.state.aiApproval.length, 0); assert.deepEqual(h.state.customerProfile, beforeProfiles);
  await h.profiles.decide(h.request, { ...prepared.reference, decision: 'approve' });
  assert.deepEqual(h.state.customerProfile, beforeProfiles);
  assert.equal((await h.profiles.continueConfirmation(h.request, prepared.reference)).outcome.status, 'succeeded');
  const result = await h.profiles.read(h.request, prepared.reference);
  assert.equal(result.businessOutcome, 'committed'); assert.equal(result.operation.receipt.resultRevision, 2);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  const expected = h.clone(beforeProfiles); Object.assign(expected.find(row => row.id === h.command.customerId), { name: h.command.name, ordinaryRevision: 2 });
  assert.deepEqual(h.state.customerProfile, expected);
  const beforeRepeat = h.clone(h.state), repeated = await h.flow.beginReview(h.request, { ...h.locator, decision: 'start_original_profile_review' });
  assert.equal(repeated.execution, 'not_started_use_original_task'); assert.equal(repeated.originalTask.receipt.task.taskId, taskId);
  assert.deepEqual(h.state, beforeRepeat); assert.equal(h.state.aiTask.length, beforeTasks + 1);
  assert.ok(h.queries.every(args => args.take === 11 && args.include === undefined));
});

test('AIN16 generic member preparation needs independent manage permission and reads one lost preparation without rediscovering or recreating a Task', { timeout: 120000 }, async () => {
  const h = await genericMemberNameEntrySetup(), permissions = [...h.identity.user.permissions], beforeChanges = h.state.customerApprovedProfileChange.length;
  await assert.rejects(h.flow.inspect(h.request, { ...h.command, customerId: 'foreign-member' }), error => error.code === 'AI_ACCESS_DENIED');
  await assert.rejects(h.flow.prepare(h.request, { ...h.command, reviewHash: 'f'.repeat(64), tenantId: 'other-tenant' }), error => error.code === 'AI_INVALID_INPUT');
  h.identity.user.permissions = permissions.filter(permission => permission !== 'rental-os:member:manage');
  const readOnly = await h.flow.inspect(h.request, h.command);
  await assert.rejects(h.flow.prepare(h.request, { ...h.command, reviewHash: readOnly.reviewHash }));
  assert.equal(h.state.customerApprovedProfileChange.length, beforeChanges);
  h.identity.user.permissions = permissions;
  const reviewed = await h.flow.inspect(h.request, h.command); let lost = false;
  h.storeControl.beforeCommit = draft => { if (!lost && draft.customerApprovedProfileChange.length === beforeChanges + 1) {
    lost = true; h.storeControl.loseReply = true; h.storeControl.beforeCommit = null;
  } };
  await assert.rejects(h.flow.prepare(h.request, { ...h.command, reviewHash: reviewed.reviewHash }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(lost, true); assert.equal(h.state.customerApprovedProfileChange.length, beforeChanges + 1);
  h.identity.user.permissions = permissions.filter(permission => permission !== 'rental-os:member:manage');
  h.members.listPersonalProfileCandidatesPage = async () => { throw Error('Original preparation reads cannot rediscover'); };
  const before = h.clone(h.state), prepared = await h.flow.readPrepared(h.request, h.locator);
  assert.equal(prepared.state, 'prepared'); assert.equal(prepared.change.fields[0].after, h.command.name);
  const task = await h.flow.readCreatedTask(h.request, h.locator);
  assert.equal(task.created.receipt.state, 'not_observed'); assert.deepEqual(h.state, before);
  assert.equal(h.state.customerApprovedProfileOperation.length, 0);
  h.identity.user.permissions = []; await assert.rejects(h.flow.readPrepared(h.request, h.locator));
  assert.deepEqual(h.state, before);
});

test('AIN16 original name cancellation closes queued and real waiting work without business rollback or policy grants', async () => {
  let h = await profileLifecycleSetup(true);
  // Explicit fixture withdrawal of execution configuration. Cancellation must
  // not initialize a new plan, resource ledger, approval or member update.
  h.state.aiTaskPlanPolicy.length = 0;
  const initialRevision = h.task().revision;
  await h.requests.requestCancellation(h.request, { ...h.reference, expectedRevision: initialRevision });
  assert.equal(h.task().status, 'CANCEL_REQUESTED');
  assert.equal((await h.requests.readCancellation(h.request, { ...h.reference, expectedRevision: initialRevision })).receipt.status, 'observed');
  const cancelRevision = h.task().revision;
  await h.requests.settleUnstartedCancellation(h.request, { ...h.reference, expectedRevision: cancelRevision });
  assert.equal(h.task().status, 'CANCELLED'); assert.equal(h.state.aiRun.find(row => row.id === h.runId).status, 'CANCELLED');
  assert.equal((await h.requests.readCancellationSettlement(h.request, { ...h.reference, expectedRevision: cancelRevision })).receipt.status, 'observed');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1); assert.equal(h.state.customerApprovedProfileOperation.length, 0);
  assert.equal(h.state.aiStep.filter(row => row.taskId === h.taskId).length, 0);
  assert.equal(h.state.aiTaskExecutionCharge.filter(row => row.taskId === h.taskId).length, 0);
  assert.equal(h.state.aiTaskPlanPolicy.length, 0);
  h = await profileLifecycleSetup(true);
  assert.equal((await h.requests.start(h.request, h.reference)).outcome.status, 'paused');
  const revision = h.task().revision;
  await h.requests.requestCancellation(h.request, { ...h.reference, expectedRevision: revision });
  await assert.rejects(h.requests.settleUnstartedCancellation(h.request, { ...h.reference, expectedRevision: h.task().revision }));
  await assert.rejects(h.requests.continueConfirmation(h.request, h.reference));
  const recovered = await h.requests.recoverOriginal(h.request, h.reference);
  assert.equal(recovered.execution, 'recovery_only_no_redispatch');
  assert.equal(h.task().status, 'CANCELLED', JSON.stringify(recovered));
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1); assert.equal(h.state.customerApprovedProfileOperation.length, 0);
  assert.equal(h.state.aiApprovalConsumption.length, 0); assert.equal(h.state.aiStep.filter(row => row.taskId === h.taskId).length, 1);
});

test('AIN16 original name recovery observes one committed CAS and lost recovery ACK never authorizes another execution', async () => {
  for (const loseAck of [false, true]) {
    const h = await profileLifecycleSetup();
    assert.equal((await h.requests.start(h.request, h.reference)).outcome.status, 'paused');
    await h.requests.decide(h.request, { ...h.reference, decision: 'approve' });
    let profileWrites = 0, commitLost = false;
    h.storeControl.beforeWrite = name => {
      if (name === 'customerProfile') profileWrites++;
      if (!commitLost && name === 'customerApprovedProfileOperation') { commitLost = true; h.storeControl.loseReply = true; }
    };
    const unknown = await h.requests.continueConfirmation(h.request, h.reference);
    assert.notEqual(unknown.outcome.status, 'succeeded'); assert.equal(commitLost, true);
    assert.equal(profileWrites, 1); assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
    assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
    const originalPlan = h.clone(h.state.aiTaskRunPlan.filter(row => row.taskId === h.taskId));
    const inputs = h.clone(h.state.aiTaskActionInput.filter(row => row.taskId === h.taskId));
    const runCount = h.state.aiRun.filter(row => row.taskId === h.taskId).length;
    await assert.rejects(h.requests.recoverOriginal(h.request, { ...h.reference, runId: 'caller-run', lease: {} }));
    const aborted = new AbortController(); aborted.abort();
    assert.equal((await h.requests.recoverOriginal(h.request, h.reference, aborted.signal)).reason, 'host_aborted');
    if (loseAck) {
      const update = h.db.aiRun.updateMany.bind(h.db.aiRun);
      let lost = false;
      h.db.aiRun.updateMany = async args => {
        const result = await update(args);
        if (!lost && args.where.id === h.runId && args.data.leaseOwnerId === 'worker-a' && result.count === 1) {
          lost = true; throw Error('synthetic recovery CAS committed, reply lost');
        }
        return result;
      };
      await assert.rejects(h.requests.recoverOriginal(h.request, h.reference), error => error.code === 'AI_RESULT_UNKNOWN');
      assert.equal(lost, true); assert.equal(h.state.aiRun.find(row => row.id === h.runId).leaseOwnerId, 'worker-a');
      h.db.aiRun.updateMany = update;
    } else {
      const observed = await h.requests.recoverOriginal(h.request, h.reference);
      assert.equal(observed.execution, 'recovery_only_no_redispatch');
    }
    const beforeRead = h.clone(h.state), result = await h.requests.read(h.request, h.reference);
    assert.equal(result.businessOutcome, 'committed'); assert.equal(result.operation.receipt.resultRevision, 2);
    assert.deepEqual(h.clone(h.state), beforeRead); assert.equal(profileWrites, 1);
    assert.deepEqual(h.clone(h.state.aiTaskRunPlan.filter(row => row.taskId === h.taskId)), originalPlan);
    assert.deepEqual(h.clone(h.state.aiTaskActionInput.filter(row => row.taskId === h.taskId)), inputs);
    assert.equal(h.state.aiRun.filter(row => row.taskId === h.taskId).length, runCount);
    assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
    h.identity.membership = false; await assert.rejects(h.requests.read(h.request, h.reference));
  }
});

test('AIN16 changed-name reconfirmation closes stale original work and requires a new proposal and approval before one Core CAS', async () => {
  const h = await profileLifecycleSetup(true);
  assert.equal((await h.requests.start(h.request, h.reference)).outcome.status, 'paused');
  // Explicit concurrent-human-result fixture: not an AI update or SQL proof.
  h.state.customerProfile[0].ordinaryRevision = 2; h.state.customerProfile[0].name = 'Concurrent human name';
  const command = { original: h.reference, name: 'Reconfirmed customer', expiresAt: '2026-10-07T12:00:00Z' };
  const before = h.clone(h.state), preview = await h.requests.readUpdatedDifference(h.request, command);
  assert.equal(preview.originalBaseMatches, false); assert.equal(preview.current.ordinaryRevision, 2);
  assert.deepEqual(preview.fields, [{ field: 'name', before: 'Concurrent human name', after: 'Reconfirmed customer' }]);
  assert.deepEqual(h.clone(h.state), before); assert.equal(preview.persistence, 'not_attempted');
  await assert.rejects(h.requests.decide(h.request, { ...h.reference, decision: 'approve' }));
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...command, reviewHash: preview.reviewHash }));
  assert.equal(h.state.customerApprovedProfileChange.length, 1); assert.equal(h.state.customerApprovedProfileOperation.length, 0);
  await h.requests.requestCancellation(h.request, { ...h.reference, expectedRevision: h.task().revision });
  await h.requests.recoverOriginal(h.request, h.reference);
  assert.equal(h.task().status, 'CANCELLED'); assert.equal(h.state.aiStep.find(row => row.taskId === h.taskId).effect, 'NONE');
  const oldRows = Object.fromEntries(['aiTask', 'aiRun', 'aiStep', 'aiTaskRunPlan', 'aiTaskActionInput', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge', 'aiTaskRunPreparation', 'aiTaskEvent']
    .map(table => [table, h.clone(h.state[table].filter(row => row.id === h.taskId || row.taskId === h.taskId))]));
  const prepared = await h.requests.prepareReconfirmedChange(h.request, { ...command, reviewHash: preview.reviewHash });
  assert.equal(prepared.approval, 'fresh_proposal_and_approval_required'); assert.equal(prepared.task, 'not_created_by_preparation');
  assert.equal(prepared.change.baseRevision, 2); assert.notEqual(prepared.reference.changeId, h.reference.changeId);
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2); assert.equal(h.state.aiApproval.length, 0);
  assert.deepEqual((await h.requests.readReconfirmedChange(h.request, { original: h.reference })).reference, prepared.reference);
  const created = await h.requests.createTask(h.request, prepared.reference), taskId = created.receipt.taskId;
  // Only this new explicit synthetic task receives the already-defined sample
  // policies; no production role/policy writer or old task budget is changed.
  h.state.aiTaskActionPolicy.push(...h.clone(h.state.aiTaskActionPolicy.filter(row => row.taskId === 'task-a')).map(row => ({ ...row, taskId })));
  assert.equal((await h.requests.start(h.request, prepared.reference)).outcome.status, 'paused');
  await assert.rejects(h.requests.continueConfirmation(h.request, prepared.reference));
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  await assert.rejects(h.requests.decide(h.request, { ...prepared.reference, decision: 'approve', approvalId: 'old-approval' }));
  await h.requests.decide(h.request, { ...prepared.reference, decision: 'approve' });
  assert.equal((await h.requests.continueConfirmation(h.request, prepared.reference)).outcome.status, 'succeeded');
  const result = await h.requests.read(h.request, prepared.reference);
  assert.equal(result.businessOutcome, 'committed'); assert.equal(result.operation.receipt.resultRevision, 3);
  assert.equal(h.state.customerProfile[0].name, 'Reconfirmed customer'); assert.equal(h.state.customerProfile[0].ordinaryRevision, 3);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.customerApprovedProfileOperation[0].changeId, prepared.reference.changeId);
  assert.equal(h.state.customerProfile[0].email, 'retained@example.test'); assert.equal(h.state.customerProfile[0].phone, 'synthetic-phone');
  assert.equal(h.state.customerProfile[0].identityVerified, false);
  for (const [table, rows] of Object.entries(oldRows)) assert.deepEqual(h.clone(h.state[table].filter(row => row.id === h.taskId || row.taskId === h.taskId)), rows);
});

test('AIN16 changed-name reconfirmation refuses unknown originals and reads one lost preparation reply without switching keys', async () => {
  let h = await profileLifecycleSetup(true);
  await h.requests.start(h.request, h.reference); await h.requests.decide(h.request, { ...h.reference, decision: 'approve' });
  let lost = false;
  h.storeControl.beforeWrite = name => { if (!lost && name === 'customerApprovedProfileOperation') { lost = true; h.storeControl.loseReply = true; } };
  assert.notEqual((await h.requests.continueConfirmation(h.request, h.reference)).outcome.status, 'succeeded');
  const command = { original: h.reference, name: 'Must not replace unknown', expiresAt: '2026-10-07T12:00:00Z' };
  const preview = await h.requests.readUpdatedDifference(h.request, command), frozen = h.clone(h.state);
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...command, reviewHash: preview.reviewHash }));
  assert.deepEqual(h.clone(h.state), frozen); assert.equal(h.state.customerApprovedProfileChange.length, 1);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);

  h = await profileLifecycleSetup(true);
  await h.requests.requestCancellation(h.request, { ...h.reference, expectedRevision: h.task().revision });
  await h.requests.settleUnstartedCancellation(h.request, { ...h.reference, expectedRevision: h.task().revision });
  const next = { original: h.reference, name: 'Metadata recovery only', expiresAt: '2026-10-07T12:00:00Z' };
  const review = await h.requests.readUpdatedDifference(h.request, next);
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...next, reviewHash: '0'.repeat(64) }));
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...next, reviewHash: review.reviewHash, changeKey: 'caller-retry-key' }));
  let metadataLost = false;
  h.storeControl.beforeWrite = (name, args) => {
    if (!metadataLost && name === 'customerApprovedProfileChange' && args.data.changeKey.startsWith('profile-reconfirm-')) {
      metadataLost = true; h.storeControl.loseReply = true;
    }
  };
  const taskCount = h.state.aiTask.length;
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...next, reviewHash: review.reviewHash }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(metadataLost, true); assert.equal(h.state.customerApprovedProfileChange.length, 2);
  const original = h.clone(h.state), observed = await h.requests.readReconfirmedChange(h.request, { original: h.reference });
  assert.equal(observed.state, 'prepared'); assert.equal(observed.change.fields[0].after, 'Metadata recovery only');
  assert.deepEqual(h.clone(h.state), original); assert.equal(h.state.aiTask.length, taskCount);
  const different = { ...next, name: 'Different replacement' }, changed = await h.requests.readUpdatedDifference(h.request, different);
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...different, reviewHash: changed.reviewHash }));
  assert.equal(h.state.customerApprovedProfileChange.length, 2); assert.equal(h.state.customerProfile[0].ordinaryRevision, 1);
  assert.equal(h.state.customerApprovedProfileOperation.length, 0); assert.equal(h.state.aiApproval.length, 0);
  assert.equal(h.state.aiGatewayInvocation.length, 0);
  h.identity.membership = false; await assert.rejects(h.requests.readReconfirmedChange(h.request, { original: h.reference }));
});

// Begin original rejected-name reconfirmation owned cases.
async function rejectedNameReconfirmationSetup() {
  const h = await profileLifecycleSetup(true);
  assert.equal((await h.requests.start(h.request, h.reference)).outcome.status, 'paused');
  const decided = await h.requests.decide(h.request, { ...h.reference, decision: 'reject' });
  assert.equal(decided.approval.decision, 'rejected');
  const continued = await h.requests.continueConfirmation(h.request, h.reference);
  assert.equal(continued.outcome.status, 'failed'); assert.equal(h.task().status, 'FAILED');
  assert.equal(h.task().cancelRequestedAt, null);
  const step = h.state.aiStep.find(row => row.taskId === h.taskId);
  assert.equal(step.status, 'FAILED'); assert.equal(step.effect, 'NONE');
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1); assert.equal(h.state.customerApprovedProfileOperation.length, 0);
  assert.equal(h.state.aiApprovalConsumption.length, 0);
  const command = { original: h.reference, name: 'Reconfirmed after original rejection', expiresAt: '2026-10-07T12:00:00Z' };
  return { ...h, command };
}

test('AIN16 original rejected name reconfirms a new proposal approval and one Core CAS without cancelling or rewriting the old task', async () => {
  const h = await rejectedNameReconfirmationSetup();
  const tables = ['aiTask', 'aiRun', 'aiStep', 'aiTaskRunPlan', 'aiTaskActionInput', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge',
    'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiTaskEvent'];
  const originalRows = () => Object.fromEntries(tables.map(table => [table, h.clone(h.state[table].filter(row => row.id === h.taskId || row.taskId === h.taskId))]));
  const before = originalRows();
  const inspected = await h.requests.readUpdatedDifference(h.request, h.command);
  assert.equal(inspected.fields[0].before, 'Original customer'); assert.equal(inspected.approval, 'not_granted');
  const prepared = await h.requests.prepareReconfirmedChange(h.request, { ...h.command, reviewHash: inspected.reviewHash });
  assert.equal(prepared.closure.state, 'closed_no_business_submission');
  assert.equal(prepared.closure.taskId, h.taskId); assert.notEqual(prepared.reference.changeId, h.reference.changeId);
  assert.equal(prepared.change.baseRevision, 1); assert.equal(h.state.aiTask.length, 2);
  assert.equal(h.state.customerProfile[0].ordinaryRevision, 1); assert.equal(h.state.aiApproval.length, 1);
  assert.deepEqual((await h.requests.readReconfirmedChange(h.request, { original: h.reference })).reference, prepared.reference);
  const created = await h.requests.createTask(h.request, prepared.reference), taskId = created.receipt.taskId;
  h.state.aiTaskActionPolicy.push(...h.clone(h.state.aiTaskActionPolicy.filter(row => row.taskId === 'task-a')).map(row => ({ ...row, taskId })));
  assert.equal((await h.requests.start(h.request, prepared.reference)).outcome.status, 'paused');
  await assert.rejects(h.requests.continueConfirmation(h.request, prepared.reference));
  assert.equal(h.state.customerApprovedProfileOperation.length, 0);
  await h.requests.decide(h.request, { ...prepared.reference, decision: 'approve' });
  let lost = false;
  h.storeControl.beforeWrite = name => { if (!lost && name === 'customerApprovedProfileOperation') { lost = true; h.storeControl.loseReply = true; } };
  assert.notEqual((await h.requests.continueConfirmation(h.request, prepared.reference)).outcome.status, 'succeeded');
  assert.equal(lost, true); assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  assert.equal(h.state.customerProfile[0].name, h.command.name); assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  const result = await h.requests.read(h.request, prepared.reference);
  assert.equal(result.businessOutcome, 'committed'); assert.equal(result.operation.receipt.resultRevision, 2);
  h.storeControl.beforeWrite = null;
  await h.requests.recoverOriginal(h.request, prepared.reference);
  const frozen = h.clone(h.state);
  assert.equal((await h.requests.read(h.request, prepared.reference)).operation.receipt.receiptId, result.operation.receipt.receiptId);
  assert.deepEqual(h.clone(h.state), frozen); assert.deepEqual(originalRows(), before);
  assert.equal(h.state.aiApproval.filter(row => row.taskId === h.taskId)[0].decision, 'REJECTED');
  assert.equal(h.state.customerProfile[0].email, 'retained@example.test'); assert.equal(h.state.customerProfile[0].phone, 'synthetic-phone');
  assert.equal(h.state.customerProfile[0].identityVerified, false); assert.equal(h.state.aiGatewayInvocation.length, 0);
});

test('AIN16 original rejected name requires exact terminal evidence no possible effect and current independent name-write permission', async () => {
  const h = await rejectedNameReconfirmationSetup(), review = await h.requests.readUpdatedDifference(h.request, h.command);
  const changed = h.state.aiTaskEvent.find(row => row.taskId === h.taskId && row.type === 'step.changed' && row.payload.data.status === 'failed');
  assert.ok(changed); const key = { scopeId: changed.scopeId, taskId: changed.taskId, cursor: changed.cursor }, payload = h.clone(changed.payload);
  changed.payload.evidence.id = '00000000-0000-4000-8000-000000000001';
  const damaged = h.clone(h.state);
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...h.command, reviewHash: review.reviewHash }));
  assert.deepEqual(h.clone(h.state), damaged); assert.equal(h.state.customerApprovedProfileChange.length, 1);
  const current = h.state.aiTaskEvent.filter(row => row.scopeId === key.scopeId && row.taskId === key.taskId && row.cursor === key.cursor);
  assert.equal(current.length, 1); current[0].payload = payload;
  h.state.aiStep.find(row => row.taskId === h.taskId).effect = 'POSSIBLE';
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...h.command, reviewHash: review.reviewHash }));
  h.state.aiStep.find(row => row.taskId === h.taskId).effect = 'NONE';
  h.identity.user.permissions = h.identity.user.permissions.filter(permission => permission !== 'rental-os:member:manage');
  const before = h.clone(h.state);
  await assert.rejects(h.requests.prepareReconfirmedChange(h.request, { ...h.command, reviewHash: review.reviewHash }));
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.state.customerApprovedProfileChange.length, 1);
  assert.equal(h.state.customerApprovedProfileOperation.length, 0); assert.equal(h.state.aiApprovalConsumption.length, 0);
  assert.equal(h.state.aiApproval.length, 1); assert.equal(h.task().status, 'FAILED');
});
// End original rejected-name reconfirmation owned cases.

test('AIN16 task observation reads queued waiting approved succeeded and cancelled originals without starting or rewriting them', async () => {
  let h = await profileLifecycleSetup(true);
  const observe = async fixture => {
    const before = fixture.clone(fixture.state), value = await fixture.requests.readTaskObservation(fixture.request, { original: fixture.reference });
    assert.deepEqual(fixture.clone(fixture.state), before);
    assert.equal(value.execution, 'read_only_no_lease_no_dispatch_no_budget_write');
    for (const hidden of ['leaseOwnerId', 'leaseExpiresAt', 'authorization', 'retained@example.test', 'synthetic-phone'])
      assert.equal(JSON.stringify(value).includes(hidden), false);
    return value;
  };
  const queued = await observe(h);
  assert.equal(queued.snapshot.status, 'queued'); assert.equal(queued.snapshot.steps.length, 0);
  assert.equal(queued.detail.resources, null); assert.equal(queued.business.availability, 'unavailable');
  assert.equal((await h.requests.readTaskEvents(h.request, { original: h.reference, after: '0', limit: 2 })).page.events.length, 0);
  await assert.rejects(h.requests.readTaskObservation(h.request, { original: h.reference, runId: 'caller-run' }));
  await h.requests.start(h.request, h.reference);
  const waiting = await observe(h);
  assert.equal(waiting.snapshot.status, 'waiting_confirmation'); assert.equal(waiting.snapshot.steps[0].kind, 'confirmation');
  assert.ok(waiting.business.value.confirmation.checkpointRef); assert.equal(waiting.business.value.businessOutcome, 'not_observed');
  let cursor = '0', seen = [];
  for (let count = 0; count < 20; count++) {
    const before = h.clone(h.state), page = (await h.requests.readTaskEvents(h.request, { original: h.reference, after: cursor, limit: 2 })).page;
    assert.deepEqual(h.clone(h.state), before); seen.push(...page.events); cursor = page.nextCursor;
    if (!page.hasMore) break;
  }
  assert.equal(new Set(seen.map(row => row.cursor)).size, seen.length); assert.equal(cursor, h.task().eventCursor.toString());
  const replay = await h.requests.readTaskEvents(h.request, { original: h.reference, after: '0', limit: 2 });
  assert.deepEqual(replay.page.events, seen.slice(0, 2));
  await h.requests.decide(h.request, { ...h.reference, decision: 'approve' });
  const approved = await observe(h);
  assert.equal(approved.business.value.decision.approval.decision, 'approved'); assert.equal(approved.business.value.businessOutcome, 'not_observed');
  await h.requests.continueConfirmation(h.request, h.reference);
  const succeeded = await observe(h);
  assert.equal(succeeded.snapshot.status, 'succeeded'); assert.equal(succeeded.business.value.businessOutcome, 'committed');
  assert.equal(succeeded.business.value.operation.receipt.resultRevision, 2);
  h.state.aiTaskPlanPolicy.length = 0; h.control.now = new Date('2026-10-08T12:00:00Z');
  h.state.customerProfile[0].ordinaryRevision = 3; h.state.customerProfile[0].name = 'Later human name';
  const historical = await observe(h);
  assert.equal(historical.business.value.operation.receipt.resultRevision, 2); assert.equal(historical.business.value.current.ordinaryRevision, 3);
  assert.equal(historical.business.value.currentMatchesChangeBase, false);

  h = await profileLifecycleSetup(true); await h.requests.start(h.request, h.reference);
  await h.requests.requestCancellation(h.request, { ...h.reference, expectedRevision: h.task().revision });
  assert.equal((await observe(h)).snapshot.status, 'cancel_requested');
  await h.requests.recoverOriginal(h.request, h.reference);
  const cancelled = await observe(h);
  assert.equal(cancelled.snapshot.status, 'cancelled'); assert.equal(cancelled.detail.steps[0].effect, 'none');
  assert.equal(cancelled.business.value.businessOutcome, 'not_observed'); assert.equal(h.state.customerApprovedProfileOperation.length, 0);
});

test('AIN16 task observation separates committed Core receipts from unknown measurements and preserves an event-history reset', async () => {
  const h = await profileLifecycleSetup(true);
  await h.requests.start(h.request, h.reference); await h.requests.decide(h.request, { ...h.reference, decision: 'approve' });
  let lost = false;
  h.storeControl.beforeWrite = name => { if (!lost && name === 'customerApprovedProfileOperation') { lost = true; h.storeControl.loseReply = true; } };
  assert.notEqual((await h.requests.continueConfirmation(h.request, h.reference)).outcome.status, 'succeeded');
  const before = h.clone(h.state), view = await h.requests.readTaskObservation(h.request, { original: h.reference });
  assert.notEqual(view.snapshot.status, 'succeeded'); assert.equal(view.detail.steps[0].effect, 'possible');
  assert.equal(view.detail.steps[0].artifacts[0].completeMeasurement, false);
  assert.equal(view.business.value.businessOutcome, 'committed'); assert.equal(view.business.value.operation.receipt.resultRevision, 2);
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.state.customerProfile[0].ordinaryRevision, 2);
  assert.equal(h.state.customerApprovedProfileOperation.length, 1); assert.equal(h.state.aiApprovalConsumption.length, 1);
  // Explicit retained-history gap sample only, not production deletion/retention.
  h.state.aiTaskEvent = h.state.aiTaskEvent.filter(row => row.taskId !== h.taskId);
  const gap = h.clone(h.state), reset = await h.requests.readTaskEvents(h.request, { original: h.reference, after: '0', limit: 10 });
  assert.equal(reset.page.status, 'reset_required'); assert.equal(reset.page.reason, 'cursor_expired');
  assert.deepEqual(h.clone(h.state), gap);
  const reread = await h.requests.readTaskObservation(h.request, { original: h.reference });
  assert.equal(reread.business.value.businessOutcome, 'committed'); assert.deepEqual(h.clone(h.state), gap);
});

test('AIN16 task observation rejects foreign bindings and revoked buffered or empty-event reads', async () => {
  const h = await profileLifecycleSetup(true), before = h.clone(h.state);
  await assert.rejects(h.requests.readTaskObservation(h.request, { original: { ...h.reference, customerId: 'foreign-customer' } }));
  await assert.rejects(h.requests.readTaskEvents(h.request, { original: h.reference, after: '1', limit: 10 }));
  await assert.rejects(h.requests.readTaskEvents(h.request, { original: h.reference, after: '0', limit: 10, taskId: 'caller-task' }));
  assert.deepEqual(h.clone(h.state), before);
  let revoked = false;
  h.storeControl.beforeRead = name => {
    if (!revoked && name === 'aiTaskResultArtifact') { revoked = true; h.identity.membership = false; }
  };
  await assert.rejects(h.requests.readTaskObservation(h.request, { original: h.reference }));
  assert.equal(revoked, true); assert.deepEqual(h.clone(h.state), before);
  h.storeControl.beforeRead = null; h.identity.membership = true;
  h.storeControl.beforeRead = name => { if (name === 'aiTaskEvent') h.identity.membership = false; };
  await assert.rejects(h.requests.readTaskEvents(h.request, { original: h.reference, after: '0', limit: 10 }));
  assert.deepEqual(h.clone(h.state), before);
});

test('AIN16 task observation exposes running resources with unavailable business when the original proposal is not yet saved', async () => {
  const h = await profileLifecycleSetup(true);
  // Declared policy only for this new controlled pause sample, not a production
  // timeout change or a previous task's resource reset.
  h.state.aiTaskPlanPolicy[0].limits.maxStepMs = 5000;
  const find = h.db.aiProposalVersion.findFirst.bind(h.db.aiProposalVersion);
  let enter, release, paused = false;
  const reached = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  h.db.aiProposalVersion.findFirst = async args => {
    if (!paused && args.where.taskId === h.taskId) { paused = true; enter(); await gate; }
    return find(args);
  };
  const starting = h.requests.start(h.request, h.reference);
  await reached;
  const before = h.clone(h.state), view = await h.requests.readTaskObservation(h.request, { original: h.reference });
  assert.equal(view.snapshot.status, 'running'); assert.equal(view.detail.steps[0].status, 'running');
  assert.equal(view.detail.steps[0].effect, 'possible'); assert.ok(view.detail.resources);
  assert.equal(view.business.availability, 'unavailable'); assert.equal(view.business.reason, 'original_preparation_not_observed');
  assert.equal(h.state.aiProposal.length, 0); assert.deepEqual(h.clone(h.state), before);
  h.db.aiProposalVersion.findFirst = find; release();
  assert.equal((await starting).outcome.status, 'paused');
  const waiting = await h.requests.readTaskObservation(h.request, { original: h.reference });
  assert.equal(waiting.snapshot.status, 'waiting_confirmation'); assert.equal(waiting.business.availability, 'available');
  assert.equal(h.state.customerApprovedProfileOperation.length, 0); assert.equal(h.state.aiApproval.length, 0);
});

test('ordinary-name creation rejects case-collation aliases before inserting any Task', async () => {
  const h = await profileRequestSetup(), transaction = h.db.$transaction;
  // Simulate only case-insensitive row lookup, not an authorization decision.
  // The service must compare the actual returned immutable ID exactly.
  h.db.$transaction = (work, options) => transaction(tx => work({ ...tx, customerApprovedProfileChange: {
    ...tx.customerApprovedProfileChange, findUnique: args => tx.customerApprovedProfileChange.findUnique({ ...args,
      where: args.where.id ? { ...args.where, id: args.where.id.toLowerCase() } : args.where })
  } }), options);
  const alias = h.reference.changeId.toUpperCase(); assert.notEqual(alias, h.reference.changeId);
  const beforeTasks = h.state.aiTask.length;
  await assert.rejects(h.requests.createTask(h.request, { ...h.reference, changeId: alias }));
  assert.equal(h.state.aiTask.length, beforeTasks); assert.equal(h.state.aiStep.length, 0);
});

async function openingProposalSetup() {
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
  const { AiOpeningSectionDifferenceService } = require('../apps/api/src/modules/ai-native/tools/opening-section-difference.service');
  const { AiOpeningSectionProposalService } = require('../apps/api/src/modules/ai-native/tools/opening-section-proposal.service');
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProposal: [], aiProposalVersion: [], aiProposalAction: [] });
  h.state.aiTaskRunPlan.length = 0;
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: 'synthetic-clarification', sceneVersion: '1', enabled: true,
    revision: 1, allowedTools: [{ code: 'tenant.config.propose', version: AI_TOOL_DRAFT_VERSION }], limits: h.plan.limits,
    expiresAt: new Date('2027-01-01T00:00:00Z') });
  const clock = () => new Date(h.control.now), guard = new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {});
  const routes = new AiBusinessReadRouteAuthority(guard, h.authorization.credentials, clock);
  // Explicit original-Core-projection samples, not a SQL parser or live Core.
  const facts = { tenantId: 'tenant-a', workspaceId: 'workspace-a', categoryCode: 'camera', categoryVersion: '1',
    profile: { configVersion: 'profile-v1', terminology: { itemLabel: 'Item', itemGroupLabel: 'Group', assetLabel: 'Asset', fulfillmentLabel: 'Fulfillment', pickupLabel: 'Pickup', returnLabel: 'Return' } },
    settings: { configVersion: 'settings-v1', pricing: { currency: 'CNY', defaultUnit: 'day_24h', enabledUnits: ['day_24h', 'hour'] },
      fulfillment: { enabledModes: ['store_pickup_return', 'carrier_shipping'] } }, groups: [{ id: 'item-a', code: 'A', status: 'enabled', inventoryMode: 'serialized', unit: 'piece' }],
    pricingGroups: [], locations: [], truncated: { groups: false, pricingGroups: false, locations: false }, enabledItemGroupCount: 1, enabledLocationCount: 0 };
  const differences = new AiOpeningSectionDifferenceService({ current: async () => h.clone(facts) }, routes, clock);
  const service = new AiOpeningSectionProposalService({ ...h.authorization, db: h.db, guard, holderId: 'worker-a',
    scene: { code: 'synthetic-clarification', version: '1' }, clock }, differences);
  const lease = await composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock }).tasks.claimRun(h.claim());
  return { ...h, service, differences, lease, facts };
}

test('AIN14 R1 proposals persist real per-section Step/proposal references without touching active settings', async () => {
  const h = await openingProposalSetup(), before = h.clone(h.facts);
  const sections = [
    { key: 'workspace_profile', expectedVersion: 'profile-v1', changes: [{ field: 'itemLabel', value: 'Equipment' }] },
    { key: 'item_groups', targetId: 'item-a', expectedVersion: 'settings-v1', changes: [{ field: 'status', value: 'disabled' }] },
    { key: 'pricing_groups_rates', expectedVersion: 'settings-v1', changes: [{ field: 'defaultUnit', value: 'hour' }] },
    { key: 'fulfillment_network', expectedVersion: 'settings-v1', changes: [{ field: 'enabledModes', value: ['carrier_shipping'] }] }
  ];
  let lease = h.lease; const saved = [];
  for (const section of sections) {
    const result = await h.service.prepare({ taskId: 'task-a', section }, lease);
    assert.equal(result.state, 'ai_proposal_saved'); assert.equal(result.businessDraft, 'not_created');
    assert.equal(result.activeConfiguration, 'unchanged'); assert.equal(result.publication, 'not_attempted');
    lease = result.lease; saved.push(result);
  }
  assert.equal(h.state.aiStep.length, 4); assert.ok(h.state.aiStep.every(s => s.status === 'PENDING' && s.effect === 'NONE'));
  assert.equal(h.state.aiProposal.length, 4); assert.equal(h.state.aiProposalAction.length, 4);
  assert.deepEqual(h.clone(h.facts), before);
  const repeated = await h.service.prepare({ taskId: 'task-a', section: sections[0] }, lease);
  assert.equal(repeated.reference.proposalId, saved[0].reference.proposalId); assert.equal(h.state.aiProposal.length, 4);
  h.control.now = new Date('2026-10-08T12:00:00Z'); h.facts.settings.pricing.defaultUnit = 'hour';
  const old = await h.service.readReceipt({ taskId: 'task-a', runId: 'run-a', registrationRef: saved[2].reference.registrationRef });
  assert.equal(old.state, 'ai_proposal_saved'); assert.equal(old.material.changes[0].before, 'day_24h');
  assert.equal(old.material.changes[0].after, 'hour'); assert.equal(old.publication, 'not_attempted');
});

test('AIN14 lost AI-proposal acknowledgement recovers only the original metadata; invalid fields and withdrawal deny', async () => {
  const h = await openingProposalSetup(), section = { key: 'pricing_groups_rates', expectedVersion: 'settings-v1', changes: [{ field: 'defaultUnit', value: 'hour' }] };
  await assert.rejects(h.differences.prepare({ ...section, changes: [{ field: 'currency', value: 'USD' }] }));
  await assert.rejects(h.differences.prepare({ ...section, expectedVersion: 'stale-version' }));
  h.storeControl.beforeWrite = name => { if (name === 'aiProposal') h.storeControl.loseReply = true; };
  let original;
  await assert.rejects(h.service.prepare({ taskId: 'task-a', section }, h.lease), error => {
    original = error.reference; return error.code === 'AI_RESULT_UNKNOWN' && Boolean(original);
  });
  assert.equal(h.state.aiProposal.length, 1); assert.equal(h.state.aiStep.length, 1);
  h.storeControl.beforeWrite = null;
  const before = h.clone(h.state), recovered = await h.service.readReceipt(original);
  assert.equal(recovered.state, 'ai_proposal_saved'); assert.deepEqual(h.clone(h.state), before);
  h.identity.user.permissions = []; await assert.rejects(h.service.readReceipt(original));
});

async function originalOpeningR1Setup(key = 'workspace_profile', suffix = key, options = {}) {
  const { setup } = require('./fixtures/ai-native/lane-a-original-request.cjs');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { composeRequestBoundOpeningProposals, composeRequestBoundOriginalScenes } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const tables = Object.fromEntries(['aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiTaskRunPreparation', 'aiTaskExecutionBudget',
    'aiTaskExecutionCharge', 'aiTaskResultArtifact', 'aiTaskEvent', 'aiTaskInputRequest', 'aiTaskInputReceipt', 'aiGatewayInvocation',
    'aiGatewayAccountingReceipt', 'aiInvocationAdmission', 'aiBudgetReservation', 'aiDataErasure'].map(name => [name, []]));
  const h = await setup({ ...tables, ...options.tables }), previous = h.control.beforeWrite;
  if (options.permissions) h.b.h.identity.user.permissions.push(...options.permissions);
  h.clone = require('./fixtures/ai-native/task-input-store.cjs').clone;
  h.control.beforeWrite = async (table, args, data) => {
    await previous?.(table, args, data);
    if (table === 'aiTask' && !args.where) { args.data.cancelRequestedAt ??= null; args.data.updatedAt ??= h.dependencies.clock(); }
  };
  for (const [id, scope] of [['scope-platform', { kind: 'platform' }], ['scope-tenant', { kind: 'tenant', tenantId: 'tenant_001' }]])
    h.state.aiScope.push({ id, ...aiPersistenceScopeColumns(scope) });
  h.state.aiBudgetPolicy = h.clone(h.b.h.state.aiBudgetPolicy).map(row => JSON.parse(JSON.stringify(row)
    .replaceAll('tenant-a', 'tenant_001').replaceAll('synthetic-clarification', 'opening_diagnosis')));
  const policy = h.state.aiTaskPlanPolicy.find(row => row.sceneCode === 'opening_diagnosis');
  policy.allowedTools = [{ code: 'tenant.config.propose', version: AI_TOOL_DRAFT_VERSION }];
  policy.limits = { ...h.b.h.plan.limits, maxTotalMs: 120000, maxStepMs: 5000, ...options.limits };
  // Explicit supported/enabled Core-source samples, before original admission.
  h.b.openingConfiguration.settings.pricing.defaultUnit = 'day_24h';
  h.b.openingConfiguration.settings.pricing.enabledUnits = ['day_24h', 'hour'];
  h.b.openingConfiguration.settings.fulfillment.enabledModes = ['store_pickup_return', 'carrier_shipping'];
  const { credentials, ...dependencies } = h.dependencies;
  const request = { headers: { authorization: (await credentials.current()).authorization } };
  const originals = composeRequestBoundOriginalScenes(dependencies, { enabled: true, audience: 'operator' });
  const command = h.command('opening_diagnosis', `opening-r1-${suffix}`); command.input.sections = options.sections ?? [key];
  const created = await originals.create(request, command), original = h.ref(created.receipt.inputRef), taskId = created.task.taskId;
  for (const operation of ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task', 'read_step_terminal'])
    h.state.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId, operation, revision: 1,
      requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  const app = composeRequestBoundOpeningProposals(dependencies, { enabled: true, audience: 'operator' },
    { host: { holderId: 'opening-r1-worker', leaseMs: 120000 } });
  const facts = h.b.openingConfiguration, group = facts.groups[0];
  const section = key === 'workspace_profile' ? { key, expectedVersion: facts.profile.configVersion, changes: [{ field: 'itemLabel', value: 'R1 Equipment' }] }
    : key === 'item_groups' ? { key, targetId: group.id, expectedVersion: facts.settings.configVersion, changes: [{ field: 'status', value: 'disabled' }] }
      : key === 'pricing_groups_rates' ? { key, expectedVersion: facts.settings.configVersion, changes: [{ field: 'defaultUnit', value: 'hour' }] }
        : { key, expectedVersion: facts.settings.configVersion, changes: [{ field: 'enabledModes', value: ['carrier_shipping'] }] };
  return { ...h, request, original, created, taskId, app, section };
}

test('AIN14 original request R1 uses the normal runner and original receipts for four independent partitions', async () => {
  for (const key of ['workspace_profile', 'item_groups', 'pricing_groups_rates', 'fulfillment_network']) {
    const h = await originalOpeningR1Setup(key), facts = h.clone(h.b.openingConfiguration);
    const preview = await h.app.preview(h.request, { original: h.original, section: h.section });
    assert.equal(preview.persistence, 'not_attempted'); assert.equal(h.state.aiProposal.length, 0);
    const result = await h.app.start(h.request, { original: h.original, section: h.section });
    assert.equal(result.outcome?.outcome?.status, 'succeeded', JSON.stringify(result));
    assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1);
    assert.equal(h.state.aiStep.length, 1); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].effect, 'COMMITTED');
    assert.equal(h.state.aiProposal.length, 1); assert.equal(h.state.aiTaskRunPlan.length, 1);
    assert.equal(h.state.aiTask[0].status, 'SUCCEEDED'); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
    assert.ok(h.state.aiTaskExecutionCharge.length >= 4); assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
    assert.ok(h.state.aiTaskRunPreparation[0].completedAt); assert.equal(h.state.aiGatewayInvocation.length, 0);
    assert.deepEqual(h.clone(h.b.openingConfiguration), facts); assert.equal(h.b.businessFacts.writes.length, 0);
    const before = h.clone(h.state);
    const read = await h.app.readReceipt(h.request, { original: h.original, registrationRef: result.reference.registrationRef });
    assert.equal(read.receipt.state, 'ai_proposal_saved'); assert.equal(read.receipt.businessDraft, 'not_created');
    assert.deepEqual(h.clone(h.state), before);
    h.b.h.control.now = new Date('2026-12-01T00:00:00Z');
    h.b.openingConfiguration.settings.configVersion = 'changed-after-proposal';
    assert.equal((await h.app.readReceipt(h.request, { original: h.original, registrationRef: result.reference.registrationRef })).receipt.state, 'ai_proposal_saved');
    h.b.h.identity.user.permissions = []; await assert.rejects(h.app.readReceipt(h.request, { original: h.original, registrationRef: result.reference.registrationRef }));
  }
});

test('AIN14 original request R1 denies caller leases and retains a lost proposal reply without redispatch', async () => {
  const h = await originalOpeningR1Setup('workspace_profile', 'unknown'), command = { original: h.original, section: h.section };
  const before = h.clone(h.state);
  await assert.rejects(h.app.start(h.request, { ...command, lease: { holderId: 'client' } }));
  const cancelled = new AbortController(); cancelled.abort();
  assert.equal((await h.app.start(h.request, command, cancelled.signal)).reason, 'host_aborted');
  assert.deepEqual(h.clone(h.state), before);
  const write = h.control.beforeWrite;
  h.control.beforeWrite = async (table, args, data) => { await write?.(table, args, data); if (table === 'aiProposal') h.control.loseReply = true; };
  const result = await h.app.start(h.request, command);
  assert.notEqual(result.outcome?.outcome?.status, 'succeeded', JSON.stringify(result));
  assert.equal(h.state.aiProposal.length, 1); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].effect, 'POSSIBLE');
  h.control.beforeWrite = write;
  const frozen = h.clone(h.state), read = await h.app.readReceipt(h.request, { original: h.original, registrationRef: result.reference.registrationRef });
  assert.equal(read.receipt.state, 'ai_proposal_saved'); assert.deepEqual(h.clone(h.state), frozen);
  // The original claim_run authority rejects WAITING_EXTERNAL. Observation is
  // not a new execution grant; an unknown action cannot go through start again.
  await assert.rejects(h.app.start(h.request, command), error => error.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.clone(h.state), frozen); assert.equal(h.state.aiProposal.length, 1);
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.b.businessFacts.writes.length, 0);
});

const openingBatchKeys = ['workspace_profile', 'item_groups', 'pricing_groups_rates', 'fulfillment_network'];
function openingBatchSections(h) {
  const facts = h.b.openingConfiguration;
  return [h.section,
    { key: 'item_groups', targetId: facts.groups[0].id, expectedVersion: facts.settings.configVersion, changes: [{ field: 'status', value: 'disabled' }] },
    { key: 'pricing_groups_rates', expectedVersion: facts.settings.configVersion, changes: [{ field: 'defaultUnit', value: 'hour' }] },
    { key: 'fulfillment_network', expectedVersion: facts.settings.configVersion, changes: [{ field: 'enabledModes', value: ['carrier_shipping'] }] }];
}

test('AIN14 same-task partitions freeze one plan and preserve four independent proposal receipts', async () => {
  // New explicit fixture policy only; no previous task ceilings are changed.
  const h = await originalOpeningR1Setup('workspace_profile', 'one-task-four', { sections: openingBatchKeys, limits: { maxOutputBytes: 16384 } });
  const command = { original: h.original, sections: openingBatchSections(h) }, facts = h.clone(h.b.openingConfiguration), before = h.clone(h.state);
  const preview = await h.app.previewSections(h.request, command);
  assert.equal(preview.sections.length, 4); assert.equal(preview.atomicity, 'independent_partitions');
  assert.deepEqual(h.clone(h.state), before);
  await assert.rejects(h.app.startSections(h.request, { ...command, sections: [command.sections[0], command.sections[0]] }));
  await assert.rejects(h.app.startSections(h.request, { ...command, sections: command.sections.map((section, i) => i === 2 ? { ...section, expectedVersion: 'stale' } : section) }));
  assert.deepEqual(h.clone(h.state), before);
  const result = await h.app.startSections(h.request, command);
  assert.equal(result.outcome.outcome.status, 'succeeded', JSON.stringify(result));
  assert.equal(result.atomicity, 'independent_partitions'); assert.equal(result.failurePolicy, 'stop_and_reconcile');
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1); assert.equal(h.state.aiTaskRunPlan.length, 1);
  assert.equal(h.state.aiTaskRunPlan[0].payload.steps.length, 4); assert.equal(h.state.aiTaskActionInput.length, 4);
  assert.equal(h.state.aiStep.length, 4); assert.ok(h.state.aiStep.every(row => row.status === 'SUCCEEDED' && row.effect === 'COMMITTED'));
  assert.equal(h.state.aiProposal.length, 4); assert.equal(h.state.aiProposalVersion.length, 4); assert.equal(h.state.aiProposalAction.length, 4);
  assert.equal(h.state.aiTaskRunPreparation.length, 1); assert.ok(h.state.aiTaskRunPreparation[0].completedAt);
  assert.equal(h.state.aiTaskExecutionCharge.length, 13); assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'RECORDED'));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.deepEqual(h.clone(h.b.openingConfiguration), facts);
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.b.businessFacts.writes.length, 0);
  const final = h.clone(h.state), read = await h.app.readSections(h.request, { original: h.original });
  assert.equal(read.sections.length, 4); assert.ok(read.sections.every(row => row.receipt.state === 'ai_proposal_saved' && row.step.status === 'SUCCEEDED'));
  assert.deepEqual(h.clone(h.state), final);
  h.b.h.control.now = new Date('2026-12-01T00:00:00Z'); h.b.openingConfiguration.settings.configVersion = 'later-version';
  const old = await h.app.readSections(h.request, { original: h.original });
  assert.equal(old.sections[2].expectedVersion, facts.settings.configVersion);
  assert.equal(old.sections[2].receipt.material.changes[0].before, 'day_24h');
  assert.deepEqual(h.clone(h.state), final);
  h.b.h.identity.user.permissions = []; await assert.rejects(h.app.readSections(h.request, { original: h.original }));
});

test('AIN14 same-task later-partition unknown stops the tail and never rewrites the committed prefix', async () => {
  const h = await originalOpeningR1Setup('workspace_profile', 'partial-unknown', { sections: openingBatchKeys, limits: { maxOutputBytes: 16384 } });
  const command = { original: h.original, sections: openingBatchSections(h) }, facts = h.clone(h.b.openingConfiguration), write = h.control.beforeWrite;
  let lost = false;
  h.control.beforeWrite = async (table, args, data) => {
    await write?.(table, args, data);
    if (!lost && table === 'aiProposal' && h.state.aiProposal.length === 1) { lost = true; h.control.loseReply = true; }
  };
  const result = await h.app.startSections(h.request, command);
  assert.notEqual(result.outcome.outcome.status, 'succeeded'); assert.equal(lost, true);
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1);
  assert.equal(h.state.aiTaskActionInput.length, 4); assert.equal(h.state.aiTaskRunPlan[0].payload.steps.length, 4);
  assert.equal(h.state.aiStep.length, 2); assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].effect, 'COMMITTED');
  assert.equal(h.state.aiStep[1].effect, 'POSSIBLE'); assert.equal(h.state.aiProposal.length, 2);
  assert.deepEqual(h.clone(h.b.openingConfiguration), facts); assert.equal(h.state.aiGatewayInvocation.length, 0);
  h.control.beforeWrite = write;
  const before = h.clone(h.state), read = await h.app.readSections(h.request, { original: h.original });
  assert.equal(read.sections[0].step.status, 'SUCCEEDED'); assert.equal(read.sections[0].receipt.state, 'ai_proposal_saved');
  assert.equal(read.sections[1].step.effect, 'POSSIBLE'); assert.equal(read.sections[1].receipt.state, 'ai_proposal_saved');
  assert.equal(read.sections[2].step.status, 'NOT_REGISTERED'); assert.equal(read.sections[3].step.status, 'NOT_REGISTERED');
  assert.equal(read.sections[2].receipt.state, 'incomplete_original_metadata'); assert.deepEqual(h.clone(h.state), before);
  await assert.rejects(h.app.startSections(h.request, command), error => error.code === 'AI_ACCESS_DENIED');
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.state.aiProposal.length, 2); assert.equal(h.b.businessFacts.writes.length, 0);
});

async function openingR1UncertainSetup(suffix, batch = true) {
  const h = await originalOpeningR1Setup('workspace_profile', suffix,
    { sections: batch ? openingBatchKeys : ['workspace_profile'], limits: { maxOutputBytes: 16384 } });
  const previous = h.control.beforeWrite; let lost = false;
  h.control.beforeWrite = async (table, args, data) => {
    await previous?.(table, args, data);
    if (!lost && table === 'aiProposal' && h.state.aiProposal.length === (batch ? 1 : 0)) { lost = true; h.control.loseReply = true; }
  };
  const result = batch ? await h.app.startSections(h.request, { original: h.original, sections: openingBatchSections(h) })
    : await h.app.start(h.request, { original: h.original, section: h.section });
  assert.equal(lost, true); assert.notEqual(result.outcome.outcome.status, 'succeeded');
  h.control.beforeWrite = previous;
  return { ...h, result };
}

test('AIN14 R1 lifecycle cancels queued work and reconciles a cancelled unknown batch without erasing metadata or debt', async () => {
  let h = await originalOpeningR1Setup('workspace_profile', 'queued-cancellation');
  h.state.aiTaskPlanPolicy.length = 0;
  const initialRevision = h.state.aiTask[0].revision, facts = h.clone(h.b.openingConfiguration);
  await assert.rejects(h.app.recoverOriginal(h.request, { original: h.original }));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  await h.app.requestCancellation(h.request, { original: h.original, expectedRevision: initialRevision });
  assert.equal(h.state.aiTask[0].status, 'CANCEL_REQUESTED');
  assert.equal((await h.app.readCancellation(h.request, { original: h.original, expectedRevision: initialRevision })).receipt.status, 'observed');
  const cancelRevision = h.state.aiTask[0].revision;
  await h.app.settleUnstartedCancellation(h.request, { original: h.original, expectedRevision: cancelRevision });
  assert.equal(h.state.aiTask[0].status, 'CANCELLED'); assert.equal(h.state.aiRun[0].status, 'CANCELLED');
  assert.equal((await h.app.readCancellationSettlement(h.request, { original: h.original, expectedRevision: cancelRevision })).receipt.status, 'observed');
  for (const table of ['aiStep', 'aiTaskRunPlan', 'aiTaskActionInput', 'aiProposal', 'aiTaskExecutionCharge', 'aiGatewayInvocation']) assert.equal(h.state[table].length, 0);
  assert.deepEqual(h.clone(h.b.openingConfiguration), facts); assert.equal(h.b.businessFacts.writes.length, 0);

  h = await openingR1UncertainSetup('cancelled-original-batch');
  const prefix = h.clone(h.state.aiStep[0]), proposals = h.clone(h.state.aiProposal), versions = h.clone(h.state.aiProposalVersion);
  const inputs = h.clone(h.state.aiTaskActionInput), plan = h.clone(h.state.aiTaskRunPlan), budget = h.clone(h.state.aiTaskExecutionBudget);
  const chargeCount = h.state.aiTaskExecutionCharge.length, originalRunId = h.state.aiRun[0].id;
  const revision = h.state.aiTask[0].revision;
  await h.app.requestCancellation(h.request, { original: h.original, expectedRevision: revision });
  await assert.rejects(h.app.settleUnstartedCancellation(h.request, { original: h.original, expectedRevision: h.state.aiTask[0].revision }));
  // New execution configuration is withdrawn and its original input expires.
  // Recovery must not fetch today's Core values or silently replace the packet.
  h.state.aiTaskPlanPolicy.length = 0; h.b.h.control.now = new Date('2026-12-01T00:00:00Z');
  h.b.openingConfiguration.settings.configVersion = 'newer-after-original-r1';
  const currentFacts = h.clone(h.b.openingConfiguration);
  h.dependencies.core.readOpeningConfiguration = async () => { throw Error('recovery must not read current opening fields'); };
  const recovered = await h.app.recoverOriginal(h.request, { original: h.original });
  assert.equal(recovered.execution, 'recovery_only_no_redispatch'); assert.equal(recovered.outcome.status, 'unknown', JSON.stringify(recovered));
  assert.equal(recovered.outcome.completedSteps, 1);
  assert.notEqual(h.state.aiTask[0].status, 'CANCELLED'); assert.equal(h.state.aiStep[1].effect, 'POSSIBLE');
  assert.deepEqual(h.clone(h.state.aiStep[0]), prefix); assert.equal(h.state.aiStep.length, 2);
  assert.deepEqual(h.clone(h.state.aiProposal), proposals); assert.deepEqual(h.clone(h.state.aiProposalVersion), versions);
  assert.deepEqual(h.clone(h.state.aiTaskActionInput), inputs); assert.deepEqual(h.clone(h.state.aiTaskRunPlan), plan);
  assert.deepEqual(h.clone(h.state.aiTaskExecutionBudget), budget); assert.equal(h.state.aiTaskExecutionCharge.length, chargeCount);
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1); assert.equal(h.state.aiRun[0].id, originalRunId);
  assert.equal(h.state.aiRun[0].leaseOwnerId, null); assert.equal(h.state.aiGatewayInvocation.length, 0);
  const beforeRead = h.clone(h.state), read = await h.app.readSections(h.request, { original: h.original });
  assert.equal(read.sections[0].receipt.state, 'ai_proposal_saved'); assert.equal(read.sections[1].receipt.state, 'ai_proposal_saved');
  assert.equal(read.sections[2].step.status, 'NOT_REGISTERED'); assert.equal(read.sections[3].step.status, 'NOT_REGISTERED');
  assert.deepEqual(h.clone(h.state), beforeRead); assert.deepEqual(h.clone(h.b.openingConfiguration), currentFacts);
  assert.equal(h.b.businessFacts.writes.length, 0);
});

test('AIN14 R1 lifecycle loses a recovery ACK without querying a holder into execution or replaying metadata', async t => {
  const h = await openingR1UncertainSetup('lost-original-recovery-ack', false), before = h.clone(h.state);
  const aborted = new AbortController(); aborted.abort();
  assert.equal((await h.app.recoverOriginal(h.request, { original: h.original }, aborted.signal)).reason, 'host_aborted');
  await assert.rejects(h.app.recoverOriginal(h.request, { original: h.original, runId: 'caller-run', lease: {} }));
  assert.deepEqual(h.clone(h.state), before);
  const runId = h.state.aiRun[0].id, update = h.db.aiRun.updateMany.bind(h.db.aiRun), find = h.db.aiRun.findFirst.bind(h.db.aiRun);
  let lost = false, readsAfterLost = 0;
  h.db.aiRun.findFirst = async args => { if (lost) readsAfterLost++; return find(args); };
  h.db.aiRun.updateMany = async args => {
    const result = await update(args);
    if (!lost && args.where.id === runId && args.data.leaseOwnerId === 'opening-r1-worker' && result.count === 1) {
      lost = true; throw Error('synthetic original recovery CAS committed, reply lost');
    }
    return result;
  };
  const traceStart = h.trace.length;
  await assert.rejects(h.app.recoverOriginal(h.request, { original: h.original }), error => {
    if (error.code !== 'AI_RESULT_UNKNOWN') t.diagnostic(JSON.stringify({ code: error.code, stack: error.stack, trace: h.trace.slice(traceStart) }));
    return error.code === 'AI_RESULT_UNKNOWN';
  });
  assert.equal(lost, true); assert.equal(readsAfterLost, 0); assert.equal(h.state.aiRun[0].leaseOwnerId, 'opening-r1-worker');
  h.db.aiRun.updateMany = update; h.db.aiRun.findFirst = find;
  for (const table of ['aiTaskRunPlan', 'aiTaskActionInput', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiStep', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge', 'aiGatewayInvocation'])
    assert.deepEqual(h.clone(h.state[table]), before[table]);
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1); assert.equal(h.b.businessFacts.writes.length, 0);
  const state = h.clone(h.state), read = await h.app.readSections(h.request, { original: h.original });
  assert.equal(read.sections[0].receipt.state, 'ai_proposal_saved'); assert.deepEqual(h.clone(h.state), state);
  h.b.h.identity.user.permissions = []; await assert.rejects(h.app.readSections(h.request, { original: h.original }));
  await assert.rejects(h.app.recoverOriginal(h.request, { original: h.original }));
});

test('AIN14 R1 lifecycle aborts a pending preclaim Run read and never claims after its late reply', async () => {
  const h = await openingR1UncertainSetup('late-preclaim-read', false), before = h.clone(h.state);
  const find = h.db.aiRun.findFirst.bind(h.db.aiRun), runId = h.state.aiRun[0].id;
  let enter, release, returned;
  const entered = new Promise(resolve => { enter = resolve; }), gate = new Promise(resolve => { release = resolve; });
  const completedRead = new Promise(resolve => { returned = resolve; });
  h.db.aiRun.findFirst = async args => {
    if (args.where.id === runId && args.where.taskId === h.taskId) {
      enter(); await gate; const row = await find(args); returned(); return row;
    }
    return find(args);
  };
  const controller = new AbortController(), pending = h.app.recoverOriginal(h.request, { original: h.original }, controller.signal);
  await entered; controller.abort();
  await assert.rejects(pending, error => error.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(h.clone(h.state), before);
  release(); await completedRead; h.db.aiRun.findFirst = find;
  const read = await h.app.readSections(h.request, { original: h.original });
  assert.equal(read.sections[0].receipt.state, 'ai_proposal_saved');
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.state.aiProposal.length, 1); assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.b.businessFacts.writes.length, 0);
});

async function ruleCalendarOpeningSetup(suffix, boundDraft = false, extraTables = {}) {
  // Explicit original Prisma-shaped version rows, not business cache, SQL or a
  // factory that invents published versions/revisions. Nothing is written to Core.
  const rule = { id: 'rule-fields-a', tenantId: 'tenant_001', workspaceId: 'workspace-a', categoryCode: 'CAMERA', version: 'rule-v1', status: 'published',
    config: { fulfillment: { pickupInspectionRequired: true, returnInspectionRequired: true, evidenceRequired: false, allowDifferentReturnLocation: false },
      damage: { manualReviewRequired: true }, cancellation: { weatherExceptionEnabled: false } },
    createdAt: new Date('2026-01-01'), effectiveFrom: new Date('2026-01-01'), publishedAt: new Date('2026-01-01') };
  const calendar = { id: 'calendar-fields-a', tenantId: 'tenant_001', workspaceId: 'workspace-a', year: 2026, version: 'calendar-v1', status: 'draft', revision: 3,
    days: [{ date: '2026-11-15', name: 'Original day', dayType: 'workday', pricingMultiplier: 1, businessStatus: 'open', closed: false, source: 'week_rule' }] };
  const h = await originalOpeningR1Setup('business_rule', `rule-calendar-${suffix}`, { sections: ['business_rule', 'business_calendar'],
    permissions: ['rental-os:rules:manage', 'rental-os:calendar:view-history'], limits: { maxOutputBytes: 16384 },
    tables: { rentalRuleVersion: [rule], rentalBusinessCalendar: [calendar],
      ...(boundDraft ? { rentalCalendarOverrideAuditEntry: [], rentalCategoryVersion: [],
        businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant_001', categoryCode: 'camera', status: 'ACTIVE',
          categoryVersionId: 'bound-calendar-category', categoryAdoptionRevision: 1 }] } : {}), ...extraTables } });
  h.b.business.getRuleVersion = () => { throw Error('cached rule getter must not be used'); };
  h.b.business.getCalendarVersion = async () => { throw Error('cached calendar getter must not be used'); };
  const sections = [
    { key: 'business_rule', targetId: rule.id, expectedVersion: rule.version, changes: [{ field: 'fulfillment.evidenceRequired', value: true }] },
    { key: 'business_calendar', targetId: calendar.id, expectedVersion: calendar.version, expectedRevision: 3, date: '2026-11-15',
      changes: [{ field: 'name', value: 'Proposed day' }, { field: 'businessStatus', value: 'closed' }, { field: 'closed', value: true }] }
  ];
  return { ...h, sections };
}

test('AIN14 rule/calendar differences reject category changes during field reads before stamping or saving material', async () => {
  const { AiOpeningSectionDifferenceService } = require('../apps/api/src/modules/ai-native/tools/opening-section-difference.service');
  const { AiOpeningVersionFieldSource } = require('../apps/api/src/modules/ai-native/tools/opening-version-fields.source');
  const { AiGuardedOpeningConfigurationSource } = require('../apps/api/src/modules/ai-native/tools/opening-configuration.source');
  const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
  for (const index of [0, 1]) {
    const h = await ruleCalendarOpeningSetup(`closing-category-${index}`);
    const routes = new AiBusinessReadRouteAuthority(h.dependencies.guard, h.dependencies.credentials, h.dependencies.clock);
    const guarded = new AiGuardedOpeningConfigurationSource(h.b.core, routes);
    let changed = false, sources = 0, stamps = 0;
    // Only the returned category fact changes after the first original field
    // read. Current Auth/Guard/ALS and both real bounded readers still run.
    const source = { current: async (...args) => {
      sources++; const row = await guarded.current(...args);
      return changed ? { ...row, categoryVersion: `${row.categoryVersion}-new` } : row;
    } };
    const fields = new AiOpeningVersionFieldSource(h.db, routes), read = fields.read.bind(fields);
    fields.read = async (...args) => { const row = await read(...args); changed = true; return row; };
    const differences = new AiOpeningSectionDifferenceService(source, routes, () => { stamps++; return h.dependencies.clock(); }, fields);
    const before = h.clone(h.state), configuration = h.clone(h.b.openingConfiguration);
    await assert.rejects(differences.prepare(h.sections[index]), error => error.code === 'CONFIG_INVALID');
    assert.equal(sources, 2, 'closing category is checked separately from the original field revision');
    assert.equal(stamps, 0, 'changed category evidence must not receive a checked observation');
    assert.deepEqual(h.clone(h.state), before); assert.deepEqual(h.b.openingConfiguration, configuration);
    assert.equal(h.b.businessFacts.writes.length, 0); assert.equal(h.state.aiProposal.length, 0);
  }
});

test('AIN14 original rule/calendar version fields reach the same R1 runner without cache or business writes', async () => {
  const h = await ruleCalendarOpeningSetup('normal'), command = { original: h.original, sections: h.sections };
  const businessBefore = h.clone([h.state.rentalRuleVersion, h.state.rentalBusinessCalendar, h.b.openingConfiguration]);
  const preview = await h.app.previewSections(h.request, command);
  assert.equal(preview.sections[0].source, 'original_persisted_rule_calendar_fields');
  assert.equal(preview.sections[0].fieldRevision, 'rule_version_and_checked_source_fingerprint_not_object_cas');
  assert.equal(preview.sections[1].baseRevision, 3); assert.equal(preview.sections[1].date, '2026-11-15');
  assert.equal(preview.sections[1].fieldRevision, 'calendar_original_revision');
  assert.deepEqual(preview.sections[1].changes.map(change => [change.field, change.before, change.after]),
    [['name', 'Original day', 'Proposed day'], ['businessStatus', 'open', 'closed'], ['closed', false, true]]);
  const result = await h.app.startSections(h.request, command);
  assert.equal(result.outcome.outcome.status, 'succeeded', JSON.stringify(result));
  assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiRun.length, 1); assert.equal(h.state.aiStep.length, 2);
  assert.equal(h.state.aiProposal.length, 2); assert.ok(h.state.aiStep.every(row => row.status === 'SUCCEEDED' && row.effect === 'COMMITTED'));
  assert.deepEqual(h.clone([h.state.rentalRuleVersion, h.state.rentalBusinessCalendar, h.b.openingConfiguration]), businessBefore);
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.b.businessFacts.writes.length, 0);
  const before = h.clone(h.state), history = await h.app.readSections(h.request, { original: h.original });
  assert.equal(history.sections[1].receipt.material.baseRevision, 3); assert.equal(history.sections[0].receipt.material.changes[0].before, false);
  assert.deepEqual(h.clone(h.state), before);
  h.state.rentalBusinessCalendar[0].revision = 4; h.state.rentalBusinessCalendar[0].days[0].name = 'Changed current day';
  const after = await h.app.readSections(h.request, { original: h.original });
  assert.equal(after.sections[1].receipt.material.changes[0].before, 'Original day');
  assert.equal(after.sections[1].receipt.material.baseRevision, 3);
});

test('AIN14 rule/calendar field readers retain original detail permissions and reject revisions or missing evidence', async () => {
  const h = await ruleCalendarOpeningSetup('denials'), command = { original: h.original, sections: h.sections };
  const before = h.clone(h.state), permissions = [...h.b.h.identity.user.permissions];
  await assert.rejects(h.app.preview(h.request, { original: h.original, section: { ...h.sections[1], changes: [{ field: 'closed', value: true }] } }));
  const { verifyOpeningSectionMaterial } = require('../apps/api/src/modules/ai-native/tools/opening-section-difference.service');
  const oldShape = await h.b.tools.openingFieldDifference({ key: 'workspace_profile', expectedVersion: h.b.openingConfiguration.profile.configVersion,
    changes: [{ field: 'itemLabel', value: 'Checked terminology' }] });
  assert.throws(() => verifyOpeningSectionMaterial({ ...oldShape, fieldRevision: 'calendar_original_revision' }));
  h.b.h.identity.user.permissions = permissions.filter(p => !['rental-os:rules:manage', 'rental-os:rules:publish', 'rental-os:price:manage'].includes(p));
  await assert.rejects(h.app.previewSections(h.request, command));
  h.b.h.identity.user.permissions = permissions.filter(p => !['rental-os:calendar:view-history', 'rental-os:calendar:edit', 'rental-os:calendar:publish', 'rental-os:price:manage', 'rental-os:rules:manage'].includes(p));
  await assert.rejects(h.app.preview(h.request, { original: h.original, section: h.sections[1] }));
  h.b.h.identity.user.permissions = permissions;
  await assert.rejects(h.app.startSections(h.request, { ...command, sections: [h.sections[0], { ...h.sections[1], expectedRevision: 2 }] }));
  await assert.rejects(h.app.preview(h.request, { original: h.original, section: { ...h.sections[0], changes: [{ field: 'payment.depositMode', value: 'none' }] } }));
  h.state.rentalRuleVersion[0].workspaceId = 'foreign-workspace';
  await assert.rejects(h.app.preview(h.request, { original: h.original, section: h.sections[0] }));
  h.state.rentalRuleVersion[0].workspaceId = 'workspace-a';
  h.state.rentalBusinessCalendar[0].days = [];
  await assert.rejects(h.app.preview(h.request, { original: h.original, section: h.sections[1] }));
  h.state.rentalBusinessCalendar[0].days = before.rentalBusinessCalendar[0].days;
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.state.aiProposal.length, 0); assert.equal(h.state.aiStep.length, 0);
});

// Begin original bound calendar draft save owned cases.
async function boundCalendarDraftSaveSetup(suffix, existingOverride = false) {
  const h = await ruleCalendarOpeningSetup(`bound-save-${suffix}`, true);
  if (existingOverride) {
    const day = h.state.rentalBusinessCalendar[0].days[0];
    day.overriddenFrom = { dayType: day.dayType, name: day.name, pricingMultiplier: day.pricingMultiplier,
      closed: day.closed, businessStatus: day.businessStatus, source: 'week_rule' };
    day.source = 'tenant_override'; day.overrideReason = 'Original manual reason';
  }
  const started = await h.app.startSections(h.request, { original: h.original, sections: h.sections });
  assert.equal(started.outcome.outcome.status, 'succeeded');
  const definition = h.clone(h.b.core.listCategories().find(row => row.code === 'camera'));
  h.state.rentalCategoryVersion.push({ id: 'bound-calendar-category', categoryCode: 'camera', structureVersion: 1, status: 'published', definition });
  Object.assign(h.state.businessWorkspace[0], { categoryVersionId: 'bound-calendar-category', categoryAdoptionRevision: 1 });
  const original = h.clone(h.state.rentalBusinessCalendar[0]);
  const published = { ...h.clone(original), id: 'bound-calendar-published', version: '0.1', status: 'published', revision: 2 };
  published.days[0].name = 'Original published day'; h.state.rentalBusinessCalendar.push(published);
  h.b.business.configStore = new (require('../apps/api/src/modules/rental-core/rental-business-config.repository').RentalBusinessConfigRepository)(h.db);
  const { composeOpeningCalendarDraftSave } = require('../apps/api/src/modules/ai-native/scenes/opening-calendar-draft.composition');
  const save = composeOpeningCalendarDraftSave(h.dependencies, { holderId: 'opening-r1-worker', leaseMs: 120000 });
  const command = { original: h.original, registrationRef: started.references[1].registrationRef,
    overrideReason: 'Human confirmed original proposed draft', overrideConfirmed: true };
  const coreContext = { ...h.b.quoteConfiguration, category: definition };
  return { ...h, save, command, original, published: h.clone(published), coreContext };
}

test('AIN14 calendar human review binds the full original Core candidate until one explicit draft save', async () => {
  const h = await boundCalendarDraftSaveSetup('human-review'); h.b.h.identity.user.permissions.push('rental-os:calendar:edit');
  const originalAi = h.clone(Object.fromEntries(Object.entries(h.state).filter(([key]) => key.startsWith('ai'))));
  const original = h.clone(h.state), review = await h.save.reviewDraft(h.command);
  assert.equal(review.review.before.name, 'Original day'); assert.equal(review.review.after.name, 'Proposed day');
  assert.equal(review.review.after.businessStatus, 'closed'); assert.equal(review.review.after.closed, true);
  assert.equal(review.review.persistence, 'not_attempted'); assert.deepEqual(h.state, original);
  h.b.h.control.now = new Date(h.b.h.control.now.getTime() + 1000);
  assert.equal((await h.save.reviewDraft(h.command)).review.reviewHash, review.review.reviewHash, 'audit time does not change the business review hash');
  // An unselected day is still part of the full persisted candidate. The R1's
  // selected fields remain valid, but the old human review cannot cover it.
  h.state.rentalBusinessCalendar[0].days.push({ ...h.clone(h.state.rentalBusinessCalendar[0].days[0]), date: '2026-11-16', name: 'Unselected new day' });
  const changed = h.clone(h.state);
  await assert.rejects(h.save.saveDraft({ ...h.command, reviewHash: review.review.reviewHash, decision: 'save_original_business_draft' }));
  assert.deepEqual(h.state, changed); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 0);
  const fresh = await h.save.reviewDraft(h.command); assert.notEqual(fresh.review.reviewHash, review.review.reviewHash);
  const command = { ...h.command, reviewHash: fresh.review.reviewHash, decision: 'save_original_business_draft' };
  const saved = await h.save.saveDraft(command); assert.equal(saved.operation.state, 'committed'); assert.equal(saved.operation.resultRevision, 4);
  assert.equal(saved.operation.reviewHash, fresh.review.reviewHash); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
  const stable = h.clone(h.state), receipt = await h.save.readDraftOperation({ ...h.command, reviewHash: fresh.review.reviewHash });
  assert.equal(receipt.operation.receiptId, saved.operation.receiptId); assert.deepEqual(h.state, stable);
  assert.equal((await h.save.saveDraft(command)).replayed, true); assert.deepEqual(h.state, stable);
  assert.deepEqual(h.clone(Object.fromEntries(Object.entries(h.state).filter(([key]) => key.startsWith('ai')))), originalAi);
  assert.deepEqual(h.state.rentalBusinessCalendar.find(row => row.id === h.published.id), h.published);
  assert.equal(saved.publication, 'not_attempted'); assert.equal(h.state.aiGatewayInvocation.length, 0);
});

test('AIN14 bound calendar draft saves exact original target version CAS and reads one lost committed operation without publication', async () => {
  const h = await boundCalendarDraftSaveSetup('commit-lost'); h.b.h.identity.user.permissions.push('rental-os:calendar:edit');
  const originalTasks = h.clone(Object.fromEntries(['aiTask', 'aiRun', 'aiStep', 'aiTaskActionInput', 'aiTaskRunPlan', 'aiProposal',
    'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiApprovalConsumption', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge'].map(name => [name, h.state[name]])));
  assert.equal((await h.save.readDraftOperation(h.command)).operation.state, 'not_observed');
  let lost = false;
  h.control.beforeCommit = draft => { if (!lost && draft.rentalCalendarOverrideAuditEntry.length === 1 && h.state.rentalCalendarOverrideAuditEntry.length === 0) {
    lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
  } };
  await assert.rejects(h.save.saveDraft({ ...h.command, decision: 'save_original_business_draft' }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(lost, true); const draft = h.state.rentalBusinessCalendar.find(row => row.id === h.original.id);
  assert.equal(draft.version, h.original.version); assert.equal(draft.revision, 4); assert.equal(draft.status, 'draft');
  assert.equal(draft.days[0].name, 'Proposed day'); assert.equal(draft.days[0].businessStatus, 'closed'); assert.equal(draft.days[0].closed, true);
  assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
  const result = await h.save.readDraftOperation(h.command);
  assert.equal(result.operation.state, 'committed'); assert.equal(result.operation.resultRevision, 4); assert.equal(result.operation.targetId, h.original.id);
  const repeated = await h.save.saveDraft({ ...h.command, decision: 'save_original_business_draft' }); assert.equal(repeated.replayed, true);
  assert.equal(repeated.operation.receiptId, result.operation.receiptId); assert.equal(draft.revision, 4);
  assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
  assert.deepEqual(h.state.rentalBusinessCalendar.find(row => row.id === h.published.id), h.published);
  assert.deepEqual(h.clone(Object.fromEntries(Object.keys(originalTasks).map(name => [name, h.state[name]]))), originalTasks);
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(result.operation.businessDraft, 'saved_not_published');
  await assert.rejects(h.save.saveDraft({ ...h.command, overrideReason: 'Different operation content', decision: 'save_original_business_draft' }));
  assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
});

test('AIN14 bound calendar draft rejects history-only authority newer original version and rolls back draft CAS when audit persistence fails', async () => {
  const h = await boundCalendarDraftSaveSetup('denials'), command = { ...h.command, decision: 'save_original_business_draft' };
  await assert.rejects(h.save.saveDraft(command)); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 0);
  assert.equal(h.state.rentalBusinessCalendar[0].revision, 3);
  await assert.rejects(h.save.saveDraft({ ...command, targetId: 'foreign-calendar' }), error => error.code === 'AI_INVALID_INPUT');
  h.b.h.identity.user.permissions.push('rental-os:calendar:edit');
  const newer = { ...h.clone(h.original), id: 'bound-calendar-newer', version: '99.1' }; h.state.rentalBusinessCalendar.push(newer);
  await assert.rejects(h.save.saveDraft(command), error => error.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.rentalBusinessCalendar[0].revision, 3); assert.equal(newer.revision, 3); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 0);
  h.state.rentalBusinessCalendar = h.state.rentalBusinessCalendar.filter(row => row.id !== newer.id); // Only this synthetic new-version conflict sample.
  const before = h.clone(h.state);
  const previous = h.control.beforeWrite;
  h.control.beforeWrite = async (name, args, data) => {
    await previous?.(name, args, data);
    if (name === 'rentalCalendarOverrideAuditEntry') throw Error('Synthetic audit persistence failure after calendar CAS');
  };
  await assert.rejects(h.save.saveDraft(command), error => error.code === 'AI_RESULT_UNKNOWN');
  h.control.beforeWrite = previous;
  assert.deepEqual(h.clone(h.state), before); assert.equal((await h.save.readDraftOperation(h.command)).operation.state, 'not_observed');
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.state.rentalBusinessCalendar[0].revision, 3);
});
// End original bound calendar draft save owned cases.

// Begin original calendar reconfirmation owned cases.
async function calendarReconfirmationSetup(suffix) {
  const h = await boundCalendarDraftSaveSetup(`reconfirmation-${suffix}`);
  // New admission reads the actual readiness repository, not the previous
  // calendar-only port. Declare empty account/price rows: missing setup stays
  // missing, never a synthetic active account or published price.
  const readRows = require('./fixtures/ai-native/task-input-store.cjs').createTaskInputStore({ workspaceMember: [], rentalPriceVersion: [], aiApproval: [], aiApprovalConsumption: [] });
  for (const name of ['workspaceMember', 'rentalPriceVersion', 'aiApproval', 'aiApprovalConsumption']) { h.state[name] = readRows.state[name]; h.db[name] = readRows.db[name]; }
  h.state.rentalPricingPlan = [];
  const raw = h.db.$queryRaw;
  h.db.$queryRaw = async sql => {
    if ((sql.sql ?? '').includes('FROM rental_pricing_plans')) {
      assert.equal(sql.values[0], 'tenant_001'); assert.equal(sql.values[1], 'workspace-a');
      assert.ok((sql.sql ?? '').includes('LIMIT')); assert.equal(h.state.rentalPricingPlan.length, 0);
      h.trace.push('readiness.empty-price-references'); return [];
    }
    return raw(sql);
  };
  h.b.h.identity.user.permissions.push('rental-os:calendar:edit');
  const { composeOpeningCalendarReconfirmation } = require('../apps/api/src/modules/ai-native/scenes/opening-calendar-reconfirmation.composition');
  const reconfirm = composeOpeningCalendarReconfirmation(h.dependencies, { holderId: 'opening-r1-worker', leaseMs: 120000 });
  const command = { ...h.command, changes: h.clone(h.sections[1].changes) };
  const oldRows = () => h.clone(Object.fromEntries(['aiTaskOriginalRequest', 'aiTask', 'aiRun', 'aiStep', 'aiTaskActionInput', 'aiTaskRunPlan',
    'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiApprovalConsumption', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge']
    .map(name => [name, (h.state[name] ?? []).filter(row => row.id === h.taskId || row.taskId === h.taskId || row.id === h.command.original.inputRef)])));
  // Explicit policies for this newly created fixture Task only; production still
  // needs its real policy source. No manager writer or predecessor mutation.
  const bindNewTaskPolicies = taskId => {
    assert.notEqual(taskId, h.taskId);
    for (const row of h.state.aiTaskActionPolicy.filter(row => row.taskId === h.taskId))
      h.state.aiTaskActionPolicy.push({ ...h.clone(row), taskId });
  };
  return { ...h, reconfirm, reconfirmCommand: command, oldRows, bindNewTaskPolicies };
}

test('AIN14 calendar reconfirmation fresh same-target difference new explicit R1 and separate Core draft save preserve predecessor and published row', async () => {
  const h = await calendarReconfirmationSetup('normal'), predecessor = h.oldRows(), tasks = h.state.aiTask.length;
  h.state.rentalBusinessCalendar[0].revision = 4; h.state.rentalBusinessCalendar[0].days[0].name = 'Another operator day';
  await assert.rejects(h.save.saveDraft({ ...h.command, decision: 'save_original_business_draft' }));
  const businessBefore = h.clone(h.state.rentalBusinessCalendar);
  const review = await h.reconfirm.inspectCurrent(h.reconfirmCommand);
  assert.equal(review.state, 'difference_ready'); assert.equal(review.originalMaterial.baseRevision, 3);
  assert.equal(review.currentMaterial.baseRevision, 4); assert.equal(review.originalMaterial.changes[0].before, 'Original day');
  assert.equal(review.currentMaterial.changes[0].before, 'Another operator day'); assert.equal(h.state.aiTask.length, tasks);
  const command = { ...h.reconfirmCommand, reviewHash: review.reviewHash };
  await assert.rejects(h.reconfirm.prepareUpdated(command), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.reconfirm.prepareUpdated({ ...command, reviewHash: '0'.repeat(64), decision: 'prepare_updated_calendar_proposal' }));
  const prepared = await h.reconfirm.prepareUpdated({ ...command, decision: 'prepare_updated_calendar_proposal' });
  assert.equal(prepared.state, 'new_preparation'); assert.equal(h.state.aiTask.length, tasks + 1);
  assert.deepEqual(h.state.rentalBusinessCalendar, businessBefore);
  const located = await h.reconfirm.readPrepared(command); assert.equal(located.record.state, 'observed');
  assert.equal(located.record.task.status, 'queued'); assert.equal(located.record.task.plan, 'not_observed');
  h.bindNewTaskPolicies(located.record.task.taskId);
  const result = await h.reconfirm.startUpdated({ ...command, decision: 'start_updated_calendar_proposal' });
  assert.equal(result.result.outcome.outcome.status, 'succeeded', JSON.stringify(result));
  assert.notEqual(result.original.inputRef, h.command.original.inputRef); assert.deepEqual(h.state.rentalBusinessCalendar, businessBefore);
  const proposal = await h.app.readReceipt(h.request, { original: result.original, registrationRef: result.result.references[0].registrationRef });
  assert.equal(proposal.receipt.material.baseRevision, 4); assert.equal(proposal.receipt.material.changes[0].before, 'Another operator day');
  const saveCommand = { ...h.command, original: result.original, registrationRef: result.result.references[0].registrationRef,
    decision: 'save_original_business_draft' };
  const saved = await h.save.saveDraft(saveCommand);
  assert.equal(saved.operation.state, 'committed'); assert.equal(saved.operation.baseRevision, 4); assert.equal(saved.operation.resultRevision, 5);
  assert.equal(saved.operation.targetId, h.original.id); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
  assert.equal((await h.save.readDraftOperation({ ...h.command, original: result.original, registrationRef: result.result.references[0].registrationRef })).operation.receiptId,
    saved.operation.receiptId);
  assert.equal((await h.save.saveDraft(saveCommand)).replayed, true);
  assert.deepEqual(h.oldRows(), predecessor); assert.deepEqual(h.state.rentalBusinessCalendar.find(row => row.id === h.published.id), h.published);
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.state.aiApproval.length, 0);
  await assert.rejects(h.reconfirm.startUpdated({ ...command, decision: 'start_updated_calendar_proposal' }));
  assert.equal(h.state.aiTask.length, tasks + 1); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
});

test('AIN14 calendar reconfirmation lost metadata acknowledgement read is original-key only and stale confirmation or no-change cannot start or save', async () => {
  const h = await calendarReconfirmationSetup('lost'), predecessor = h.oldRows();
  h.state.rentalBusinessCalendar[0].revision = 4; h.state.rentalBusinessCalendar[0].days[0].name = 'Concurrent current name';
  const review = await h.reconfirm.inspectCurrent(h.reconfirmCommand), command = { ...h.reconfirmCommand, reviewHash: review.reviewHash };
  const beforeWrite = h.control.beforeWrite; let lost = false;
  h.control.beforeWrite = async (name, args, data) => { await beforeWrite?.(name, args, data);
    if (!lost && name === 'aiTask' && !args.where) { lost = true; h.control.loseReply = true; } };
  const prepared = await h.reconfirm.prepareUpdated({ ...command, decision: 'prepare_updated_calendar_proposal' });
  h.control.beforeWrite = beforeWrite; assert.equal(lost, true); assert.equal(prepared.execution, 'not_started');
  assert.equal(h.state.aiTask.length, 2); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 0);
  const before = h.clone(h.state), located = await h.reconfirm.readPrepared(command);
  assert.equal(located.record.state, 'observed'); assert.equal(located.record.task.state, 'observed');
  assert.equal(located.record.task.status, 'queued'); assert.equal(located.record.task.plan, 'not_observed');
  assert.deepEqual(h.clone(h.state), before);
  h.state.rentalBusinessCalendar[0].revision = 5; h.state.rentalBusinessCalendar[0].days[0].name = 'Changed after explicit preparation';
  await assert.rejects(h.reconfirm.startUpdated({ ...command, decision: 'start_updated_calendar_proposal' }), error => error.code === 'AI_REVISION_CONFLICT');
  const changed = h.clone(h.state), reread = await h.reconfirm.readPrepared(command);
  assert.equal(reread.record.task.taskId, located.record.task.taskId); assert.deepEqual(h.clone(h.state), changed);
  await assert.rejects(h.reconfirm.inspectCurrent({ ...h.reconfirmCommand, targetId: 'caller-other-target' }), error => error.code === 'AI_INVALID_INPUT');
  assert.equal(h.state.aiTask.length, 2); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 0); assert.deepEqual(h.oldRows(), predecessor);
  assert.equal(h.state.aiGatewayInvocation.length, 0);

  const same = await calendarReconfirmationSetup('no-change');
  same.state.rentalBusinessCalendar[0].revision = 4;
  Object.assign(same.state.rentalBusinessCalendar[0].days[0], { name: 'Proposed day', businessStatus: 'closed', closed: true });
  const noChange = await same.reconfirm.inspectCurrent(same.reconfirmCommand), count = same.state.aiTask.length;
  assert.equal(noChange.state, 'no_change');
  const noTask = await same.reconfirm.prepareUpdated({ ...same.reconfirmCommand, reviewHash: noChange.reviewHash, decision: 'prepare_updated_calendar_proposal' });
  assert.equal(noTask.state, 'no_change'); assert.equal(same.state.aiTask.length, count); assert.equal(same.state.rentalCalendarOverrideAuditEntry.length, 0);
});
// End original calendar reconfirmation owned cases.

// Begin original rule Core draft-preview owned cases.
async function originalRuleCorePreviewSetup(suffix, changes = [{ field: 'fulfillment.evidenceRequired', value: true }], options = {}) {
  const h = await ruleCalendarOpeningSetup(`core-rule-${suffix}`, false, options.tables);
  const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const context = { ...h.b.quoteConfiguration, category: h.b.core.listCategories().find(row => row.code === 'camera') };
  const cached = runWithRequestIdentity({ userId: 'user-a', tenantId: 'tenant_001', workspaceId: 'workspace-a', audience: 'operator', isSaasAdmin: false },
    () => h.b.business.state('tenant_001', context));
  // Only this new fixture replaces the old minimal rule-field sample with the
  // original Core's COMPLETE seeded config, before its immutable R1 is created.
  h.state.rentalRuleVersion[0].config = h.clone(cached.ruleVersions[0].config);
  h.state.rentalRuleVersion[0].config.fulfillment.evidenceRequired = false;
  if (options.boundSave) Object.assign(h.state.rentalRuleVersion[0], { status: options.draftSource ? 'draft' : 'published',
    version: '1.0', changeReason: 'Original rule source', createdBy: 'user-a' });
  if (options.draftSource) Object.assign(h.state.rentalRuleVersion[0], { publishedAt: null, effectiveFrom: null, publishedBy: null });
  if (options.boundSave) h.state.rentalRuleVersion[0].config = JSON.parse(JSON.stringify(h.state.rentalRuleVersion[0].config));
  // This slice can supply explicit historical before values, before immutable
  // R1 material is created. Current Core still validates the complete candidate.
  for (const [field, value] of Object.entries(options.before ?? {})) {
    const [block, key] = field.split('.'); h.state.rentalRuleVersion[0].config[block][key] = h.clone(value);
  }
  const section = { ...h.sections[0], expectedVersion: h.state.rentalRuleVersion[0].version, changes };
  const started = await h.app.startSections(h.request, { original: h.original, sections: [section] });
  assert.equal(started.outcome.outcome.status, 'succeeded');
  const calls = { previews: 0, writes: 0, afterPreview: null, routes: [] };
  for (const name of ['saveRuleVersion', 'publishRuleVersion', 'restoreRuleVersion']) h.b.business[name] = async () => { calls.writes++; throw Error('Rule preview must not save/restore/publish'); };
  h.b.business.configStore.upsertRuleVersion = async () => { calls.writes++; throw Error('Rule preview must not persist a version'); };
  h.b.business.configStore.writeRuleVersionWithAudit = async () => { calls.writes++; throw Error('Rule preview must not write an audit'); };
  const actual = h.b.business.previewBoundRuleDraft.bind(h.b.business);
  h.b.business.previewBoundRuleDraft = async (...args) => {
    calls.previews++; assert.equal(getRequestIdentity().tenantId, 'tenant_001'); assert.equal(getRequestIdentity().workspaceId, 'workspace-a');
    const value = actual(...args); await calls.afterPreview?.(); return value;
  };
  const guard = h.dependencies.guard.canActivate.bind(h.dependencies.guard);
  h.dependencies.guard.canActivate = async execution => { const req = execution.switchToHttp().getRequest(); calls.routes.push([req.method, req.originalUrl]); return guard(execution); };
  const { composeOpeningRuleDraftPreview } = require('../apps/api/src/modules/ai-native/scenes/opening-rule-draft.composition');
  const preview = composeOpeningRuleDraftPreview(h.dependencies, { holderId: 'opening-r1-worker', leaseMs: 120000 });
  return { ...h, cached, section, calls, preview, command: { original: h.original, registrationRef: started.references[0].registrationRef } };
}

test('AIN14 original rule Core preview validates the canonical R1 full candidate without modifying rule Task or publication', async () => {
  const h = await originalRuleCorePreviewSetup('normal'), before = h.clone(h.state), cache = h.clone(h.cached.ruleVersions);
  const result = await h.preview.previewDraft(h.command);
  assert.equal(result.preview.targetId, 'rule-fields-a'); assert.equal(result.preview.version, 'rule-v1');
  assert.deepEqual(result.preview.changes, [{ field: 'fulfillment.evidenceRequired', before: false, after: true }]);
  assert.equal(result.preview.validation, 'original_core_rule_save_validation_only');
  assert.equal(result.preview.draftTarget, 'original_restore_to_new_draft_required');
  assert.equal(result.configSource, 'current_original_version_row_not_saved_R1_full_config');
  assert.equal(result.businessDraft, 'not_created'); assert.equal(result.approval, 'not_granted'); assert.equal(result.publication, 'not_attempted');
  assert.equal(result.draftSave.status, 'unavailable'); assert.equal(result.execution, 'read_only_no_lease_or_dispatch');
  assert.notEqual(result.preview.sourceConfigFingerprint, result.preview.candidateConfigFingerprint);
  assert.deepEqual(await h.preview.previewDraft(h.command), result);
  assert.deepEqual(h.clone(h.state), before); assert.deepEqual(h.clone(h.cached.ruleVersions), cache);
  assert.equal(h.calls.writes, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
  assert.ok(h.calls.routes.some(([method, path]) => method === 'POST' && path === '/api/rental/v1/rule-versions'));
  const permissions = [...h.b.h.identity.user.permissions];
  h.b.h.identity.user.permissions = permissions.filter(p => p !== 'rental-os:rules:manage');
  if (!h.b.h.identity.user.permissions.includes('rental-os:rules:publish')) h.b.h.identity.user.permissions.push('rental-os:rules:publish');
  const count = h.calls.previews;
  await assert.rejects(h.preview.previewDraft(h.command)); assert.equal(h.calls.previews, count);
  h.b.h.identity.user.permissions = permissions;
  h.calls.afterPreview = async () => { h.state.rentalRuleVersion[0].config.payment.quoteValidityMinutes = 37; };
  await assert.rejects(h.preview.previewDraft(h.command), error => error.code === 'AI_REVISION_CONFLICT');
  h.state.rentalRuleVersion[0].config = before.rentalRuleVersion[0].config; h.calls.afterPreview = null;
  await assert.rejects(h.preview.previewDraft({ ...h.command, targetId: 'caller-target' }), error => error.code === 'AI_INVALID_INPUT');
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.calls.writes, 0);
});

test('AIN14 original rule Core preview rejects unsupported weather activation and incomplete original fields without saving an AI-valid rule', async () => {
  const h = await originalRuleCorePreviewSetup('unsupported-weather', [{ field: 'cancellation.weatherExceptionEnabled', value: true }]);
  const before = h.clone(h.state);
  // R1 may describe a boolean difference; only the original Core determines
  // whether that draft config is legal. Do not turn its rejection into success.
  await assert.rejects(h.preview.previewDraft(h.command), error => error.getStatus?.() === 400);
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.calls.writes, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
  delete h.state.rentalRuleVersion[0].config.payment.unpaidHoldMinutes;
  await assert.rejects(h.preview.previewDraft(h.command), error => error.getStatus?.() === 400);
  assert.equal(h.state.rentalRuleVersion[0].config.payment.unpaidHoldMinutes, undefined);
  h.state.rentalRuleVersion[0].config = before.rentalRuleVersion[0].config;
  h.state.rentalRuleVersion[0].workspaceId = 'foreign-workspace';
  await assert.rejects(h.preview.previewDraft(h.command)); h.state.rentalRuleVersion[0].workspaceId = 'workspace-a';
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.calls.writes, 0);
});
// End original rule Core draft-preview owned cases.

// Original R1 -> explicit full Core review -> business draft, using the same
// serialized transaction store. No new manager grants or live database exists.
async function originalRuleDraftSaveSetup(suffix, draftSource = false, candidate = {}) {
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const h = await originalRuleCorePreviewSetup(`bound-save-${suffix}`, candidate.changes, { boundSave: true, draftSource, before: candidate.before,
    tables: { operationLog: [], rentalRuleVersionAudit: [], rentalCategoryVersion: [],
      businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant_001', categoryCode: 'camera', status: 'ACTIVE',
        categoryVersionId: 'bound-rule-category', categoryAdoptionRevision: 1 }] } });
  const definition = h.clone(h.b.core.listCategories().find(row => row.code === 'camera'));
  h.state.rentalCategoryVersion.push({ id: 'bound-rule-category', categoryCode: 'camera', structureVersion: 1, status: 'published', definition });
  h.b.business.configStore = new (require('../apps/api/src/modules/rental-core/rental-business-config.repository').RentalBusinessConfigRepository)(h.db);
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const source = h.clone(h.state.rentalRuleVersion[0]);
  h.cached.ruleVersions = [await runWithRequestIdentity({ userId: 'user-a', tenantId: 'tenant_001', workspaceId: 'workspace-a', audience: 'operator' },
    () => h.b.business.configStore.loadRuleVersionById('tenant_001', 'workspace-a', source.id))];
  // This older store understands scalar predicates, but not Prisma's JSON
  // equals filter. Implement that exact predicate for this fixture's rule CAS;
  // a mismatch returns count zero. Do not remove or relax the production CAS.
  const transaction = h.db.$transaction;
  h.db.$transaction = (work, options) => transaction(async tx => {
    const update = tx.rentalRuleVersion.updateMany.bind(tx.rentalRuleVersion);
    tx.rentalRuleVersion.updateMany = async args => {
      if (!args.where.config?.equals) return update(args);
      const { config, ...where } = args.where, row = await tx.rentalRuleVersion.findFirst({ where });
      if (!row || requestFingerprint(row.config) !== requestFingerprint(config.equals)) return { count: 0 };
      return update({ ...args, where });
    };
    return work(tx);
  }, options);
  const { credentials, ...dependencies } = h.dependencies;
  const { composeRequestBoundOpeningRuleDraftSave } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  const save = composeRequestBoundOpeningRuleDraftSave(dependencies, { enabled: true, audience: 'operator',
    host: { holderId: 'opening-r1-worker', leaseMs: 120000 } });
  return { ...h, source, save, saveCommand: { ...h.command, changeReason: 'Human reviewed original rule draft change' } };
}

test('AIN14-16 human rule Task consumer resolves original proposals, reviews all six fields and saves or observes the same Core draft', async () => {
  const shared = require('@rental-os/shared'), Module = require('node:module'), fs = require('node:fs'), path = require('node:path');
  const { composeRequestBoundTaskRuleDraft, AiTaskRuleDraftController } = require('../apps/api/src/modules/ai-native/task-rule-draft.application');
  const dto = require('../apps/api/src/modules/ai-native/task-rule-draft.dto');
  const { plainToInstance } = require('class-transformer'), { validateSync } = require('class-validator');
  const { createTaskRuleDraftSession, taskRuleDraftStore } = require('../apps/admin/src/features/ai-native/task-rule-draft-session');
  const httpFile = require.resolve('../apps/admin/src/api/http'), queryFile = require.resolve('../apps/admin/src/app/queryClient');
  const previousHttp = Module._cache[httpFile], previousQuery = Module._cache[queryFile];
  const sessionSignal = new AbortController().signal, calls = [], memory = new Map();
  let controller, h, storageKey, reference;
  Module._cache[queryFile] = { id: queryFile, filename: queryFile, loaded: true, exports: { currentSessionSignal: () => sessionSignal, currentSessionEpoch: () => 1 } };
  Module._cache[httpFile] = { id: httpFile, filename: httpFile, loaded: true, exports: { http: {
    post: async (url, body, config) => {
      const action = url.split('/').at(-1); calls.push({ url, body: structuredClone(body), signal: config.signal, timeout: config.timeout });
      assert.equal(url, `/${shared.AI_TASK_RULE_DRAFT_HTTP.basePath}/${shared.AI_TASK_RULE_DRAFT_HTTP[action]}`);
      assert.equal(config.timeout, 12000); assert.equal(config.signal.aborted, false);
      if (action === 'save') assert.deepEqual(JSON.parse(memory.get(storageKey)), reference, 'only original ids are preserved before dispatch');
      const type = { list: dto.AiTaskRuleDraftListDto, review: dto.AiTaskRuleDraftReviewDto, save: dto.AiTaskRuleDraftSaveDto, operation: dto.AiTaskRuleDraftReferenceDto }[action];
      assert.deepEqual(validateSync(plainToInstance(type, body), { forbidUnknownValues: true }), []);
      const request = { ...h.request, method: 'POST', originalUrl: '/api' + url, url: '/api' + url };
      await h.dependencies.guard.canActivate({ getClass: () => AiTaskRuleDraftController, getHandler: () => controller[action],
        switchToHttp: () => ({ getRequest: () => request }) });
      return { data: { data: await controller[action](request, body), requestId: 'synthetic-rule-consumer' } };
    }
  } } };
  try {
    const { aiTaskRuleDraftApi } = require('../apps/admin/src/api/aiTaskRuleDraft');
    assert.match(require.resolve('@rental-os/shared'), /[\\/]shared[\\/]dist[\\/]index\.js$/, 'human consumers use the compiled formal package export');
    assert.equal(JSON.parse(fs.readFileSync(path.join(path.dirname(require.resolve('@rental-os/shared')), '../package.json'), 'utf8')).version, '0.1.0');
    assert.equal(shared.aiTaskRuleDraftReference.safeParse({ taskId: 'task-a', runId: 'run-a', stepId: 'step-a', registrationRef: 'untrusted' }).success, false);
    assert.deepEqual(shared.AI_TASK_RULE_DRAFT_SCHEMAS.AiTaskRuleDraftReference.required, ['taskId', 'runId', 'stepId']);
    const after = [false, false, true, true, true, false];
    for (const draftSource of [false, true]) {
      // Explicit historical source has disabled manual review and an enabled
      // weather exception. The R1 corrects both; Core forbids keeping those
      // values. No validator, permission or assertion is relaxed for this case.
      h = await originalRuleDraftSaveSetup(draftSource ? 'human-edit' : 'human-restore', draftSource, {
        changes: shared.AI_TASK_RULE_DRAFT_FIELDS.map((field, i) => ({ field, value: after[i] })),
        before: { 'fulfillment.pickupInspectionRequired': true, 'fulfillment.returnInspectionRequired': true,
          'fulfillment.evidenceRequired': false, 'fulfillment.allowDifferentReturnLocation': false,
          'damage.manualReviewRequired': false, 'cancellation.weatherExceptionEnabled': true,
          'qualification.documentTypes': ['historical-proof'], 'qualification.minimumValidityDays': 1 }
      });
      const { credentials, ...original } = h.dependencies;
      const application = composeRequestBoundTaskRuleDraft({ original, saveEnabled: true,
        host: { holderId: 'human-rule-worker', leaseMs: 120000 } });
      controller = new AiTaskRuleDraftController(application);
      const originalAi = h.clone(Object.fromEntries(Object.entries(h.state).filter(([name]) => name.startsWith('ai'))));
      storageKey = `synthetic-original-rule-${draftSource}`;
      const storage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
      const store = taskRuleDraftStore(storageKey, storage); let current = true;
      let session = createTaskRuleDraftSession({ taskId: h.state.aiTask[0].id, current: () => current, api: aiTaskRuleDraftApi, store, changed() {} });
      await session.list(); assert.equal(session.view.items.length, 1); reference = session.view.items[0].reference;
      assert.deepEqual(Object.keys(reference), ['taskId', 'runId', 'stepId']);
      assert.deepEqual(session.view.items[0].changes.map(c => c.field), [...shared.AI_TASK_RULE_DRAFT_FIELDS]);
      const readOnly = h.clone(h.state); await session.review(reference, 'Human confirmed all original changes');
      const review = session.view.review;
      assert.equal(review.mode, draftSource ? 'edit_original_draft' : 'restore_to_new_draft');
      assert.deepEqual(review.changes.map(c => c.after), after);
      assert.deepEqual(review.normalizations.map(c => c.field), ['qualification.documentTypes', 'qualification.minimumValidityDays']);
      assert.deepEqual(h.state, readOnly); assert.equal(memory.has(storageKey), false);
      const React = require('react'), { renderToStaticMarkup } = require('react-dom/server');
      const { RuleDraftDifferences } = require('../apps/admin/src/features/ai-native/TaskRuleDraftView');
      const markup = renderToStaticMarkup(React.createElement(RuleDraftDifferences, { review, translate: text => text }));
      assert.equal((markup.match(/<dt>/g) ?? []).length, 8); assert.match(markup, /Core 规范化/);
      for (const label of ['交付检查', '归还检查', '履约凭证', '异地归还', '损坏人工审核', '天气例外', '资质材料类型', '资质最短有效天数']) assert.ok(markup.includes(label), label);
      assert.doesNotMatch(markup, /registrationRef|reviewHash|historical-proof.*input/);
      if (!draftSource) {
        let lost = false; h.control.beforeCommit = draft => {
          if (!lost && draft.operationLog.length === 1 && h.state.operationLog.length === 0) {
            lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
          }
        };
        await assert.rejects(session.save(), error => error.getResponse().code === 'AI_RESULT_UNKNOWN');
        assert.equal(lost, true); assert.equal(session.view.review, null); assert.deepEqual(session.view.pending, reference);
        assert.deepEqual(JSON.parse(memory.get(storageKey)), reference);
        const saves = calls.filter(c => c.url.endsWith('/save')).length;
        await assert.rejects(session.save()); assert.equal(calls.filter(c => c.url.endsWith('/save')).length, saves);
        session.dispose(); session = createTaskRuleDraftSession({ taskId: reference.taskId, current: () => current, api: aiTaskRuleDraftApi, store, changed() {} });
        assert.deepEqual(session.view.pending, reference);
        await session.operation(reference); assert.equal(session.view.operation.operation.state, 'committed');
        assert.deepEqual(calls.at(-1).body, reference, 'recovery sends ids only, no caller hashes/reason/config');
      } else await session.save();
      const committed = session.view.operation.operation;
      assert.equal(committed.state, 'committed'); assert.equal(committed.receiptId, h.state.operationLog[0].id);
      assert.equal(committed.publication, 'not_performed_by_operation'); assert.equal(session.view.pending, null); assert.equal(memory.has(storageKey), false);
      const saved = h.state.rentalRuleVersion.find(row => row.id === committed.draft.id);
      assert.equal(saved.status, 'draft'); const expected = h.clone(h.source.config);
      for (const c of review.changes) { const [block, field] = c.field.split('.'); expected[block][field] = c.after; }
      expected.qualification.documentTypes = []; expected.qualification.minimumValidityDays = 0;
      assert.deepEqual(saved.config, expected); assert.deepEqual(committed.changes, review.changes); assert.deepEqual(committed.normalizations, review.normalizations);
      assert.deepEqual(h.clone(Object.fromEntries(Object.entries(h.state).filter(([name]) => name.startsWith('ai')))), originalAi);
      assert.equal(h.state.operationLog.length, 1); assert.equal(h.calls.writes, 0);
      const observed = h.clone(h.state); await session.operation(reference); assert.equal(session.view.operation.operation.receiptId, committed.receiptId);
      assert.deepEqual(h.state, observed);
      const beforeDenied = h.clone(h.state);
      await assert.rejects(controller.operation(h.request, { ...reference, stepId: 'foreign-step' }));
      h.b.h.identity.user.permissions = h.b.h.identity.user.permissions.filter(p => p !== 'rental-os:rules:manage');
      await assert.rejects(controller.review(h.request, { ...reference, changeReason: 'unauthorized review' }));
      assert.deepEqual(h.state, beforeDenied); current = false; session.dispose();
    }
    const source = file => fs.readFileSync(path.join(process.cwd(), file), 'utf8');
    assert.match(source('apps/api/src/app.module.ts'), /AI_NATIVE_TASK_RULE_DRAFT_PROVIDER/);
    assert.match(source('apps/api/src/app.module.ts'), /AiTaskRuleDraftController/);
    assert.match(source('apps/api/src/modules/ai-native/ai-native-application.providers.ts'), /provide: AI_TASK_RULE_DRAFT_REQUESTS/);
    assert.match(source('apps/api/src/contracts/openapi-document.ts'), /AI_TASK_RULE_DRAFT_CONTRACTS\[action\]/);
    assert.match(source('apps/admin/src/features/ai-native/TaskCenterPage.tsx'), /<TaskRuleDraft/);
    assert.match(source('apps/admin/src/features/ai-native/TaskRuleDraft.tsx'), /<ConfirmAction/);
    assert.doesNotMatch(source('apps/admin/src/features/ai-native/TaskRuleDraft.tsx'), /registrationRef|reviewHash/);
  } finally {
    if (previousHttp) Module._cache[httpFile] = previousHttp; else delete Module._cache[httpFile];
    if (previousQuery) Module._cache[queryFile] = previousQuery; else delete Module._cache[queryFile];
  }
});

test('AIN14-16 rule journal corruption and failed persistence block saves without replacing an original locator', async () => {
  const { createTaskRuleDraftSession, taskRuleDraftStore } = require('../apps/admin/src/features/ai-native/task-rule-draft-session');
  const reference = { taskId: 'task-a', runId: 'run-a', stepId: 'step-a' };
  let writes = 0, raw = '{invalid';
  const store = taskRuleDraftStore('key', { getItem: () => raw, setItem: (_key, value) => { raw = value; }, removeItem: () => { raw = null; } });
  const api = { list: async () => ({ taskId: reference.taskId, items: [{ reference }], saveEnabled: true }),
    review: async () => ({ reference, changeReason: 'Human reason', reviewHash: 'a'.repeat(64) }), save: async () => { writes++; } };
  const session = createTaskRuleDraftSession({ taskId: reference.taskId, current: () => true, api, store, changed() {} });
  assert.equal(session.view.locatorInvalid, true); await session.list(); await session.review(reference, 'Human reason');
  await assert.rejects(session.save()); assert.equal(writes, 0); assert.equal(raw, '{invalid');
  raw = JSON.stringify({ ...reference, stepId: 'old-step' });
  assert.throws(() => store.write(reference), /AI_RESULT_UNKNOWN/); assert.equal(JSON.parse(raw).stepId, 'old-step');
  raw = null;
  const broken = taskRuleDraftStore('key', { getItem: () => null, setItem() {}, removeItem() {} });
  const unsent = createTaskRuleDraftSession({ taskId: reference.taskId, current: () => true, api, store: broken, changed() {} });
  await unsent.list(); await unsent.review(reference, 'Human reason'); await assert.rejects(unsent.save(), /AI_OPERATION_LOCATOR_UNAVAILABLE/);
  assert.equal(writes, 0); session.dispose(); unsent.dispose();
});

test('AIN14-16 original rule proposal saves a reviewed Core draft and recovers one lost operation without publishing or changing the original Task', async () => {
  for (const draftSource of [false, true]) {
    const h = await originalRuleDraftSaveSetup(draftSource ? 'draft' : 'history', draftSource);
    const aiRows = () => h.clone(Object.fromEntries(Object.entries(h.state).filter(([name]) => name.startsWith('ai'))));
    const originalAi = aiRows(), originalCache = h.clone(h.cached.ruleVersions);
    const review = await h.save.reviewDraft(h.request, h.saveCommand), reference = { ...h.saveCommand, reviewHash: review.review.reviewHash };
    assert.deepEqual(review.review.normalizations, [{ field: 'qualification.minimumValidityDays', before: 1, after: 0, source: 'original_core_normalization' }]);
    assert.equal(review.review.mode, draftSource ? 'edit_original_draft' : 'restore_to_new_draft');
    assert.equal(review.review.persistence, 'not_attempted'); assert.equal(h.state.operationLog.length, 0);
    assert.equal((await h.save.readDraftOperation(h.request, reference)).operation.state, 'not_observed');
    await assert.rejects(h.save.saveDraft(h.request, reference), error => error.code === 'AI_INVALID_INPUT');
    const intent = { ...reference, decision: 'save_original_business_draft' }; let lost = false;
    h.control.beforeCommit = draft => { if (!lost && draft.operationLog.length === 1 && h.state.operationLog.length === 0) {
      lost = true; h.control.loseReply = true; h.control.beforeCommit = null;
    } };
    await assert.rejects(h.save.saveDraft(h.request, intent), error => error.code === 'AI_RESULT_UNKNOWN');
    assert.equal(lost, true); assert.equal(h.state.operationLog.length, 1);
    const current = h.clone(h.state), observed = await h.save.readDraftOperation(h.request, reference);
    assert.equal(observed.operation.state, 'committed'); assert.equal(observed.operation.publication, 'not_performed_by_operation');
    const saved = h.state.rentalRuleVersion.find(row => row.id === observed.operation.draft.id);
    assert.equal(saved.status, 'draft'); assert.equal(saved.config.fulfillment.evidenceRequired, true);
    const expected = h.clone(h.source.config); expected.fulfillment.evidenceRequired = true; expected.qualification.minimumValidityDays = 0;
    assert.deepEqual(saved.config, expected); assert.deepEqual(observed.operation.normalizations, review.review.normalizations);
    if (draftSource) { assert.equal(saved.id, h.source.id); assert.equal(h.state.rentalRuleVersion.length, 1); assert.equal(h.state.rentalRuleVersionAudit.length, 0); }
    else { assert.notEqual(saved.id, h.source.id); assert.equal(saved.restoredFromVersion, h.source.version);
      assert.deepEqual(h.state.rentalRuleVersion.find(row => row.id === h.source.id), h.source);
      assert.equal(h.state.rentalRuleVersionAudit.length, 1); assert.equal(h.state.rentalRuleVersionAudit[0].action, 'restore'); }
    assert.deepEqual(h.state, current); assert.deepEqual(aiRows(), originalAi); assert.deepEqual(h.cached.ruleVersions, originalCache);
    const replay = await h.save.saveDraft(h.request, intent);
    assert.equal(replay.replayed, true); assert.equal(replay.operation.receiptId, observed.operation.receiptId);
    assert.deepEqual(h.state, current); assert.equal(h.calls.writes, 0); assert.equal(h.state.aiGatewayInvocation.length, 0);
  }
});

test('AIN14-16 rule draft save requires current edit permission and renewed full-config review and rolls back missing operation evidence', async () => {
  const h = await originalRuleDraftSaveSetup('conflict', true), review = await h.save.reviewDraft(h.request, h.saveCommand);
  const intent = { ...h.saveCommand, reviewHash: review.review.reviewHash, decision: 'save_original_business_draft' };
  h.state.rentalRuleVersion[0].config.payment.quoteValidityMinutes = 37;
  const changed = h.clone(h.state);
  await assert.rejects(h.save.saveDraft(h.request, intent), error => error.code === 'AI_REVISION_CONFLICT');
  assert.deepEqual(h.state, changed); assert.equal(h.state.operationLog.length, 0);
  const fresh = await h.save.reviewDraft(h.request, h.saveCommand), freshIntent = { ...intent, reviewHash: fresh.review.reviewHash };
  assert.notEqual(freshIntent.reviewHash, intent.reviewHash);
  const permissions = [...h.b.h.identity.user.permissions];
  h.b.h.identity.user.permissions = permissions.filter(permission => permission !== 'rental-os:rules:manage');
  await assert.rejects(h.save.saveDraft(h.request, freshIntent)); assert.equal(h.state.operationLog.length, 0);
  h.b.h.identity.user.permissions = permissions;
  const previous = h.control.beforeWrite;
  h.control.beforeWrite = async (name, args, data) => { await previous?.(name, args, data);
    if (name === 'operationLog') throw Error('Synthetic missing bound rule operation evidence'); };
  await assert.rejects(h.save.saveDraft(h.request, freshIntent), error => error.code === 'AI_RESULT_UNKNOWN');
  h.control.beforeWrite = previous;
  assert.deepEqual(h.state, changed); assert.equal((await h.save.readDraftOperation(h.request,
    { ...h.saveCommand, reviewHash: freshIntent.reviewHash })).operation.state, 'not_observed');
  const saved = await h.save.saveDraft(h.request, freshIntent);
  assert.equal(saved.operation.state, 'committed'); assert.equal(h.state.rentalRuleVersion[0].config.payment.quoteValidityMinutes, 37);
  assert.equal(h.state.rentalRuleVersion[0].config.fulfillment.evidenceRequired, true);
  assert.equal(h.state.rentalRuleVersion[0].status, 'draft'); assert.equal(h.state.operationLog.length, 1);
});

// Begin original calendar Core draft-preview owned cases.
async function originalCalendarCorePreviewSetup(suffix) {
  const h = await ruleCalendarOpeningSetup(`core-preview-${suffix}`);
  const started = await h.app.startSections(h.request, { original: h.original, sections: h.sections });
  assert.equal(started.outcome.outcome.status, 'succeeded', JSON.stringify(started));
  const { composeOpeningCalendarDraftPreview } = require('../apps/api/src/modules/ai-native/scenes/opening-calendar-draft.composition');
  const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const context = { ...h.b.quoteConfiguration, category: h.b.core.listCategories().find(row => row.code === 'camera') };
  // New preview fixture only: seed Core's ordinary calendar cache from the SAME
  // original Prisma-shaped row. This proves actual preview selection, not SQL,
  // draft persistence or an absorbing-store write. All save ports throw.
  const cached = runWithRequestIdentity({ userId: 'user-a', tenantId: 'tenant_001', workspaceId: 'workspace-a' },
    () => h.b.business.state('tenant_001', context));
  const original = h.clone(h.state.rentalBusinessCalendar[0]);
  const published = { ...h.clone(original), id: 'calendar-fields-published', version: 'calendar-v0', status: 'published', revision: 2 };
  published.days[0].name = 'Original published day';
  h.state.rentalBusinessCalendar.push(h.clone(published));
  cached.calendars = [h.clone(published), h.clone(original)];
  const calls = { previews: 0, writes: 0, routes: [], identities: [], afterPreview: null };
  h.b.business.configStore.upsertCalendar = async () => { calls.writes++; throw Error('preview must not save a business draft'); };
  h.b.business.applyCalendarRangeOverride = async () => { calls.writes++; throw Error('preview must not apply calendar ranges'); };
  h.b.business.publishCalendar = async () => { calls.writes++; throw Error('preview must not publish'); };
  const actualPreview = h.b.business.previewCalendarRangeOverride.bind(h.b.business);
  h.b.business.previewCalendarRangeOverride = async (...args) => {
    calls.previews++; calls.identities.push(h.clone(getRequestIdentity()));
    const result = await actualPreview(...args);
    await calls.afterPreview?.();
    return result;
  };
  const canActivate = h.dependencies.guard.canActivate.bind(h.dependencies.guard);
  h.dependencies.guard.canActivate = async execution => {
    calls.routes.push({ method: execution.switchToHttp().getRequest().method, path: execution.switchToHttp().getRequest().originalUrl });
    return canActivate(execution);
  };
  const preview = composeOpeningCalendarDraftPreview(h.dependencies, { holderId: 'opening-r1-worker', leaseMs: 120000 });
  const command = { original: h.original, registrationRef: started.references[1].registrationRef };
  return { ...h, preview, command, cached, calls };
}

test('AIN14 original calendar Core preview consumes the canonical R1 proposal without draft-save or publication claims', async () => {
  const h = await originalCalendarCorePreviewSetup('normal');
  h.b.h.identity.user.permissions.push('rental-os:calendar:edit');
  const before = h.clone(h.state), calendars = h.clone(h.cached.calendars);
  const first = await h.preview.previewDraft(h.command);
  assert.deepEqual(first.calendar, { targetId: 'calendar-fields-a', year: 2026, version: 'calendar-v1', baseRevision: 3 });
  assert.equal(first.preview.days[0].current.name, 'Original day');
  assert.equal(first.preview.days[0].after.name, 'Proposed day');
  assert.equal(first.preview.days[0].after.businessStatus, 'closed');
  assert.equal(first.preview.days[0].after.closed, true);
  assert.equal(first.businessDraft, 'not_created'); assert.equal(first.approval, 'not_granted');
  assert.equal(first.publication, 'not_attempted'); assert.equal(first.execution, 'read_only_no_lease_or_dispatch');
  assert.deepEqual(first.draftSave, { status: 'unavailable', reason: 'original_version_bound_operation_receipt_not_available' });
  assert.equal(first.validation, 'original_core_preview_only_apply_validation_not_attempted');
  assert.equal(first.overrideConfirmation, 'not_required_by_preview');
  const second = await h.preview.previewDraft(h.command);
  assert.deepEqual(second, first); assert.equal(h.calls.previews, 2); assert.equal(h.calls.writes, 0);
  assert.ok(h.calls.routes.some(row => row.method === 'POST' && row.path === '/api/rental/v1/calendars/2026/days/range-preview'));
  assert.ok(h.calls.identities.every(identity => identity.userId === 'user-a' && identity.tenantId === 'tenant_001' && identity.workspaceId === 'workspace-a'));
  assert.deepEqual(h.clone(h.state), before); assert.deepEqual(h.clone(h.cached.calendars), calendars);
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiProposal.length, 2);
  // Same revision in a newer editable version is NOT permission to rebase the
  // original proposal. The actual Core annual selector must be checked too.
  const newer = h.clone(h.cached.calendars[1]); newer.version = '1.1'; newer.id = 'calendar-newer';
  h.cached.calendars.push(newer);
  await assert.rejects(h.preview.previewDraft(h.command), error => error.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.calls.previews, 3); assert.equal(h.calls.writes, 0);
  assert.deepEqual(h.clone(h.state), before);
});

test('AIN14 original calendar Core preview rejects view-only, foreign input, stale rows and late revocation', async () => {
  const h = await originalCalendarCorePreviewSetup('denials'), permissions = [...h.b.h.identity.user.permissions];
  const before = h.clone(h.state), calendars = h.clone(h.cached.calendars);
  // Existing history/rules/opening read permission does not authorize the
  // human calendar edit-preview route; no manager or privilege is fabricated.
  await assert.rejects(h.preview.previewDraft(h.command)); assert.equal(h.calls.previews, 0);
  h.b.h.identity.user.permissions = [...permissions, 'rental-os:calendar:edit'];
  await assert.rejects(h.preview.previewDraft({ ...h.command, year: 2027 }), error => error.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.preview.previewDraft({ ...h.command, registrationRef: 'foreign-registration' }));
  assert.equal(h.calls.previews, 0); assert.deepEqual(h.clone(h.state), before);
  h.state.rentalBusinessCalendar[0].revision = 4;
  await assert.rejects(h.preview.previewDraft(h.command)); assert.equal(h.calls.previews, 0);
  h.state.rentalBusinessCalendar[0].revision = 3;
  // Same revision but a changed before-value still cannot replace source evidence.
  h.state.rentalBusinessCalendar[0].days[0].name = 'Unreviewed current day';
  await assert.rejects(h.preview.previewDraft(h.command), error => error.code === 'AI_REVISION_CONFLICT');
  h.state.rentalBusinessCalendar[0].days[0].name = 'Original day';
  h.calls.afterPreview = () => { h.b.h.identity.user.permissions = permissions; };
  await assert.rejects(h.preview.previewDraft(h.command));
  assert.equal(h.calls.previews, 1); assert.equal(h.calls.writes, 0);
  assert.deepEqual(h.clone(h.state), before); assert.deepEqual(h.clone(h.cached.calendars), calendars);
  assert.equal(h.state.aiGatewayInvocation.length, 0); assert.equal(h.state.aiTask.length, 1); assert.equal(h.state.aiProposal.length, 2);
});
// End original calendar Core draft-preview owned cases.

// Begin original self-service calendar owned cases.
async function originalSelfServiceCalendarSetup(suffix, renameOnly = false, editor = true) {
  const h = await ruleCalendarOpeningSetup(`self-service-${suffix}`);
  if (renameOnly) {
    h.state.rentalBusinessCalendar[0].days[0].businessStatus = 'self_service';
    h.state.rentalBusinessCalendar[0].days[0].closed = true;
  }
  const section = { ...h.sections[1], changes: [{ field: 'name', value: 'Explicit self-service day' },
    ...(renameOnly ? [] : [{ field: 'businessStatus', value: 'self_service' }, { field: 'closed', value: true }])] };
  const before = h.clone(h.state.rentalBusinessCalendar);
  const preview = await h.app.previewSections(h.request, { original: h.original, sections: [section] });
  const started = await h.app.startSections(h.request, { original: h.original, sections: [section] });
  assert.equal(started.outcome.outcome.status, 'succeeded', JSON.stringify(started));
  assert.equal(h.state.aiProposal.length, 1); assert.equal(h.state.aiStep.length, 1);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED'); assert.equal(h.state.aiStep[0].effect, 'COMMITTED');
  assert.deepEqual(h.clone(h.state.rentalBusinessCalendar), before);
  // Fresh R1 execution keeps its original authorization binding. The separate
  // historical/Core preview must resolve this new fixture's CURRENT edit grant.
  if (editor) h.b.h.identity.user.permissions.push('rental-os:calendar:edit');
  const { composeOpeningCalendarDraftPreview } = require('../apps/api/src/modules/ai-native/scenes/opening-calendar-draft.composition');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const context = { ...h.b.quoteConfiguration, category: h.b.core.listCategories().find(row => row.code === 'camera') };
  const cached = runWithRequestIdentity({ userId: 'user-a', tenantId: 'tenant_001', workspaceId: 'workspace-a' },
    () => h.b.business.state('tenant_001', context));
  const row = h.clone(h.state.rentalBusinessCalendar[0]), published = { ...h.clone(row), id: 'published-self-service-base', version: 'calendar-v0', status: 'published', revision: 2 };
  published.days[0].name = 'Original published calendar';
  h.state.rentalBusinessCalendar.push(h.clone(published)); cached.calendars = [h.clone(published), h.clone(row)];
  let coreCalls = 0, writes = 0;
  const actual = h.b.business.previewCalendarRangeOverride.bind(h.b.business);
  h.b.business.previewCalendarRangeOverride = async (...args) => { coreCalls++; return actual(...args); };
  h.b.business.configStore.upsertCalendar = async () => { writes++; throw Error('AI proposal/preview must not save calendar'); };
  h.b.business.applyCalendarRangeOverride = async () => { writes++; throw Error('AI proposal/preview must not apply range'); };
  h.b.business.publishCalendar = async () => { writes++; throw Error('AI proposal/preview must not publish'); };
  const draft = composeOpeningCalendarDraftPreview(h.dependencies, { holderId: 'opening-r1-worker', leaseMs: 120000 });
  return { ...h, section, preview, draft, cached, counts: () => ({ coreCalls, writes }),
    command: { original: h.original, registrationRef: started.references[0].registrationRef } };
}

test('AIN14 self-service original field difference reaches normal R1 and Core preview without closing all fulfillment or publishing', async () => {
  for (const renameOnly of [false, true]) {
    const h = await originalSelfServiceCalendarSetup(renameOnly ? 'rename' : 'switch', renameOnly);
    const material = h.preview.sections[0];
    assert.equal(material.baseRevision, 3); assert.equal(material.fieldRevision, 'calendar_original_revision');
    assert.deepEqual(material.changes.map(change => change.field), renameOnly ? ['name'] : ['name', 'businessStatus', 'closed']);
    const before = h.clone(h.state), calendars = h.clone(h.cached.calendars);
    const result = await h.draft.previewDraft(h.command);
    assert.equal(result.preview.days[0].after.businessStatus, 'self_service');
    assert.equal(result.preview.days[0].after.closed, true); assert.equal(result.preview.days[0].after.name, 'Explicit self-service day');
    assert.equal(result.preview.days[0].current.businessStatus, renameOnly ? 'self_service' : 'open');
    assert.equal(result.businessDraft, 'not_created'); assert.equal(result.approval, 'not_granted'); assert.equal(result.publication, 'not_attempted');
    assert.equal(result.draftSave.status, 'unavailable'); assert.equal(result.execution, 'read_only_no_lease_or_dispatch');
    assert.deepEqual(h.counts(), { coreCalls: 1, writes: 0 });
    assert.deepEqual(h.clone(h.state), before); assert.deepEqual(h.clone(h.cached.calendars), calendars);
    assert.equal(h.state.aiGatewayInvocation.length, 0);
  }
});

test('AIN14 self-service contradictory manual-closed evidence and missing current calendar edit permission remain blocked', async () => {
  const h = await ruleCalendarOpeningSetup('self-service-contradictions'), before = h.clone(h.state);
  const section = { ...h.sections[1], changes: [{ field: 'businessStatus', value: 'self_service' }, { field: 'closed', value: false }] };
  await assert.rejects(h.app.startSections(h.request, { original: h.original, sections: [section] }));
  assert.deepEqual(h.clone(h.state), before); assert.equal(h.state.aiProposal.length, 0); assert.equal(h.state.aiStep.length, 0);
  // A malformed current self-service row is not repaired by renaming or by
  // dropping its legacy closed fact; the original source remains explicit.
  h.state.rentalBusinessCalendar[0].days[0].businessStatus = 'self_service';
  const damaged = h.clone(h.state);
  await assert.rejects(h.app.previewSections(h.request, { original: h.original,
    sections: [{ ...h.sections[1], changes: [{ field: 'name', value: 'Cannot disguise contradictory source' }] }] }));
  assert.deepEqual(h.clone(h.state), damaged); assert.equal(h.state.aiProposal.length, 0);
  const readOnly = await originalSelfServiceCalendarSetup('read-only', false, false), frozen = readOnly.clone(readOnly.state);
  await assert.rejects(readOnly.draft.previewDraft(readOnly.command));
  assert.deepEqual(readOnly.clone(readOnly.state), frozen); assert.deepEqual(readOnly.counts(), { coreCalls: 0, writes: 0 });
});
// End original self-service calendar owned cases.

test('original settings change receipt remains readable after expiry and config change, without execution authority', async () => {
  const h = await settingsInputSetup({ normal: true });
  h.control.now = new Date('2026-10-08T12:00:00Z');
  h.current.settingsRevision = 9;
  h.current.settings.notifications = { enabledEvents: [], editableChannels: ['email'] };
  const before = h.clone(h.state);
  const receipt = await h.app.readChangeReceipt({ changeKey: 'original-key' });
  assert.equal(receipt.state, 'prepared_not_approved');
  assert.equal(receipt.change.changeHash, h.reference.changeHash);
  assert.equal(receipt.change.baseRevision, 1);
  assert.deepEqual(receipt.change.diff['notifications.editableChannels'], { before: ['email'], after: ['sms'] });
  assert.deepEqual(h.clone(h.state), before);
  h.identity.user.permissions.length = 0;
  await assert.rejects(h.app.readChangeReceipt({ changeKey: 'original-key' }));
});
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
  // Native phase persistence references this task-scoped input row. The
  // settings step uses the original change ID, not a second random input ID.
  assert.equal(h.state.aiTaskActionInput[0].id, h.reference.changeId);
  assert.equal(h.state.aiTaskActionInput[0].id, input.inputRef);
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

test('settings commit does not borrow a replacement lease held by the same host', async () => {
  const h = await settingsWaitingSetup(), { waiting, input, signal } = h;
  assert.equal((await waiting.execute(input, signal)).kind, 'paused');
  const observed = await waiting.readWaiting(input);
  await waiting.application.decide({ ...observed.reference, decision: 'approve' });
  let writes = 0;
  h.dependencies.core.commitNotificationSettings = async (_tenant, notifications) => {
    writes++; h.current.settingsRevision++; h.current.settings.notifications = structuredClone(notifications);
    return structuredClone(h.current);
  };
  h.dependencies.core.refreshCommittedBusinessSettings = async () => {};
  const transaction = h.db.$transaction;
  let replaced = false, replacementObserved = false;
  // Exact durable state of a same-holder reacquisition, injected after the
  // executor's last old-lease check and before the participant takes its locks.
  // The rows/SQL are substitutes here; the application and participant are real.
  h.db.$transaction = (work, options) => transaction(tx => work({ ...tx,
    rentalApprovedSettingsOperation: { ...tx.rentalApprovedSettingsOperation,
      findUnique: async query => {
        if (!replaced) {
          replaced = true;
          const current = h.state.aiRun[0];
          assert.equal((await tx.aiRun.updateMany({ where: { id: current.id }, data: {
            revision: current.revision + 1, fencingToken: current.fencingToken.plus(1)
          } })).count, 1);
          const replacement = await tx.aiRun.findFirst({ where: { id: current.id } });
          assert.equal(replacement.revision, input.lease.revision + 1);
          assert.equal(replacement.fencingToken.toFixed(0), String(BigInt(input.lease.fencingToken) + 1n));
          replacementObserved = true;
        }
        return tx.rentalApprovedSettingsOperation.findUnique(query);
      }
    }
  }), options);
  const result = await waiting.execute(input, signal);
  assert.equal(replaced, true);
  assert.equal(replacementObserved, true, 'the exact replacement tuple must be observed before participant validation');
  assert.notEqual(result.kind, 'succeeded', 'an old callback cannot adopt the current same-holder fence');
  assert.equal(writes, 0);
  assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  assert.equal(h.state.aiApprovalConsumption.length, 0);
});

test('original rejected settings confirmation reconciles without a second execution phase', async () => {
  for (const cancelled of [false, true]) {
    const h = await settingsNormalHostSetup(), root = h.rebuild();
    assert.equal((await root.application.start({ taskId: 'task-a', runId: 'run-a' })).outcome.status, 'paused');
    const first = h.state.aiTaskExecutionPhaseReceipt.find(row => row.kind === 'confirmation');
    assert.ok(first);
    await root.settings.application.decide({ draftVersion: 'ain-approved-settings-draft-1', taskId: 'task-a',
      proposalId: first.proposalId, proposalRevision: first.proposalRevision,
      reviewedPayloadHash: first.reviewedPayloadHash, decision: 'reject' });
    if (cancelled) await root.application.requestCancel({ taskId: 'task-a', expectedRevision: h.state.aiTask[0].revision });
    const current = h.state.aiRun[0];
    const lease = await root.authorization.tasks.claimRecoveryRun({ taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', leaseMs: 100000,
      expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: current.revision,
      expectedFencingToken: current.fencingToken.toFixed(0) });
    const { scopeId: _scopeId, ...binding } = first.payload.binding;
    const before = h.clone(h.state);
    const result = await root.settings.reconcile({ ...binding, lease });
    assert.equal(result.kind, 'failed');
    assert.equal(result.errorCode, 'AI_APPROVAL_REJECTED');
    assert.deepEqual(h.clone(h.state), before, 'observe original rejection, do not create a phase or consume an approval');
    assert.equal(h.state.aiApprovalConsumption.length, 0);
    assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
    const start = h.state.aiTaskExecutionPhaseStart[0];
    h.state.aiTaskExecutionPhaseStart.push({ ...h.clone(start), id: 'later-settings-phase', sequence: 2,
      previousReceiptId: first.id, decisionRef: h.state.aiApproval[0].id });
    assert.equal((await root.settings.reconcile({ ...binding, lease })).kind, 'unknown', 'a later started phase breaks the no-submission witness');
  }
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
  const { requestBoundOriginalModelHarness } = require('./fixtures/ai-native/lane-a-original-model.cjs');
  const modelHost = await requestBoundOriginalModelHarness('quote_clarification');
  const sharedCore = Object.assign(Object.create(modelHost.requestDependencies.core), h.dependencies.core);
  const modelDependencies = { ...modelHost.requestDependencies, db: h.db, auth: h.dependencies.auth,
    guard: h.dependencies.guard, core: sharedCore, subscriptions: h.dependencies.subscriptions, clock: h.dependencies.clock };
  const { credentials: _settingsCredentials, ...settingsDependencies } = h.dependencies;
  const modelOptions = { ...modelHost.options, settingsTask: { dependencies: { ...settingsDependencies, core: sharedCore },
    configuration: { host: { holderId: 'worker-a', leaseMs: 100000 }, task: {
      taskId: 'task-a', runId: 'run-a', registrationRef: 'settings-a', change: h.reference, limits: h.plan.limits } } } };
  const { AiOriginalScenesModule, AI_ORIGINAL_SCENE_MODEL_REQUESTS } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.module');
  const module = AiOriginalScenesModule.registerHttpModel(modelDependencies, modelOptions);
  const requests = module.providers.find(p => p.provide === AI_ORIGINAL_SCENE_MODEL_REQUESTS).useFactory();
  const { AiOriginalSceneModelController } = require('../apps/api/src/modules/ai-native/scenes/original-scenes.controller');
  const controller = new AiOriginalSceneModelController(requests);
  const request = { headers: { authorization: (await _settingsCredentials.current()).authorization } };
  const result = await controller.startSettingsTask(request, { taskId: 'task-a', runId: 'run-a' });
  assert.equal(result.kind, 'run_outcome'); assert.equal(result.outcome.status, 'paused', JSON.stringify({ result,
    steps: h.state.aiStep, phases: h.state.aiTaskExecutionPhaseReceipt, trace: h.trace.slice(-20) }, (_key, value) => typeof value === 'bigint' ? value.toString() : value));
  assert.equal(h.state.aiTask[0].status, 'WAITING_CONFIRMATION');
  assert.equal(h.state.aiStep[0].status, 'RUNNING'); assert.equal(h.state.aiStep[0].effect, 'POSSIBLE');
  assert.equal(h.state.aiTaskExecutionPhaseReceipt.length, 1);
  assert.equal(h.state.aiTaskExecutionPhaseReceipt[0].payload.version, 'approved-settings-wait-1');
  assert.equal(h.state.aiApproval.length, 0); assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  assert.equal(h.state.aiTaskExecutionCharge.filter(charge => charge.stepId === h.state.aiStep[0].id).length, 3);
  const preparationCharge = h.state.aiTaskExecutionCharge.filter(charge => charge.stepId === null);
  assert.equal(preparationCharge.length, 1); assert.equal(preparationCharge[0].resource, 'ACTIVE_MS');
  assert.equal(preparationCharge[0].status, 'RECORDED');
  assert.equal(h.state.aiTaskRunPreparation.length, 1);
  assert.equal(h.state.aiTaskRunPreparation[0].prepared, true);
  assert.equal(h.state.aiTaskRunPreparation[0].chargeId, preparationCharge[0].chargeId);
  assert.equal(h.state.aiTaskExecutionCharge.length, 4);
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
  assert.equal(material.inputPublication, 'published_reference');
  assert.equal(material.execution, 'not_attested');
  assert.equal(material.workflowStatus, 'waiting_confirmation');
  const handoff = await consumer.humanHandoff({ preparation });
  assert.equal(handoff.reference.taskId, 'task-a'); assert.equal(handoff.continuation, 'not_invoked_use_original_settings_host');
  assert.equal(handoff.confirmation.checkpointRef, checkpoint.id);
  assert.equal(handoff.confirmation.taskRevision, h.state.aiTask[0].revision);
  assert.equal(handoff.confirmation.proposal.reviewedPayloadHash, proposal.reviewedPayloadHash);
  assert.equal(handoff.execution, 'not_attested'); assert.deepEqual(handoff.missing, []);
  await assert.rejects(consumer.humanHandoff({ preparation, checkpointRef: 'caller-checkpoint' }));
  const { composeAiTaskCenterScene } = require('../apps/api/src/modules/ai-native/task-center-scene.composition');
  const { AiTaskEventRepository } = require('../apps/api/src/modules/ai-native/ai-task-event.repository');
  const settingsCenter = composeAiTaskCenterScene({ settings: consumer,
    events: new AiTaskEventRepository(h.db, host.authorization.authority, h.dependencies.clock),
    list: { readPage: async () => { throw Error('not used'); } }, scenes: {
      requests: { readHistorical: async () => { throw Error('settings uses original settings input'); } },
      readTaskReceipt: async () => { throw Error('not used'); }, readRecovery: async () => { throw Error('not used'); } } });
  const aggregatedSettings = await settingsCenter.readScene({ kind: 'settings', taskId: 'task-a', runId: 'run-a', reference: { preparation } });
  const { validateAiTaskSceneObservation } = require('../apps/api/src/modules/ai-native/scenes/scene-observation-contracts');
  assert.deepEqual(validateAiTaskSceneObservation(aggregatedSettings), aggregatedSettings);
  const tenantOnly = structuredClone(aggregatedSettings); tenantOnly.business.scope = { kind: 'tenant', tenantId: 'tenant-a' };
  assert.throws(() => validateAiTaskSceneObservation(tenantOnly), error => error.code === 'AI_STORAGE_UNAVAILABLE');
  assert.equal(aggregatedSettings.business.confirmation.checkpointRef, checkpoint.id);
  assert.equal(aggregatedSettings.snapshot.availability, 'available'); assert.equal(aggregatedSettings.business.businessOutcome, 'not_observed');
  const stateBeforeRead = h.clone(h.state);
  const fromRequest = await requests.readTaskScene(request, { kind: 'settings', taskId: 'task-a', runId: 'run-a', reference: { preparation } });
  assert.equal(fromRequest.business.confirmation.checkpointRef, checkpoint.id);
  assert.equal(fromRequest.business.businessOutcome, 'not_observed');
  assert.equal(modelHost.factoryCalls.length, 0); assert.equal(modelHost.execution.sent.length, 0);
  assert.deepEqual(h.clone(h.state), stateBeforeRead);
  await assert.rejects(requests.readTaskScene({ headers: {} }, { kind: 'settings', taskId: 'task-a', runId: 'run-a', reference: { preparation } }));
  const { composeRequestBoundOriginalSceneModel } = require('../apps/api/src/modules/ai-native/scenes/request-bound-scenes.application');
  assert.throws(() => composeRequestBoundOriginalSceneModel(modelDependencies, { ...modelOptions,
    settingsTask: { ...modelOptions.settingsTask, dependencies: { ...settingsDependencies, db: modelHost.requestDependencies.db } } }),
    e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  await assert.rejects(settingsCenter.readScene({ kind: 'settings', taskId: 'other-task', runId: 'run-a', reference: { preparation } }));
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
  sharedCore.commitNotificationSettings = h.dependencies.core.commitNotificationSettings;
  sharedCore.refreshCommittedBusinessSettings = h.dependencies.core.refreshCommittedBusinessSettings;
  await assert.rejects(requests.continueSettingsConfirmation(request, { taskId: 'task-a', runId: 'foreign-run', checkpointRef: checkpoint.id }), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(requests.continueSettingsConfirmation(request, { taskId: 'task-a', runId: 'run-a', checkpointRef: checkpoint.id, holderId: 'caller-worker' }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(requests.continueSettingsConfirmation(request, { taskId: 'task-a', runId: 'run-a', checkpointRef: checkpoint.id }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.aiRun[0].leaseOwnerId, null, 'no decision must not claim an execution lease');
  await controller.decideSettingsProposal(request, { draftVersion: 'ain-approved-settings-draft-1', taskId: 'task-a',
    proposalId: proposal.proposalId, proposalRevision: proposal.proposalRevision, reviewedPayloadHash: proposal.reviewedPayloadHash, decision: 'approve' });
  const approvedObservation = await consumer.read({ preparation });
  assert.equal(approvedObservation.decision.state, 'recorded');
  assert.equal(approvedObservation.businessOutcome, 'not_observed');
  assert.equal(approvedObservation.execution, 'not_attested');
  const decision = await controller.readSettingsDecision(request, { draftVersion: 'ain-approved-settings-draft-1', taskId: 'task-a',
    proposalId: proposal.proposalId, proposalRevision: proposal.proposalRevision, reviewedPayloadHash: proposal.reviewedPayloadHash });
  assert.equal(decision.state, 'recorded');
  const finished = await controller.continueSettingsConfirmation(request, { taskId: 'task-a', runId: 'run-a', checkpointRef: checkpoint.id });
  assert.equal(modelHost.factoryCalls.length, 0); assert.equal(modelHost.execution.sent.length, 0);
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
  assert.equal(business.confirmation, null, 'committed task must not re-offer its old wait');
  const afterCommitState = h.clone(h.state);
  const recoveredScene = await controller.readTaskScene(request, { kind: 'settings', taskId: 'task-a', runId: 'run-a', reference: { preparation } });
  assert.equal(recoveredScene.business.businessOutcome, 'committed', 'reconnection discovers the original receipt without a caller operation key');
  assert.deepEqual(validateAiTaskSceneObservation(recoveredScene), recoveredScene);
  assert.equal(recoveredScene.business.operation.receipt.operationKey, business.operation.receipt.operationKey);
  assert.deepEqual(h.clone(h.state), afterCommitState, 'receipt discovery is read-only');
  const terminal = await controller.reconcileSettingsTask(request, { taskId: 'task-a', runId: 'run-a' });
  assert.equal(terminal.mode, 'read_only');
  assert.equal(terminal.businessOutcome, 'committed');
  assert.equal(terminal.operation.receipt.operationKey, business.operation.receipt.operationKey);
  assert.deepEqual(h.clone(h.state), afterCommitState, 'terminal reconciliation must not claim or restart the run');
  assert.equal(modelHost.factoryCalls.length, 0); assert.equal(modelHost.execution.sent.length, 0);
  const terminalObservation = await consumer.read({ preparation });
  assert.equal(terminalObservation.workflowStatus, 'succeeded');
  assert.equal(terminalObservation.businessOutcome, 'committed');
  assert.equal(terminalObservation.execution, 'not_attested');
  await assert.rejects(host.application.readConfirmation(checkpointRequest), 'terminal tasks cannot expose a live waiting checkpoint');
});

test('settings normal host cancellation blocks confirmation and preserves original charges under required evidence', { timeout: 20000 }, async () => {
  for (const witnessPresent of [true, false]) {
  const h = await settingsNormalHostSetup(), host = h.rebuild(), key = { taskId: 'task-a', runId: 'run-a' };
  assert.equal((await host.application.start(key)).outcome.status, 'paused');
  const checkpoint = h.state.aiTaskExecutionPhaseReceipt[0], originalCharges = h.state.aiTaskExecutionCharge.map(c => c.chargeId);
  await assert.rejects(host.application.requestCancel({ taskId: 'other-task', expectedRevision: h.state.aiTask[0].revision }));
  if (!witnessPresent) h.state.aiTaskExecutionPhaseReceipt.splice(0);
  const cancelled = await host.application.requestCancelOriginal({ taskId: key.taskId, expectedRevision: h.state.aiTask[0].revision });
  assert.equal(cancelled.cancellation, 'requested_not_rollback');
  assert.equal(cancelled.reconciliation.outcome.status, witnessPresent ? 'cancelled' : 'unknown');
  await assert.rejects(host.application.continueConfirmation({ ...key, checkpointRef: checkpoint.id }));
  const rebuilt = h.rebuild(), lease = checkpoint.payload.presentedLease;
  await assert.rejects(rebuilt.inputs.source.publishSettingsInput({ taskId: key.taskId, registrationRef: 'new-settings',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: h.reference }));
  assert.equal(h.state.aiTask[0].status, witnessPresent ? 'CANCELLED' : 'CANCEL_REQUESTED');
  assert.equal(h.state.rentalApprovedSettingsOperation.length, 0);
  assert.equal(h.state.aiApprovalConsumption.length, 0);
  assert.equal(h.state.aiTaskExecutionPhaseStart.length, 1);
  assert.deepEqual(h.state.aiTaskExecutionCharge.map(c => c.chargeId), originalCharges);
  assert.ok(h.state.aiTaskExecutionCharge.every(c => c.status === (witnessPresent ? 'RECORDED' : 'UNKNOWN')));
  assert.equal(h.state.aiRun[0].leaseOwnerId, null);
  assert.equal(h.timers.size, 0);
  }
});

for (const mode of ['missing operation', 'cancelled committed operation', 'expired committed operation']) test(`settings normal host recovers ${mode} without executing again`, { timeout: 20000 }, async () => {
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
  if (mode !== 'missing operation') h.storeControl.beforeWrite = async (name, args) => {
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
    if (mode === 'cancelled committed operation') {
      await host.application.requestCancel({ taskId: key.taskId, expectedRevision: h.state.aiTask[0].revision });
    }
  }
  assert.equal(calls, 1);
  const rebuilt = h.rebuild();
  if (mode === 'expired committed operation') {
    h.control.now = new Date('2026-10-08T12:00:00Z');
    h.current.settingsRevision++;
    h.current.settings.notifications = { enabledEvents: [], editableChannels: ['email'] };
    const before = h.clone(h.state);
    const observed = await rebuilt.application.reconcileOriginal(key);
    assert.equal(observed.mode, 'read_only'); assert.equal(observed.businessOutcome, 'committed');
    assert.equal(observed.operation.receipt.changeHash, h.reference.changeHash);
    assert.equal(observed.operation.receipt.resultRevision, 2);
    assert.deepEqual(h.clone(h.state), before); assert.equal(calls, 1);
    assert.equal(h.state.aiStep[0].status, 'RUNNING'); assert.equal(h.timers.size, 0);
    h.identity.membership = false;
    await assert.rejects(rebuilt.application.reconcileOriginal(key));
    return;
  }
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


test('AIN14 human calendar consumer locates original proposal confirms override saves one Core draft and recovers only its receipt', { timeout: 120000 }, async () => {
  const Module = require('node:module'), shared = require('@rental-os/shared');
  const { composeRequestBoundTaskCalendarDraft, AiTaskCalendarDraftController } = require('../apps/api/src/modules/ai-native/task-calendar-draft.application');
  const { createTaskCalendarDraftSession, taskCalendarDraftStore } = require('../apps/admin/src/features/ai-native/task-calendar-draft-session');
  const dto = require('../apps/api/src/modules/ai-native/task-calendar-draft.dto');
  const { plainToInstance } = require('class-transformer'), { validateSync } = require('class-validator');
  const { ExecutionContextHost } = require('@nestjs/core/helpers/execution-context-host');
  const httpFile = require.resolve('../apps/admin/src/api/http'), queryFile = require.resolve('../apps/admin/src/app/queryClient');
  const previousHttp = Module._cache[httpFile], previousQuery = Module._cache[queryFile];
  const calls = [], memory = new Map(), controllerTypes = { list: dto.AiTaskCalendarDraftListDto, review: dto.AiTaskCalendarDraftReviewDto,
    save: dto.AiTaskCalendarDraftSaveDto, operation: dto.AiTaskCalendarDraftReferenceDto };
  let h, controller, key, loseDelivery = false, epoch = 1, switchEpoch = false;
  Module._cache[queryFile] = { id: queryFile, filename: queryFile, loaded: true, exports: {
    currentSessionSignal: () => new AbortController().signal, currentSessionEpoch: () => epoch } };
  Module._cache[httpFile] = { id: httpFile, filename: httpFile, loaded: true, exports: { http: {
    post: async (url, body, options) => {
      const action = url.split('/').at(-1); calls.push({ action, body: structuredClone(body) });
      assert.equal(url, `/${shared.AI_TASK_CALENDAR_DRAFT_HTTP.basePath}/${shared.AI_TASK_CALENDAR_DRAFT_HTTP[action]}`);
      assert.equal(options.timeout, 12000); assert.equal(options.signal.aborted, false);
      const transformed = plainToInstance(controllerTypes[action], body);
      assert.deepEqual(validateSync(transformed, { whitelist: true }), []);
      if (action === 'save') {
        assert.deepEqual(JSON.parse(memory.get(key)), { taskId: body.taskId, runId: body.runId, stepId: body.stepId });
        assert.doesNotMatch(memory.get(key), /reviewHash|overrideReason|overrideConfirmed|Original day|Proposed day/);
      }
      const request = { ...h.request, body, method: 'POST', originalUrl: '/api' + url, url: '/api' + url };
      await h.dependencies.guard.canActivate(new ExecutionContextHost([request]));
      const response = await controller[action](request, transformed);
      if (action === 'save' && loseDelivery) { loseDelivery = false; throw Error('Synthetic delivery lost after original Core receipt'); }
      if (switchEpoch) { switchEpoch = false; epoch++; }
      return { data: { data: response } };
    }
  } } };
  const storage = { getItem: name => memory.get(name) ?? null, setItem: (name, value) => memory.set(name, value), removeItem: name => memory.delete(name) };
  const makeController = saveEnabled => new AiTaskCalendarDraftController(composeRequestBoundTaskCalendarDraft({ original: h.requestDependencies,
    saveEnabled, host: { holderId: 'opening-r1-worker', leaseMs: 120000 } }));
  try {
    const { aiTaskCalendarDraftApi } = require('../apps/admin/src/api/aiTaskCalendarDraft');
    assert.ok(require.resolve('@rental-os/shared').endsWith(require('node:path').join('shared', 'dist', 'index.js')));
    const Ajv = require('ajv'), ajv = new Ajv({ strict: false }); require('ajv-formats')(ajv);
    const validators = Object.fromEntries(Object.entries(shared.AI_TASK_CALENDAR_DRAFT_SCHEMAS).map(([name, schema]) => [name, ajv.compile(schema)]));
    for (const lost of [false, true]) {
      h = await boundCalendarDraftSaveSetup(`human-consumer-${lost}`, lost);
      h.b.h.identity.user.permissions.push('rental-os:calendar:edit');
      h.requestDependencies = { ...h.dependencies }; delete h.requestDependencies.credentials;
      controller = makeController(true); key = `synthetic-calendar-human-${lost}`;
      const taskId = h.state.aiTask.find(row => row.inputRef === h.command.original.inputRef).id;
      let active = true, session = createTaskCalendarDraftSession({ taskId, current: () => active, api: aiTaskCalendarDraftApi,
        store: taskCalendarDraftStore(key, storage), changed() {} });
      const aiBefore = h.clone(Object.fromEntries(Object.entries(h.state).filter(([name]) => name.startsWith('ai'))));
      const before = h.clone(h.state); await session.list(); assert.deepEqual(h.state, before);
      assert.equal(session.view.items.length, 1); const item = session.view.items[0], reference = item.reference;
      assert.equal(item.target.id, h.original.id); assert.equal(item.target.version, h.original.version); assert.equal(item.target.baseRevision, 3);
      assert.equal(item.overrideRequired, lost); assert.equal(validators.AiTaskCalendarDraftListResponse({ contractVersion: shared.AI_TASK_CALENDAR_DRAFT_VERSION,
        taskId, observedAt: new Date().toISOString(), saveEnabled: true, items: session.view.items }), true);
      assert.equal(validators.AiTaskCalendarDraftReference({ ...reference, overrideReason: 'unexpected' }), false);
      const extraBody = { ...reference, overrideReason: 'Human calendar override', overrideConfirmed: lost, workspaceId: 'foreign' };
      const transformed = plainToInstance(dto.AiTaskCalendarDraftReviewDto, extraBody);
      assert.deepEqual(validateSync(transformed, { whitelist: true }), []);
      assert.equal(Object.hasOwn(transformed, 'workspaceId'), false);
      await assert.rejects(controller.review({ ...h.request, body: extraBody }, transformed), error => error.getResponse().code === 'AI_INVALID_INPUT');
      assert.deepEqual(h.state, before);
      if (lost) { await assert.rejects(session.review(reference, 'Human calendar override', false)); assert.deepEqual(h.state, before); }
      await session.review(reference, 'Human calendar override', lost); assert.deepEqual(h.state, before);
      const reviewed = session.view.review;
      assert.equal(reviewed.before.name, 'Original day'); assert.equal(reviewed.after.name, 'Proposed day');
      assert.equal(reviewed.existingOverrideReason, lost ? 'Original manual reason' : null);
      assert.equal(reviewed.after.closed, true); assert.equal(reviewed.persistence, 'not_attempted');
      assert.equal(validators.AiTaskCalendarDraftReviewResponse(reviewed), true, JSON.stringify(validators.AiTaskCalendarDraftReviewResponse.errors));
      assert.equal(memory.has(key), false); const savedBefore = calls.filter(row => row.action === 'save').length;
      loseDelivery = lost;
      if (lost) {
        await assert.rejects(session.save()); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
        assert.deepEqual(session.view.pending, reference); await assert.rejects(session.save());
        assert.equal(calls.filter(row => row.action === 'save').length, savedBefore + 1);
        session.dispose(); controller = makeController(false);
        session = createTaskCalendarDraftSession({ taskId, current: () => active, api: aiTaskCalendarDraftApi,
          store: taskCalendarDraftStore(key, storage), changed() {} });
        h.b.h.identity.user.permissions = h.b.h.identity.user.permissions.filter(value => value !== 'rental-os:calendar:edit');
        await session.operation(reference); // History read remains available with new saves disabled.
      } else await session.save();
      assert.equal(session.view.operation.operation.state, 'committed');
      assert.equal(validators.AiTaskCalendarDraftOperationResponse(session.view.operation), true, JSON.stringify(validators.AiTaskCalendarDraftOperationResponse.errors));
      assert.equal(session.view.operation.operation.overrideReason, 'Human calendar override');
      assert.equal(memory.has(key), false); assert.equal(session.view.pending, null);
      assert.equal(h.state.rentalBusinessCalendar[0].revision, 4); assert.equal(h.state.rentalCalendarOverrideAuditEntry.length, 1);
      assert.equal(h.state.rentalCalendarOverrideAuditEntry[0].after.__rentalBoundDraftOperation.overrideConfirmed, lost);
      const stable = h.clone(h.state); await session.operation(reference); assert.deepEqual(h.state, stable);
      if (!lost) {
        // A synthetic historical reviewed receipt predates the recovery field.
        // Its full original command/proof remains readable, while the new
        // three-id consumer refuses to infer an absent confirmation value.
        const row = h.state.rentalCalendarOverrideAuditEntry[0], originalAfter = h.clone(row.after);
        const metadata = { ...row.after.__rentalBoundDraftOperation }; delete metadata.proofHash; delete metadata.overrideConfirmed;
        const after = { ...row.after }; delete after.__rentalBoundDraftOperation;
        const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
        row.after.__rentalBoundDraftOperation = { ...metadata, proofHash: requestFingerprint({ metadata, before: row.before,
          after, reason: row.reason, operator: row.operator, at: row.at.toISOString() }) };
        const legacy = await h.save.readDraftOperation({ ...h.command, overrideReason: 'Human calendar override',
          overrideConfirmed: false, reviewHash: reviewed.reviewHash });
        assert.equal(legacy.operation.receiptId, row.id); await assert.rejects(session.operation(reference));
        row.after = originalAfter; assert.deepEqual(h.state, stable);
      }
      assert.deepEqual(h.state.rentalBusinessCalendar.find(row => row.id === h.published.id), h.published);
      assert.deepEqual(h.clone(Object.fromEntries(Object.entries(h.state).filter(([name]) => name.startsWith('ai')))), aiBefore);
      assert.equal(h.state.aiGatewayInvocation.length, 0);
      if (!lost) {
        controller = makeController(false); await session.list(); assert.equal(session.view.saveEnabled, false);
        await assert.rejects(controller.review(h.request, { ...reference, overrideReason: 'No self authorization', overrideConfirmed: false, workspaceId: 'foreign' }));
        assert.deepEqual(h.state, stable);
        switchEpoch = true; await assert.rejects(session.operation(reference), error => error.message === 'AI_SCOPE_CHANGED');
        active = false; session.dispose();
      } else session.dispose();
    }
    // An unresolved original locator and malformed persistence never dispatch a new save.
    const reference = { taskId: 'task-locator', runId: 'run-locator', stepId: 'step-locator' }; key = 'unknown-calendar-locator';
    memory.set(key, JSON.stringify(reference)); let saves = 0;
    const unavailable = createTaskCalendarDraftSession({ taskId: reference.taskId, current: () => true, store: taskCalendarDraftStore(key, storage), changed() {},
      api: { ...aiTaskCalendarDraftApi, save: async () => { saves++; throw Error('Must not dispatch'); }, operation: async () => ({ contractVersion: shared.AI_TASK_CALENDAR_DRAFT_VERSION,
        taskId: reference.taskId, observedAt: new Date().toISOString(), reference, operation: { state: 'not_observed', retryable: false } }) } });
    await unavailable.operation(reference); assert.deepEqual(unavailable.view.pending, reference); await assert.rejects(unavailable.save()); assert.equal(saves, 0);
    memory.set(key, '{broken'); const broken = createTaskCalendarDraftSession({ taskId: reference.taskId, current: () => true,
      api: aiTaskCalendarDraftApi, store: taskCalendarDraftStore(key, storage), changed() {} });
    assert.equal(broken.view.locatorInvalid, true); await assert.rejects(broken.save()); assert.equal(saves, 0);
    unavailable.dispose(); broken.dispose();
  } finally {
    if (previousHttp) Module._cache[httpFile] = previousHttp; else delete Module._cache[httpFile];
    if (previousQuery) Module._cache[queryFile] = previousQuery; else delete Module._cache[queryFile];
  }
});
