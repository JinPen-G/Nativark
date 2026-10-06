'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { PrismaTaskPlanPolicyRepository } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-policy.repository');
async function setup() {
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [] });
  h.identity.user.permissions.push('system:params:manage');
  const input = { ...h.authorization, guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    scene: { code: 'synthetic-clarification', version: '1' } };
  const repo = new PrismaTaskPlanPolicyRepository(h.db, input, () => new Date(h.control.now));
  const command = { expectedRevision: null, enabled: false, limits: h.clone(h.plan.limits), expiresAt: '2026-10-07T12:00:00Z' };
  return { ...h, repo, input, command };
}
test('actual Auth/Guard manages a default-disabled policy with CAS and reconstructs it from storage', async () => {
  const h = await setup();
  assert.deepEqual(await h.repo.read(), { state: 'not_configured' });
  assert.equal((await h.repo.put(h.command)).revision, 1);
  assert.equal(h.state.aiTaskPlanPolicy[0].scopeId, 'scope-a');
  assert.equal(h.state.aiTaskPlanPolicy[0].enabled, false);
  assert.equal((await h.repo.put({ ...h.command, expectedRevision: 1, enabled: true })).revision, 2);
  const rebuilt = new PrismaTaskPlanPolicyRepository(h.db, h.input, () => new Date(h.control.now));
  assert.equal((await rebuilt.read()).revision, 2);
  await assert.rejects(h.repo.put({ ...h.command, expectedRevision: 1 }), e => e.code === 'AI_REVISION_CONFLICT');
});
test('concurrent first writers and stale updates cannot overwrite a winning policy', async () => {
  const h = await setup();
  const results = await Promise.allSettled([h.repo.put(h.command), h.repo.put(h.command)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(h.state.aiTaskPlanPolicy.length, 1);
});
for (const [label, change] of [
  ['permission withdrawn', h => { h.identity.user.permissions = ['rental-os:order:view']; }],
  ['workspace membership revoked', h => { h.identity.membership = false; }],
  ['foreign workspace', h => { h.identity.workspace = 'foreign-space'; }],
]) test(`actual management Guard rejects ${label}`, async () => {
  const h = await setup(); change(h);
  await assert.rejects(h.repo.put(h.command), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskPlanPolicy.length, 0);
});
test('caller cannot supply scope, scene, tools or arbitrary limits', async () => {
  const h = await setup();
  for (const patch of [{ scopeId: 'other' }, { sceneCode: 'other' }, { allowedTools: ['sql'] }, { limits: { ...h.command.limits, maxConcurrent: 2 } }, { expectedRevision: 0 }]) {
    await assert.rejects(h.repo.put({ ...h.command, ...patch }), e => e.code === 'AI_INVALID_INPUT');
  }
  assert.equal(h.state.aiTaskPlanPolicy.length, 0);
});
test('withdrawn config permission after staged write rolls back the actual policy transaction', async () => {
  const h = await setup();
  h.storeControl.beforeWrite = async name => { if (name === 'aiTaskPlanPolicy') h.identity.user.permissions = []; };
  await assert.rejects(h.repo.put(h.command), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(h.state.aiTaskPlanPolicy.length, 0);
});
test('lost commit reply retains the policy and requires authorized read, not blind write retry', async () => {
  const h = await setup(); h.storeControl.loseReply = true;
  await assert.rejects(h.repo.put(h.command), e => e.code === 'AI_RESULT_UNKNOWN' && e.retryable === false && e.nextAction === 'reconcile');
  assert.equal(h.state.aiTaskPlanPolicy.length, 1);
  assert.equal((await h.repo.read()).revision, 1);
  await assert.rejects(h.repo.put(h.command), e => e.code === 'AI_REVISION_CONFLICT');
});
test('managed policy drives actual immutable input/plan proof and disabling invalidates it', async () => {
  const h = await setup();
  // The harness's bootstrap plan is unrelated to this new input producer.
  h.state.aiTaskRunPlan.length = 0;
  h.state.aiTaskActionInput = [];
  // Recreate the real Prisma-shaped store including the new table; the same
  // real Auth/Guard is retained, not a fixture policy success callback.
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const store = createTaskInputStore(h.state);
  const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
  const { PrismaTaskPlanInputSource } = require('../apps/api/src/modules/ai-native/runner/prisma-task-plan-input.source');
  const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
  const management = new PrismaTaskPlanPolicyRepository(store.db, h.input, () => new Date(h.control.now));
  await management.put({ ...h.command, enabled: true });
  const auth = composePersistedTaskAuthorization({ ...h.authorization, db: store.db, clock: () => new Date(h.control.now) });
  const source = new PrismaTaskPlanInputSource(store.db, auth.authority, auth.execution, () => new Date(h.control.now));
  const lease = await auth.tasks.claimRun(h.claim());
  await source.publishCatalogInput({ taskId: 'task-a', registrationRef: 'managed-catalog',
    expectedTaskRevision: store.state.aiTask[0].revision, lease, input: { limit: 5 } });
  const plan = { ...h.clone(h.plan), steps: [{ registrationRef: 'managed-catalog', operation: 'readonly',
    toolCode: 'rental.catalog.search', toolVersion: AI_TOOL_DRAFT_VERSION }] };
  const proof = await source.authorize(plan, lease);
  assert.equal(proof.policyVersion, 'scene-policy-1');
  await management.put({ ...h.command, expectedRevision: 1, enabled: false });
  await assert.rejects(source.authorize(plan, lease));
  assert.equal(store.state.aiTaskActionInput.length, 1);
  assert.equal(store.state.aiTaskResultArtifact.length, 0);
});
