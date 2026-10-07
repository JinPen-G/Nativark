'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');

test.after(() => assert.deepEqual(h.attempts, []));

test('document parsing does not persist a document retargeted by the file adapter', async () => {
  const f = h.harness();
  const ctx = h.context();
  await f.documents.create(ctx, h.draft());
  const commitsBeforeParse = f.repo.commits;
  f.files.read = async (_readContext, document) => {
    document.scope.workspaceId = 'workspace-foreign';
    return { mediaType: 'text/plain', bytes: Buffer.from(f.text) };
  };

  const result = await f.documents.parseDocument(ctx, { documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  assert.equal(result.document.scope.workspaceId, 'space-1');
  assert.equal(f.repo.commits, commitsBeforeParse + 2, 'the parse result is committed once after the pending marker');
  const stored = await f.repo.read(ctx.scope, 'doc-1');
  assert.equal(stored.document.scope.workspaceId, 'space-1');
});
