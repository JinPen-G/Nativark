'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
test.after(() => assert.deepEqual(h.attempts, []));
test('malformed attachment bytes are rejected before parser invocation with bounded evidence', async () => {
  const f = h.harness(), ctx = h.context(); let parserCalls = 0;
  f.files.read = async () => ({ mediaType: 'text/plain', bytes: 'not-a-Uint8Array' });
  f.parser.parse = () => { parserCalls++; throw new Error('must not parse malformed bytes'); };
  const result = await f.documents.create(ctx, h.draft());
  const rejected = await f.documents.parseDocument(ctx, { documentId: result.document.documentId, expectedRevision: result.revision, operationId: 'parse-malformed' });
  assert.equal(rejected.document.parsing, 'rejected'); assert.equal(rejected.failure, 'invalid_text'); assert.equal(parserCalls, 0);
});
test('attachment byte limit is checked before parser and persistence of chunks', async () => {
  const f = h.harness(), ctx = h.context(); let parserCalls = 0;
  f.files.read = async () => ({ mediaType: 'text/plain', bytes: new Uint8Array(262145) });
  f.parser.parse = () => { parserCalls++; throw new Error('must not parse oversized bytes'); };
  const result = await f.documents.create(ctx, h.draft());
  const rejected = await f.documents.parseDocument(ctx, { documentId: result.document.documentId, expectedRevision: result.revision, operationId: 'parse-oversize' });
  assert.equal(rejected.document.parsing, 'rejected'); assert.equal(rejected.failure, 'limit_exceeded'); assert.equal(parserCalls, 0);
});
