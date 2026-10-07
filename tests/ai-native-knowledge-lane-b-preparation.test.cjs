'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { HumanKnowledgeService } = h.load('human-knowledge.service');
const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');
test.after(() => assert.deepEqual(h.attempts, []));

test('create/parse readiness and bounded preview expose current persistent facts only', async () => {
  const { ports, f, db } = fixture(), api = new HumanKnowledgeService(ports);
  const draft = h.draft();
  const prepared = await api.prepareCreate(draft);
  assert.equal(prepared.status, 'ready_to_create'); assert.equal(prepared.attachmentId, draft.attachmentId);
  await api.create(draft);
  const ready = await api.parseReadiness('doc-1');
  assert.equal(ready.ready, true); assert.equal(ready.nextStep, 'parse');
  await api.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  assert.equal((await api.preview('doc-1', 1)).status, 'ready');
  const preview = await api.preview('doc-1', 1);
  assert.equal(preview.sources.length, 1); assert.equal(preview.sources[0].source.documentVersion, 'v1');
  assert.equal(preview.truncated, false);
  assert.equal(preview.sources[0].trust, 'untrusted_data'); assert.equal(preview.semantics, 'preview_not_approval_or_search_readiness');
  await api.revise(3, h.draft({ documentVersion: 'v2', operationId: 'revise-1' }));
  const next = await api.parseReadiness('doc-1');
  assert.equal(next.ready, true); assert.equal(next.documentVersion, 'v2');
  assert.equal((await api.operationStatus('doc-1', 'parse-1')).completionSemantics, 'receipt_and_head_are_separate_facts');
  f.denied = true;
  await assert.rejects(api.prepareCreate(h.draft({ documentId: 'doc-2', operationId: 'create-2' })), { code: 'unavailable' });
  assert.equal(db.state.versions.size, 2);
});

test('explicit preference selection never defaults to every confirmed memory', async () => {
  const { ports } = fixture(), memory = new PersistentMemoryConsentService(ports);
  const expiresAt = new Date(h.now + 3600000).toISOString();
  await memory.propose({ memoryId: 'memory-locale', operationId: 'p-locale', expiresAt, preference: { kind: 'locale', value: 'zh-CN' } });
  await memory.confirm({ memoryId: 'memory-locale', expectedRevision: 1, operationId: 'c-locale', expiresAt });
  await memory.propose({ memoryId: 'memory-density', operationId: 'p-density', expiresAt, preference: { kind: 'display_density', value: 'compact' } });
  await memory.confirm({ memoryId: 'memory-density', expectedRevision: 1, operationId: 'c-density', expiresAt });
  const selected = await memory.selectPreferences({ kinds: ['locale'], limit: 10 });
  assert.deepEqual(selected.items.map(item => item.memoryId), ['memory-locale']);
  await assert.rejects(memory.selectPreferences({ kinds: [], limit: 10 }), { code: 'invalid_input' });
});
