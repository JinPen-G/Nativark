'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const { KnowledgeCommitUnknownError } = h.load('knowledge-errors');
test.after(() => assert.deepEqual(h.attempts, []));
test('parse pending receipt after COMMIT reply loss is unknown, not a completed replay', async () => {
  const f = h.harness(), ctx = h.context();
  const { PrismaKnowledgeRepository } = h.load('prisma-knowledge.repository');
  const { KnowledgeDocumentService } = h.load('knowledge-document.service');
  const { dbFactory } = require('./fixtures/ai-native/knowledge-persistent-content.cjs');
  f.repo = new PrismaKnowledgeRepository(dbFactory(), () => new Date(h.now));
  f.documents = new KnowledgeDocumentService({ ...f.ports, repository: f.repo });
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
