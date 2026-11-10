'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
const { composePersistedAvailabilityTaskRunner } = require('../apps/api/src/modules/ai-native/runner/persisted-catalog-runner.composition');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
const { AI_TOOL_DRAFT_VERSION, RentalInventoryMode } = require('./fixtures/ai-native/local-shared.cjs');
async function setup() {
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [] });
  h.state.aiTaskRunPlan.length = 0;
  h.identity.user.permissions.push('rental-os:order:create');
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: 'synthetic-clarification', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'rental.availability.check', version: AI_TOOL_DRAFT_VERSION }], limits: h.clone(h.plan.limits), expiresAt: new Date('2026-10-07T12:00:00Z') });
  const auth = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock: () => new Date(h.control.now) });
  const lease = await auth.tasks.claimRun(h.claim());
  const calls = [];
  const root = composePersistedAvailabilityTaskRunner({ db: h.db, authorization: h.authorization,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), wall: () => new Date(h.control.now), monotonic: () => ++h.control.tick,
    core: { readAvailability: async (tenantId, input) => {
      calls.push({ tenantId, input: structuredClone(input), identity: getRequestIdentity() });
      if (h.control.onRead) await h.control.onRead();
      const result = { available: true, locationId: input.locationId, startAt: input.startAt, endAt: input.endAt,
        lines: input.lines.map(line => ({ itemGroupId: line.itemGroupId, itemGroupCode: 'SYNTHETIC', itemGroupName: 'Synthetic asset',
          inventoryMode: Object.values(RentalInventoryMode)[0], requestedQuantity: line.quantity, availableQuantity: 2, available: true, reasons: [] })) };
      return h.control.transformResult ? h.control.transformResult(result) : result;
    } } });
  const input = { locationId: 'location-a', startAt: '2026-10-08T10:00:00Z', endAt: '2026-10-09T10:00:00Z', lines: [{ itemGroupId: 'group-a', quantity: 1 }] };
  const publish = value => root.source.publishAvailabilityInput({ taskId: 'task-a', registrationRef: 'availability-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: value ?? input });
  const plan = { ...h.clone(h.plan), steps: [{ registrationRef: 'availability-a', operation: 'readonly', toolCode: 'rental.availability.check', toolVersion: AI_TOOL_DRAFT_VERSION }] };
  const ready = async () => {
    await publish(); await root.evidence.savePlan(plan, lease);
    await auth.tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: lease.holderId,
      expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: h.state.aiRun[0].revision, expectedFencingToken: h.state.aiRun[0].fencingToken.toFixed(0) });
  };
  return { ...h, auth, lease, root, calls, input, publish, plan, ready };
}
test('availability runs through real durable plan/input/Guard/facts/result/resource chain without reserving inventory', async () => {
  const h = await setup(); await h.ready();
  assert.equal((await h.root.runner.run(h.claim())).status, 'succeeded');
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].tenantId, 'tenant-a');
  assert.equal(h.calls[0].identity.workspaceId, 'workspace-a');
  assert.deepEqual(h.calls[0].input, h.input);
  assert.equal(h.state.aiTaskResultArtifact[0].payload.result.available, true);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.equal(h.state.aiStep[0].inputRef, h.state.aiTaskActionInput[0].id);
});
for (const [label, mutate] of [
  ['policy disabled', h => { h.state.aiTaskPlanPolicy[0].enabled = false; }],
  ['policy revision changed', h => { h.state.aiTaskPlanPolicy[0].revision++; }],
  ['payload changed', h => { h.state.aiTaskActionInput[0].payload.lines[0].quantity++; }],
  ['scope changed', h => { h.identity.workspace = 'workspace-b'; }],
  ['permission withdrawn', h => { h.identity.user.permissions = []; }],
  ['membership withdrawn', h => { h.identity.membership = false; }]
]) test(`availability refuses ${label} before Core`, async () => {
  const h = await setup(); await h.ready(); mutate(h);
  await Promise.allSettled([h.root.runner.run(h.claim())]);
  assert.equal(h.calls.length, 0); assert.notEqual(h.state.aiTask[0].status, 'SUCCEEDED');
});
test('unknown fields cannot publish an availability input or widen the catalog producer', async () => {
  const h = await setup();
  await assert.rejects(h.publish({ ...h.input, sql: 'synthetic-only' }), e => e.code === 'AI_INVALID_INPUT');
  await assert.rejects(h.root.source.publishCatalogInput({}), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(h.state.aiTaskActionInput.length, 0);
});
test('revocation during Core does not persist a successful availability result', async () => {
  const h = await setup(); await h.ready(); h.control.onRead = () => { h.identity.membership = false; };
  await Promise.allSettled([h.root.runner.run(h.claim())]);
  assert.equal(h.calls.length, 1);
  assert.equal(h.state.aiTaskResultArtifact.filter(row => row.outcome === 'SUCCEEDED').length, 0);
});
test('interrupted availability keeps unknown occupancy and does not retry Core on recovery', async () => {
  const h = await setup(); await h.ready(); h.control.onRead = () => { throw Error('synthetic interruption'); };
  assert.equal((await h.root.runner.run(h.claim())).status, 'unknown');
  assert.equal((await h.root.runner.run({ ...h.claim(), holderId: 'recovery-worker', recovery: true })).status, 'unknown');
  assert.equal(h.calls.length, 1); assert.equal(h.state.aiTask[0].status, 'WAITING_EXTERNAL');
  assert.ok(h.state.aiTaskExecutionCharge.every(row => row.status === 'UNKNOWN'));
});
test('selected empty locations fail the real read authorization even with route permissions', async () => {
  const h = await setup(); h.identity.user.locationScope = { mode: 'selected', locationIds: [] }; await h.ready();
  await Promise.allSettled([h.root.runner.run(h.claim())]);
  assert.equal(h.calls.length, 0); assert.notEqual(h.state.aiTask[0].status, 'SUCCEEDED');
});
test('metadata permission alone cannot pass the actual availability route Guard', async () => {
  const h = await setup(); h.identity.user.permissions = ['rental-os:order:view']; await h.ready();
  await Promise.allSettled([h.root.runner.run(h.claim())]);
  assert.equal(h.calls.length, 0); assert.notEqual(h.state.aiTask[0].status, 'SUCCEEDED');
});
test('returned quantities for another request cannot become durable success', async () => {
  const h = await setup(); await h.ready();
  h.control.transformResult = result => { result.lines[0].requestedQuantity = 99; return result; };
  await Promise.allSettled([h.root.runner.run(h.claim())]);
  assert.equal(h.calls.length, 1); assert.equal(h.state.aiTaskResultArtifact.filter(row => row.outcome === 'SUCCEEDED').length, 0);
});
test('authorized server-selected availability policy is persisted without permitting caller tools', async () => {
  const h = await setup(); h.state.aiTaskPlanPolicy.length = 0; h.identity.user.permissions.push('system:params:manage');
  const { PrismaTaskPlanPolicyRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-policy.repository');
  const repo = new PrismaTaskPlanPolicyRepository(h.db, { ...h.authorization,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    scene: { code: 'synthetic-clarification', version: '1' }, tool: 'rental.availability.check' }, () => new Date(h.control.now));
  const draft = { expectedRevision: null, enabled: true, limits: h.clone(h.plan.limits), expiresAt: '2026-10-07T12:00:00Z' };
  await assert.rejects(repo.put({ ...draft, tool: 'rental.order.commit' }), e => e.code === 'AI_INVALID_INPUT');
  await repo.put(draft);
  assert.equal(h.state.aiTaskPlanPolicy[0].allowedTools[0].code, 'rental.availability.check');
  await h.ready(); assert.equal((await h.root.runner.run(h.claim())).status, 'succeeded');
});
