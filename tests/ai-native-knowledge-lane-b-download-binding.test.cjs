'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
test.after(() => assert.deepEqual(h.attempts, []));
test('download adapter cannot replace the authorized attachment through a document alias', async () => {
  const f = h.retrieval(h.harness());
  await h.published(f);
  const ref = h.source([...f.repo.chunks.values()][0][0]);
  f.content.downloadReference = async (_, document) => {
    document.attachmentId = 'foreign-attachment';
    return { attachmentId: document.attachmentId, documentVersion: document.documentVersion };
  };
  await assert.rejects(f.sources.download(h.context(), ref), { code: 'unavailable' });
});
test('download reference is detached before final current-authorization waits', async () => {
  const f = h.retrieval(h.harness());
  await h.published(f);
  const ref = h.source([...f.repo.chunks.values()][0][0]);
  const returned = { attachmentId: 'attachment-1', documentVersion: 'v1' };
  let received = false;
  f.content.downloadReference = async () => { received = true; return returned; };
  const original = f.authorization.authorize;
  f.authorization.authorize = async (...args) => {
    if (received) returned.attachmentId = 'late-foreign-attachment';
    return original(...args);
  };
  assert.deepEqual(await f.sources.download(h.context(), ref), { attachmentId: 'attachment-1', documentVersion: 'v1' });
});
test('download rejects caller identity change while reference resolution waits', async () => {
  const f = h.retrieval(h.harness()), ctx = h.context();
  await h.published(f);
  const ref = h.source([...f.repo.chunks.values()][0][0]);
  f.content.downloadReference = async () => {
    ctx.actor.userId = 'another-user';
    return { attachmentId: 'attachment-1', documentVersion: 'v1' };
  };
  await assert.rejects(f.sources.download(ctx, ref), { code: 'unavailable' });
});
