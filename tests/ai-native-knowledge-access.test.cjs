'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const unavailable = { draftVersion: h.shared.AI_KNOWLEDGE_DRAFT_VERSION, requestId: 'recall-1', status: 'unavailable', nextAction: 'reauthorize_or_manual' };
async function fixture() { const f = h.retrieval(h.harness()); await h.published(f); return f; }
async function ref(f) { return (await f.retrieval.recall(h.context(), h.query())).matches[0].source; }
test.after(() => assert.deepEqual(h.attempts, []));
test('search receives current server scope, principal, audience, version and ACL before any content read', async () => {
  const f = await fixture(); const result = await f.retrieval.recall(h.context(), h.query());
  assert.equal(result.status, 'ready'); assert.equal(result.matches[0].trust, 'untrusted_data');
  assert.deepEqual(f.searchCalls[0].grant.scope, h.scope); assert.equal(f.searchCalls[0].grant.actor.actorId, 'user-1');
  assert.deepEqual(f.searchCalls[0].documents, [{ documentId: 'doc-1', documentVersion: 'v1', aclRevision: 1 }]);
  assert.deepEqual(await f.sources.download(h.context(), result.matches[0].source), { attachmentId: 'attachment-1', documentVersion: 'v1' });
});
test('cross-tenant/workspace/platform and missing-workspace references never read text', async () => {
  const f = await fixture(), source = await ref(f); f.bodyReads = 0;
  for (const ctx of [h.context({ scope: { ...h.scope, tenantId: 'other' } }), h.context({ scope: { ...h.scope, workspaceId: 'other' } }), h.context({ actor: { kind: 'saas_admin', userId: 'saas' }, scope: { kind: 'platform' } }), h.context({ scope: { kind: 'workspace', tenantId: 'tenant-1' } })]) {
    await assert.rejects(f.sources.resolve(ctx, source), { code: 'unavailable' });
    assert.notEqual((await f.retrieval.recall(ctx, h.query())).status, 'ready');
  }
  assert.equal(f.bodyReads, 0);
});
test('candidate filter mutation returning a foreign source is blocked before body/model access', async () => {
  const f = await fixture(), source = await ref(f); f.bodyReads = 0;
  f.search.search = async () => [{ ...source, scope: { ...h.scope, tenantId: 'foreign' } }];
  assert.deepEqual(await f.retrieval.recall(h.context(), h.query()), unavailable); assert.equal(f.bodyReads, 0);
  f.search.search = async () => [{ ...source, documentId: 'hidden' }];
  assert.deepEqual(await f.retrieval.recall(h.context(), h.query()), unavailable); assert.equal(f.bodyReads, 0);
});
test('same ID in different scopes resolves only the selected scope and version', async () => {
  const f = await fixture(), other = h.context({ scope: { ...h.scope, workspaceId: 'space-2' } }); f.text = 'Synthetic different space';
  await h.published(f, other);
  const first = await f.retrieval.recall(h.context(), h.query()), second = await f.retrieval.recall(other, h.query());
  assert.equal(first.matches[0].excerpt, 'Synthetic paragraph.'); assert.equal(second.matches[0].excerpt, 'Synthetic different space');
});
test('current role/location/customer policy and separate snippet/download decisions govern each access', async () => {
  const f = await fixture(), source = await ref(f);
  const staff = h.context({ audience: 'staff' }), client = h.context({ audience: 'client', actor: { kind: 'customer', customerId: 'customer-1' } });
  f.rule = (ctx, r) => !r.document || (ctx.audience !== 'staff' && (ctx.audience !== 'client' || r.document.owner.actorId === ctx.actor.customerId));
  for (const ctx of [staff, client]) await assert.rejects(f.sources.resolve(ctx, source), { code: 'unavailable' });
  f.rule = (_, r) => r.action !== 'download'; await assert.rejects(f.sources.download(h.context(), source), { code: 'unavailable' });
  f.rule = (_, r) => r.action !== 'snippet'; assert.deepEqual(await f.retrieval.recall(h.context(), h.query()), unavailable);
});
test('authorized then revoked and nonexistent sources have identical public errors', async () => {
  const f = await fixture(), source = await ref(f); f.denied = true;
  const errors = [];
  for (const s of [source, { ...source, documentId: 'does-not-exist' }]) {
    try { await f.sources.resolve(h.context(), s); } catch (e) { errors.push({ code: e.code, message: e.message }); }
  }
  assert.deepEqual(errors, [{ code: 'unavailable', message: 'unavailable' }, { code: 'unavailable', message: 'unavailable' }]);
  assert.deepEqual(await f.retrieval.recall(h.context(), h.query()), unavailable);
});
test('ACL revision, changed document version, withdrawal and expiry invalidate old citations', async () => {
  for (const mutate of [r => r.document.aclRevision++, r => r.document.documentVersion = 'v2', r => r.document.publication = 'withdrawn', r => r.document.validUntil = new Date(h.now).toISOString()]) {
    const f = await fixture(), source = await ref(f), r = await f.repo.read(h.scope, 'doc-1'); mutate(r); r.revision++; f.repo.seed(r);
    await assert.rejects(f.sources.readChunk(h.context(), source), { code: 'unavailable' });
  }
});
test('revocation while reading body cannot leak the snippet', async () => {
  const f = await fixture(); const read = f.content.chunk;
  f.content.chunk = async (...args) => { const chunk = await read(...args); f.denied = true; return chunk; };
  assert.deepEqual(await f.retrieval.recall(h.context(), h.query()), unavailable);
});
test('business facts preserve snapshot/missing/legacy basis; never search SOP for a substitute', async () => {
  const f = await fixture();
  for (const basis of [{ kind: 'snapshot', version: 'historic' }, { kind: 'missing', reason: 'snapshot_missing' }, { kind: 'legacy_current_fallback', reason: 'snapshot_missing' }]) {
    const source = { kind: 'business_fact', fact: { scope: h.scope, resourceType: 'order', resourceId: 'order-1', observedAt: new Date(h.now).toISOString(), basis } };
    assert.deepEqual(await f.sources.resolve(h.context(), source), source);
    f.content.factReference = async (_, fact) => ({ ...fact, basis: { kind: 'current' } });
    await assert.rejects(f.sources.resolve(h.context(), source), { code: 'unavailable' });
    f.content.factReference = async (_, fact) => h.clone(fact);
  }
  assert.equal(f.searchCalls.length, 0);
});
test('authorized pipeline states differ from denial; no matching authorized text is only no_results', async () => {
  const f = h.retrieval(h.harness()); await f.documents.create(h.context(), h.draft());
  assert.deepEqual(await f.retrieval.recall(h.context(), h.query()), { draftVersion: unavailable.draftVersion, requestId: 'recall-1', status: 'not_ready', reason: 'parsing' });
  f.parseError = new Error('failed'); await f.documents.parseDocument(h.context(), { documentId: 'doc-1', expectedRevision: 1, operationId: 'parse' });
  assert.equal((await f.retrieval.recall(h.context(), h.query())).status, 'failed');
  const ready = await fixture(); assert.equal((await ready.retrieval.recall(h.context(), h.query({ query: 'absent' }))).status, 'no_results');
});
test('result and input bounds fail closed', async () => {
  const f = await fixture(), source = await ref(f);
  await assert.rejects(f.retrieval.recall(h.context(), h.query({ limit: 21 })), { code: 'invalid_input' });
  f.search.search = async () => Array(6).fill(source); assert.deepEqual(await f.retrieval.recall(h.context(), h.query()), unavailable);
});
