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

function harness(result, clock, release) {
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
    claimRun: claim, claimRecoveryRun: claim, releaseRun: release ?? (async value => { assert.equal(value.expectedRunRevision, expectedRevision); return { released: true, revision: expectedRevision + 1 }; })
  }, plan: { resolve: async () => ({ taskId: input.taskId, runId: input.runId, taskRevision: 3,
    limits: { maxSteps: 1, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 100, maxConcurrent: 1, maxCalls: 1 },
    steps: [{ registrationRef: 's1', operation: 'readonly', toolCode: 'orders.read', toolVersion: '1' }] }) },
  steps: { register: async () => ({ stepId: 'step-1', runId: input.runId, sequence: 1, stepRevision: 1,
    taskRevision: 4, runRevision: ++expectedRevision, replayed: false, existingStatus: 'pending' }),
    start: commit, succeed: commit, fail: commit, pause: commit, unknown: commit }, effects: { execute: () => result() } });
  return { runner, input };
}

test('new execution strips an explicit false recovery flag and carries registration CAS into start and release', async () => {
  const h = harness(async () => ({ kind: 'succeeded', resultRef: 'result-1', outputBytes: 1 }));
  assert.equal((await h.runner.run({ ...h.input, recovery: false })).status, 'succeeded');
});

test('recovery strips its flag but cannot start a newly registered step from a legacy adapter', async () => {
  const h = harness(async () => assert.fail('recovery must not execute'));
  assert.equal((await h.runner.run({ ...h.input, recovery: true })).status, 'unavailable');
});

test('actual recovery registration refuses missing original steps without any registration CAS', async () => {
  const h = setup(), before = clone(h.state);
  const lease = { taskId: command.taskId, ...command.lease, expiresAt: h.state.run.leaseExpiresAt.toISOString() };
  const ports = createAiTaskRunnerRepositoryPorts({ tasks: {}, registrations: h.repository, transitions: {},
    commands: { register: () => clone(command), transition: () => assert.fail('recovery must not start') } });
  await assert.rejects(ports.steps.register({ registrationRef: command.registrationRef, operation: 'readonly',
    toolCode: 'rental.order.explain', toolVersion: 'draft-1' }, lease, true), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  for (const key of ['task', 'run', 'steps', 'events', 'ids', 'commits']) assert.deepEqual(h.state[key], before[key], key);
  assert.equal(h.state.calls.some(call => /(?:update|create|cas)/i.test(call.kind)), false);
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

test('an uncooperative lease release is bounded and its late acknowledgement cannot publish success', async () => {
  const timers = new Map();
  const clock = { now: () => 0, setTimeout: (fn, delay) => { timers.set(fn, delay); return fn; }, clearTimeout: handle => timers.delete(handle) };
  let entered, resolveRelease, releases = 0, effects = 0;
  const releaseEntered = new Promise(resolve => { entered = resolve; });
  const h = harness(async () => { effects++; return { kind: 'succeeded', resultRef: 'result-1', outputBytes: 1 }; }, clock,
    () => { releases++; entered(); return new Promise(resolve => { resolveRelease = resolve; }); });
  const running = h.runner.run(h.input);
  await releaseEntered;
  assert.deepEqual([...timers.values()], [5000], 'release has its own finite cleanup deadline');
  const timeout = [...timers.keys()][0]; timeout();
  // A release timeout cannot prove rollback: keep the original operation unknown.
  await assert.rejects(running, e => e.code === 'AI_RESULT_UNKNOWN');
  assert.equal(timers.size, 0);
  resolveRelease({ released: true, revision: 99 });
  await Promise.resolve();
  assert.equal(releases, 1); assert.equal(effects, 1); assert.equal(timers.size, 0);
});

test('Run preparation callback uses only the original reservation remaining window', async () => {
  const timers = new Map(), counts = { effects: 0, completed: 0, abandoned: 0 };
  const clock = { now: () => 0, setTimeout: (fn, delay) => { timers.set(fn, delay); return fn; }, clearTimeout: fn => timers.delete(fn) };
  const h = harness(async () => { counts.effects++; assert.fail('Preparation timeout cannot execute a step'); }, clock);
  h.runner.deps.resources = { open: async () => {}, reserve: async () => assert.fail('No step reservation'),
    record: async () => assert.fail('No step settlement'), recover: async () => assert.fail('No step recovery'),
    preparation: { begin: async () => ({ key: 'original-preparation-1', prepared: false, remainingMs: 20 }),
      complete: async () => { counts.completed++; }, abandon: async () => { counts.abandoned++; } } };
  let entered;
  const inside = new Promise(resolve => { entered = resolve; });
  const running = h.runner.runPrepared(h.input, async () => { entered(); await new Promise(() => {}); });
  await inside;
  assert.deepEqual([...timers.values()], [20], 'The default host window cannot exceed original remaining active time');
  [...timers.keys()][0]();
  await assert.rejects(running, error => error.code === 'AI_RESULT_UNKNOWN');
  assert.deepEqual(counts, { effects: 0, completed: 0, abandoned: 1 });
  assert.equal(timers.size, 0);
});

test('release receipt accepts only the original CAS acknowledgement and never erases committed facts', async () => {
  for (const mode of ['normal', 'missing', 'not_released', 'stale', 'skipped', 'string_revision', 'mutated_command']) {
    const counts = { effects: 0, outcomes: 0, releases: 0, claims: 0 };
    const original = { status: 'running', resultRef: null, runRevision: null, holder: 'worker-1' };
    const h = harness(async () => { counts.effects++; return { kind: 'succeeded', resultRef: 'result-1', outputBytes: 1 }; }, undefined,
      async value => {
        counts.releases++;
        const revision = value.expectedRunRevision + 1;
        // Explicit persistence double: release already committed. Corrupting its
        // delivery cannot undo the original result or authorize another run.
        original.runRevision = revision; original.holder = null;
        if (mode === 'missing') return undefined;
        if (mode === 'not_released') return { released: false, revision };
        if (mode === 'stale') return { released: true, revision: revision - 1 };
        if (mode === 'skipped') return { released: true, revision: revision + 1 };
        if (mode === 'string_revision') return { released: true, revision: String(revision) };
        if (mode === 'mutated_command') {
          value.expectedRunRevision += 10;
          return { released: true, revision: value.expectedRunRevision + 1 };
        }
        return { released: true, revision };
      });
    const claim = h.runner.deps.leases.claimRun;
    h.runner.deps.leases.claimRun = async value => { counts.claims++; return claim(value); };
    h.runner.deps.taskOutcome = { commit: async value => {
      counts.outcomes++;
      assert.equal(value.outcome.status, 'succeeded');
      original.status = 'succeeded'; original.resultRef = 'result-1';
      return { taskRevision: value.taskRevision + 1, lease: { ...value.lease, revision: value.lease.revision + 1 }, outcomeStatus: 'succeeded' };
    } };
    if (mode === 'normal') assert.equal((await h.runner.run(h.input)).status, 'succeeded');
    else await assert.rejects(h.runner.run(h.input), error => error.code === 'AI_RESULT_UNKNOWN', mode);
    assert.deepEqual(counts, { effects: 1, outcomes: 1, releases: 1, claims: 1 }, mode);
    assert.equal(original.status, 'succeeded', mode);
    assert.equal(original.resultRef, 'result-1', mode);
    assert.equal(original.holder, null, mode);
    assert.equal(original.runRevision, 10, mode);
  }
});
