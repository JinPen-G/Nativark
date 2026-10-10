'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { composePersistedHumanKnowledge } = h.load('persistent-knowledge.composition');
const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');
const { HumanKnowledgeModule } = h.load('human-knowledge.module');
const { HumanKnowledgeInputService } = h.load('human-knowledge-input.service');
const { HumanKnowledgeConsumptionService } = h.load('human-knowledge-consumption.service');
test.after(() => assert.deepEqual(h.attempts, []));

test('missing attachment business binding denies prepare/create/revise before writes', async () => {
  const { ports, db } = fixture();
  const binding = ports.files.assertBound;
  delete ports.files.assertBound;
  const bundle = composePersistedHumanKnowledge(ports);
  await assert.rejects(bundle.management.create(h.draft()), { code: 'unavailable' });
  await assert.rejects(bundle.management.prepareCreate(h.draft()), { code: 'unavailable' });
  assert.equal(db.state.documents.size, 0);
  ports.files.assertBound = binding;
  await bundle.management.create(h.draft());
  delete ports.files.assertBound;
  await assert.rejects(bundle.management.revise(1, h.draft({
    documentVersion: 'v2', attachmentId: 'attachment-2', operationId: 'revise-2',
  })), { code: 'unavailable' });
  assert.equal((await bundle.management.read('doc-1')).revision, 1);
});

test('opt-in composition prepares original knowledge package with separately authorized preferences', async () => {
  const { ports, db } = fixture();
  const deps = { ...ports, memory: { db, authorization: ports.authorization } };
  const bundle = composePersistedHumanKnowledge(deps);
  await bundle.management.create(h.draft());
  await bundle.management.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  const queued = await bundle.index.request({ documentId: 'doc-1', expectedRevision: 3, operationId: 'index-1', kind: 'upsert' });
  const indexed = await bundle.index.resume({ documentId: 'doc-1', operationId: queued.indexJob.operationId, generation: queued.indexJob.generation });
  await bundle.management.publish({ documentId: 'doc-1', expectedRevision: indexed.revision, operationId: 'publish-1' });
  const memory = new PersistentMemoryConsentService(ports);
  const expiresAt = new Date(h.now + 3600000).toISOString();
  await memory.propose({ memoryId: 'memory-1', operationId: 'propose-1', expiresAt,
    preference: { kind: 'locale', value: 'zh-CN' } });
  await memory.confirm({ memoryId: 'memory-1', expectedRevision: 1, operationId: 'confirm-1', expiresAt });
  const input = { requestId: 'collect-1', query: 'Synthetic', maxSources: 2, maxSnippetChars: 2000, maxTotalBytes: 4096 };
  const result = await bundle.preparation.collect(input, { includePreferences: true });
  assert.equal(result.status, 'ready'); assert.equal(result.preferences.items.length, 1);
  const documentRead = await bundle.consumption.readDocument({ documentId: 'doc-1', previewLimit: 2 });
  assert.equal(documentRead.state, 'current_readable');
  assert.equal(documentRead.body, 'current_readable');
  assert.equal(documentRead.bounded, true);
  const memoryRead = await bundle.consumption.readMemory({ memoryId: 'memory-1' });
  assert.equal(memoryRead.status, 'ready');
  assert.equal(memoryRead.confirmation.confirmationRecordId, result.preferences.items[0].confirmationRecordId);
  assert.deepEqual(await bundle.preparation.revalidate(result), result);
  assert.equal(result.preferences.semantics, 'preference_not_authority');
  assert.deepEqual(result.sections, { knowledge: 'authorized_sources', preferences: 'optional_confirmed_preferences', businessFacts: 'core_authoritative_only' });
  assert.equal(result.tools, undefined); assert.equal(result.invocationId, undefined);
  const disabled = composePersistedHumanKnowledge(ports);
  await assert.rejects(async () => disabled.preparation.collect(input, { includePreferences: true }), { code: 'unavailable' });
  assert.equal((await disabled.preparation.collect(input)).preferences.status, 'not_requested');
  const module = HumanKnowledgeModule.register(deps);
  assert.ok(module.providers.find(p => p.provide === HumanKnowledgeInputService).useValue);
  assert.ok(module.providers.find(p => p.provide === HumanKnowledgeConsumptionService).useValue);
  assert.ok(module.exports.includes(HumanKnowledgeConsumptionService));
  const consent = module.providers.find(p => p.provide === PersistentMemoryConsentService).useValue;
  assert.ok(module.exports.includes(PersistentMemoryConsentService));
  assert.equal(consent, module.providers.find(p => p.provide === HumanKnowledgeInputService).useValue.memory);
  assert.equal((await consent.read('memory-1')).status, 'confirmed');
  const noMemoryModule = HumanKnowledgeModule.register(ports);
  assert.equal(noMemoryModule.exports.includes(PersistentMemoryConsentService), false);
  assert.equal(noMemoryModule.providers.some(p => p.provide === PersistentMemoryConsentService), false);
  const withdrawn = await bundle.consumption.withdrawMemory({ memoryId: 'memory-1', expectedRevision: 2 });
  assert.equal(withdrawn.status, 'revoked');
  assert.equal(withdrawn.semantics, 'consent_withdrawal_not_memory_delete_or_business_rollback');
  await assert.rejects(bundle.preparation.revalidate(result), { code: 'unavailable' });
  assert.deepEqual((await bundle.preparation.collect(input, { includePreferences: true })).preferences.items, []);
  assert.throws(() => composePersistedHumanKnowledge({ ...deps, memory: { db, authorization: undefined } }), { code: 'unavailable' });
});

test('consumption binds observations across waits and recovers the exact memory deletion', async () => {
  const { ports, db, flags } = fixture();
  const bundle = composePersistedHumanKnowledge({ ...ports, memory: { db, authorization: ports.authorization } });
  await bundle.management.create(h.draft());
  await bundle.management.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  const detail = bundle.management.detail.bind(bundle.management);
  let once = true;
  bundle.management.detail = async id => {
    const result = await detail(id);
    if (once) {
      once = false;
      await bundle.management.revise(result.revision, h.draft({ documentVersion: 'v2', operationId: 'revise-2' }));
    }
    return result;
  };
  await assert.rejects(bundle.consumption.readDocument({ documentId: 'doc-1' }), { code: 'conflict' });
  bundle.management.detail = detail;
  const revised = await detail('doc-1');
  const parsed = await bundle.management.parse({ documentId: 'doc-1', expectedRevision: revised.revision, operationId: 'parse-2' });
  const queued = await bundle.index.request({ documentId: 'doc-1', expectedRevision: parsed.revision, operationId: 'index-2', kind: 'upsert' });
  const indexed = await bundle.index.resume({ documentId: 'doc-1', operationId: queued.indexJob.operationId, generation: queued.indexJob.generation });
  const current = await bundle.management.publish({ documentId: 'doc-1', expectedRevision: indexed.revision, operationId: 'publish-2' });
  await bundle.management.withdraw({ documentId: 'doc-1', expectedRevision: current.revision, operationId: 'withdraw-1' });
  const withdrawn = await bundle.consumption.readDocument({ documentId: 'doc-1' });
  assert.equal(withdrawn.state, 'withdrawn_or_deleted');
  assert.deepEqual(withdrawn.preview.sources, []);
  assert.equal(withdrawn.metadata.indexJob.status, 'pending');

  const expiresAt = new Date(h.now + 3600000).toISOString();
  await bundle.memory.propose({ memoryId: 'memory-1', operationId: 'propose-1', expiresAt,
    preference: { kind: 'locale', value: 'zh-CN' } });
  await bundle.memory.confirm({ memoryId: 'memory-1', expectedRevision: 1, operationId: 'confirm-1', expiresAt });
  const proof = bundle.memory.confirmationDetail.bind(bundle.memory);
  bundle.memory.confirmationDetail = async id => {
    const result = await proof(id);
    await bundle.memory.revoke({ memoryId: id, expectedRevision: 2 });
    return result;
  };
  await assert.rejects(bundle.consumption.readMemory({ memoryId: 'memory-1' }), { code: 'unavailable' });
  bundle.memory.confirmationDetail = proof;
  assert.equal((await bundle.consumption.readMemory({ memoryId: 'memory-1' })).status, 'revoked');

  const deletion = { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-1', expectedRevision: 2, operation: 'delete' };
  const transaction = db.$transaction;
  db.$transaction = async (...args) => {
    const before = db.state.memories.get('memory-1').status;
    const result = await transaction(...args);
    if (before !== 'deleted' && db.state.memories.get('memory-1').status === 'deleted') throw new Error('synthetic committed response lost');
    return result;
  };
  await assert.rejects(bundle.consumption.changeMemory('delete-1', deletion), { code: 'result_unknown' });
  db.$transaction = transaction;
  const recovered = await bundle.consumption.recoverMemoryChange('delete-1', deletion);
  assert.equal(recovered.status, 'committed_current');
  assert.equal((await bundle.consumption.changeMemory('delete-1', deletion)).status, 'deleted');
  const count = db.state.memoryOperations.size;
  await assert.rejects(bundle.consumption.recoverMemoryChange('delete-1', { ...deletion, expectedRevision: 1 }), { code: 'conflict' });
  assert.equal(db.state.memoryOperations.size, count);
  flags.workspaceId = 'another-space';
  await assert.rejects(bundle.consumption.readDocument({ documentId: 'doc-1' }), { code: 'unavailable' });
  await assert.rejects(bundle.consumption.recoverMemoryChange('delete-1', deletion), { code: 'unavailable' });
});
