'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
require('./fixtures/ai-native/local-shared.cjs');
const { taskInputHarness } = require('./fixtures/ai-native/task-input-harness.cjs');
const { PrismaTaskStepEvidenceAuthority } = require('../apps/api/src/modules/ai-native/runner/prisma-task-step-evidence.authority');
const { AiStepTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-step-transition.repository');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
async function setup() {
  const h = await taskInputHarness();
  const authority = new PrismaTaskStepEvidenceAuthority(h.db, h.taskAuthority, h.planAuthority, () => new Date(h.control.now));
  const transitions = new AiStepTransitionRepository(h.db, authority, () => new Date(h.control.now));
  h.compose = () => {
    const { composePersistentTaskRunner } = require('../apps/api/src/modules/ai-native/runner/persistent-task-runner.composition');
    return composePersistentTaskRunner({ ...h.configuration(), transitions });
  };
  return { ...h, authority, commands: h.configuration().commands };
}
test('persisted evidence advances actual runner steps only after durable measured results', async () => {
  const h = await setup();
  assert.equal((await h.compose().runner.run(h.claim())).status, 'succeeded');
  assert.equal(h.state.aiStep.length, 2);
  assert.ok(h.state.aiStep.every(s => s.status === 'SUCCEEDED' && s.resultRef));
  assert.equal(h.state.aiTaskResultArtifact.length, 2);
  assert.ok(h.state.aiTaskResultArtifact.every(a => a.completeMeasurement));
});
async function completed() {
  const h = await setup();
  const lease = await h.tasks.claimRun(h.claim());
  const cfg = h.compose();
  await cfg.accounting.initialize(lease.taskId, lease);
  const p = h.plan.steps[0];
  const registered = await h.registrations.register(h.commands.register(p, lease));
  lease.revision = registered.runRevision;
  let ref = { plan: p, registered };
  const start = h.commands.transition('start', ref, lease, null);
  const { AiStepTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-step-transition.repository');
  const transitioned = await new AiStepTransitionRepository(h.db, h.authority, () => new Date(h.control.now)).transition(start);
  lease.revision = transitioned.runRevision;
  ref.registered.taskRevision = transitioned.event.taskRevision;
  ref.registered.stepRevision += 1;
  // Use the production runner for the complete chain in the main test. Here a
  // separately completed harness supplies genuine production-created artifacts.
  const other = await setup();
  await other.compose().runner.run(other.claim());
  const source = other.state.aiTaskResultArtifact[0];
  const step = h.state.aiStep[0];
  const artifact = { ...h.clone(source), id: 'artifact-a', stepId: step.id, actionId: step.actionId,
    stepFingerprint: step.requestFingerprint, leaseOwnerId: lease.holderId, fencingToken: h.state.aiRun[0].fencingToken };
  h.state.aiTaskResultArtifact.push(artifact);
  for (const charge of other.state.aiTaskExecutionCharge.filter(c => c.stepId === source.stepId)) {
    h.state.aiTaskExecutionCharge.push({ ...h.clone(charge), stepId: step.id, actionId: step.actionId,
      stepFingerprint: step.requestFingerprint, leaseOwnerId: lease.holderId, fencingToken: artifact.fencingToken });
  }
  return { ...h, command: h.commands.transition('succeed', ref, lease, artifact.id), artifact };
}
for (const [label, mutate] of [
  ['wrong actor', h => { h.control.context.actor.userId = 'other'; }],
  ['revoked authorization', h => { h.control.revoked = true; }],
  ['modified plan', h => { h.state.aiTaskRunPlan[0].payload.limits.maxCalls = 3; }],
  ['expired plan proof', h => { h.planAuthority.authorize = async () => ({ authorityHash: 'a'.repeat(64), policyVersion: 'synthetic-policy', expiresAt: h.control.now.toISOString() }); }],
  ['cross-call artifact', h => { h.artifact.actionId = 'other'; }],
  ['tampered result', h => { h.artifact.payload = { forged: true }; }],
  ['incomplete result', h => { h.artifact.completeMeasurement = false; }],
  ['old holder', h => { h.artifact.leaseOwnerId = 'old'; }],
  ['wrong byte count', h => { h.artifact.outputBytes += 1n; }],
  ['cross-scope charge', h => { h.state.aiTaskExecutionCharge[0].scopeId = 'other'; }],
  ['old charge fence', h => { h.state.aiTaskExecutionCharge[0].fencingToken = new (require('../apps/api/node_modules/@prisma/client').Prisma.Decimal)(999); }],
  ['missing resource evidence', h => { h.state.aiTaskExecutionCharge.length = 0; }],
  ['write plan without Core receipt', h => { h.state.aiTaskRunPlan[0].payload.steps[0].operation = 'idempotent';
    h.state.aiTaskRunPlan[0].planHash = requestFingerprint(h.state.aiTaskRunPlan[0].payload); }],
  ['commit tool falsely labeled read-only', h => {
    h.state.aiStep[0].toolCode = 'rental.order.commit';
    h.state.aiTaskRunPlan[0].payload.steps[0].toolCode = 'rental.order.commit';
    h.state.aiTaskRunPlan[0].planHash = requestFingerprint(h.state.aiTaskRunPlan[0].payload);
  }],
]) test(`persisted evidence denies ${label} without writing step/event`, async () => {
  const h = await completed(); mutate(h);
  const before = h.clone(h.state.aiStep), count = h.state.aiTaskEvent.length;
  await assert.rejects(new AiStepTransitionRepository(h.db, h.authority, () => new Date(h.control.now)).transition(h.command));
  assert.deepEqual(h.state.aiStep, before);
  assert.equal(h.state.aiTaskEvent.length, count);
});

test('identity changed during evidence read is rejected before any event', async () => {
  const h = await completed();
  h.storeControl.beforeRead = async name => {
    if (name === 'aiTaskResultArtifact') h.control.context.scope.workspaceId = 'other';
  };
  const count = h.state.aiTaskEvent.length;
  await assert.rejects(new AiStepTransitionRepository(h.db, h.authority, () => new Date(h.control.now)).transition(h.command));
  assert.equal(h.state.aiTaskEvent.length, count);
  assert.equal(h.state.aiStep[0].status, 'RUNNING');
});

test('explicit assembly uses actual AuthService, stored action policy and persisted step evidence', async () => {
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { composeAuthorizedReadonlyPersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition');
  const h = await authorizedRunnerHarness();
  const { transitionAuthority: _syntheticTransition, ...input } = h.configuration();
  const root = composeAuthorizedReadonlyPersistentTaskInputRunner(input);
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  assert.equal(h.executions.length, 2);
  assert.ok(h.state.aiStep.every(s => s.status === 'SUCCEEDED'));
});
test('stored action policy withdrawal prevents the next effect in actual assembly', async () => {
  const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
  const { composeAuthorizedReadonlyPersistentTaskInputRunner } = require('../apps/api/src/modules/ai-native/runner/authorized-persistent-task-input.composition');
  const h = await authorizedRunnerHarness();
  const { transitionAuthority: _syntheticTransition, ...input } = h.configuration();
  const root = composeAuthorizedReadonlyPersistentTaskInputRunner(input);
  let revoked = false;
  h.storeControl.beforeCommit = async draft => {
    if (!revoked && draft.aiStep[0]?.status === 'SUCCEEDED') {
      revoked = true;
      draft.aiTaskActionPolicy = draft.aiTaskActionPolicy.filter(p => p.operation !== 'transition_task');
    }
  };
  await Promise.allSettled([root.runner.run(h.claim())]);
  assert.equal(revoked, true);
  assert.equal(h.executions.length, 1);
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
});
test('known failure is persisted without retry permission or raw error text', async () => {
  const h = await setup();
  h.control.execute = () => ({ kind: 'failed', errorCode: 'AI_BUSINESS_REJECTED', payload: { internal: 'synthetic-private' } });
  const result = await h.compose().runner.run(h.claim());
  assert.equal(result.status, 'failed');
  assert.equal(h.state.aiStep[0].status, 'FAILED');
  assert.equal(h.executions.length, 1);
  assert.ok(h.state.aiStep[0].resultRef);
});

test('lost step commit acknowledgement keeps result/event and reports reconcile, never safe retry', async () => {
  const h = await completed();
  h.storeControl.loseReply = true;
  const transitions = new AiStepTransitionRepository(h.db, h.authority, () => new Date(h.control.now));
  await assert.rejects(transitions.transition(h.command), error => error.code === 'AI_RESULT_UNKNOWN'
    && error.retryable === false && error.nextAction === 'reconcile');
  assert.equal(h.state.aiStep[0].status, 'SUCCEEDED');
  assert.equal(h.state.aiStep[0].resultRef, h.artifact.id);
  const count = h.state.aiTaskEvent.length;
  await assert.rejects(transitions.transition(h.command));
  assert.equal(h.state.aiTaskEvent.length, count);
});
