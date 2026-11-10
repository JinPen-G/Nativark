'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const { KnowledgeCache } = h.load('knowledge-cache');
const { KnowledgeSourceService } = h.load('knowledge-source.service');
const { KnowledgeIndexCoordinator } = h.load('knowledge-index-coordinator');
const change = (revision, operationId) => ({ documentId: 'doc-1', expectedRevision: revision, operationId });
async function fixture() {
  const f = h.retrieval(h.harness()); await h.published(f);
  f.cache = new KnowledgeCache(f.clock, { maxEntries: 4, maxBytes: 10000, ttlMs: 1000 }); f.ports.cache = f.cache;
  f.sources = new KnowledgeSourceService(f.documents, f.content, f.cache);
  f.ref = h.source([...f.repo.chunks.values()][0][0]);
  f.indexCalls = []; f.index = { apply: async (_, cmd) => { f.indexCalls.push(h.clone(cmd)); } };
  f.coordinator = new KnowledgeIndexCoordinator(f.documents, f.index);
  return f;
}
test.after(() => assert.deepEqual(h.attempts, []));
test('cache miss/hit still checks authorization; TTL is absolute and boundary expires', async () => {
  const f = await fixture(), ctx = h.context();
  await f.sources.readChunk(ctx, f.ref); const calls = f.authCalls.length; assert.equal(f.bodyReads, 1);
  f.now += 999; await f.sources.readChunk(ctx, f.ref); assert.equal(f.bodyReads, 1); assert.ok(f.authCalls.length > calls);
  f.now += 1; await f.sources.readChunk(ctx, f.ref); assert.equal(f.bodyReads, 2);
});
test('idle cache releases expired plaintext even when the business clock moves backwards', async () => {
  const f = await fixture(), chunk = [...f.repo.chunks.values()][0][0];
  const cache = new KnowledgeCache(f.clock, { maxEntries: 2, maxBytes: 2000, ttlMs: 10 });
  cache.put('idle', chunk);
  assert.equal(cache.stats().entries, 1); assert.ok(cache.stats().bytes > 0);
  f.now -= 86400000;
  await new Promise(resolve => setTimeout(resolve, 40));
  // Observe storage without get/put/invalidate triggering lazy eviction.
  assert.deepEqual(cache.stats(), { entries: 0, bytes: 0 });
});
test('cached result cannot bypass a newly revoked read_body or snippet permission', async () => {
  for (const deniedAction of ['read_body', 'snippet']) {
    const f = await fixture(); await f.sources.readChunk(h.context(), f.ref); assert.equal(f.cache.stats().entries, 1);
    f.rule = (_, r) => r.action !== deniedAction;
    await assert.rejects(f.sources.readChunk(h.context(), f.ref), { code: 'unavailable' }); assert.equal(f.bodyReads, 1);
  }
});
test('cache key isolates actor, audience, tenant, version, ACL revision, access key and head revision', async () => {
  const f = await fixture(), grant = await f.authorization.authorize(h.context(), { action: 'snippet', scope: h.scope });
  const base = f.cache.key(grant, f.ref, 4);
  for (const g of [{ ...grant, actor: { ...grant.actor, actorId: 'other' } }, { ...grant, audience: 'staff' }, { ...grant, scope: { ...grant.scope, tenantId: 'other' } }, { ...grant, accessKey: 'changed' }]) assert.notEqual(f.cache.key(g, f.ref, 4), base);
  assert.notEqual(f.cache.key(grant, { ...f.ref, documentVersion: 'v2' }, 4), base);
  assert.notEqual(f.cache.key(grant, { ...f.ref, aclRevision: 2 }, 4), base); assert.notEqual(f.cache.key(grant, f.ref, 5), base);
  await f.sources.readChunk(h.context(), f.ref); f.policyRevision++;
  await f.sources.readChunk(h.context(), f.ref); assert.equal(f.bodyReads, 2);
});
test('bounded LRU, byte budget, cloned values and invalid zero/unconfigured limits', async () => {
  const f = await fixture(), c = [...f.repo.chunks.values()][0][0];
  for (const limits of [undefined, { maxEntries: 0, maxBytes: 1000, ttlMs: 1 }, { maxEntries: 2, maxBytes: 0, ttlMs: 1 }, { maxEntries: 2, maxBytes: 1000, ttlMs: 0 }]) assert.throws(() => new KnowledgeCache(f.clock, limits), { code: 'invalid_input' });
  const cache = new KnowledgeCache(f.clock, { maxEntries: 2, maxBytes: 2000, ttlMs: 100 });
  cache.put('a', c); cache.put('b', c); cache.get('a'); cache.put('c', c);
  assert.equal(cache.get('b'), undefined); assert.ok(cache.get('a')); assert.equal(cache.stats().entries, 2); assert.ok(cache.stats().bytes <= 2000);
  cache.get('a').text = 'changed'; assert.equal(cache.get('a').text, c.text);
  cache.put('large', { ...c, text: 'x'.repeat(10000) }); assert.equal(cache.get('large'), undefined);
});
test('withdraw propagation failure leaves pending/failed evidence but never readable cached text', async () => {
  const f = await fixture(), ctx = h.context(); await f.sources.readChunk(ctx, f.ref);
  const withdrawn = await f.publication.withdraw(ctx, change(4, 'withdraw'));
  assert.equal(withdrawn.indexJob.status, 'pending'); assert.equal(withdrawn.indexJob.kind, 'remove'); assert.equal(f.cache.stats().entries, 0);
  f.index.apply = async () => { throw new Error('synthetic secret failure'); };
  const failed = await f.coordinator.runPending(ctx, 'doc-1'); assert.equal(failed.indexJob.status, 'failed'); assert.equal(failed.failure, 'index_failed');
  await assert.rejects(f.sources.readChunk(ctx, f.ref), { code: 'unavailable' });
  await f.coordinator.runPending(ctx, 'doc-1'); assert.equal((await f.documents.read(ctx, 'doc-1')).revision, failed.revision);
  f.index.apply = async () => {};
  await f.coordinator.request(ctx, { ...change(failed.revision, 'remove-retry'), kind: 'remove' });
  assert.equal((await f.coordinator.runPending(ctx, 'doc-1')).indexJob.status, 'completed');
  assert.ok([...f.repo.receipts.values()].some(receipt => receipt.failure === 'index_failed'));
});
test('duplicate/out-of-order index completion cannot resurrect deleted document', async () => {
  const f = await fixture(), ctx = h.context();
  const pending = await f.coordinator.request(ctx, { ...change(4, 'index-1'), kind: 'upsert' });
  const oldJob = h.clone(pending.indexJob);
  await f.publication.delete(ctx, change(5, 'delete'));
  const deleted = await f.coordinator.runPending(ctx, 'doc-1'); assert.equal(deleted.document.publication, 'deleted');
  await assert.rejects(f.coordinator.complete(ctx, 'doc-1', oldJob, 'completed'), { code: 'conflict' });
  const duplicate = await f.coordinator.complete(ctx, 'doc-1', deleted.indexJob, 'completed'); assert.equal(duplicate.revision, deleted.revision);
  await assert.rejects(f.coordinator.request(ctx, { ...change(deleted.revision, 'revive'), kind: 'upsert' }), { code: 'not_ready' });
});
test('ACL bump gates head, invalidates local cache and queues removal; old source is rejected', async () => {
  const f = await fixture(), ctx = h.context(); await f.sources.readChunk(ctx, f.ref);
  const changed = await f.coordinator.changeAcl(ctx, { ...change(4, 'acl'), aclRevision: 2 });
  assert.equal(changed.document.aclRevision, 2); assert.equal(f.cache.stats().entries, 0);
  await assert.rejects(f.sources.resolve(ctx, f.ref), { code: 'unavailable' });
  assert.ok(f.authCalls.some(r => r.action === 'change_acl' && r.aclRevision === 2));
  await f.coordinator.request(ctx, { ...change(changed.revision, 'reindex-acl'), kind: 'upsert' });
  await f.coordinator.runPending(ctx, 'doc-1');
  assert.equal((await f.sources.readChunk(ctx, { ...f.ref, aclRevision: 2 })).text, 'Synthetic paragraph.');
  assert.equal([...f.repo.chunks.values()][0][0].aclRevision, 1);
});
test('index changes and re-publication invalidate cache even with unchanged content version', async () => {
  const f = await fixture(), ctx = h.context(); await f.sources.readChunk(ctx, f.ref);
  await f.coordinator.request(ctx, { ...change(4, 'reindex'), kind: 'upsert' }); assert.equal(f.cache.stats().entries, 0);
  const indexed = await f.coordinator.runPending(ctx, 'doc-1'); assert.equal(indexed.document.indexing, 'indexed');
  await f.sources.readChunk(ctx, f.ref); assert.equal(f.cache.stats().entries, 1);
  const withdrawn = await f.publication.withdraw(ctx, change(indexed.revision, 'withdraw'));
  await f.coordinator.request(ctx, { ...change(withdrawn.revision, 'prepare-republish'), kind: 'upsert' });
  const ready = await f.coordinator.runPending(ctx, 'doc-1');
  const republished = await f.publication.publish(ctx, change(ready.revision, 'republish')); assert.equal(republished.document.publication, 'published'); assert.equal(f.cache.stats().entries, 0);
});
