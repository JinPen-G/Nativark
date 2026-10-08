'use strict';
const assert = require('node:assert/strict');
const { controlledApprovedOrderHarness } = require('./approved-order-controlled.cjs');
const { clone } = require('./task-input-store.cjs');
const { AI_TOOL_DRAFT_VERSION } = require('../../../packages/shared/src/index.ts');
const { AI_APPROVAL_APPLICATION_DRAFT_VERSION } = require('../../../packages/shared/src/ai-approval-application-draft.ts');
const { requestFingerprint } = require('../../../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { ApprovedOrderHumanAuthority } = require('../../../apps/api/src/modules/ai-native/approval-execution/approved-order-human.authority');

// Selection/lease ports and task hosting are test doubles, not validation of A's producer or the live runner.
async function reprepareHarness(options = {}) {
  const h = await controlledApprovedOrderHarness(options), state = h.state;
  const originalHash = requestFingerprint({ request: 'replacement fixture' });
  state.records.aiTask.push({ ...clone(state.records.aiTask[0]), id: 'task-b', revision: 1, eventCursor: 0n,
    inputRef: 'original-b', inputHash: originalHash });
  state.records.aiRun.push({ ...clone(state.records.aiRun[0]), id: 'run-b', taskId: 'task-b', revision: 1 });
  state.records.aiTaskActionPolicy.push(...state.records.aiTaskActionPolicy.map(row => ({ ...clone(row), taskId: 'task-b' })),
    { scopeId: 'scope-a', taskId: 'task-a', operation: 'reprepare_approval', revision: 1,
      requiredPermissions: ['rental-os:order:create'], expiresAt: new Date('2099-01-01') });
  const body = { ...clone(h.body), quoteId: 'quote-b' };
  state.records.quote.push({ ...clone(state.records.quote[0]), id: 'quote-b', request: body });
  const lease = () => {
    const run = state.records.aiRun.find(row => row.id === 'run-b');
    return { taskId: 'task-b', runId: 'run-b', holderId: run.leaseOwnerId, revision: run.revision,
      fencingToken: run.fencingToken.toFixed(0), expiresAt: run.leaseExpiresAt.toISOString() };
  };
  const limits = { maxSteps: 4, maxCalls: 4, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096, maxConcurrent: 1 };
  const input = await h.root.source.publishOrderInput({ taskId: 'task-b', registrationRef: 'order-b', expectedTaskRevision: 1, lease: lease(), input: body });
  const plan = await h.root.plans.savePlan({ taskId: 'task-b', runId: 'run-b', taskRevision: 1, limits,
    steps: [{ registrationRef: 'order-b', operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease());
  const { taskId, expiresAt, ...held } = lease();
  const registration = await h.root.registrations.register({ taskId, registrationRef: 'order-b', expectedTaskRevision: 1, lease: held });
  const step = state.records.aiStep.find(row => row.id === registration.stepId);
  held.revision = state.records.aiRun.find(row => row.id === 'run-b').revision;
  step.status = 'RUNNING';
  const replacement = { taskId, runId: 'run-b', stepId: step.id, actionId: step.actionId, inputRef: input.id,
    fingerprint: step.requestFingerprint, originalInputRef: 'original-b', quoteSelectionRef: 'selection-b', planHash: plan.planHash };
  h.dependencies.reprepareServices = deps => ({
    selection: { readAuthorized: async (reference, tx) => {
      if (state.selectionUnavailable) throw Error('synthetic selection unavailable');
      assert.deepEqual(reference, { draftVersion: 'ain-quote-selection-draft-1', originalInputRef: 'original-b', selectionId: 'selection-b',
        taskId: 'task-b', runId: 'run-b', inputHash: replacement.fingerprint });
      const current = await new ApprovedOrderHumanAuthority(deps).policy.authorizeRead('task-b', tx);
      const quote = state.records.quote.find(row => row.id === 'quote-b');
      const { consumedAt, consumedOrderId, ...immutable } = quote;
      return { context: current.context, scopeId: current.scopeId, taskId: 'task-b', runId: 'run-b', originalInputRef: 'original-b',
        originalInputHash: originalHash, selectionId: 'selection-b', selectionRevision: 1, quoteId: 'quote-b',
        quoteHash: requestFingerprint(immutable), inputHash: replacement.fingerprint, body: clone(body), expiresAt: quote.expiresAt,
        bindingHash: requestFingerprint({ selection: 'selection-b', originalHash }), ...state.proofOverrides };
    } },
    lease: { current: async () => state.leaseUnavailable ? null : held }
  });
  const command = { draftVersion: AI_APPROVAL_APPLICATION_DRAFT_VERSION, operationKey: 'reprepare-a', originalTaskId: 'task-a',
    original: h.review, reason: 'change_plan', replacement };
  const executorInput = () => ({ taskId, runId: 'run-b', stepId: step.id, actionId: step.actionId,
    inputRef: input.id, fingerprint: step.requestFingerprint, lease: lease() });
  const prepareCore = () => {
    h.dependencies.core.prepareOrder = async (_tenant, request, _name, quote) => {
      assert.equal(request.quoteId, 'quote-b'); assert.equal(quote.id, 'quote-b'); state.prepares++;
      return { id: `order-${state.prepares}`, tenantId: 'tenant-a', workspaceId: 'workspace-a', status: 'draft',
        payableAmount: 123, quoteId: 'quote-b', lines: body.lines };
    };
  };
  return { ...h, command, replacement, executorInput, prepareCore };
}
module.exports = { reprepareHarness };
