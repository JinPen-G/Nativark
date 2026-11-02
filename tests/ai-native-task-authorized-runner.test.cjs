'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
const compose = input => require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition').composeAuthorizedPersistentTaskInputRunner(input);

test('formal persisted authorization composes with actual runner, evidence, accounting and input repositories', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose();
  const policies = h.clone(h.state.aiTaskActionPolicy), gates = h.clone(h.state.aiBudgetPolicy);
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.completeMeasurement).length, 2);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedActiveMs, 20n);
  assert.deepEqual(h.state.aiTaskActionPolicy, policies); assert.deepEqual(h.state.aiBudgetPolicy, gates);
});

for (const mode of ['platform_managed', 'tenant_managed']) test(`current ${mode} service and plan policy drive the actual runner without legacy budget seeding`, async () => {
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [] });
  h.state.aiTenantModelConfiguration.push({ tenantId: 'tenant-a', mode, revision: 1, serviceEnabled: true,
    settings: mode === 'tenant_managed' ? { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://synthetic.example.test/v1',
      model: 'synthetic-model', timeoutMs: 30000, maxConcurrent: 2, maxOutputTokens: 2048 } : null,
    credentialsEncrypted: mode === 'tenant_managed' ? 'v2:synthetic:YWJj:YWJj:YWJj' : null });
  h.state.aiBudgetPolicy = h.state.aiBudgetPolicy.filter(policy => policy.scopeKind === 'PLATFORM');
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: 'synthetic-clarification', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'rental.order.explain', version: AI_TOOL_DRAFT_VERSION }], limits: h.clone(h.plan.limits), expiresAt: new Date('2027-01-01') });
  const gates = h.clone(h.state.aiBudgetPolicy);
  assert.equal((await h.compose().runner.run(h.claim())).status, 'succeeded');
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 2n);
  assert.deepEqual(h.state.aiBudgetPolicy, gates);
});

for (const field of ['auth', 'credentials', 'subscriptions']) test(`authorized runner requires explicit ${field}`, async () => {
  const h = await authorizedRunnerHarness(), input = h.configuration(); delete input.authorization[field];
  assert.throws(() => compose(input), /AI_RESOURCE_UNAVAILABLE|AI_ACCESS_DENIED/);
  assert.deepEqual(h.executions, []);
});
for (const field of ['registrationAuthority', 'transitionAuthority', 'inputSource', 'planAuthority', 'executors', 'commands']) {
  test(`authorized runner cannot silently default ${field}`, async () => {
    const h = await authorizedRunnerHarness(), input = h.configuration(); delete input[field];
    assert.throws(() => compose(input), /AI_RESOURCE_UNAVAILABLE|AI_ACCESS_DENIED/);
  });
}

test('caller-supplied permissive tasks and execution gate cannot replace the composed persisted authority', async () => {
  const h = await authorizedRunnerHarness(); h.state.aiBudgetPolicy[0].enabled = false;
  const root = compose({ ...h.configuration(), tasks: h.tasks, executionAuthorization: { authorize: async () => h.context() } });
  await assert.rejects(root.runner.run(h.claim()));
  assert.deepEqual(h.executions, []); assert.equal(h.state.aiStep.length, 0);
});

for (const [name, mutate] of Object.entries({
  'missing task policy': h => { h.state.aiTaskActionPolicy = []; },
  'missing platform gate': h => { h.state.aiBudgetPolicy = h.state.aiBudgetPolicy.slice(1); },
  'unreleased AI feature': h => { h.state.subscriptionFeatureCatalog[0].releaseStatus = 'PLANNED'; },
  'expired subscription': h => { h.state.tenant[0].subscription.endAt = h.control.now; },
  'revoked membership': h => { h.identity.membership = false; }
})) test(`actual composed runner denies ${name} without seeding replacements`, async () => {
  const h = await authorizedRunnerHarness(); mutate(h); const before = h.clone(h.state);
  await assert.rejects(h.compose().runner.run(h.claim()));
  assert.deepEqual(h.executions, []); assert.deepEqual(h.state, before);
});

test('disabled AI denies new claims while lawful metadata and lease cleanup still use current action policy', async () => {
  const h = await authorizedRunnerHarness(), root = h.compose();
  const lease = await root.authorization.tasks.claimRun(h.claim());
  h.state.aiBudgetPolicy[0].enabled = false;
  assert.equal((await root.authorization.tasks.readMetadata('task-a')).status, 'running');
  assert.equal((await root.authorization.tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: lease.holderId,
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: lease.revision, expectedFencingToken: lease.fencingToken })).released, true);
  await assert.rejects(root.authorization.tasks.claimRun(h.claim()));
  assert.deepEqual(h.executions, []);
});
