'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-public.cjs');
const { publicDocumentHarness } = require('./fixtures/ai-native/knowledge-persistent-content.cjs');
const { createControllerSourceLoader } = require('../scripts/controller-sources.cjs');
const loader = createControllerSourceLoader(require('node:path').resolve(__dirname, '..'));
const { KnowledgeCommitUnknownError } = loader.load(loader.resolveSource(__filename, '@rental-os/ai-native-server/knowledge-persistence', true));
test.after(() => assert.deepEqual(h.attempts, []));

test('reconcile reads the same durable parse result after lost response without another parse or write', async () => {
  const f = publicDocumentHarness(), ctx = h.context();
  const { repo: repository, documents } = f;
  await documents.create(ctx, h.draft());
  const commit = repository.commit.bind(repository);
  let writes = 0;
  repository.commit = async input => { writes++; const result = await commit(input); if (input.operation.id === 'parse-1:parse-result') throw new KnowledgeCommitUnknownError(); return result; };
  const input = { documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' };
  await assert.rejects(documents.parseDocument(ctx, input), { code: 'result_unknown' });
  const count = writes, reads = f.fileCalls;
  assert.equal((await documents.reconcileParse(ctx, input)).document.parsing, 'parsed');
  assert.equal(writes, count); assert.equal(f.fileCalls, reads);
  f.denied = true;
  await assert.rejects(documents.reconcileParse(ctx, input), { code: 'unavailable' });
});

test('reconcile cannot turn an admission-only receipt into parsed success', async () => {
  const f = h.harness(), ctx = h.context();
  await f.documents.create(ctx, h.draft());
  const commit = f.repo.commit.bind(f.repo);
  f.repo.commit = async input => { const result = await commit(input); if (input.operation.id === 'parse-1') throw new KnowledgeCommitUnknownError(); return result; };
  const input = { documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' };
  await assert.rejects(f.documents.parseDocument(ctx, input), { code: 'result_unknown' });
  await assert.rejects(f.documents.reconcileParse(ctx, input), { code: 'result_unknown', nextAction: 'reconcile' });
  assert.equal(f.fileCalls, 0);
});
