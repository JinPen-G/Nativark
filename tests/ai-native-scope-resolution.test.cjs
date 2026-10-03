'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const base = require('./fixtures/ai-native/contract-consumer.cjs'); base.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiScopeRepository } = require('../apps/api/src/modules/ai-native/ai-scope.repository');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const now = new Date('2026-10-03T12:00:00Z');
function setup(context = base.contexts[0]) {
  const state = { context: structuredClone(context), row: { id: 'actual-database-id', ...aiPersistenceScopeColumns(context.scope) }, calls: [], count: 0, hook: null, dbError: false };
  const authority = { resolve: async () => { state.count++; state.calls.push('authorize'); if (state.hook) state.hook(state.count); return state.context; } };
  const db = { aiScope: { findFirst: async args => { state.calls.push(args); if (state.dbError) throw Error('private connection'); return structuredClone(state.row); } } };
  return { state, repository: new AiScopeRepository(db, authority, () => new Date(now)) };
}
const tenant = { ...base.contexts[0], scope: { kind: 'tenant', tenantId: 'tenant-test' } };
for (const context of [...base.contexts, tenant]) test(`resolve actual scope for ${context.scope.kind}/${context.audience}/${context.actor.kind}`, async () => {
  const f = setup(context), out = await f.repository.resolveCurrent();
  assert.equal(out.scope.id, 'actual-database-id'); assert.equal(out.scope.kind, context.scope.kind.toUpperCase());
  assert.deepEqual(f.state.calls[1].where, aiPersistenceScopeColumns(context.scope));
  assert.equal(f.state.count, 2); assert.equal(f.state.calls.length, 3);
  if (context.scope.kind === 'platform') { assert.equal('tenantId' in out.scope, false); assert.equal('workspaceId' in out.scope, false); }
  if (context.scope.kind === 'tenant') assert.equal('workspaceId' in out.scope, false);
  out.context.requestId = 'mutated'; assert.notEqual(f.state.context.requestId, 'mutated');
});
for (const field of ['id','kind','scopeKey','tenantId','workspaceId']) test(`corrupt or differently-cased ${field} is rejected after SQL match`, async () => {
  const f = setup(); f.state.row[field] = field === 'id' ? '' : String(f.state.row[field]).toUpperCase() + 'X';
  await assert.rejects(f.repository.resolveCurrent(), e => e.code === (field === 'id' ? 'AI_STORAGE_UNAVAILABLE' : 'AI_SCOPE_CHANGED'));
});
for (const change of [s => { s.context.actor.userId = 'other'; }, s => { s.context.scope.workspaceId = 'other'; }, s => { s.context.access.permissions = []; },
  s => { s.context.access.locationScope = { mode: 'all', locationIds: [] }; }]) test('reauthorization change discards buffered scope', async () => {
  const f = setup(); f.state.hook = count => { if (count === 2) change(f.state); };
  await assert.rejects(f.repository.resolveCurrent(), e => e.code === 'AI_SCOPE_CHANGED');
});
test('only fresh request metadata may change during lookup', async () => {
  const f = setup(); f.state.hook = count => { if (count === 2) { f.state.context.requestId = 'fresh'; f.state.context.authorizedAt = now.toISOString(); } };
  assert.equal((await f.repository.resolveCurrent()).context.requestId, 'fresh');
});
test('missing scope never creates a default scope', async () => {
  const f = setup(); f.state.row = null; await assert.rejects(f.repository.resolveCurrent(), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.equal(f.state.calls.length, 3);
});
test('revoked authority discloses no buffered row', async () => {
  const f = setup(); f.state.hook = count => { if (count === 2) throw Error('revoked'); };
  await assert.rejects(f.repository.resolveCurrent(), e => e.code === 'AI_ACCESS_DENIED');
});
test('invalid identity cannot reach database', async () => {
  for (const patch of [{ audience: 'client' }, { scope: { kind: 'platform' } }, { contractVersion: 'old' }, { authorizedAt: '2027-01-01T00:00:00Z' }]) {
    const f = setup(); Object.assign(f.state.context, patch);
    await assert.rejects(f.repository.resolveCurrent(), e => e.code === 'AI_ACCESS_DENIED'); assert.equal(f.state.calls.length, 1);
  }
});
test('expired automation cannot resolve scope', async () => {
  const f = setup(base.contexts[4]); f.state.context.actor.expiresAt = now.toISOString();
  await assert.rejects(f.repository.resolveCurrent(), e => e.code === 'AI_ACCESS_DENIED'); assert.equal(f.state.calls.length, 1);
});
test('DB failures are sanitized and never retried', async () => {
  const f = setup(); f.state.dbError = true;
  await assert.rejects(f.repository.resolveCurrent(), e => e.code === 'AI_STORAGE_UNAVAILABLE' && e.message === e.code); assert.equal(f.state.calls.length, 2);
});
test('missing authority fails construction instead of using caller-provided scope', () => {
  assert.throws(() => new AiScopeRepository({}, null), e => e.code === 'AI_ACCESS_DENIED');
});
