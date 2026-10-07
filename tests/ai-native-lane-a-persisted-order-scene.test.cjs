'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { composeAiPersistedOrderScene } = require('../apps/api/src/modules/ai-native/scenes/persisted-order-scene.composition');
const { AiBusinessScenesModule, AI_PERSISTED_ORDER_SCENE } = require('../apps/api/src/modules/ai-native/scenes/business-scenes.module');
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { businessApprovedHarness } = require('./fixtures/ai-native/lane-a-business-approved.cjs');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');

async function setup() {
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [], aiProposal: [], aiProposalVersion: [],
    aiProposalAction: [], aiApproval: [], aiApprovalConsumption: [], aiApprovedOrderSnapshot: [] });
  const business = await businessApprovedHarness();
  const transaction = h.db.$transaction.bind(h.db), active = new AsyncLocalStorage();
  // Current authorization opens independent READ transactions. The serialized
  // database double cannot queue them behind its own pending outer write.
  // Only those reads use committed delegates; this does not model MySQL locks.
  h.db.$transaction = callback => active.getStore()
    ? callback(h.db) : transaction(tx => active.run(true, () => callback(tx)));
  h.state.aiTaskRunPlan.length = 0;
  h.identity.user.permissions.push('rental-os:order:create', 'system:params:manage');
  const dependencies = { ...business.deps, ...h.authorization, db: h.db,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    confirmation: business.dependencies.confirmation,
    scene: { code: 'synthetic-clarification', version: '1' }, clock: () => new Date(h.control.now), toolVersion: AI_TOOL_DRAFT_VERSION };
  delete dependencies.inputSource;
  return { h, business, dependencies };
}

test('one persisted scene publishes normalized original input, registers it, and reads the same authorized body', async () => {
  const { h, business, dependencies } = await setup();
  const before = [...h.trace];
  const module = AiBusinessScenesModule.registerPersistedOrder(dependencies);
  assert.deepEqual(module.exports, [AI_PERSISTED_ORDER_SCENE]);
  const scene = module.providers[0].useFactory();
  assert.deepEqual(h.trace, before);
  assert.equal(h.state.aiTaskActionInput.length, 0);
  assert.equal(h.state.aiTaskPlanPolicy.length, 0);
  await scene.inputs.policy.put({ expectedRevision: null, enabled: true, limits: h.plan.limits, expiresAt: '2027-01-01T00:00:00Z' });
  const lease = await scene.inputs.tasks.claimRun(h.claim());
  const published = await scene.publishInput({ taskId: 'task-a', registrationRef: 'order-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: business.body });
  await scene.savePlan({ taskId: 'task-a', runId: 'run-a', taskRevision: h.state.aiTask[0].revision, limits: h.plan.limits,
    steps: [{ registrationRef: 'order-a', operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease);
  const { taskId, expiresAt, ...held } = lease;
  const registered = await scene.registerStep({ taskId, registrationRef: 'order-a', expectedTaskRevision: h.state.aiTask[0].revision, lease: held });
  const step = h.state.aiStep.find(row => row.id === registered.stepId), row = h.state.aiTaskActionInput[0];
  // Runner start is outside this adapter; simulate the persisted execution boundary.
  step.status = 'RUNNING';
  const ref = { scopeId: 'scope-a', taskId, runId: held.runId, stepId: step.id, actionId: step.actionId,
    inputRef: published.id, registrationRef: row.registrationRef, fingerprint: row.fingerprint };
  const proof = await scene.inputs.inputAuthority.authorizeOrderInput(ref, h.db);
  const read = () => scene.inputs.inputSource.read({ context: proof.context, scopeId: ref.scopeId, taskId, runId: held.runId, actionId: step.actionId }, h.db);
  assert.deepEqual(await read(), dependencies.confirmation.normalizeOrderInput(structuredClone(business.body)));
  assert.equal(h.state.aiApproval.length, 0);
  assert.equal(h.state.aiProposal.length, 0);
  assert.equal(scene.originalRequestCreation, 'requires_existing_task_and_run');
  const command = { taskId, proposalId: 'proposal-a', proposalRevision: 1, actionId: step.actionId,
    expiresAt: '2026-10-08T00:00:00Z', lease: { ...held, revision: registered.runRevision } };
  const prepared = await scene.prepare(command);
  assert.equal(prepared.actionId, step.actionId);
  assert.equal(h.state.aiProposal.length, 1);
  assert.equal(h.state.aiApproval.length, 0);
  assert.equal(business.state.records.rentalOrder.length, 0);
  await assert.rejects(scene.submit({ taskId, proposalId: 'proposal-a', proposalRevision: 1,
    reviewedPayloadHash: prepared.reviewedPayloadHash, approvalId: 'no-human-approval', actionId: step.actionId, lease: command.lease }));
  assert.equal(h.state.aiApprovalConsumption.length, 0);
  assert.equal(business.state.records.rentalOrder.length, 0);
  h.identity.session = false;
  await assert.rejects(read);
  await assert.rejects(scene.prepare(command));
  assert.equal(h.state.aiProposal.length, 1);
});

test('the combined scene rejects caller replacement of its persisted original input source', async () => {
  const { dependencies } = await setup();
  assert.throws(() => composeAiPersistedOrderScene({ ...dependencies, inputSource: { read: async () => ({}) } }),
    e => e.code === 'AI_INVALID_INPUT');
});
