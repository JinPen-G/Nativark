'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const { authorize } = h.load('knowledge-validation');
test.after(() => assert.deepEqual(h.attempts, []));
test('authorization rejects caller identity replacement while its actual port awaits', async () => {
  const f = h.harness(), ctx = h.context(), request = { action: 'search', scope: ctx.scope };
  const base = f.authorization.authorize;
  const port = { authorize: async (c, r) => { ctx.actor.userId = 'replacement'; return base(c, r); } };
  await assert.rejects(authorize(port, ctx, request), { code: 'unavailable' });
});
test('validated grant is detached from mutable dependency-owned grant', async () => {
  const f = h.harness(), ctx = h.context(), request = { action: 'search', scope: ctx.scope };
  const original = await f.authorization.authorize(ctx, request);
  const result = await authorize({ authorize: async () => original }, ctx, request);
  original.accessKey = 'changed-after-return';
  assert.notEqual(result.accessKey, original.accessKey);
});
test('download rejects permission revision changed during reference read without disclosing attachment', async () => {
  const f = h.retrieval(h.harness()); await h.published(f);
  const ref = h.source([...f.repo.chunks.values()][0][0]);
  const read = f.content.downloadReference;
  f.content.downloadReference = async (...args) => { const result = await read(...args); f.policyRevision++; return result; };
  await assert.rejects(f.sources.download(h.context(), ref), { code: 'unavailable' });
});
