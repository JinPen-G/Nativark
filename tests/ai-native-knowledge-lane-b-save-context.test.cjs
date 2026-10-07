'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');

test.after(() => assert.deepEqual(h.attempts, []));

test('publication does not let the repository mutate the caller scope after commit', async () => {
  const f = h.harness();
  const ctx = h.context();
  const parsed = await h.parsed(f, ctx);
  parsed.document.indexing = 'indexed';
  f.repo.seed(parsed);
  const originalCommit = f.repo.commit.bind(f.repo);
  f.repo.commit = async input => {
    const result = await originalCommit(input);
    input.scope.workspaceId = 'workspace-foreign';
    return result;
  };

  const result = await f.publication.publish(ctx, { documentId: 'doc-1', expectedRevision: parsed.revision, operationId: 'publish-1' });
  assert.equal(result.document.publication, 'published');
  assert.equal(ctx.scope.workspaceId, 'space-1');
  const stored = await f.repo.read(h.scope, 'doc-1');
  assert.equal(stored.document.publication, 'published');
});
