'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { setup, command, clone } = require('./fixtures/ai-native/step-registration.cjs');
const { createAiTaskRunnerRepositoryPorts } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.repository-adapter');
const { AiTaskRunner } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');

test('actual registration adapter preserves the run CAS revision for the next transition', async () => {
  const h = setup();
  const lease = { taskId: command.taskId, ...command.lease, expiresAt: h.state.run.leaseExpiresAt.toISOString() };
  const ports = createAiTaskRunnerRepositoryPorts({ tasks: {}, registrations: h.repository, transitions: h.transition(), commands: {
    register: (_plan, held) => ({ ...clone(command), lease: { runId: held.runId, holderId: held.holderId, revision: held.revision, fencingToken: held.fencingToken } }),
    transition: (_kind, ref, held) => ({ taskId: command.taskId, stepId: ref.registered.stepId,
      expectedTaskRevision: ref.registered.taskRevision, expectedStepRevision: ref.registered.stepRevision,
      evidenceId: 'evidence-start', reason: 'start', lease: { runId: held.runId, holderId: held.holderId, revision: held.revision, fencingToken: held.fencingToken } })
  } });
  const plan = { registrationRef: command.registrationRef, operation: 'readonly', toolCode: 'rental.order.explain', toolVersion: 'draft-1' };
  const registered = await ports.steps.register(plan, lease);
  assert.equal(registered.runRevision, h.state.run.revision);
  const commit = await ports.steps.start({ plan, registered }, { ...lease, revision: registered.runRevision });
  assert.equal(commit.lease.revision, h.state.run.revision);
  assert.equal(h.state.steps[0].status, 'RUNNING');
});

function harness(result, clock) {
  const input = { taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', expectedTaskRevision: 3,
    expectedRunRevision: 4, expectedFencingToken: '8', leaseMs: 1000 };
  const lease = { taskId: input.taskId, runId: input.runId, holderId: input.holderId, revision: 5, fencingToken: '9', expiresAt: '2026-10-05T00:00:01Z' };
  let expectedRevision = 5;
  const commit = async (_ref, held) => {
    assert.equal(held.revision, expectedRevision, 'runner must carry registration revision');
    return { lease: { ...held, revision: ++expectedRevision }, taskRevision: 5 };
  };
  const claim = async value => { assert.equal(Object.hasOwn(value, 'recovery'), false, 'strict persistence input excludes orchestration flag'); return lease; };
  const runner = new AiTaskRunner({ clock, leases: {
    readMetadata: async () => ({ taskId: input.taskId, revision: 3, status: 'running', cancelRequestedAt: null }),
    claimRun: claim, claimRecoveryRun: claim, releaseRun: async value => { assert.equal(value.expectedRunRevision, expectedRevision); return { released: true, revision: expectedRevision + 1 }; }
  }, plan: { resolve: async () => ({ taskId: input.taskId, runId: input.runId, taskRevision: 3,
    limits: { maxSteps: 1, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 100, maxConcurrent: 1, maxCalls: 1 },
    steps: [{ registrationRef: 's1', operation: 'readonly', toolCode: 'orders.read', toolVersion: '1' }] }) },
  steps: { register: async () => ({ stepId: 'step-1', runId: input.runId, sequence: 1, stepRevision: 1,
    taskRevision: 4, runRevision: ++expectedRevision, replayed: false, existingStatus: 'pending' }),
    start: commit, succeed: commit, fail: commit, pause: commit, unknown: commit }, effects: { execute: () => result() } });
  return { runner, input };
}

test('runner strips recovery flag and carries registration CAS into start and release', async () => {
  const h = harness(async () => ({ kind: 'succeeded', resultRef: 'result-1', outputBytes: 1 }));
  assert.equal((await h.runner.run({ ...h.input, recovery: true })).status, 'succeeded');
});

test('persisted failed result is not reported as a successful run', async () => {
  const h = harness(async () => ({ kind: 'failed', errorCode: 'AI_RESOURCE_UNAVAILABLE', outputBytes: 0 }));
  assert.deepEqual(await h.runner.run(h.input), { status: 'failed', errorCode: 'AI_RESOURCE_UNAVAILABLE', completedSteps: 0, cleanupFailed: 0 });
});

test('synchronous dependency throw releases the deadline timer', async () => {
  const timers = new Set();
  const clock = { now: () => 0, setTimeout: callback => { timers.add(callback); return callback; }, clearTimeout: handle => timers.delete(handle) };
  const h = harness(() => { throw Error('synthetic synchronous failure'); }, clock);
  assert.equal((await h.runner.run(h.input)).status, 'failed');
  assert.equal(timers.size, 0);
});
