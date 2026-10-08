'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiTaskRunner } = require('../apps/api/src/modules/ai-native/runner/ai-task-runner.service');
const input = { taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', expectedTaskRevision: 1, expectedRunRevision: 1, expectedFencingToken: '0', leaseMs: 1000 };

function setup() {
  const trace = [], state = { taskRevision: 1, runRevision: 2, status: 'running', answered: false, existing: null, response: 'succeeded' };
  const lease = () => ({ taskId: 'task-a', runId: 'run-a', holderId: 'worker-a', fencingToken: '1', revision: state.runRevision, expiresAt: '2099-01-01T00:00:00Z' });
  const commit = kind => { trace.push(kind); state.taskRevision++; state.runRevision++; return { taskRevision: state.taskRevision, lease: lease() }; };
  const deps = {
    leases: { readMetadata: async () => ({ taskId: 'task-a', revision: state.taskRevision, status: state.status, cancelRequestedAt: null }),
      claimRun: async () => { trace.push('claim'); return lease(); }, claimRecoveryRun: async () => { trace.push('claim-recovery'); return lease(); },
      releaseRun: async c => { trace.push('release'); assert.equal(c.expectedTaskRevision, state.taskRevision); assert.equal(c.expectedRunRevision, state.runRevision); return { released: true, revision: ++state.runRevision }; } },
    plan: { resolve: async () => ({ taskId: 'task-a', runId: 'run-a', taskRevision: state.taskRevision,
      steps: ['clarify', 'continue'].map(registrationRef => ({ registrationRef, operation: 'readonly', toolCode: 'rental.order.explain', toolVersion: '1' })),
      limits: { maxSteps: 3, maxCalls: 3, maxTotalMs: 1000, maxStepMs: 100, maxConcurrent: 1, maxOutputBytes: 1000 } }) },
    steps: { register: async p => ({ stepId: p.registrationRef, runId: 'run-a', sequence: p.registrationRef === 'clarify' ? 1 : 2,
      stepRevision: 1, taskRevision: state.taskRevision, runRevision: state.runRevision, replayed: p.registrationRef === 'clarify' && state.existing !== null,
      existingStatus: p.registrationRef === 'clarify' ? state.existing ?? 'pending' : 'pending', resultRef: state.existing && state.existing !== 'pending' ? 'receipt-a' : null }),
      start: async () => commit('start'), succeed: async () => commit('succeed'), fail: async () => commit('fail'),
      pause: async () => assert.fail('clarification never invents a paused step status'), unknown: async () => commit('unknown') },
    effects: { execute: async p => { trace.push(`execute:${p.registrationRef}`); return { kind: state.response, resultRef: 'receipt-a', outputBytes: 3 }; },
      reconcile: async () => { trace.push('reconcile'); return { kind: 'unknown', resultRef: 'receipt-a', outputBytes: 0 }; } },
    resources: { open: async () => {}, reserve: async () => ({ chargeIds: ['s', 'a', 'o'] }), recover: async () => ({ chargeIds: ['s', 'a', 'o'] }),
      record: async () => { trace.push('account'); }, markUnknown: async () => { trace.push('resource-unknown'); } },
    inputs: { afterSucceeded: async (ref, held) => {
      trace.push(`input:${ref.plan.registrationRef}`);
      assert.equal(held.revision, state.runRevision);
      if (ref.plan.registrationRef !== 'clarify' || state.answered) return null;
      state.status = 'waiting_input'; return commit('input-transaction');
    } },
    taskOutcome: { commit: async () => commit('outcome') }
  };
  return { deps, state, trace, run: recovery => new AiTaskRunner(deps).run({ ...input, recovery }) };
}

test('input wait is committed only after step success and accounting, then releases without another step', async () => {
  const h = setup();
  assert.equal((await h.run(false)).status, 'paused');
  assert.deepEqual(h.trace, ['claim', 'start', 'execute:clarify', 'succeed', 'account', 'input:clarify', 'input-transaction', 'release']);
});
test('persisted successful clarification is read on restart, never re-executed', async () => {
  const h = setup(); h.state.existing = 'succeeded';
  assert.equal((await h.run(true)).status, 'paused');
  assert.deepEqual(h.trace, ['claim-recovery', 'account', 'input:clarify', 'input-transaction', 'release']);
});
test('answered clarification continues the original remaining steps without re-executing success', async () => {
  const h = setup(); h.state.existing = 'succeeded'; h.state.answered = true;
  assert.equal((await h.run(false)).status, 'succeeded');
  assert.equal(h.trace.includes('execute:clarify'), false);
  assert.equal(h.trace.filter(t => t === 'execute:continue').length, 1);
});
test('already waiting task does not claim a fence or continue on a generic runner reconnect', async () => {
  const h = setup(); h.state.status = 'waiting_input'; h.state.existing = 'succeeded';
  assert.equal((await h.run(true)).status, 'paused'); assert.deepEqual(h.trace, []);
});
test('unaccounted success cannot publish input wait', async () => {
  const h = setup(); h.deps.resources.record = async () => { throw Error('measurement missing'); };
  assert.equal((await h.run(false)).status, 'unknown');
  assert.equal(h.trace.some(t => t.startsWith('input:')), false);
});
test('unknown action is not turned into a clarification and is never re-executed', async () => {
  const h = setup(); h.state.existing = 'unknown';
  assert.equal((await h.run(true)).status, 'unknown');
  assert.equal(h.trace.some(t => t.startsWith('input:') || t.startsWith('execute:')), false);
});
test('previously registered but unstarted step continues only under a fresh execution claim', async () => {
  const h = setup(); h.state.existing = 'pending';
  assert.equal((await h.run(false)).status, 'paused');
  assert.equal(h.trace.filter(t => t === 'execute:clarify').length, 1);
  const recovery = setup(); recovery.state.existing = 'pending';
  assert.equal((await recovery.run(true)).status, 'unavailable');
  assert.equal(recovery.trace.includes('execute:clarify'), false);
});
test('effect-provided paused input cannot replace a persisted successful clarification', async () => {
  const h = setup(); h.deps.effects.execute = async () => ({ kind: 'paused', pause: 'input', resultRef: 'model-said-wait', outputBytes: 1 });
  assert.equal((await h.run(false)).status, 'unavailable');
  assert.equal(h.trace.some(t => t.startsWith('input:')), false);
  assert.equal(h.trace.includes('outcome'), false);
});

test('input wait acknowledgement cannot advance an unrelated holder', async () => {
  const h = setup(); h.deps.inputs.afterSucceeded = async (_ref, held) => ({ taskRevision: h.state.taskRevision + 1, lease: { ...held, holderId: 'other', revision: held.revision + 1 } });
  assert.equal((await h.run(false)).status, 'unavailable');
  assert.equal(h.trace.includes('execute:continue'), false);
});
