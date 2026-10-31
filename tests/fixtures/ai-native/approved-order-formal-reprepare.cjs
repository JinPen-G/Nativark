'use strict';
const assert = require('node:assert/strict');
const { controlledApprovedOrderHarness } = require('./approved-order-controlled.cjs');
const { clone } = require('./task-input-store.cjs');
const { composeControlledApprovedOrder } = require('../../../apps/api/src/modules/ai-native/approval-execution/controlled-approved-order.composition');
const { composeFormalApprovedOrderReprepareServices } = require('../../../apps/api/src/modules/ai-native/approval-execution/formal-approved-order-reprepare.composition');
const { AI_SCENE_REQUEST_DRAFT_VERSION } = require('../../../packages/shared/src/ai-scene-request-draft.ts');
const { AI_QUOTE_SELECTION_DRAFT_VERSION } = require('../../../packages/shared/src/ai-quote-selection-draft.ts');
const { AI_PROPOSAL_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } = require('../../../packages/shared/src/index.ts');
const { AI_APPROVAL_APPLICATION_DRAFT_VERSION } = require('../../../packages/shared/src/ai-approval-application-draft.ts');

// Database/Core facts and runner start states remain fixtures; original/selection repositories and lease CAS are real.
exports.formalReprepareHarness = async () => {
  const h = await controlledApprovedOrderHarness({ prepare: false }), { state } = h;
  for (const name of ['aiTask', 'aiRun', 'aiStep', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval', 'aiApprovalConsumption',
    'aiApprovedOrderSnapshot', 'aiTaskActionInput', 'aiTaskRunPlan', 'aiTaskEvent', 'aiTaskResultArtifact', 'aiApprovalReprepare', 'aiTaskActionPolicy',
    'aiTaskPlanPolicy', 'aiTaskOriginalRequest', 'aiTaskQuoteSelection']) state.records[name] = [];
  for (const row of state.records.aiBudgetPolicy) {
    row.sceneCode = 'quote_clarification'; row.settingsJson.sceneCode = 'quote_clarification'; row.settingsJson.allowedScenes = ['quote_clarification'];
  }
  Object.assign(h.dependencies.core, {
    // Candidate preparation now requires bounded original reader ports. Empty
    // pages express missing choices, never a fabricated quote or permission.
    listItemGroupsPage: async () => ({ rows: [], truncated: false, nextCursor: null,
      source: 'persisted_workspace_configuration', configurationVersion: '0'.repeat(64) }),
    getProfile: () => ({ tenantId: 'tenant-a', categoryCode: 'camera' }),
    getWorkspaceCategory: async () => ({ code: 'camera', businessModel: { pricingUnits: ['day'], fulfillmentModes: ['store_pickup_return'] } }),
    getBusinessSettings: () => ({ tenantId: 'tenant-a', calendar: { timeZone: 'UTC' }, pricing: { enabledUnits: ['day'] },
      fulfillment: { enabledModes: ['store_pickup_return'] }, configVersion: 1 }),
    prepareOrder: async (_tenant, request, _name, quote) => {
      assert.equal(request.quoteId, quote.id); state.prepares++;
      return { id: `order-${state.prepares}`, tenantId: 'tenant-a', workspaceId: 'workspace-a', status: 'draft',
        payableAmount: 123, quoteId: quote.id, lines: request.lines };
    }
  });
  const configuration = { holderId: 'formal-worker', creationRules: [{ sceneCode: 'quote_clarification', sceneVersion: '1', revision: 1,
    audiences: ['operator'], requiredPermissions: ['rental-os:order:create'], maxInputAgeMs: 3600000 }],
    memberships: { listPersonalOptions: async () => [], listPersonalOptionsPage: async () => ({ rows: [], truncated: false }) } };
  const dependencies = { ...h.dependencies, scene: { code: 'quote_clarification', version: '1' },
    reprepareServices: deps => composeFormalApprovedOrderReprepareServices(deps, configuration) };
  const compose = () => composeControlledApprovedOrder(dependencies), app = compose();
  const sources = composeFormalApprovedOrderReprepareServices(dependencies, configuration);
  const limits = { maxSteps: 4, maxCalls: 4, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096, maxConcurrent: 1 };
  await app.policy.put({ expectedRevision: null, enabled: true, limits, expiresAt: '2099-01-01T00:00:00Z' });
  const material = async (key, quoteId, previousInputRef) => {
    const original = await sources.originals.save({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey: key,
      sceneCode: 'quote_clarification', input: { candidate: { customerType: 'personal' } }, ...(previousInputRef ? { previousInputRef } : {}) }, !!previousInputRef);
    const task = await sources.originals.createTask({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef: original.inputRef });
    for (const operation of ['read_metadata', 'transition_task', 'claim_run', 'decide_approval', 'reprepare_approval']) state.records.aiTaskActionPolicy.push({
      scopeId: 'scope-a', taskId: task.taskId, operation, revision: 1, requiredPermissions: [operation === 'read_metadata' ? 'rental-os:order:view' : 'rental-os:order:create'],
      expiresAt: new Date('2099-01-01') });
    const body = { ...clone(h.body), quoteId };
    if (!state.records.quote.some(row => row.id === quoteId)) state.records.quote.push({ ...clone(state.records.quote[0]), id: quoteId, request: clone(body) });
    const selected = await sources.selection.select({ draftVersion: AI_QUOTE_SELECTION_DRAFT_VERSION, originalInputRef: original.inputRef,
      taskId: task.taskId, runId: task.runId, selectionKey: `selection-${key}`, expectedSelectionRevision: 0, order: body });
    const held = await app.tasks.claimRun({ taskId: task.taskId, runId: task.runId, holderId: configuration.holderId,
      expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '0', leaseMs: 120000 });
    const run = () => state.records.aiRun.find(row => row.id === task.runId);
    state.records.aiTask.find(row => row.id === task.taskId).status = 'RUNNING';
    run().status = 'RUNNING';
    const lease = () => ({ ...held, revision: run().revision });
    const published = await app.source.publishOrderInput({ taskId: task.taskId, registrationRef: `input-${key}`, expectedTaskRevision: 1, lease: lease(), input: body });
    const plan = await app.plans.savePlan({ taskId: task.taskId, runId: task.runId, taskRevision: 1, limits,
      steps: [{ registrationRef: `input-${key}`, operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease());
    const { taskId, expiresAt, ...preRegistration } = lease();
    const registered = await app.registrations.register({ taskId, registrationRef: `input-${key}`, expectedTaskRevision: 1, lease: preRegistration });
    const step = state.records.aiStep.find(row => row.id === registered.stepId); step.status = 'RUNNING';
    const reference = { taskId, runId: task.runId, stepId: step.id, actionId: step.actionId, inputRef: published.id, fingerprint: step.requestFingerprint,
      originalInputRef: original.inputRef, quoteSelectionRef: selected.receipt.selectionId, planHash: plan.planHash };
    return { original, reference, lease, executor: () => ({ taskId, runId: task.runId, stepId: step.id, actionId: step.actionId,
      inputRef: published.id, fingerprint: step.requestFingerprint, lease: lease() }) };
  };
  const first = await material('first', 'quote-a');
  const { taskId, expiresAt, ...lease } = first.lease();
  const pending = await app.prepare({ taskId, proposalId: 'formal-original', proposalRevision: 1, actionId: first.reference.actionId,
    expiresAt: first.original.expiresAt, lease });
  const original = { contractVersion: AI_PROPOSAL_DRAFT_VERSION, proposalId: pending.proposalId, proposalRevision: pending.proposalRevision,
    reviewedPayloadHash: pending.reviewedPayloadHash };
  const second = await material('replacement', 'quote-b', first.original.inputRef);
  const command = { draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, operationKey: 'formal-reprepare', originalTaskId: first.reference.taskId,
    original, reason: 'change_plan', replacement: second.reference };
  return { ...h, dependencies, configuration, compose, app, sources, first, second, command };
};
