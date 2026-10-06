'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiTaskTransitionRepository } = require('../apps/api/src/modules/ai-native/ai-task-transition.repository');
const { AI_TASK_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
const { contexts } = require('./fixtures/ai-native/contract-consumer.cjs');
const now = new Date('2026-10-06T10:00:00Z');
const command = { taskId: 'task-a', expectedRevision: 4, to: 'running', reason: 'resume',
  lease: { runId: 'run-a', holderId: 'worker-a', revision: 7, fencingToken: '2' } };

// Bottom-level transaction double: production repository/FSM decide every transition.
function harness(status) {
  let state = { task: { id: 'task-a', scopeId: 'scope-a', status, revision: 4, eventCursor: 3n,
    cancelRequestedAt: null, contractVersion: AI_TASK_DRAFT_VERSION }, events: [], runRevision: 7 };
  let mutations = 0;
  const db = { aiTask: {}, aiRun: {}, $transaction: async callback => {
    const draft = structuredClone(state);
    const result = await callback({
      aiTask: { findFirst: async () => structuredClone(draft.task), updateMany: async ({ where, data }) => {
        mutations++;
        if (where.revision !== draft.task.revision) return { count: 0 };
        if (data.revision) draft.task.revision += data.revision.increment;
        if (data.eventCursor) draft.task.eventCursor += data.eventCursor.increment;
        if (data.status) draft.task.status = data.status;
        return { count: 1 };
      } },
      aiStep: { findMany: async () => [{ id: 'step-a', runId: 'run-a', sequence: 1, revision: 3,
        actionId: 'action-a', status: 'SUCCEEDED', effect: 'NONE' }] },
      aiRun: { updateMany: async () => { mutations++; draft.runRevision++; return { count: 1 }; } },
      aiTaskEvent: { create: async ({ data }) => { draft.events.push(data); return { cursor: data.cursor }; } }
    });
    state = draft;
    return result;
  } };
  const repository = new AiTaskTransitionRepository(db, { resolve: async () => structuredClone(contexts[0]) }, () => now);
  return { repository, state: () => structuredClone(state), mutations: () => mutations };
}

test('generic resume cannot consume waiting_input without the dedicated durable input transaction', async () => {
  const h = harness('WAITING_INPUT'), before = h.state();
  await assert.rejects(h.repository.transition(command), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(h.state(), before);
  assert.equal(h.mutations(), 0, 'deny before reserving revisions or emitting events');
});

for (const patch of [{ confirmed: true }, { evidenceId: 'arbitrary-evidence' }, { inputReceiptId: 'caller-receipt' }]) {
  test(`generic resume rejects untrusted ${Object.keys(patch)[0]}`, async () => {
    const h = harness('WAITING_INPUT');
    await assert.rejects(h.repository.transition({ ...command, ...patch }), e => e.code === 'AI_INVALID_INPUT');
    assert.equal(h.mutations(), 0);
  });
}

test('external reconciliation resume retains its existing independent path', async () => {
  const h = harness('WAITING_EXTERNAL');
  const result = await h.repository.transition(command);
  assert.equal(result.event.data.to, 'running');
  assert.equal(h.state().task.status, 'RUNNING');
  assert.equal(h.state().events.length, 1);
});

test('waiting input can still accept cancellation without fabricating business rollback', async () => {
  const h = harness('WAITING_INPUT');
  const result = await h.repository.transition({ taskId: 'task-a', expectedRevision: 4, to: 'cancel_requested', reason: 'cancel_requested' });
  assert.equal(result.event.data.to, 'cancel_requested');
  assert.equal(h.state().task.status, 'CANCEL_REQUESTED');
});
