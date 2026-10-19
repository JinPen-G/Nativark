'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { setup, command, clone } = require('./fixtures/ai-native/step-registration.cjs');
const { createAiTaskRunnerRepositoryPorts } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.repository-adapter');
const { AiTaskTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-task-transition.repository');
const { createAiTaskRunnerOutcomePort } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner-outcome-adapter');
const { AiTaskRunner } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');
const { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } = require('../packages/shared/src/index.ts');
const { evaluateAiTaskTransitionDraft, evaluateAiTaskConfirmationTransitionDraft } = require('../apps/api/src/modules/ai-native/task-transition-draft');

for (const [name, mutate] of [
  ['task', result => { result.event.taskId = 'other-task'; }],
  ['run', result => { result.event.data.runId = 'other-run'; }],
  ['step', result => { result.event.data.stepId = 'other-step'; }],
  ['event type', result => { result.event.type = 'task.transition'; }],
  ['status', result => { result.event.data.status = 'succeeded'; }],
  ['task revision', result => { result.event.taskRevision++; }],
  ['step revision', result => { result.event.data.stepRevision++; }],
  ['run revision', result => { result.runRevision++; }]
]) test(`actual runner adapter rejects mismatched ${name} acknowledgement without repeating a committed transition`, async () => {
  const h = setup(), transition = h.transition(); let writes = 0;
  const lease = { taskId: command.taskId, ...command.lease, expiresAt: h.state.run.leaseExpiresAt.toISOString() };
  const ports = createAiTaskRunnerRepositoryPorts({ tasks: {}, registrations: h.repository,
    transitions: { transition: async value => { writes++; const result = await transition.transition(value); mutate(result); return result; } },
    commands: {
      register: (_plan, held) => ({ ...clone(command), lease: { runId: held.runId, holderId: held.holderId, revision: held.revision, fencingToken: held.fencingToken } }),
      transition: (_kind, ref, held) => ({ taskId: command.taskId, stepId: ref.registered.stepId,
        expectedTaskRevision: ref.registered.taskRevision, expectedStepRevision: ref.registered.stepRevision,
        evidenceId: 'evidence-start', reason: 'start', lease: { runId: held.runId, holderId: held.holderId, revision: held.revision, fencingToken: held.fencingToken } })
    } });
  const plan = { registrationRef: command.registrationRef, operation: 'readonly', toolCode: 'rental.order.explain', toolVersion: 'draft-1' };
  const registered = await ports.steps.register(plan, lease);
  await assert.rejects(ports.steps.start({ plan, registered }, { ...lease, revision: registered.runRevision }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(writes, 1); assert.equal(h.state.steps[0].status, 'RUNNING');
  // A rejected acknowledgement is not proof of rollback or permission to resend.
});

for (const [name, mutate] of [
  ['task', result => { result.event.taskId = 'other-task'; }],
  ['version', result => { result.event.contractVersion = 'unknown'; }],
  ['event type', result => { result.event.type = 'step.changed'; }],
  ['status', result => { result.event.data.to = 'waiting_input'; }],
  ['reason', result => { result.event.data.reason = 'resume'; }],
  ['run revision', result => { result.runRevision++; }]
]) test(`aggregate outcome refuses mismatched ${name} after an actual committed task transition`, async () => {
  const h = setup(); await h.run();
  Object.assign(h.state.steps[0], { status: 'SUCCEEDED', effect: 'COMMITTED' });
  const repository = new AiTaskTransitionRepository(h.db, { resolve: async () => clone(h.state.grant.context) }, () => new Date(h.state.clock));
  let calls = 0;
  const port = createAiTaskRunnerOutcomePort({ commands: { transition: input => clone(input) },
    transitions: { transition: async input => { calls++; const result = await repository.transition(input); mutate(result); return result; } } });
  await assert.rejects(port.commit({ taskId: command.taskId, taskRevision: h.state.task.revision,
    lease: { taskId: command.taskId, ...command.lease, revision: h.state.run.revision, expiresAt: h.state.run.leaseExpiresAt.toISOString() },
    outcome: { status: 'succeeded', completedSteps: 1, cleanupFailed: 0 } }), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(calls, 1); assert.equal(h.state.task.status, 'SUCCEEDED');
});

function confirmationHarness(mutate = () => {}) {
  const lease = { taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', revision: 7, fencingToken: '9', expiresAt: '2027-01-01T00:00:00Z' };
  const plan = { registrationRef: 'commit-a', operation: 'idempotent', toolCode: 'rental.order.commit', toolVersion: AI_TOOL_DRAFT_VERSION };
  const ref = { plan, registered: { stepId: 'step-a', runId: 'run-a', sequence: 1, stepRevision: 2, taskRevision: 5,
    runRevision: 7, replayed: false, existingStatus: 'pending' } };
  const calls = [];
  const confirmation = { pause: async input => {
    calls.push(clone(input));
    const result = { runId: input.lease.runId, runRevision: input.lease.revision + 1, stepId: input.stepId,
      stepRevision: input.expectedStepRevision, checkpointRef: input.checkpointRef,
      event: { contractVersion: AI_TASK_DRAFT_VERSION, type: 'task.transition', taskId: input.taskId,
        taskRevision: input.expectedTaskRevision + 1, cursor: '7', occurredAt: '2026-10-08T00:00:00Z',
        data: { from: 'running', to: 'waiting_confirmation', reason: 'confirmation_required' } } };
    mutate(result, input);
    return result;
  } };
  const adapters = { tasks: {}, registrations: {}, transitions: { transition: () => assert.fail('confirmation must not use step transition') },
    commands: { transition: () => assert.fail('confirmation must not fabricate a step command') }, confirmation };
  return { lease, ref, calls, adapters, ports: createAiTaskRunnerRepositoryPorts(adapters) };
}

test('confirmation adapter accepts a synthetic task checkpoint acknowledgement without incrementing the step revision', async () => {
  const h = confirmationHarness();
  const result = await h.ports.steps.pause(h.ref, h.lease, 'confirmation', 'phase-receipt-a');
  assert.equal(result.taskRevision, 6);
  assert.equal(result.lease.revision, 8);
  assert.deepEqual(result.confirmation, { stepId: 'step-a', stepRevision: 2, checkpointRef: 'phase-receipt-a' });
  assert.equal(h.ref.registered.stepRevision, 2);
  assert.equal(h.calls.length, 1);
});

for (const [name, mutate] of [
  ['step event', value => { value.event.type = 'step.changed'; }],
  ['run binding', value => { value.runId = 'other-run'; }],
  ['step revision', value => { value.stepRevision++; }],
  ['checkpoint', value => { value.checkpointRef = 'other-receipt'; }],
  ['task target', value => { value.event.data.to = 'waiting_external'; }],
  ['mutated lease', (value, input) => { input.lease.holderId = 'other-worker'; input.lease.revision = 20; value.runRevision = 21; }]
]) test(`confirmation adapter rejects ${name} acknowledgement without retrying`, async () => {
  const h = confirmationHarness(mutate);
  await assert.rejects(h.ports.steps.pause(h.ref, h.lease, 'confirmation', 'phase-receipt-a'), error => error.code === 'AI_RESULT_UNKNOWN');
  assert.equal(h.calls.length, 1);
});

test('confirmation adapter fails closed before a missing port, receipt, readonly or model pause', async () => {
  const h = confirmationHarness();
  await assert.rejects(createAiTaskRunnerRepositoryPorts({ ...h.adapters, confirmation: undefined }).steps.pause(h.ref, h.lease, 'confirmation', 'receipt-a'), /AI_RESOURCE_UNAVAILABLE/);
  await assert.rejects(h.ports.steps.pause(h.ref, h.lease, 'confirmation', null), /AI_RESOURCE_UNAVAILABLE/);
  for (const [operation, toolCode] of [['readonly', 'rental.order.explain'], ['external_unknown', 'ai.model.text']]) {
    await assert.rejects(h.ports.steps.pause({ ...h.ref, plan: { ...h.ref.plan, operation, toolCode } }, h.lease, 'confirmation', 'receipt-a'), /AI_RESOURCE_UNAVAILABLE/);
  }
  assert.equal(h.calls.length, 0);
});

test('runner consumes a synthetic confirmation checkpoint without settling charges or committing a second task transition', async () => {
  const h = confirmationHarness();
  const input = { taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', expectedTaskRevision: 3,
    expectedRunRevision: 4, expectedFencingToken: '8', leaseMs: 10000 };
  const counts = { reserve: 0, execute: 0, release: 0 };
  const runner = new AiTaskRunner({
    leases: {
      readMetadata: async () => ({ taskId: input.taskId, revision: 3, status: 'running', cancelRequestedAt: null }),
      claimRun: async () => ({ ...h.lease, revision: 5 }),
      claimRecoveryRun: async () => assert.fail('not recovery'),
      releaseRun: async value => {
        counts.release++;
        assert.equal(value.expectedTaskRevision, 6); assert.equal(value.expectedRunRevision, 8);
        return { released: true, revision: 9 };
      }
    },
    plan: { resolve: async () => ({ taskId: input.taskId, runId: input.runId, taskRevision: 3, steps: [h.ref.plan],
      limits: { maxSteps: 1, maxCalls: 1, maxConcurrent: 1, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 100 } }) },
    steps: {
      ...h.ports.steps,
      register: async () => ({ ...h.ref.registered, stepRevision: 1, taskRevision: 4, runRevision: 6 }),
      start: async (_ref, lease) => ({ lease: { ...lease, revision: 7 }, taskRevision: 5 })
    },
    effects: { execute: async () => { counts.execute++; return { kind: 'paused', pause: 'confirmation', resultRef: 'receipt-a', outputBytes: 17 }; } },
    resources: {
      open: async () => {}, reserve: async () => { counts.reserve++; return { chargeIds: ['steps', 'active', 'output'] }; },
      record: async () => assert.fail('waiting is not settlement'),
      markUnknown: async () => assert.fail('a recorded waiting phase retains the original reservations')
    },
    taskOutcome: { commit: async () => assert.fail('checkpoint already committed the task transition') }
  });
  assert.deepEqual(await runner.run(input), { status: 'paused', completedSteps: 0, cleanupFailed: 0 });
  assert.deepEqual(counts, { reserve: 1, execute: 1, release: 1 });
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].expectedStepRevision, 2);
});

function confirmationState(from = 'running') {
  const state = { contractVersion: AI_TASK_DRAFT_VERSION, taskId: 'task-a', revision: 5, status: from,
    steps: [{ stepId: 'step-a', runId: 'run-a', sequence: 1, revision: 2, actionId: 'action-a', outcome: { status: 'running', effect: 'possible' } }] };
  const request = { contractVersion: AI_TASK_DRAFT_VERSION, taskId: 'task-a', expectedRevision: 5,
    to: from === 'running' ? 'waiting_confirmation' : 'running', reason: from === 'running' ? 'confirmation_required' : 'resume',
    occurredAt: '2026-10-08T00:00:00Z', initiator: { kind: 'worker', id: 'worker-a' } };
  const checkpoint = { stepId: 'step-a', runId: 'run-a', stepRevision: 2, actionId: 'action-a' };
  return { state, request, checkpoint };
}

test('confirmation state predicate permits only its exact running step while ordinary transitions keep rejecting unresolved steps', () => {
  for (const from of ['running', 'waiting_confirmation']) {
    const h = confirmationState(from), before = clone(h);
    assert.deepEqual(evaluateAiTaskTransitionDraft(h.state, h.request), { allowed: false, reason: 'unresolved_steps' });
    assert.deepEqual(evaluateAiTaskConfirmationTransitionDraft(h.state, h.request, h.checkpoint), { allowed: true, nextRevision: 6 });
    assert.deepEqual(h, before);
  }
});

test('confirmation state predicate preserves revision, identity, cancellation and unknown-result barriers', () => {
  const evaluate = mutate => {
    const h = confirmationState(); mutate(h);
    assert.equal(evaluateAiTaskConfirmationTransitionDraft(h.state, h.request, h.checkpoint).allowed, false);
  };
  for (const key of ['stepId', 'runId', 'actionId']) evaluate(h => { h.checkpoint[key] = 'foreign'; });
  evaluate(h => { h.checkpoint.stepRevision++; });
  evaluate(h => { h.request.expectedRevision--; });
  evaluate(h => { h.request.reason = 'completed'; });
  evaluate(h => { h.state.status = 'cancel_requested'; });
  evaluate(h => { h.request.to = 'succeeded'; h.request.reason = 'completed'; });
  evaluate(h => { h.state.steps[0].outcome.status = 'unknown'; });
  evaluate(h => { h.state.steps[0].outcome.effect = 'none'; });
  evaluate(h => { h.state.steps = []; });
  for (const status of ['running', 'unknown']) evaluate(h => {
    h.state.steps.push({ ...clone(h.state.steps[0]), stepId: 'step-b', sequence: 2, actionId: 'action-b', outcome: { status, effect: 'possible' } });
  });
});
