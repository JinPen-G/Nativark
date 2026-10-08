'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiTaskRunner, AiTaskRunnerError } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');

function harness(taskOutcome) {
  const events = [], lease = { taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', revision: 1, fencingToken: '2', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const deps = {
    leases: {
      readMetadata: async () => ({ taskId: 'task-1', status: 'running', revision: 2, cancelRequestedAt: null }),
      claimRun: async () => lease,
      claimRecoveryRun: async () => ({ ...lease, purpose: 'recovery_only' }),
      releaseRun: async value => { events.push(['release', value]); return { released: true, revision: value.expectedTaskRevision + 1 }; }
    },
    steps: {
      register: async plan => ({ stepId: `step-${plan.registrationRef}`, runId: 'run-1', sequence: 1, stepRevision: 1, taskRevision: 3, runRevision: 2, replayed: false, existingStatus: 'pending' }),
      start: async (_step, current) => ({ lease: { ...current, revision: current.revision + 1 }, taskRevision: 4 }),
      succeed: async (_step, current) => ({ lease: { ...current, revision: current.revision + 1 }, taskRevision: 5 }),
      fail: async () => { throw new Error('not used'); }, pause: async () => { throw new Error('not used'); }, unknown: async () => { throw new Error('not used'); }
    },
    plan: { resolve: async () => ({ taskId: 'task-1', runId: 'run-1', taskRevision: 2, steps: [{ registrationRef: 's1', operation: 'readonly', toolCode: 'read', toolVersion: '1' }], limits: { maxSteps: 1, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 1000, maxConcurrent: 1, maxCalls: 1 } }) },
    effects: { execute: async () => ({ kind: 'succeeded', resultRef: 'result-1', outputBytes: 1 }) },
    taskOutcome
  };
  return { runner: new AiTaskRunner(deps), events };
}

test('runner commits aggregate outcome through an injected port before releasing the latest fence', async () => {
  let committed;
  const h = harness({ commit: async input => { committed = input; return { taskRevision: input.taskRevision + 1, lease: { ...input.lease, revision: input.lease.revision + 1 } }; } });
  const result = await h.runner.run({ taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', expectedTaskRevision: 2, expectedRunRevision: 1, expectedFencingToken: '1', leaseMs: 1000 });
  assert.equal(result.status, 'succeeded'); assert.equal(committed.outcome.status, 'succeeded');
  assert.equal(h.events[0][0], 'release'); assert.equal(h.events[0][1].expectedRunRevision, 5);
  assert.equal(h.events[0][1].expectedTaskRevision, 6); assert.equal(h.events[0][1].expectedFencingToken, '2');
});

test('invalid task outcome fence fails closed instead of reporting success', async () => {
  const h = harness({ commit: async input => ({ taskRevision: input.taskRevision, lease: input.lease }) });
  const result = await h.runner.run({ taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', expectedTaskRevision: 2, expectedRunRevision: 1, expectedFencingToken: '1', leaseMs: 1000 });
  assert.equal(result.status, 'unavailable');
});

test('cancel request commits cancelled only when the aggregate outcome port is present', async () => {
  let committed;
  const lease = { taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', revision: 1, fencingToken: '2', expiresAt: new Date(Date.now() + 60_000).toISOString() };
  const runner = new AiTaskRunner({
    leases: {
      readMetadata: async () => ({ taskId: 'task-1', status: 'cancel_requested', revision: 2, cancelRequestedAt: new Date().toISOString() }),
      claimRun: async () => lease, claimRecoveryRun: async () => ({ ...lease, purpose: 'recovery_only' }),
      releaseRun: async () => ({ released: true, revision: 3 })
    },
    steps: { register: async () => { throw new Error('must not register after cancel'); }, start: async () => { throw new Error('must not start'); }, succeed: async () => { throw new Error('must not succeed'); }, fail: async () => { throw new Error('must not fail'); }, pause: async () => { throw new Error('must not pause'); }, unknown: async () => { throw new Error('must not unknown'); } },
    plan: { resolve: async () => ({ taskId: 'task-1', runId: 'run-1', taskRevision: 2, steps: [], limits: { maxSteps: 1, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 1000, maxConcurrent: 1, maxCalls: 1 } }) },
    effects: { execute: async () => { throw new Error('must not execute'); } },
    taskOutcome: { commit: async input => { committed = input; return { taskRevision: input.taskRevision + 1, lease: { ...input.lease, revision: input.lease.revision + 1 } }; } }
  });
  const result = await runner.run({ taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', expectedTaskRevision: 2, expectedRunRevision: 1, expectedFencingToken: '1', leaseMs: 1000 });
  assert.equal(result.status, 'cancelled'); assert.equal(committed.outcome.status, 'cancelled');
});
