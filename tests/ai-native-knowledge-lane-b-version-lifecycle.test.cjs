'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { HumanKnowledgeService } = h.load('human-knowledge.service');
const { KnowledgeError } = h.load('knowledge-errors');
test.after(() => assert.deepEqual(h.attempts, []));
test('declared parser capability and rejected input correct through a new immutable version', async () => {
  const { ports, f, db } = fixture();
  let unsupported = true;
  const api = new HumanKnowledgeService({ ...ports, files: { ...f.files, read: async (...args) => unsupported
    ? { mediaType: 'application/pdf', bytes: new Uint8Array([65]) } : f.files.read(...args) } });
  assert.deepEqual(api.parserCapabilities().mediaTypes, ['text/plain', 'text/markdown']);
  assert.equal(api.parserCapabilities().maxBytes, 262144);
  await api.create(h.draft());
  const failed = await api.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  assert.equal(failed.failure, 'unsupported');
  assert.equal((await api.versionStatus('doc-1')).parseRecovery, 'revise_new_version');
  f.rule = (_ctx, request) => request.attachmentId !== 'denied-file';
  await assert.rejects(api.revise(3, h.draft({ documentVersion: 'v2', operationId: 'revise-1', attachmentId: 'denied-file' })), { code: 'unavailable' });
  await api.revise(3, h.draft({ documentVersion: 'v2', operationId: 'revise-2' }));
  const status = await api.versionStatus('doc-1');
  assert.equal(status.currentVersion, 'v2'); assert.equal(status.pendingParseVersion, 'v2');
  assert.equal(status.indexedPublishedVersion, null); assert.equal(status.historicalVersions, 'unavailable');
  assert.equal(db.state.versions.size, 2);
  unsupported = false;
  assert.equal((await api.parse({ documentId: 'doc-1', expectedRevision: 4, operationId: 'parse-2' })).parsing, 'parsed');
  assert.equal((await api.detail('doc-1')).nextStepAuthorization, 'authorized');
  f.rule = (_context, request) => request.action !== 'index';
  assert.equal((await api.detail('doc-1')).nextStepAuthorization, 'unavailable');
});
test('unknown parsing must be reconciled instead of overwritten by a new version', async () => {
  const { ports } = fixture();
  const api = new HumanKnowledgeService({ ...ports, files: { read: async () => { throw new KnowledgeError('unavailable'); } } });
  await api.create(h.draft());
  await assert.rejects(api.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' }), { code: 'unavailable' });
  await assert.rejects(api.revise(2, h.draft({ documentVersion: 'v2', operationId: 'revise-1' })), { code: 'result_unknown' });
  assert.equal((await api.versionStatus('doc-1')).currentVersion, 'v1');
});
