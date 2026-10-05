'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' } });
const { AiTaskRunner } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');

const input = { taskId: 'task-1', runId: 'run-1', holderId: 'worker-1', expectedTaskRevision: 3, expectedRunRevision: 4, expectedFencingToken: '8', leaseMs: 1000 };
function setup(options = {}) {
  const state = { taskRevision: 3, runRevision: 5, fence: '9', status: 'running', effects: 0, reconciles: 0, starts: 0, taskCommits: [], releases: [], stepCommits: [], stepRevision: 1 };
  const lease = () => ({ taskId: input.taskId, runId: input.runId, holderId: input.holderId, revision: state.runRevision, fencingToken: state.fence, expiresAt: '2099-01-01T00:00:00.000Z' });
  const check = held => { assert.equal(held.revision, state.runRevision); assert.equal(held.fencingToken, state.fence); };
  const stepCommit = async (ref, held, kind) => {
    check(held);
    assert.equal(ref.registered.stepRevision, state.stepRevision, 'step transition must use latest revision');
    state.stepRevision++;
    state.runRevision++; state.taskRevision++; state.stepCommits.push(kind);
    return { lease: lease(), taskRevision: state.taskRevision };
  };
  const deps = {
    leases: {
      readMetadata: async () => ({ taskId: input.taskId, revision: state.taskRevision, status: state.status, cancelRequestedAt: state.status === 'cancel_requested' ? '2026-10-05T00:00:00.000Z' : null }),
      claimRun: async () => lease(), claimRecoveryRun: async () => ({ ...lease(), purpose: 'recovery_only' }),
      releaseRun: async value => { state.releases.push(value); assert.equal(value.expectedRunRevision, state.runRevision, 'release latest run revision'); assert.equal(value.expectedTaskRevision, state.taskRevision, 'release latest task revision'); assert.equal(value.expectedFencingToken, state.fence); return { released: true, revision: ++state.runRevision }; }
    },
    steps: {
      register: async () => { state.runRevision++; state.taskRevision++; return { stepId: 'step-1', runId: input.runId, sequence: 1, stepRevision: state.stepRevision, taskRevision: state.taskRevision, runRevision: state.runRevision, replayed: !!options.replayed, existingStatus: options.replayed ?? 'pending' }; },
      start: async (ref, held) => { state.starts++; return stepCommit(ref, held, 'start'); },
      succeed: (ref, held) => stepCommit(ref, held, 'succeed'), fail: (ref, held) => stepCommit(ref, held, 'fail'),
      pause: (ref, held) => stepCommit(ref, held, 'pause'), unknown: (ref, held) => stepCommit(ref, held, 'unknown')
    },
    plan: { resolve: async () => ({ taskId: input.taskId, runId: input.runId, taskRevision: state.taskRevision, steps: options.empty ? [] : [{ registrationRef: 'action-1', operation: options.operation ?? 'readonly', toolCode: 'rental.order.explain', toolVersion: 'draft-1' }], limits: { maxSteps: 3, maxTotalMs: 1000, maxStepMs: 100, maxOutputBytes: 1024, maxConcurrent: 1, maxCalls: 3 } }) },
    effects: {
      execute: async () => { state.effects++; if (options.cancelDuringEffect) { state.status = 'cancel_requested'; state.taskRevision++; } if (options.throwEffect) throw Error('private failure'); return options.result ?? { kind: 'succeeded', resultRef: 'fact-1', outputBytes: 3 }; },
      reconcile: async () => { state.reconciles++; if (options.throwReconcile) throw Error('unknown provider response'); return options.result ?? { kind: 'succeeded', resultRef: 'fact-1', outputBytes: 3 }; },
      cleanup: async () => { if (options.throwCleanup) throw Error('cleanup failed'); }
    },
    taskOutcome: { commit: async value => { check(value.lease); assert.equal(value.taskRevision, state.taskRevision); state.taskCommits.push(value.outcome); state.runRevision++; state.taskRevision++; if (options.taskAckLost) throw Error('commit ack lost'); return { lease: lease(), taskRevision: state.taskRevision }; } }
  };
  if (options.status) state.status = options.status;
  if (options.empty) state.status = 'cancel_requested';
  return { state, deps, run: () => new AiTaskRunner(deps).run({ ...input, ...(options.recovery ? { recovery: true } : {}) }) };
}

for (const result of [
  { kind: 'succeeded', resultRef: 'fact-1', outputBytes: 1 },
  { kind: 'failed', errorCode: 'AI_BUSINESS_REJECTED', resultRef: 'failure-1', outputBytes: 1 },
  { kind: 'paused', pause: 'confirmation', resultRef: null, outputBytes: 0 },
  { kind: 'unknown', resultRef: 'unknown-1', outputBytes: 1 }
]) test(`runner carries step and aggregate revisions through ${result.kind}`, async () => {
  const h = setup({ result }); const outcome = await h.run();
  assert.equal(outcome.status, result.kind === 'paused' ? 'paused' : result.kind);
  assert.equal(h.state.taskCommits.length, 1); assert.equal(h.state.releases.length, 1);
});

test('empty plan cancellation persists then releases the updated aggregate revision', async () => {
  const h = setup({ empty: true }); assert.equal((await h.run()).status, 'cancelled');
  assert.equal(h.state.effects, 0); assert.equal(h.state.taskCommits[0].status, 'cancelled');
});

for (const operation of ['readonly', 'idempotent', 'external_unknown']) test(`effect exception persists task outcome for ${operation}`, async () => {
  const h = setup({ operation, throwEffect: true });
  assert.equal((await h.run()).status, operation === 'readonly' ? 'failed' : 'unknown');
  assert.equal(h.state.taskCommits.length, 1); assert.equal(h.state.effects, 1);
});

test('cleanup failure after an effect persists waiting-external, not local unknown alone', async () => {
  const h = setup({ operation: 'idempotent', throwCleanup: true });
  assert.equal((await h.run()).status, 'unknown'); assert.equal(h.state.taskCommits[0].status, 'unknown');
});

test('persisted unknown replay reaches reconciliation without starting or executing again', async () => {
  const h = setup({ operation: 'external_unknown', replayed: 'unknown', recovery: true });
  assert.equal((await h.run()).status, 'succeeded'); assert.equal(h.state.reconciles, 1);
  assert.equal(h.state.effects, 0); assert.equal(h.state.starts, 0);
});

test('running crash replay reconciles with the exact current lease, never re-dispatches', async () => {
  const h = setup({ operation: 'readonly', replayed: 'running', recovery: true });
  h.deps.effects.reconcile = async (_plan, signal, held) => {
    assert.equal(signal.aborted, false);
    assert.equal(held.holderId, input.holderId); assert.equal(held.runId, input.runId);
    assert.equal(held.revision, h.state.runRevision); assert.equal(held.fencingToken, h.state.fence);
    h.state.reconciles++; return { kind: 'succeeded', resultRef: 'fact-1', outputBytes: 3 };
  };
  assert.equal((await h.run()).status, 'succeeded');
  assert.equal(h.state.reconciles, 1); assert.equal(h.state.effects, 0); assert.equal(h.state.starts, 0);
});

test('persistent effect interruption cannot manufacture a failed step with a null result receipt', async () => {
  const h = setup({ operation: 'readonly', throwEffect: true }); let unknown = 0;
  h.deps.resources = { open: async () => {}, reserve: async () => ({ chargeIds: ['original-charge'] }),
    record: async () => { throw Error('no measurement'); }, markUnknown: async () => { unknown++; } };
  h.deps.effects.readInterrupted = async () => ({ kind: 'unknown', resultRef: 'persisted-start-receipt', outputBytes: 0 });
  h.deps.steps.fail = async () => { assert.fail('no observed failure receipt, cannot publish failed'); };
  const originalUnknown = h.deps.steps.unknown;
  h.deps.steps.unknown = async (ref, held, receipt) => { assert.equal(receipt, 'persisted-start-receipt'); return originalUnknown(ref, held); };
  assert.equal((await h.run()).status, 'unknown'); assert.ok(unknown > 0);
  assert.equal(h.state.effects, 1);
});

test('runner waits for deferred model resources after start and cannot execute a pending ticket', async () => {
  for (const missing of [false, true]) {
    const h = setup(); const trace = [];
    h.deps.resources = { open: async () => {}, reserve: async () => { trace.push('basic'); return { chargeIds: ['s', 'a', 'o'], modelPending: true }; },
      record: async () => {}, markUnknown: async () => {} };
    if (!missing) h.deps.resources.beforeExecute = async (ticket, ref, held) => {
      assert.equal(h.state.starts, 1); assert.equal(h.state.effects, 0); assert.equal(held.revision, h.state.runRevision);
      trace.push('call'); return { chargeIds: [...ticket.chargeIds, 'c'] };
    };
    assert.equal((await h.run()).status, missing ? 'unavailable' : 'succeeded');
    assert.equal(h.state.effects, missing ? 0 : 1); assert.deepEqual(trace, missing ? ['basic'] : ['basic', 'call']);
  }
});

test('persistent composition rejects missing current-authority, plan or effect dependencies at assembly', () => {
  const { composePersistentTaskRunner } = require('../apps/api/src/modules/ai-native/runner/persistent-task-runner.composition');
  assert.throws(() => composePersistentTaskRunner({}), /AI_RESOURCE_UNAVAILABLE/);
  assert.throws(() => composePersistentTaskRunner({ db: { $transaction() {} }, tasks: {} }), /AI_RESOURCE_UNAVAILABLE/);
});

test('reconcile failure keeps unknown and commits the task waiting outcome', async () => {
  const h = setup({ operation: 'external_unknown', replayed: 'unknown', recovery: true, throwReconcile: true });
  assert.equal((await h.run()).status, 'unknown'); assert.equal(h.state.taskCommits[0].status, 'unknown'); assert.equal(h.state.effects, 0);
});

test('cancel arriving during the last effect is settled after its durable result', async () => {
  const h = setup({ operation: 'idempotent', cancelDuringEffect: true });
  assert.equal((await h.run()).status, 'cancelled'); assert.equal(h.state.taskCommits[0].status, 'cancelled'); assert.equal(h.state.effects, 1);
});

test('lost task commit acknowledgement never triggers another outcome commit or effect', async () => {
  const h = setup({ taskAckLost: true }); await assert.rejects(h.run());
  assert.equal(h.state.taskCommits.length, 1); assert.equal(h.state.effects, 1);
});

test('cancelled recovery can reconcile an existing unknown but cannot execute a new effect', async () => {
  const h = setup({ operation: 'idempotent', replayed: 'unknown', recovery: true, status: 'cancel_requested' });
  await h.run(); assert.equal(h.state.reconciles, 1); assert.equal(h.state.effects, 0); assert.equal(h.state.starts, 0);
});

test('a still-unknown waiting task is neither mutated unknown-to-unknown nor resumed', async () => {
  const h = setup({ operation: 'external_unknown', replayed: 'unknown', recovery: true, status: 'waiting_external', throwReconcile: true });
  assert.equal((await h.run()).status, 'unknown'); assert.equal(h.state.taskCommits.length, 0); assert.deepEqual(h.state.stepCommits, []);
});

test('resource-backed cleanup failure preserves the durable successful step and stops new work', async () => {
  const h = setup({ throwCleanup: true }); let records = 0;
  h.deps.resources = { open: async () => {}, reserve: async () => ({ chargeIds: ['s', 'a', 'o'] }),
    record: async () => { records++; }, markUnknown: async () => {} };
  assert.equal((await h.run()).status, 'unknown');
  assert.deepEqual(h.state.stepCommits, ['start', 'succeed']);
  assert.equal(records, 1); assert.equal(h.state.effects, 1);
  assert.equal(h.state.taskCommits.length, 0, 'all-success steps cannot fabricate an external-pending task event');
});

test('durable failed replay settles only original resources and never transitions or executes again', async () => {
  const h = setup({ replayed: 'failed', recovery: true }); const original = h.deps.steps.register; let records = 0;
  h.deps.steps.register = async (...args) => ({ ...await original(...args), resultRef: 'failure-1' });
  h.deps.resources = { open: async () => {}, recover: async () => ({ chargeIds: ['s', 'a', 'o'] }),
    reserve: async () => assert.fail('cannot reserve after durable failure'),
    record: async (_ticket, _ref, _lease, reconcile) => { assert.equal(reconcile, true); records++; }, markUnknown: async () => {} };
  h.deps.effects.readInterrupted = async () => ({ kind: 'failed', errorCode: 'AI_BUSINESS_REJECTED', resultRef: 'failure-1', outputBytes: 1 });
  assert.equal((await h.run()).status, 'failed'); assert.equal(records, 1);
  assert.deepEqual(h.state.stepCommits, []); assert.equal(h.state.effects, 0); assert.equal(h.state.reconciles, 0);
});

for (const gap of ['wrong_receipt', 'settlement_failed']) test(`failed replay keeps pending resources for ${gap}`, async () => {
  const h = setup({ replayed: 'failed', recovery: true }); const original = h.deps.steps.register; let unknown = 0, records = 0;
  h.deps.steps.register = async (...args) => ({ ...await original(...args), resultRef: 'failure-1' });
  h.deps.resources = { open: async () => {}, recover: async () => ({ chargeIds: ['s', 'a', 'o'] }), reserve: async () => assert.fail('fresh reserve'),
    record: async () => { records++; throw Error('ack lost'); }, markUnknown: async () => { unknown++; } };
  h.deps.effects.readInterrupted = async () => ({ kind: 'failed', errorCode: 'AI_BUSINESS_REJECTED', resultRef: gap === 'wrong_receipt' ? 'other-call' : 'failure-1', outputBytes: 1 });
  assert.equal((await h.run()).status, 'unknown'); assert.equal(records, gap === 'wrong_receipt' ? 0 : 1); assert.equal(unknown, 1);
  assert.deepEqual(h.state.stepCommits, []); assert.equal(h.state.effects, 0); assert.equal(h.state.taskCommits.length, 0);
});

module.exports = { setup, input };
