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

test('read-only HTTP uses request-local credentials and current exact policies without enabling default routes', async t => {
  const { HumanKnowledgeConsumptionRequestFactory } = h.load('human-knowledge-consumption.composition');
  const { HumanKnowledgeConsumptionController } = h.load('human-knowledge-consumption.controller');
  const { AI_KNOWLEDGE_CONSUMPTION_HTTP_SCHEMAS: schemas } = require('../packages/shared/src/ai-knowledge-consumption-http-draft');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  const Ajv = require('ajv'), ajv = new Ajv({ strict: true, allErrors: true });
  require('ajv-formats')(ajv);
  const validators = Object.fromEntries(Object.entries(schemas).map(([name, schema]) => {
    assert.doesNotThrow(() => aiLeafToOpenApi30(schema, name));
    return [name, ajv.compile(schema)];
  }));
  const valid = (name, value) => {
    assert.equal(validators[name](value), true, `${name}: ${ajv.errorsText(validators[name].errors)}`);
    return value;
  };
  const readDocument = HumanKnowledgeConsumptionService.prototype.readDocument;
  t.mock.method(HumanKnowledgeConsumptionService.prototype, 'readDocument', async function(value) {
    const result = await readDocument.call(this, value);
    result.internalOnly = 'not-public'; result.metadata.internalOnly = 'not-public';
    if (result.preview.status === 'ready' && result.preview.sources.length) {
      result.preview.sources[0].source.locator.internalOnly = 'not-public';
      result.preview.sources[0].source.scope.internalOnly = 'not-public';
    }
    return result;
  });
  const { fingerprint } = h.load('knowledge-validation');
  const { getRequestIdentity, runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { f, ports, db, identity } = fixture();
  const bundle = composePersistedHumanKnowledge({ ...ports, memory: { db, authorization: ports.authorization } });
  const expiresAt = new Date(h.now + 3600000).toISOString();
  await bundle.management.create(h.draft({ validUntil: expiresAt }));
  await bundle.management.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  await bundle.memory.propose({ memoryId: 'memory-1', operationId: 'propose-1', expiresAt, preference: { kind: 'locale', value: 'zh-CN' } });
  await bundle.memory.confirm({ memoryId: 'memory-1', expectedRevision: 1, operationId: 'confirm-1', expiresAt });
  const memory = await bundle.memory.read('memory-1'), policies = new Map(), stores = new Map();
  const grant = (domain, action, resource) => {
    const key = { tenantId: 'tenant-1', workspaceId: 'space-1', actorKind: 'user', actorId: 'user-1', audience: 'operator',
      domain, action, resourceKey: fingerprint(resource) };
    policies.set(JSON.stringify(key), { ...key, resource, enabled: true, revision: 1,
      expiresAt: new Date(h.now + 86400000), requiredPermissions: ['synthetic-policy'] });
  };
  const document = { documentId: 'doc-1', documentVersion: 'v1', attachmentId: 'attachment-1', aclRevision: 1 };
  for (const action of ['read_metadata', 'read_body', 'resolve_source']) {
    grant('knowledge', action, {}); grant('knowledge', action, document);
  }
  grant('memory', 'read', { owner: memory.owner });
  grant('memory', 'read', { memoryId: memory.memoryId, revision: memory.revision, aclRevision: memory.aclRevision, owner: memory.owner });
  const dependencies = { db, clock: ports.clock, memory: { db },
    auth: { resolveAccessContext: async (authorization, options) => {
      assert.equal(options.audience, 'operator');
      const store = getRequestIdentity();
      if (store) { stores.set(authorization, store); assert.equal(store.tenantId, undefined); }
      await Promise.resolve();
      if (store) assert.equal(getRequestIdentity(), store);
      if (!['Bearer reader', 'Bearer other'].includes(authorization)) return undefined;
      const access = await identity.auth.resolveAccessContext(authorization, options);
      return authorization === 'Bearer other' ? { ...access, workspaceId: 'other-space' } : access;
    } },
    policyDb: { aiKnowledgeActionPolicy: { findUnique: async ({ where }) =>
      structuredClone(policies.get(JSON.stringify(where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey)) ?? null) },
    aiKnowledgePolicyManagementOperation: { findFirst: async () => null } },
    fileRuntime: { readKnowledgeBytes: async () => { throw Error('unexpected file read'); }, assertKnowledgeBinding: async () => {} } };
  assert.deepEqual(HumanKnowledgeModule.registerConsumptionHttp().controllers, []);
  assert.throws(() => HumanKnowledgeModule.registerConsumptionHttp({ enabled: true }), { code: 'unavailable' });
  assert.throws(() => HumanKnowledgeModule.registerConsumptionHttp({ enabled: true, dependencies: { ...dependencies, policyDb: undefined } }), { code: 'unavailable' });
  const module = HumanKnowledgeModule.registerConsumptionHttp({ enabled: true, dependencies });
  assert.deepEqual(module.controllers, [HumanKnowledgeConsumptionController]);
  const requests = module.providers.find(p => p.provide === HumanKnowledgeConsumptionRequestFactory).useValue;
  const controller = new HumanKnowledgeConsumptionController(requests);
  const request = { headers: { authorization: 'Bearer reader' } };
  let last;
  const open = requests.open.bind(requests);
  requests.open = value => { last = open(value); return last; };
  const invalid = error => {
    valid('AiKnowledgeConsumptionHttpErrorDraft', error.getResponse());
    return error.getStatus() === 400 && error.getResponse().code === 'AI_INVALID_INPUT';
  };
  const denied = error => {
    valid('AiKnowledgeConsumptionHttpErrorDraft', error.getResponse());
    return error.getStatus() === 503 && error.getResponse().code === 'AI_RESOURCE_UNAVAILABLE';
  };
  valid('AiKnowledgeDocumentReadRequestDraft', { documentId: 'doc-1' });
  valid('AiKnowledgeMemoryReadRequestDraft', { memoryId: 'memory-1' });
  valid('AiKnowledgePreferencesReadRequestDraft', { limit: 1 });
  const draft = valid('AiKnowledgeDocumentReadResponseDraft', await controller.readDocument(request, { documentId: 'doc-1' }));
  assert.equal(draft.metadata.publication, 'draft'); assert.equal(draft.body, 'current_readable');
  assert.equal(draft.metadata.permissions, undefined);
  assert.equal(validators.AiKnowledgeDocumentReadResponseDraft({ ...draft, metadata: { ...draft.metadata, internalOnly: 'forbidden' } }), false);
  assert.equal(validators.AiKnowledgeConsumptionHttpErrorDraft({ code: 'AI_RESOURCE_UNAVAILABLE', retryable: false, body: 'forbidden' }), false);
  await assert.rejects(last.readDocument({ documentId: 'doc-1' }), { code: 'unavailable' });
  await assert.rejects(controller.readDocument(request, { documentId: 'doc-1', actor: 'user-1' }), invalid);
  await assert.rejects(last.readDocument({ documentId: 'doc-1' }), { code: 'unavailable' });
  await assert.rejects(controller.readPreferences(request, { limit: 11 }), invalid);
  await assert.rejects(controller.readMemory({ headers: { authorization: 'Bearer client' } }, { memoryId: 'memory-1' }), denied);
  assert.equal(valid('AiKnowledgeMemoryReadResponseDraft', await controller.readMemory(request, { memoryId: 'memory-1' })).status, 'ready');
  assert.equal(valid('AiKnowledgePreferencesReadResponseDraft', await controller.readPreferences(request, { limit: 1 })).items[0].memoryId, 'memory-1');
  const queued = await bundle.index.request({ documentId: 'doc-1', expectedRevision: 3, operationId: 'index-1', kind: 'upsert' });
  const indexed = await bundle.index.resume({ documentId: 'doc-1', operationId: queued.indexJob.operationId, generation: queued.indexJob.generation });
  const published = await bundle.management.publish({ documentId: 'doc-1', expectedRevision: indexed.revision, operationId: 'publish-1' });
  const { scope, ...source } = draft.preview.sources[0].source;
  valid('AiKnowledgeSourceReadRequestDraft', source);
  assert.equal(validators.AiKnowledgeSourceReadRequestDraft({ ...source, scope }), false);
  assert.equal(valid('AiKnowledgeSourceReadResponseDraft', await controller.openSource(request, source)).text, draft.preview.sources[0].snippet);
  await assert.rejects(controller.openSource(request, { ...source, scope }), invalid);
  const parent = { tenantId: 'parent-scope' };
  await runWithRequestIdentity(parent, async () => {
    const own = getRequestIdentity();
    const [allowed, blocked] = await Promise.allSettled([
      controller.readDocument(request, { documentId: 'doc-1' }),
      controller.readDocument({ headers: { authorization: 'Bearer other' } }, { documentId: 'doc-1' }),
    ]);
    assert.equal(allowed.status, 'fulfilled'); assert.equal(blocked.status, 'rejected');
    assert.notEqual(stores.get('Bearer reader'), stores.get('Bearer other'));
    assert.equal(getRequestIdentity(), own);
  });
  const before = structuredClone({ documents: db.state.documents, memories: db.state.memories });
  const bodyPolicies = [...policies.values()].filter(row => row.domain === 'knowledge' && row.action === 'read_body');
  for (const row of bodyPolicies) row.enabled = false;
  assert.deepEqual(valid('AiKnowledgeDocumentReadResponseDraft', await controller.readDocument(request, { documentId: 'doc-1' })).preview.sources, []);
  for (const row of bodyPolicies) row.enabled = true;
  assert.deepEqual({ documents: db.state.documents, memories: db.state.memories }, before);
  await bundle.management.withdraw({ documentId: 'doc-1', expectedRevision: published.revision, operationId: 'withdraw-1' });
  const withdrawn = valid('AiKnowledgeDocumentReadResponseDraft', await controller.readDocument(request, { documentId: 'doc-1' }));
  assert.equal(withdrawn.state, 'withdrawn_or_deleted');
  assert.equal(validators.AiKnowledgeDocumentReadResponseDraft({ ...withdrawn, preview: draft.preview }), false);
  await assert.rejects(controller.openSource(request, source), denied);
  await bundle.memory.revoke({ memoryId: 'memory-1', expectedRevision: 2 });
  const revoked = valid('AiKnowledgeMemoryReadResponseDraft', await controller.readMemory(request, { memoryId: 'memory-1' }));
  assert.equal(revoked.status, 'revoked'); assert.equal(revoked.memory.preference, undefined);
  assert.equal(validators.AiKnowledgeMemoryReadResponseDraft({ ...revoked, memory: { ...revoked.memory, preference: memory.preference } }), false);
  assert.deepEqual(valid('AiKnowledgePreferencesReadResponseDraft', await controller.readPreferences(request, { limit: 1 })).items, []);
  f.now = h.now + 7200000;
  await assert.rejects(controller.readDocument(request, { documentId: 'doc-1' }), denied);
});
