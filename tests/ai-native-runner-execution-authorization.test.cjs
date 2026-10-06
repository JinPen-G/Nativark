'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' } });
const { taskInputHarness } = require('./fixtures/ai-native/task-input-harness.cjs');
const { composePersistentTaskRunner } = require('../apps/api/src/modules/ai-native/runner/persistent-task-runner.composition');
const { PrismaTaskMeasuredEffects } = require('../apps/api/src/modules/ai-native/runner/prisma-task-measured-effects');

// Only the execution policy is synthetic here; the runner, evidence and resource repositories are real.
async function setup() {
  const h = await taskInputHarness();
  h.control.executionAllowed = true;
  h.authorizationCalls = [];
  h.executionAuthorization = { authorize: async taskId => {
    h.authorizationCalls.push(taskId);
    if (!h.control.executionAllowed) throw Error('synthetic execution policy withdrawn');
    return h.context();
  } };
  h.configurationWithGate = () => ({ ...h.configuration(), executionAuthorization: h.executionAuthorization });
  h.runWithGate = inputs => composePersistentTaskRunner({ ...h.configurationWithGate(), inputs }).runner.run(h.claim());
  return h;
}

test('persistent runner and measured effects reject a missing execution authorization method at construction', async () => {
  const h = await setup();
  for (const executionAuthorization of [undefined, {}, { authorize: true }]) {
    assert.throws(() => composePersistentTaskRunner({ ...h.configuration(), executionAuthorization }), /AI_RESOURCE_UNAVAILABLE/);
    assert.throws(() => new PrismaTaskMeasuredEffects(h.db, h.tasks, h.make().evidence, h.configuration().executors, executionAuthorization), /AI_RESOURCE_UNAVAILABLE/);
  }
});

test('each newly executed step authorizes again rather than reusing claim or prior-step permission', async () => {
  const h = await setup();
  assert.equal((await h.runWithGate()).status, 'succeeded');
  assert.deepEqual(h.authorizationCalls, ['task-a', 'task-a']);
  assert.deepEqual(h.executions, ['input-clarify', 'input-continue']);
});

test('first success does not authorize the next effect after execution policy withdrawal', async () => {
  const h = await setup();
  h.control.execute = async () => { h.control.executionAllowed = false; return { kind: 'succeeded', payload: { synthetic: true } }; };
  await Promise.allSettled([h.runWithGate()]);
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiTaskResultArtifact.filter(a => a.completeMeasurement).length, 1);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.deepEqual(h.authorizationCalls, ['task-a', 'task-a']);
});

test('execution is reauthorized after asynchronous clarification reading, not before it', async () => {
  const h = await setup();
  const inputs = { afterSucceeded: async () => null, readForStep: async () => { await Promise.resolve(); h.control.executionAllowed = false; return []; } };
  await Promise.allSettled([h.runWithGate(inputs)]);
  assert.deepEqual(h.executions, []);
  assert.deepEqual(h.authorizationCalls, ['task-a']);
});

for (const [name, mutate] of Object.entries({
  actor: c => { c.actor.userId = 'other-user'; },
  scope: c => { c.scope.workspaceId = 'other-workspace'; },
  audience: c => { c.audience = 'staff'; },
  malformed: c => { delete c.contractVersion; }
})) test(`execution context rejects ${name} mismatch against the original step access`, async () => {
  const h = await setup();
  h.executionAuthorization.authorize = async () => { const context = h.context(); mutate(context); return context; };
  await Promise.allSettled([h.runWithGate()]);
  assert.deepEqual(h.executions, []);
  assert.equal(h.state.aiTaskResultArtifact.some(a => a.completeMeasurement), false);
});

test('an execution-authorization wait cannot outlive the runner cancellation signal', async () => {
  const h = await setup();
  let fireTimer;
  const clock = { now: () => 0, setTimeout: fn => { fireTimer = fn; return fn; }, clearTimeout() {} };
  h.executionAuthorization.authorize = async () => { const current = fireTimer; await Promise.resolve(); current(); return h.context(); };
  await Promise.allSettled([composePersistentTaskRunner({ ...h.configurationWithGate(), clock }).runner.run(h.claim())]);
  assert.deepEqual(h.executions, []);
});

test('durable-result reconciliation and interrupted reads never call the new execution gate', async () => {
  const h = await setup();
  h.control.execute = async () => { throw Error('synthetic interrupted executor'); };
  await Promise.allSettled([h.runWithGate()]);
  h.control.executionAllowed = false;
  const before = h.clone(h.state.aiTaskResultArtifact), lease = await h.tasks.claimRecoveryRun(h.claim());
  const effects = new PrismaTaskMeasuredEffects(h.db, h.tasks, h.make().evidence, h.configuration().executors, h.executionAuthorization, undefined, () => h.control.now);
  assert.equal((await effects.reconcile(h.plan.steps[0], new AbortController().signal, lease)).kind, 'unknown');
  assert.equal((await effects.readInterrupted(h.plan.steps[0], new AbortController().signal, lease)).kind, 'unknown');
  assert.deepEqual(h.authorizationCalls, ['task-a']);
  assert.deepEqual(h.executions, ['input-clarify']);
  assert.deepEqual(h.state.aiTaskResultArtifact, before);
});
