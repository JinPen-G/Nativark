'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
require('ts-node').register({ skipProject: true, transpileOnly: true, moduleTypes: { '**': 'cjs' }, compilerOptions: { module: 'commonjs', target: 'es2022' } });
const { NativeOperatorSession, nativeAgentRun } = require('../apps/admin/src/features/ai-operator/native-session');

test('archived history and later pages remain readable with a full journal of unresolved sends', async () => {
  const scene = 'order_explanation', signal = new AbortController().signal;
  const originals = Array.from({ length: 100 }, (_, index) => ({ chatId: `chat-${index}`, scene, conversationId: null, pending: true }));
  const storage = { getItem: () => JSON.stringify(originals), setItem: () => assert.fail('history wrote to the journal') };
  const session = new NativeOperatorSession({ storage, identity: 'owner', current: () => true, tasks: {}, api: {
    list: async query => { assert.equal(query.status, 'archived'); assert.equal(query.beforeId, 'cursor'); return { items: [], nextBeforeId: null }; },
    detail: async () => ({ conversation: { status: 'archived', currentTurn: null }, turns: { items: [] } }),
  } });
  assert.equal((await session.history(scene, signal, 'archived', 'cursor')).nextBeforeId, null);
  assert.equal((await session.open('history', 'original', scene, signal)).historical, true);
  assert.deepEqual(session.locatorsSnapshot(), originals);
});

test('the actual run distinguishes partial completion and an unknown step', () => {
  const run = nativeAgentRun({ status: 'partially_succeeded', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:05Z',
    steps: [{ stepId: 'step', sequence: 1, kind: 'model', status: 'unknown' }] });
  assert.equal(run.status, 'partial'); assert.equal(run.steps[0].status, 'unknown');
});
