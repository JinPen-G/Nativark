'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { HumanKnowledgeService } = h.load('human-knowledge.service');
const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');
test.after(() => assert.deepEqual(h.attempts, []));
test('version comparison returns bounded authorized chunk changes and old-reference status', async () => {
  const { ports, f } = fixture(), api = new HumanKnowledgeService(ports);
  await api.create(h.draft()); await api.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  await api.revise(3, h.draft({ documentVersion: 'v2', operationId: 'revise-1' }));
  const compared = await api.compareVersions('doc-1', 'v1', 'v2');
  assert.equal(compared.body, 'authorized'); assert.equal(compared.changes.length, 1);
  assert.equal(compared.currentVersion, 'v2');
  f.rule = (_context, request) => request.action !== 'read_body';
  const metadata = await api.compareVersions('doc-1', 'v1', 'v2');
  assert.equal(metadata.body, 'unavailable'); assert.deepEqual(metadata.changes, []);
  f.rule = () => true;
  const status = await api.versionStatus('doc-1');
  assert.equal(status.currentVersion, 'v2'); assert.equal(status.historicalVersions, 'unavailable');
});

test('confirmation detail reads the stored proof and rechecks current memory binding', async () => {
  const { ports } = fixture(), api = new PersistentMemoryConsentService(ports), expiresAt = new Date(h.now + 3600000).toISOString();
  await api.propose({ memoryId: 'memory-1', operationId: 'p-1', expiresAt, preference: { kind: 'locale', value: 'zh-CN' } });
  await api.confirm({ memoryId: 'memory-1', expectedRevision: 1, operationId: 'c-1', expiresAt });
  const detail = await api.confirmationDetail('memory-1');
  assert.equal(detail.preference.value, 'zh-CN'); assert.equal(detail.semantics, 'persistent_confirmation_record_not_current_preference_reconstruction');
});
