'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
const { PrismaTaskPlanInputSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-input.source');
const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
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
