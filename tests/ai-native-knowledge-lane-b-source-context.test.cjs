'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');

test.after(() => assert.deepEqual(h.attempts, []));

test('source read does not let the content port retarget the caller context', async () => {
  const f = h.retrieval(h.harness());
  const ctx = h.context();
  await h.published(f, ctx);
  const source = h.source([...f.repo.chunks.values()][0][0]);
  const originalChunk = f.content.chunk;
  f.content.chunk = async (contentContext, value, maxChars) => {
    contentContext.scope.workspaceId = 'workspace-foreign';
    return originalChunk(contentContext, value, maxChars);
  };

  const result = await f.sources.readChunk(ctx, source);
  assert.equal(result.documentId, 'doc-1');
  assert.equal(ctx.scope.workspaceId, 'space-1');
});
