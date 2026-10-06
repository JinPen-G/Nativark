'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fixture = require('./fixtures/ai-native/contract-consumer.cjs'); fixture.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022' } });
const { AiTaskListRepository } = require('../apps/api/src/modules/ai-native/ai-task-list.repository');
const now = new Date('2026-10-03T00:01:00Z');
const row = id => ({ id, status: 'RUNNING', revision: 1, sceneCode: 'order-explain', sceneVersion: '1', createdAt: now, updatedAt: now, cancelRequestedAt: null, secret: 'not-public' });
function setup(context = fixture.contexts[0]) {
  const state = { context: structuredClone(context), revoked: false, queries: [], rows: [row('task-b'), row('task-a')], duringRead: null };
  const authority = { resolveList: async () => { if (state.revoked) throw Error('private denial'); return state.context; } };
  const db = { aiTask: { findMany: async args => { state.queries.push(args); if (state.duringRead) await state.duringRead(); return state.rows; } } };
  return { state, repository: new AiTaskListRepository(db, authority, () => now) };
}
for (const context of fixture.contexts) test(`list applies server owner/scope/audience for ${context.actor.kind}`, async () => {
  const h = setup(context), page = await h.repository.readPage({ limit: 1 });
  const q = h.state.queries[0]; assert.equal(q.take, 2); assert.equal(q.where.ownerId, context.actor.userId ?? context.actor.customerId ?? context.actor.subjectId);
  assert.equal(q.where.audience, context.audience.toUpperCase()); assert.equal(q.where.id, undefined); assert.equal(q.where.archivedAt, null);
  assert.equal(page.items.length, 1); assert.equal(JSON.stringify(page).includes('not-public'), false);
  await h.repository.readPage({ limit: 1, cursor: page.nextCursor });
  assert.equal(h.state.queries[1].where.OR[1].id.lt, 'task-b');
});
test('invalid paging or caller identity fields never query storage', async () => {
  const h = setup(); for (const input of [{ limit: 0 }, { limit: 51 }, { cursor: 'garbage' }, { tenantId: 'foreign' }, { status: 'made_up' }]) await assert.rejects(h.repository.readPage(input), e => e.code === 'AI_INVALID_INPUT');
  assert.equal(h.state.queries.length, 0);
});
test('revocation during database read discards the page', async () => {
  const h = setup(); h.state.duringRead = async () => { h.state.revoked = true; };
  await assert.rejects(h.repository.readPage({}), e => e.code === 'AI_ACCESS_DENIED');
});
test('identity/scope change during read discards prior owner page', async () => {
  const h = setup(); h.state.duringRead = async () => { h.state.context.scope.workspaceId = 'other-space'; };
  await assert.rejects(h.repository.readPage({}), e => e.code === 'AI_ACCESS_DENIED');
});
