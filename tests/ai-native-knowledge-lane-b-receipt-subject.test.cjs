'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');

test.after(() => assert.deepEqual(h.attempts, []));

test('knowledge operation receipts cannot be replayed by another actor in the same scope', async () => {
  const f = h.harness();
  const first = h.context();
  await f.documents.create(first, h.draft());
  const second = h.context({ actor: { kind: 'user', userId: 'user-2' }, requestId: 'request-2' });
  await assert.rejects(f.documents.create(second, h.draft()), { code: 'conflict' });
});
