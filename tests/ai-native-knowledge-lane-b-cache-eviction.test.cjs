'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-public.cjs');
test.after(() => assert.deepEqual(h.attempts, []));
test('denied source access evicts the revoked document cache without clearing another document scope', async () => {
  const f = h.harness(); await h.published(f);
  f.cache = new f.documents.ports.cache.constructor(f.clock, { maxEntries: 10, maxBytes: 10000, ttlMs: 1000 });
  f.documents.ports.cache = f.cache; f.sources = new f.sources.constructor(f.documents, f.content, f.cache);
  f.ref = h.source([...f.repo.chunks.values()][0][0]); await f.sources.readChunk(h.context(), f.ref);
  const other = { ...f.ref, documentId: 'other-document', documentVersion: 'v1', chunkId: 'other-chunk' };
  f.cache.put('other', { ...f.repo.chunks.values().next().value[0], documentId: 'other-document', chunkId: 'other-chunk' });
  f.rule = () => false;
  await assert.rejects(f.sources.readChunk(h.context(), f.ref), { code: 'unavailable' });
  assert.equal(f.cache.stats().entries, 1);
  assert.ok(f.cache.get('other'));
});
