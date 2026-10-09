'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { FileStorageKnowledgeFileAdapter } = h.load('file-storage-knowledge.adapter');
const { composeKnowledgeFileApplication, KNOWLEDGE_SCENE_OPTIONS } = h.load('knowledge-file.composition');
const { HumanKnowledgeModule } = h.load('human-knowledge.module');
const { HumanKnowledgeUploadService, knowledgeUploadRequest } = h.load('human-knowledge-upload.service');
const { fingerprint } = h.load('knowledge-validation');
const { composeOriginalSceneKnowledge } = require('../apps/api/src/modules/ai-native/scenes/original-scene-knowledge');
const { FileStorageRuntimeService } = require('../apps/api/src/modules/integrations/file-storage.runtime.service');
const { TenantKnowledgeObjectReader } = require('../apps/api/src/modules/integrations/knowledge-object-reader');
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
test.after(() => assert.deepEqual(h.attempts, []));

test('knowledge file adapter requires workspace context and does not expose URLs', async () => {
  const calls = [];
  const adapter = new FileStorageKnowledgeFileAdapter({ readKnowledgeBytes: async (...args) => { calls.push(args); throw Object.assign(new Error('no persistent source'), { code: 'unavailable' }); } });
  const document = { documentId: 'doc-1', attachmentId: 'file-1' };
  await assert.rejects(() => adapter.read({ scope: { kind: 'tenant', tenantId: 't-1' }, actor: { kind: 'user', userId: 'u-1' } }, document, 1024), { code: 'unavailable' });
  await assert.rejects(() => adapter.read({ scope: { kind: 'workspace', tenantId: 't-1', workspaceId: 'w-1' }, actor: { kind: 'user', userId: 'u-1' } }, document, 1024), { code: 'unavailable' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][2].businessType, 'ai_knowledge_document');
  assert.equal(calls[0][2].uploadScene, 'ai-knowledge');
  assert.equal('url' in calls[0][2], false);
});

function fileFixture() {
  const f = fixture(), { db } = f, grants = new Map();
  db.state.assets = new Map(); db.state.uploads = new Map();
  const clone = value => structuredClone(value);
  const match = (row, where) => Object.entries(where).every(([key, value]) => value && typeof value === 'object' && 'gt' in value ? row[key] > value.gt : row[key] === value);
  const delegate = name => ({
    async findFirst({ where, include }) { const row = [...db.state[name].values()].find(row => match(row, where));
      return row ? clone({ ...row, ...(include?.uploadSession ? { uploadSession: [...db.state.uploads.values()].find(session => session.fileAssetId === row.id) ?? null } : {}) }) : null; },
    async findUniqueOrThrow({ where }) { const row = [...db.state[name].values()].find(row => match(row, where)); if (!row) throw Error('not found'); return clone(row); },
    async create({ data }) {
      if (name === 'uploads' && [...db.state.uploads.values()].some(row => row.tenantId === data.tenantId && row.idempotencyKey === data.idempotencyKey)) {
        throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'offline' });
      }
      const row = { ...clone(data), createdAt: new Date(), updatedAt: new Date() }; db.state[name].set(row.id, row); return clone(row);
    },
    async updateMany({ where, data }) { let count = 0; for (const row of db.state[name].values()) if (match(row, where)) { Object.assign(row, clone(data), { updatedAt: new Date() }); count++; } return { count }; },
  });
  db.fileAsset = delegate('assets'); db.fileUploadSession = delegate('uploads');
  db.aiKnowledgeDocument.findUnique = async ({ where }) => clone(db.state.documents.get(where.id) ?? null);
  db.aiKnowledgeDocument.findMany = async ({ where, take, select }) => [...db.state.documents.values()].filter(row => match(row, where))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(row => clone(select ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row));
  db.aiStructuredMemory.findMany = async ({ where, take, select }) => [...db.state.memories.values()].filter(row => match(row, where))
    .sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(row => clone(Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]]))));
  db.aiKnowledgeActionPolicy = { findUnique: async ({ where }) => clone(grants.get(JSON.stringify(where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey)) ?? null) };
  const transaction = db.$transaction; let queue = Promise.resolve();
  db.$transaction = work => { const result = queue.then(() => transaction(work)); queue = result.catch(() => {}); return result; };
  const text = Buffer.from('Synthetic SOP: inspect the package before return.');
  const input = { documentId: 'doc-1', fileName: 'sop.txt', mimeType: 'text/plain', sizeBytes: text.length };
  const config = { id: 'config-file', capability: 'file', provider: 's3_compatible', settings: { endpoint: 'https://objects.example.test', bucket: 'synthetic-bucket', region: 'us-east-1', forcePathStyle: true }, credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret' } };
  let reads = 0; const state = { afterBody: null, noProvider: false };
  const integrations = { runtimeConfig: async () => state.noProvider ? undefined : clone(config), assertEnabledInTransaction: async () => {} };
  const objectIO = { egress: async (url, _name, options) => { assert.equal(options.allowQuery, false); return url; },
    transport: async (url, init) => { reads++; assert.equal(new URL(url).search, ''); assert.match(init.headers.Authorization, /^AWS4-HMAC-SHA256 /); assert.equal(init.redirect, 'error');
      return new Response(new ReadableStream({ start(controller) { controller.enqueue(text); if (state.afterBody) state.afterBody(); controller.close(); } }),
        { headers: { 'content-type': 'text/plain', 'content-length': String(text.length) } }); } };
  const deps = { ...f.ports, db, integrations, objectIO };
  function allow(action, resource = {}, workspaceId = 'space-1', domain = 'knowledge') {
    const key = { tenantId: 'tenant-1', workspaceId, actorKind: 'user', actorId: 'user-1', audience: 'operator', domain, action, resourceKey: fingerprint(resource) };
    grants.set(JSON.stringify(key), { ...key, resource: clone(resource), revision: 1, enabled: true, expiresAt: new Date(h.now + 3600000), requiredPermissions: ['synthetic-policy'] });
  }
  function allowUpload(value = input, workspaceId, revision) { const request = knowledgeUploadRequest(value, revision); allow('upload', { upload: { documentId: request.businessId, idempotencyKey: request.idempotencyKey, fileName: request.fileName, mimeType: request.mimeType, sizeBytes: request.sizeBytes, ...(revision ? { revision } : {}) } }, workspaceId); }
  function allowDocument(attachmentId, aclRevision = 1, documentVersion = 'v1') {
    const resource = { documentId: 'doc-1', documentVersion, attachmentId, aclRevision };
    for (const action of ['create', 'revise', 'read_metadata', 'parse', 'read_body', 'index', 'publish', 'search', 'resolve_source', 'snippet', 'withdraw', 'delete']) { allow(action); allow(action, resource); }
    allow('create', { attachmentId });
  }
  return { ...f, deps, input, text, state, config, integrations, objectIO, grants, allow, allowUpload, allowDocument,
    api: composeKnowledgeFileApplication(deps), reads: () => reads };
}

async function completed(f, t) {
  const old = FileStorageRuntimeService.prototype.objectExists;
  FileStorageRuntimeService.prototype.objectExists = async function (_config, key, mime, size) {
    assert.ok([...f.db.state.assets.values()].some(row => row.storageKey === key)); assert.equal(mime, 'text/plain'); assert.equal(size, f.text.length); return true;
  };
  t.after(() => { FileStorageRuntimeService.prototype.objectExists = old; });
  f.allowUpload();
  const upload = await f.api.uploads.begin(f.input);
  return { upload, bound: await f.api.uploads.complete({ documentId: 'doc-1', sessionId: upload.sessionId }) };
}

test('first creation uses original upload receipt then real create parse index publish withdraw lifecycle', async t => {
  const f = fileFixture();
  const module = HumanKnowledgeModule.registerFiles(f.deps);
  assert.ok(module.exports.includes(HumanKnowledgeUploadService)); assert.equal(f.reads(), 0);
  assert.ok(module.exports.includes(KNOWLEDGE_SCENE_OPTIONS));
  const options = module.providers.find(row => row.provide === KNOWLEDGE_SCENE_OPTIONS).useValue;
  assert.equal(options(false).includePreferences, false);
  assert.throws(() => options(true), { code: 'unavailable' });
  assert.throws(() => options('true'), { code: 'invalid_input' });
  assert.equal(f.reads(), 0);
  await assert.rejects(f.api.uploads.begin(f.input), { code: 'unavailable' }); assert.equal(f.db.state.uploads.size, 0);
  f.allowUpload();
  const [a, b] = await Promise.all([f.api.uploads.begin(f.input), f.api.uploads.begin(f.input)]);
  assert.equal(a.fileAssetId, b.fileAssetId); assert.equal(f.db.state.uploads.size, 1); assert.equal(f.db.state.assets.size, 1);
  assert.ok(a.uploadUrl); assert.ok(b.uploadUrl); assert.equal(f.db.state.documents.size, 0);
  f.allowDocument(a.fileAssetId);
  await assert.rejects(f.api.management.create(h.draft({ attachmentId: a.fileAssetId })), { code: 'unavailable' });
  const { bound } = await completed(f, t); assert.equal(bound.attachmentId, a.fileAssetId);
  const draft = h.draft({ attachmentId: bound.attachmentId });
  assert.equal((await f.api.management.prepareCreate(draft)).status, 'ready_to_create');
  await f.api.management.create(draft);
  assert.equal((await f.api.management.create(draft)).revision, 1);
  await assert.rejects(f.api.uploads.begin(f.input), { code: 'unavailable' });
  assert.equal((await f.api.management.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' })).parsing, 'parsed');
  assert.equal(f.reads(), 1);
  assert.equal((await f.api.management.reconcileParse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' })).parsing, 'parsed');
  assert.equal(f.reads(), 1);
  const queued = await f.api.index.request({ documentId: 'doc-1', expectedRevision: 3, operationId: 'index-1', kind: 'upsert' });
  const indexed = await f.api.index.resume({ documentId: 'doc-1', operationId: queued.indexJob.operationId, generation: queued.indexJob.generation });
  const published = await f.api.management.publish({ documentId: 'doc-1', expectedRevision: indexed.revision, operationId: 'publish-1' });
  const preview = await f.api.management.preview('doc-1'); assert.match(preview.sources[0].snippet, /Synthetic SOP/);
  assert.equal((await f.api.management.list({ limit: 5 })).items.length, 1);
  const collected = await f.api.preparation.collect({ requestId: 'scenario-input', query: 'Synthetic', maxSources: 3, maxSnippetChars: 1000, maxTotalBytes: 8192 });
  assert.equal(collected.status, 'ready'); assert.equal(collected.sources.length, 1);
  assert.equal((await f.api.preparation.revalidate(collected)).sources[0].snippet, f.text.toString());
  for (const [key, row] of f.grants) if (row.action === 'resolve_source' && row.resource.documentId) f.grants.delete(key);
  await assert.rejects(f.api.preparation.revalidate(collected), { code: 'unavailable' });
  f.allowDocument(bound.attachmentId);
  const withMemory = composeKnowledgeFileApplication({ ...f.deps, memory: { db: f.db } });
  const owner = { actorKind: 'user', actorId: 'user-1' }, memoryId = 'memory-1', expiresAt = new Date(h.now + 3600000).toISOString();
  const memoryProposal = { memoryId, operationId: 'memory-propose', expiresAt, preference: { kind: 'locale', value: 'zh-CN' } };
  await assert.rejects(withMemory.memory.propose(memoryProposal), { code: 'unavailable' });
  for (const action of ['propose', 'read', 'confirm', 'delete']) {
    f.allow(action, { owner }, 'space-1', 'memory');
    for (const revision of [1, 2]) f.allow(action, { memoryId, revision, aclRevision: 1, owner }, 'space-1', 'memory');
  }
  await withMemory.memory.propose(memoryProposal);
  const confirmation = { memoryId, expectedRevision: 1, operationId: 'memory-confirm', expiresAt };
  await withMemory.memory.confirm(confirmation);
  assert.equal((await withMemory.memory.confirmationStatus(confirmation)).status, 'confirmed');
  const memoryInput = { requestId: 'memory-input', query: 'Synthetic', maxSources: 2, maxSnippetChars: 1000, maxTotalBytes: 8192 };
  const remembered = await withMemory.preparation.collect(memoryInput, { includePreferences: true });
  assert.equal(remembered.preferences.items.length, 1);
  assert.equal(remembered.preferences.items[0].revision, 2);
  assert.deepEqual(await withMemory.preparation.revalidate(remembered), remembered);
  // Use the existing scene input consumer, not a second knowledge envelope.
  const sceneOptions = withMemory.sceneKnowledge(true);
  const scene = composeOriginalSceneKnowledge(sceneOptions, f.identity, () => new Date(h.now));
  const originalInputRef = '00000000-0000-4000-8000-000000000001';
  const frozen = await scene.collect(originalInputRef, { sceneCode: 'order_explanation', input: { question: 'Synthetic' } });
  assert.equal(frozen.version, 'ain-scene-knowledge-1');
  assert.equal(frozen.material.preferences.items[0].memoryId, memoryId);
  assert.equal(frozen.material.sources[0].snippet, f.text.toString());
  assert.ok(Object.isFrozen(frozen));
  const modelIds = Object.keys(frozen).filter(key => /invocation|dispatch|token/i.test(key));
  assert.deepEqual(modelIds, []);
  // Frozen materials are still subject to current recall permission, not only
  // independent body/source-opening permission retained by the same person.
  const searchGrants=[...f.grants].filter(([,row])=>row.action==='search');
  for(const [key,row] of searchGrants)if(!row.resource.documentId)f.grants.delete(key);
  await assert.rejects(scene.revalidate(frozen,originalInputRef),{code:'AI_RESOURCE_UNAVAILABLE'});
  for(const [key,row] of searchGrants)f.grants.set(key,row);
  for(const [key,row] of searchGrants)if(row.resource.documentId)f.grants.delete(key);
  await assert.rejects(scene.revalidate(frozen,originalInputRef),{code:'AI_RESOURCE_UNAVAILABLE'});
  for(const [key,row] of searchGrants)f.grants.set(key,row);
  assert.deepEqual(await scene.revalidate(frozen,originalInputRef),frozen);
  const memoryRead=f.db.aiStructuredMemory.findFirst;let revokeDuringPreferenceRead=true;
  f.db.aiStructuredMemory.findFirst=async args=>{const row=await memoryRead(args);
    if(revokeDuringPreferenceRead){revokeDuringPreferenceRead=false;for(const [key] of searchGrants)f.grants.delete(key);}return row;};
  try{await assert.rejects(scene.revalidate(frozen,originalInputRef),{code:'AI_RESOURCE_UNAVAILABLE'});}
  finally{f.db.aiStructuredMemory.findFirst=memoryRead;for(const [key,row] of searchGrants)f.grants.set(key,row);}
  for (const [key, row] of f.grants) if (row.action === 'resolve_source' && row.resource.documentId) f.grants.delete(key);
  await assert.rejects(scene.revalidate(frozen, originalInputRef), { code: 'AI_RESOURCE_UNAVAILABLE' });
  f.allowDocument(bound.attachmentId);
  await withMemory.memory.revoke({ memoryId, expectedRevision: 2 });
  assert.equal((await withMemory.memory.state(memoryId)).consentStatus, 'revoked');
  await assert.rejects(withMemory.preparation.revalidate(remembered), { code: 'unavailable' });
  await assert.rejects(scene.revalidate(frozen, originalInputRef), { code: 'AI_RESOURCE_UNAVAILABLE' });
  assert.deepEqual((await withMemory.preparation.collect(memoryInput, { includePreferences: true })).preferences.items, []);
  f.allowDocument(bound.attachmentId, 2);
  const withdrawn = await f.api.management.withdraw({ documentId: 'doc-1', expectedRevision: published.revision, operationId: 'withdraw-1' });
  assert.equal(withdrawn.publication, 'withdrawn');
  await assert.rejects(scene.revalidate(frozen, originalInputRef), { code: 'AI_RESOURCE_UNAVAILABLE' });
  await assert.rejects(f.api.management.preview('doc-1'), { code: 'unavailable' });
  assert.equal((await f.api.management.operation('doc-1', 'withdraw-1')).receipt, 'recorded');
});

test('first upload denies changed payload, cross-workspace occupation, free metadata and missing storage', async () => {
  const f = fileFixture(); f.allowUpload();
  f.db.responseError = new Error('upload commit reply lost');
  await assert.rejects(f.api.uploads.begin(f.input), /reply lost/);
  f.db.responseError = null;
  const upload = await f.api.uploads.begin(f.input);
  assert.equal(f.db.state.uploads.size, 1);
  f.allowUpload({ ...f.input, fileName: 'different.txt' });
  await assert.rejects(f.api.uploads.begin({ ...f.input, fileName: 'different.txt' }));
  assert.throws(() => f.api.uploads.begin({ ...f.input, metadata: { workspaceId: 'forged' } }), { code: 'invalid_input' });
  f.flags.workspaceId = 'space-other'; f.allowUpload(f.input, 'space-other');
  await assert.rejects(f.api.uploads.begin(f.input));
  await assert.rejects(f.api.uploads.complete({ documentId: 'doc-1', sessionId: upload.sessionId }));
  assert.equal(f.db.state.uploads.size, 1);
  const empty = fileFixture(); empty.allowUpload(); empty.state.noProvider = true;
  await assert.rejects(empty.api.uploads.begin(empty.input)); assert.equal(empty.db.state.uploads.size, 0);
});

test('late body revocation remains pending and exact reconciliation never reads the object again', async t => {
  const f = fileFixture(), { bound } = await completed(f, t); f.allowDocument(bound.attachmentId);
  await f.api.management.create(h.draft({ attachmentId: bound.attachmentId }));
  f.state.afterBody = () => { f.flags.active = false; };
  await assert.rejects(f.api.management.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-late' }), { code: 'unavailable' });
  f.flags.active = true; f.state.afterBody = null;
  await assert.rejects(f.api.management.reconcileParse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-late' }), { code: 'result_unknown' });
  assert.equal(f.reads(), 1);
});

test('revision uploads preserve frozen source identity, reject retargeting and consume the original revise receipt', async t => {
  const f = fileFixture(), { bound } = await completed(f, t); f.allowDocument(bound.attachmentId);
  await f.api.management.create(h.draft({ attachmentId: bound.attachmentId }));
  await f.api.management.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-v1' });
  const revision = { documentVersion: 'v1', expectedRevision: 3, aclRevision: 1, targetVersion: 'v2' };
  const file = { ...f.input, fileName: 'sop-v2.txt' }, selection = { ...file, expectedRevision: 3, targetVersion: 'v2' };
  await assert.rejects(f.api.uploads.beginRevision(selection), { code: 'unavailable' });
  f.allowUpload(file, undefined, revision);
  const [a, b] = await Promise.all([f.api.uploads.beginRevision(selection), f.api.uploads.beginRevision(selection)]);
  assert.equal(a.fileAssetId, b.fileAssetId); assert.notEqual(a.fileAssetId, bound.attachmentId); assert.equal(f.db.state.uploads.size, 2);
  f.allowUpload({ ...file, fileName: 'changed.txt' }, undefined, revision);
  await assert.rejects(f.api.uploads.beginRevision({ ...selection, fileName: 'changed.txt' }));
  await assert.rejects(f.api.uploads.complete({ documentId: 'doc-1', sessionId: a.sessionId }));
  const completion = { documentId: 'doc-1', sessionId: a.sessionId, expectedRevision: 3, targetVersion: 'v2' };
  const head = f.db.state.documents.get('doc-1'), original = structuredClone(head);
  head.revision++; head.state.revision++; head.state.document.aclRevision++;
  await assert.rejects(f.api.uploads.completeRevision(completion), { code: 'unavailable' });
  f.db.state.documents.set('doc-1', original);
  f.db.responseError = new Error('revision upload completed but reply lost');
  await assert.rejects(f.api.uploads.completeRevision(completion), /reply lost/); f.db.responseError = null;
  const uploaded = await f.api.uploads.completeRevision(completion); assert.equal(uploaded.attachmentId, a.fileAssetId);
  f.allowDocument(uploaded.attachmentId); f.allowDocument(uploaded.attachmentId, 1, 'v2');
  const request = h.draft({ documentVersion: 'v2', attachmentId: uploaded.attachmentId, operationId: 'revise-v2' });
  const revised = await f.api.management.revise(3, request); assert.equal(revised.revision, 4);
  assert.equal((await f.api.management.revise(3, request)).revision, 4);
  assert.equal(f.db.state.versions.size, 2);
  assert.equal((await f.api.management.parse({ documentId: 'doc-1', expectedRevision: 4, operationId: 'parse-v2' })).parsing, 'parsed');
  assert.equal(f.reads(), 2);
  await assert.rejects(f.api.management.revise(6, h.draft({ documentVersion: 'v3', attachmentId: uploaded.attachmentId, operationId: 'retarget-v3' })), { code: 'unavailable' });
  await assert.rejects(f.api.uploads.beginRevision({ ...selection, targetVersion: 'v3' }), { code: 'unavailable' });
});

test('knowledge byte source bounds overflow and abort without waiting for provider cleanup', async t => {
  const f = fileFixture(), { bound } = await completed(f, t); f.allowDocument(bound.attachmentId);
  await f.api.management.create(h.draft({ attachmentId: bound.attachmentId }));
  const ref = { tenantId: 'tenant-1', workspaceId: 'space-1', documentId: 'doc-1', fileAssetId: bound.attachmentId };
  let cancelled = 0;
  const source = new ReadableStream({ pull(controller) { controller.enqueue(Buffer.alloc(f.text.length + 1)); }, cancel() { cancelled++; return new Promise(() => {}); } }, { highWaterMark: 0 });
  const reader = new TenantKnowledgeObjectReader(f.db, f.integrations, async () => new Response(source, { headers: { 'content-type': 'text/plain', 'content-length': String(f.text.length) } }), f.objectIO.egress);
  await assert.rejects(reader.read(ref, 262144)); assert.equal(cancelled, 1); assert.equal(source.locked, false);
  let ready; const started = new Promise(resolve => { ready = resolve; });
  const pending = new ReadableStream({ pull() { ready(); }, cancel() { cancelled++; return new Promise(() => {}); } }, { highWaterMark: 0 });
  const waiting = new TenantKnowledgeObjectReader(f.db, f.integrations, async () => new Response(pending, { headers: { 'content-type': 'text/plain', 'content-length': String(f.text.length) } }), f.objectIO.egress);
  const control = new AbortController(), work = waiting.read(ref, 262144, control.signal); await started;
  control.abort(); await assert.rejects(work); assert.equal(pending.locked, false); assert.equal(cancelled, 2);
});
