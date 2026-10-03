'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const { KnowledgeError } = h.load('knowledge-errors');
const mutation = (revision, operationId) => ({ documentId: 'doc-1', expectedRevision: revision, operationId });
test.after(() => assert.deepEqual(h.attempts, []));
test('missing repository, authorization or file/parser ports fail closed', () => {
  const { KnowledgeDocumentService } = h.load('knowledge-document.service');
  const f = h.harness();
  for (const key of ['repository', 'authorization', 'clock', 'files', 'parser']) assert.throws(() => new KnowledgeDocumentService({ ...f.ports, [key]: undefined }), { code: 'unavailable' });
});
test('draft parse and publication are distinct; exact operation replay does not mutate', async () => {
  const f = h.harness(), ctx = h.context();
  const draft = await f.documents.create(ctx, h.draft());
  assert.equal(draft.revision, 1); assert.equal(draft.document.owner.actorId, 'user-1');
  await f.documents.create(ctx, h.draft()); assert.equal(f.repo.commits, 1);
  await assert.rejects(f.documents.create(ctx, h.draft({ title: 'Different' })), { code: 'conflict' });
  await assert.rejects(f.publication.publish(ctx, mutation(1, 'early')), { code: 'not_ready' });
  const parsed = await f.documents.parseDocument(ctx, mutation(1, 'parse-1'));
  assert.equal(parsed.document.parsing, 'parsed'); assert.equal(parsed.document.indexing, 'not_indexed');
  await f.documents.parseDocument(ctx, mutation(1, 'parse-1')); assert.equal(f.fileCalls, 1);
  await assert.rejects(f.publication.publish(ctx, mutation(3, 'still-early')), { code: 'not_ready' });
});
test('CAS prevents simultaneous versions; historical versions remain immutable and cannot be reused', async () => {
  const f = h.harness(), ctx = h.context(); await h.parsed(f);
  const original = h.clone([...f.repo.versions.values()][0]);
  const results = await Promise.allSettled(['v2', 'v3'].map(v => f.documents.newVersion(ctx, 3, h.draft({ documentVersion: v, attachmentId: `file-${v}`, operationId: `new-${v}` }))));
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.deepEqual([...f.repo.versions.values()][0], original);
  await assert.rejects(f.documents.newVersion(ctx, 4, h.draft({ operationId: 'reuse-v1' })), { code: 'conflict' });
});
test('published -> withdrawn -> deleted tombstone retains audit and old chunks', async () => {
  const f = h.harness(), ctx = h.context(); await h.published(f);
  assert.equal((await f.publication.withdraw(ctx, mutation(4, 'withdraw'))).document.publication, 'withdrawn');
  assert.equal((await f.publication.delete(ctx, mutation(5, 'delete'))).document.publication, 'deleted');
  assert.equal(f.repo.chunks.size, 1); assert.ok(f.repo.receipts.size >= 5);
  await assert.rejects(f.publication.publish(ctx, mutation(6, 'revive')), { code: 'conflict' });
  await assert.rejects(f.documents.newVersion(ctx, 6, h.draft({ documentVersion: 'v2', operationId: 'revive-v2' })), { code: 'conflict' });
});
test('revoked create/read/parse/replay and file ownership never substitute for current authorization', async () => {
  const f = h.harness(), ctx = h.context(); await f.documents.create(ctx, h.draft());
  f.denied = true;
  for (const call of [() => f.documents.read(ctx, 'doc-1'), () => f.documents.create(ctx, h.draft()), () => f.documents.parseDocument(ctx, mutation(1, 'parse'))]) await assert.rejects(call(), { code: 'unavailable' });
  assert.equal(f.fileCalls, 0);
});
test('parse failure is safe evidence, no raw exception; explicit new operation retries', async () => {
  const f = h.harness(), ctx = h.context(); f.parseError = new Error('synthetic sensitive exception');
  const failed = await h.parsed(f); assert.equal(failed.failure, 'parse_failed'); assert.equal(failed.document.parsing, 'failed');
  assert.equal(JSON.stringify(failed).includes('sensitive'), false);
  f.parseError = null;
  assert.equal((await f.documents.parseDocument(ctx, mutation(3, 'retry'))).document.parsing, 'parsed');
});
test('late parser cannot resurrect a tombstone or overwrite new version', async () => {
  const f = h.harness(), ctx = h.context(); await f.documents.create(ctx, h.draft());
  f.files.read = async () => { await f.publication.delete(ctx, mutation(2, 'delete-during-parse')); return { mediaType: 'text/plain', bytes: Buffer.from('late') }; };
  await assert.rejects(f.documents.parseDocument(ctx, mutation(1, 'parse')), { code: 'conflict' });
  assert.equal((await f.documents.read(ctx, 'doc-1')).document.publication, 'deleted'); assert.equal(f.repo.chunks.size, 0);
});
test('input cannot supply URL, path, credentials, public flag, scope or owner', async () => {
  const f = h.harness();
  for (const extra of [{ url: 'https://example.invalid' }, { path: '/etc/file' }, { apiKey: 'synthetic' }, { public: true }, { owner: {} }, { scope: h.scope }]) await assert.rejects(f.documents.create(h.context(), { ...h.draft(), ...extra }), { code: 'invalid_input' });
  for (const attachmentId of ['https://example.invalid', 'C:\\file.txt', '../file']) await assert.rejects(f.documents.create(h.context(), h.draft({ attachmentId })), { code: 'invalid_input' });
  assert.equal(f.repo.commits, 0);
});
test('publication reauthorizes and refuses expired documents and stale revisions', async () => {
  const f = h.harness(), ctx = h.context(); const r = await h.parsed(f, ctx, h.draft({ validUntil: '2026-10-03T00:00:01Z' })); r.document.indexing = 'indexed'; f.repo.seed(r);
  await assert.rejects(f.publication.publish(ctx, mutation(2, 'stale')), { code: 'conflict' });
  f.now += 1000; await assert.rejects(f.publication.publish(ctx, mutation(3, 'expired')), { code: 'not_ready' });
  f.rule = (_, request) => request.action !== 'publish'; await assert.rejects(f.publication.publish(ctx, mutation(3, 'unauthorized')), { code: 'unavailable' });
});
test('actual knowledge modules pass noEmit type checking', () => h.typecheck());
