'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const fact = () => ({ kind: 'business_fact', fact: { scope: h.clone(h.scope), resourceType: 'order', resourceId: 'order-1', observedAt: new Date(h.now).toISOString(), basis: { kind: 'snapshot', version: 'history-1' } } });
test.after(() => assert.deepEqual(h.attempts, []));
test('business-fact resolution rejects permission revision changed during reference read', async () => {
  const f = h.retrieval(h.harness());
  f.content.factReference = async (_, value) => { f.policyRevision++; return h.clone(value); };
  await assert.rejects(f.sources.resolve(h.context(), fact()), { code: 'unavailable' });
});
test('business-fact provider cannot change the requested historical basis through an input alias', async () => {
  const f = h.retrieval(h.harness());
  f.content.factReference = async (_, value) => { value.basis = { kind: 'current' }; return value; };
  await assert.rejects(f.sources.resolve(h.context(), fact()), { code: 'unavailable' });
});
test('source results are detached from dependency-owned body and locator objects', async () => {
  const f = h.retrieval(h.harness()); await h.published(f);
  const chunk = [...f.repo.chunks.values()][0][0];
  f.content.chunk = async () => chunk;
  const result = await f.sources.readChunk(h.context(), h.source(chunk));
  const original = result.text; chunk.text = 'late replacement'; chunk.locator.paragraph = 99;
  assert.equal(result.text, original); assert.equal(result.locator.paragraph, 1);
});
