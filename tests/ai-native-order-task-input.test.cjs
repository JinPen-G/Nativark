'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composePersistedOrderTaskInput } = require('../apps/api/src/modules/ai-native/order-task-input.composition');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');

async function setup() {
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProposalVersion: [], aiProposalAction: [] });
  h.state.aiTaskRunPlan.length = 0;
  h.identity.user.permissions.push('rental-os:order:create', 'system:params:manage');
  const confirmation = Object.create(RentalOrderConfirmationService.prototype);
  confirmation.memberships = {};
  const root = composePersistedOrderTaskInput({ ...h.authorization, db: h.db,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), confirmation,
    scene: { code: 'synthetic-clarification', version: '1' }, clock: () => new Date(h.control.now) });
  await root.policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: '2027-01-01T00:00:00Z' });
  const lease = await root.tasks.claimRun(h.claim());
  const body = { quoteId: 'quote-a', customerType: 'personal', customerId: 'customer-a', customerName: 'Synthetic customer',
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-a', startAt: '2026-10-07T10:00:00Z', endAt: '2026-10-08T10:00:00Z',
    lines: [{ itemGroupId: 'item-a', quantity: 1 }] };
  const publish = (patch = {}) => root.source.publishOrderInput({ taskId: 'task-a', registrationRef: 'order-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: body, ...patch });
  const plan = () => ({ taskId: 'task-a', runId: 'run-a', taskRevision: h.state.aiTask[0].revision, limits: h.plan.limits,
    steps: [{ registrationRef: 'order-a', operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] });
  return { ...h, root, lease, body, publish, plan };
}

async function registered() {
  const h = await setup(), published = await h.publish();
  await h.root.plans.savePlan(h.plan(), h.lease);
  const { taskId, expiresAt, ...lease } = h.lease;
  const registered = await h.root.registrations.register({ taskId, registrationRef: 'order-a', expectedTaskRevision: h.state.aiTask[0].revision, lease });
  const step = h.state.aiStep.find(row => row.id === registered.stepId), row = h.state.aiTaskActionInput[0];
  step.status = 'RUNNING';
  const reference = { scopeId: 'scope-a', taskId, runId: lease.runId, stepId: step.id, actionId: step.actionId,
    inputRef: published.id, registrationRef: row.registrationRef, fingerprint: row.fingerprint };
  return { ...h, published, reference };
}

test('authorized policy and Core-normalized publication produce the actual plan, registered step and preparation input', async () => {
  const h = await registered(), proof = await h.root.inputAuthority.authorizeOrderInput(h.reference, h.db);
  assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.equal(h.state.aiTaskRunPlan.length, 1);
  assert.equal(h.state.aiStep[0].inputRef, h.published.id);
  assert.equal(proof.policyRevision, 1);
  assert.deepEqual(proof.reference, h.reference);
  assert.deepEqual(h.state.aiTaskActionInput[0].payload.bookingIdentity, { bookingIdentity: 'personal' });
  assert.equal((await h.publish({ expectedTaskRevision: h.state.aiTask[0].revision,
    lease: { ...h.lease, revision: h.state.aiRun[0].revision } })).replayed, true);
  const { scopeId, taskId, runId, actionId } = h.reference;
  const body = await h.root.inputSource.read({ context: proof.context, scopeId, taskId, runId, actionId }, h.db);
  assert.deepEqual(body, { ...h.body, bookingIdentity: { bookingIdentity: 'personal' } });
  assert.equal(h.state.aiProposalVersion.length, 0);
});

test('published order input remains immutable and a closed plan rejects injected actions', async () => {
  const h = await setup(); await h.publish();
  await assert.rejects(h.publish({ input: { ...h.body, customerName: 'changed' } }), e => e.code === 'AI_REVISION_CONFLICT');
  await h.root.plans.savePlan(h.plan(), h.lease);
  await assert.rejects(h.publish({ registrationRef: 'injected-action' }), e => e.code === 'AI_REVISION_CONFLICT');
  assert.equal(h.state.aiTaskActionInput.length, 1);
});

test('current policy revision and registration reference cannot replace the original order input proof', async () => {
  const h = await registered();
  h.state.aiTaskPlanPolicy[0].revision++;
  await assert.rejects(h.root.inputAuthority.authorizeOrderInput(h.reference, h.db));
  h.state.aiTaskPlanPolicy[0].revision--;
  h.state.aiTaskActionInput[0].registrationRef = 'other-reference';
  await assert.rejects(h.root.inputAuthority.authorizeOrderInput(h.reference, h.db));
});

test('lost publication acknowledgement retains the original input for reconciliation', async () => {
  const h = await setup();
  h.storeControl.beforeCommit = async draft => {
    if (draft.aiTaskActionInput.length && !h.state.aiTaskActionInput.length) h.storeControl.loseReply = true;
  };
  await assert.rejects(h.publish(), e => e.code === 'AI_RESULT_UNKNOWN' && e.nextAction === 'reconcile' && e.retryable === false);
  assert.equal(h.state.aiTaskActionInput.length, 1);
  assert.equal((await h.publish()).replayed, true);
});

test('order route authorization and Core DTO validation reject publication before persistence', async () => {
  const h = await setup();
  await assert.rejects(h.publish({ input: { ...h.body, modelChosenAmount: 1 } }));
  h.identity.user.permissions = h.identity.user.permissions.filter(code => !['rental-os:order:create', 'rental-os:order:operate'].includes(code));
  await assert.rejects(h.publish(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.aiTaskActionInput.length, 0);
});
