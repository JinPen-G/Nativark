'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-public.cjs');
const { publicDocumentHarness } = require('./fixtures/ai-native/knowledge-persistent-content.cjs');
const { createControllerSourceLoader } = require('../scripts/controller-sources.cjs');
const loader = createControllerSourceLoader(require('node:path').resolve(__dirname, '..'));
const { KnowledgeCommitUnknownError } = loader.load(loader.resolveSource(__filename, '@rental-os/ai-native-server/knowledge-persistence', true));
test.after(() => assert.deepEqual(h.attempts, []));
test('parse pending receipt after COMMIT reply loss is unknown, not a completed replay', async () => {
  const f = publicDocumentHarness(), ctx = h.context();
  await f.documents.create(ctx, h.draft());
  const commit = f.repo.commit.bind(f.repo);
  let loseReply = true, writes = 0;
  f.repo.commit = async input => {
    writes++;
    const result = await commit(input);
    if (loseReply && input.operation.id === 'parse-1') { loseReply = false; throw new KnowledgeCommitUnknownError(); }
    return result;
  };
  const input = { documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' };
  await assert.rejects(f.documents.parseDocument(ctx, input), { code: 'result_unknown' });
  const count = writes;
  await assert.rejects(f.documents.parseDocument(ctx, input), { code: 'result_unknown', nextAction: 'reconcile' });
  assert.equal(f.fileCalls, 0);
  assert.equal(writes, count);
});
