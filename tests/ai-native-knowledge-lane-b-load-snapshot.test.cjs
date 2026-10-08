'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
test.after(() => assert.deepEqual(h.attempts, []));
test('document load rejects caller scope mutation while the repository awaits', async () => {
  const f = h.harness(), ctx = h.context(); await f.documents.create(ctx, h.draft());
  const original = f.repo.read.bind(f.repo);
  f.repo.read = async (scope, id) => { ctx.scope.workspaceId = 'workspace-foreign'; return original(scope, id); };
  await assert.rejects(f.documents.read(ctx, 'doc-1'), { code: 'unavailable' });
});
test('document load cannot return a same-id record from a scope selected after authorization', async () => {
  const f = h.harness(), ctx = h.context(); await f.documents.create(ctx, h.draft());
  const foreign = h.clone([...f.repo.heads.values()][0]); foreign.document.scope.workspaceId = 'workspace-foreign';
  f.repo.seed(foreign, [...f.repo.chunks.values()][0]);
  const original = f.repo.read.bind(f.repo);
  f.repo.read = async (scope, id) => { ctx.scope.workspaceId = 'workspace-foreign'; return original(scope, id); };
  await assert.rejects(f.documents.read(ctx, 'doc-1'), { code: 'unavailable' });
});
