'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
const { PrismaKnowledgeReadAdapter } = require('../apps/api/src/modules/ai-native/knowledge/prisma-knowledge-read.adapter');
const { PrismaKnowledgeRepository } = require('../apps/api/src/modules/ai-native/knowledge/prisma-knowledge.repository');
const { KnowledgeDocumentService } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-document.service');
const { KnowledgeSourceService } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-source.service');
const { KnowledgeRetrievalService } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-retrieval.service');
const { KnowledgeTextParser } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-text-parser');
const { dbFactory } = require('./fixtures/ai-native/knowledge-persistent-content.cjs');
const { composePersistedKnowledge, createPersistedKnowledgePorts } = require('../apps/api/src/modules/ai-native/knowledge/persistent-knowledge.composition');
const { KnowledgeModule } = require('../apps/api/src/modules/ai-native/knowledge/knowledge.module');
const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'space-a' };
const context = { actor: { kind: 'user', userId: 'user-a' }, audience: 'operator', scope, requestId: 'req-a', contractVersion: 'test', authorizedAt: '2026-10-06T00:00:00Z' };
const owner = { actorKind: 'user', actorId: 'user-a' };
const now = () => Date.parse('2026-10-06T00:00:00Z');
async function setup() {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db, () => new Date(now()));
  const state = { revoked: false, afterQuery: null };
  const authorization = { async authorize(c, req) {
    if (state.revoked || JSON.stringify(c.scope) !== JSON.stringify(scope) || c.actor.userId !== 'user-a' || (req.document && req.document.owner.actorId !== owner.actorId)) return null;
    return { scope, actor: owner, audience: 'operator', accessKey: 'synthetic-access-1' };
  } };
  const docs = new KnowledgeDocumentService({ repository: repo, authorization, clock: { now }, files: { read: async () => ({ mediaType: 'text/plain', bytes: new TextEncoder().encode('Synthetic camping SOP') }) }, parser: new KnowledgeTextParser() });
  const adapter = new PrismaKnowledgeReadAdapter(db, repo, authorization, { now });
  const sources = new KnowledgeSourceService(docs, adapter);
  const selection = { select: async () => ({ grant: await authorization.authorize(context, { scope, action: 'search' }), documents: [{ documentId: 'doc-a', documentVersion: 'v1', aclRevision: 1 }] }) };
  const retrieval = new KnowledgeRetrievalService(docs, sources, selection, adapter);
  const document = { draftVersion: 'ain-c06-draft-1', documentId: 'doc-a', documentVersion: 'v1', attachmentId: 'attachment-a', owner, scope, aclRevision: 1, title: 'Synthetic SOP', publication: 'published', parsing: 'parsed', indexing: 'indexed', validFrom: '2026-10-01T00:00:00Z' };
  const chunk = { draftVersion: 'ain-c06-draft-1', documentId: 'doc-a', documentVersion: 'v1', chunkId: 'chunk-a', scope, aclRevision: 1, locator: { kind: 'section', sectionId: 'section-a', paragraph: 1 }, text: 'Synthetic camping SOP', trust: 'untrusted_data' };
  await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, next: { document, revision: 1 }, chunks: [chunk], newVersion: true, operation: { id: 'seed-a', fingerprint: 'seed-hash' } });
  const source = { kind: 'document', documentId: chunk.documentId, documentVersion: chunk.documentVersion, chunkId: chunk.chunkId, scope, aclRevision: 1, locator: chunk.locator };
  return { db, repo, state, authorization, docs, adapter, sources, retrieval, source, chunk };
}
test('actual repository -> content -> source and lexical retrieval return immutable scoped evidence', async () => {
  const s = await setup();
  assert.deepEqual(await s.sources.readChunk(context, s.source), s.chunk);
  const result = await s.retrieval.recall(context, { requestId: 'query-a', query: 'camping', limit: 5 });
  assert.equal(result.status, 'ready'); assert.equal(result.matches[0].excerpt, s.chunk.text);
  assert.equal(result.matches[0].trust, 'untrusted_data');
  assert.deepEqual(await s.sources.download(context, s.source), { attachmentId: 'attachment-a', documentVersion: 'v1' });
  assert.ok(s.db.queries.every(q => q.take <= 201 && q.where.version.document.tenantId === 'tenant-a' && q.where.version.document.workspaceId === 'space-a'));
});
test('withdrawal and ACL revision narrowing invalidate persisted content and recall', async () => {
  for (const patch of [{ publication: 'withdrawn' }, { aclRevision: 2 }]) {
    const s = await setup();
    const before = await s.repo.read(scope, 'doc-a');
    await s.repo.commit({ scope, documentId: 'doc-a', expectedRevision: 1, next: { revision: 2, document: { ...before.document, ...patch } }, newVersion: false, operation: { id: 'change-a', fingerprint: 'change-hash' } });
    await assert.rejects(s.sources.readChunk(context, s.source), e => e.code === 'unavailable');
    const result = await s.retrieval.recall(context, { requestId: 'query-a', query: 'camping', limit: 5 });
    assert.notEqual(result.status, 'ready');
  }
});
test('scope, actor, source version and locator cannot substitute another body', async () => {
  const s = await setup();
  for (const bad of [{ ...s.source, documentVersion: 'v-other' }, { ...s.source, scope: { ...scope, tenantId: 'tenant-other' } }, { ...s.source, locator: { ...s.source.locator, paragraph: 2 } }]) await assert.rejects(s.adapter.chunk(context, bad, 2000), e => e.code === 'unavailable');
  await assert.rejects(s.adapter.chunk({ ...context, actor: { kind: 'user', userId: 'user-other' } }, s.source, 2000), e => e.code === 'unavailable');
});
test('revocation and head change during body read suppress late results', async () => {
  for (const change of ['revoke', 'withdraw']) {
    const s = await setup();
    s.db.afterRead = () => { if (change === 'revoke') s.state.revoked = true; else { const row = s.db.state.documents.get('doc-a'); row.status = 'withdrawn'; row.withdrawnAt = new Date(now()); row.state.document.publication = 'withdrawn'; row.revision = row.state.revision = 2; } };
    await assert.rejects(s.adapter.chunk(context, s.source, 2000), e => e.code === 'unavailable');
  }
});
test('corrupt body columns, unknown JSON and duplicate chunk IDs fail closed', async () => {
  for (const change of [row => { row.text = 'different'; }, row => { row.state.secret = 'untrusted-extra'; }, row => { row.state.documentVersion = 'v-other'; }, row => { row.state.trust = 'trusted'; }]) {
    const s = await setup(); change([...s.db.state.chunks.values()][0]);
    await assert.rejects(s.adapter.chunk(context, s.source, 2000), e => e.code === 'unavailable');
  }
  const s = await setup(), row = [...s.db.state.chunks.values()][0]; s.db.state.chunks.set('duplicate', { ...structuredClone(row), id: 'duplicate', chunkIndex: 1 });
  await assert.rejects(s.adapter.chunk(context, s.source, 2000), e => e.code === 'unavailable');
});
test('search returns references only, respects finite limits and does not promote business facts', async () => {
  const s = await setup(), grant = await s.authorization.authorize(context, { action: 'search', scope });
  const result = await s.adapter.search({ grant, documents: [{ documentId: 'doc-a', documentVersion: 'v1', aclRevision: 1 }], query: 'camping', limit: 5 });
  assert.equal(result.length, 1); assert.equal(result[0].text, undefined);
  await assert.rejects(s.adapter.search({ grant, documents: [], query: 'camping', limit: 0 }), e => e.code === 'invalid_input');
  await assert.rejects(s.adapter.factReference(context, { scope, resourceType: 'order', resourceId: 'order-a' }), e => e.code === 'unavailable');
  assert.deepEqual(await s.adapter.search({ grant, documents: [], query: 'camping', limit: 5 }), []);
});

async function persistedSetup() {
  const s = await setup();
  const deps = { db: s.db, authorization: s.authorization, memoryAuthorization: s.authorization,
    files: s.docs.ports.files, clock: { now },
    selection: { select: async () => ({ grant: await s.authorization.authorize(context, { action: 'search', scope }), documents: [{ documentId: 'doc-b', documentVersion: 'v1', aclRevision: 1 }] }) },
    gateway: { invoke: async () => { throw new Error('must not dispatch'); }, stream: async function* () { throw new Error('must not dispatch'); } },
    cache: { maxEntries: 10, maxBytes: 20000, ttlMs: 1000 }, policy: { sceneCode: 'knowledge', maxOutputTokens: 100 } };
  return { ...s, deps, bundle: composePersistedKnowledge(deps) };
}
test('persisted composition runs real create/parse/index/publish/recall/withdraw and memory lifecycle', async () => {
  const s = await persistedSetup(), b = s.bundle;
  let head = await b.documents.create(context, { documentId: 'doc-b', documentVersion: 'v1', attachmentId: 'attachment-b', title: 'Synthetic lifecycle', validFrom: '2026-10-01T00:00:00Z', operationId: 'create-b' });
  head = await b.documents.parseDocument(context, { documentId: 'doc-b', expectedRevision: head.revision, operationId: 'parse-b' });
  assert.equal(head.document.parsing, 'parsed');
  await b.index.request(context, { documentId: 'doc-b', expectedRevision: head.revision, operationId: 'index-b', kind: 'upsert' });
  head = await b.index.runPending(context, 'doc-b');
  head = await b.publication.publish(context, { documentId: 'doc-b', expectedRevision: head.revision, operationId: 'publish-b' });
  const recall = await b.retrieval.recall(context, { requestId: 'query-b', query: 'camping', limit: 5 });
  assert.equal(recall.status, 'ready'); assert.equal(recall.matches[0].excerpt, 'Synthetic camping SOP');
  await b.sources.readChunk(context, recall.matches[0].source); // warm the actual cache
  await b.publication.withdraw(context, { documentId: 'doc-b', expectedRevision: head.revision, operationId: 'withdraw-b' });
  await assert.rejects(b.sources.readChunk(context, recall.matches[0].source), e => e.code === 'unavailable');
  assert.notEqual((await b.retrieval.recall(context, { requestId: 'query-c', query: 'camping', limit: 5 })).status, 'ready');
  const memory = await b.memory.propose(context, { memoryId: 'memory-b', operationId: 'memory-propose', expiresAt: '2026-11-01T00:00:00Z', preference: { kind: 'locale', value: 'zh-CN' } });
  assert.equal(memory.status, 'proposed');
  await assert.rejects(b.memory.change(context, 'fake-confirm', { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-b', expectedRevision: 1, operation: 'confirm', confirmationRecordId: 'missing' }), e => e.code === 'unavailable');
  assert.equal((await b.memory.change(context, 'memory-delete', { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-b', expectedRevision: 1, operation: 'delete' })).status, 'deleted');
  assert.equal(s.db.state.memories.get('memory-b').state.preference, undefined);
});
test('persisted factory and existing dynamic module reject missing or empty trusted dependencies', async () => {
  const s = await persistedSetup();
  for (const key of ['authorization', 'memoryAuthorization', 'files', 'selection', 'index', 'gateway', 'clock', 'db']) {
    assert.throws(() => composePersistedKnowledge({ ...s.deps, [key]: {} }), e => e.code === 'unavailable');
  }
  const ports = createPersistedKnowledgePorts(s.deps), module = KnowledgeModule.register(ports);
  assert.equal(module.controllers, undefined); assert.equal(module.imports, undefined);
  const services = module.providers[0].useFactory(); assert.ok(services.documents instanceof KnowledgeDocumentService);
  assert.ok(services.sources instanceof KnowledgeSourceService); assert.equal(s.db.queries.length, 0);
});
test('real index receipts replay once and cannot revive an older generation after withdrawal', async () => {
  const s = await persistedSetup();
  const { PrismaKnowledgeIndexAdapter } = require('../apps/api/src/modules/ai-native/knowledge/prisma-knowledge-index.adapter');
  const adapter = new PrismaKnowledgeIndexAdapter(s.db, s.authorization);
  let head = await s.bundle.index.request(context, { documentId: 'doc-a', expectedRevision: 1, operationId: 'index-a', kind: 'upsert' });
  const value = { scope, documentId: 'doc-a', job: head.indexJob };
  await adapter.apply(context, value); const count = s.db.state.operations.size;
  await adapter.apply(context, value); assert.equal(s.db.state.operations.size, count);
  head = await s.bundle.index.runPending(context, 'doc-a');
  await s.bundle.publication.withdraw(context, { documentId: 'doc-a', expectedRevision: head.revision, operationId: 'withdraw-a' });
  await assert.rejects(adapter.apply(context, value), e => e.code === 'conflict');
  const removed = await s.bundle.index.runPending(context, 'doc-a');
  assert.equal(removed.indexJob.kind, 'remove'); assert.equal(removed.indexJob.status, 'completed');
});
test('index COMMIT answer loss remains pending/reconcile rather than a definite failed job', async () => {
  const s = await persistedSetup();
  await s.bundle.index.request(context, { documentId: 'doc-a', expectedRevision: 1, operationId: 'index-unknown', kind: 'upsert' });
  s.db.responseError = new Error('COMMIT response lost');
  await assert.rejects(s.bundle.index.runPending(context, 'doc-a'), e => e.code === 'result_unknown');
  s.db.responseError = null;
  const head = await s.repo.read(scope, 'doc-a');
  assert.equal(head.indexJob.status, 'pending'); assert.equal(head.document.indexing, 'indexing');
  assert.ok([...s.db.state.operations.values()].some(row => row.operationId.startsWith('lexical-index-')));
  const count = s.db.state.operations.size;
  await s.bundle.index.runPending(context, 'doc-a');
  assert.equal(s.db.state.operations.size, count + 1); // completion only, no duplicate readiness
});
test('index receipt write failure rolls back without acknowledgement or half completion', async () => {
  const s = await persistedSetup();
  await s.bundle.index.request(context, { documentId: 'doc-a', expectedRevision: 1, operationId: 'index-fail', kind: 'upsert' });
  const count = s.db.state.operations.size; s.db.failReceipt = true;
  await assert.rejects(s.bundle.index.runPending(context, 'doc-a'), e => e.code === 'result_unknown');
  s.db.failReceipt = false;
  assert.equal(s.db.state.operations.size, count);
  assert.equal((await s.repo.read(scope, 'doc-a')).indexJob.status, 'pending');
});
test('bounded reads reject overflow, malformed delegates and never return raw storage exceptions', async () => {
  const s = await setup(), base = [...s.db.state.chunks.values()][0];
  s.db.aiKnowledgeChunk.findMany = async () => Array.from({ length: 201 }, (_, i) => ({ ...structuredClone(base), id: `row-${i}`, chunkIndex: i, state: { ...structuredClone(base.state), chunkId: `chunk-${i}` } }));
  await assert.rejects(s.adapter.chunk(context, s.source, 2000), e => e.code === 'unavailable');
  s.db.aiKnowledgeChunk.findMany = async () => { throw new Error('private storage endpoint and secret'); };
  await assert.rejects(s.adapter.chunk(context, s.source, 2000), e => e.code === 'unavailable' && !String(e).includes('private') && !e.cause);
  const grant = await s.authorization.authorize(context, { action: 'search', scope });
  await assert.rejects(s.adapter.search({ grant, query: 'camping', limit: 5, documents: Array.from({ length: 101 }, () => ({ documentId: 'doc-a', documentVersion: 'v1', aclRevision: 1 })) }), e => e.code === 'invalid_input');
});
test('a caller changing context and references after await cannot retarget persisted body read', async () => {
  const s = await setup(), c = structuredClone(context), source = structuredClone(s.source);
  const original = s.db.aiKnowledgeChunk.findMany;
  let resume, entered;
  const arrived = new Promise(resolve => { entered = resolve; });
  const gate = new Promise(resolve => { resume = resolve; });
  s.db.aiKnowledgeChunk.findMany = async args => { entered(); await gate; return original(args); };
  const pending = s.adapter.chunk(c, source, 2000);
  await arrived; c.scope.tenantId = 'tenant-other'; c.actor.userId = 'user-other'; source.chunkId = 'other'; source.scope.workspaceId = 'space-other'; resume();
  assert.deepEqual(await pending, s.chunk);
  assert.equal(s.db.queries[0].where.version.document.tenantId, 'tenant-a');
});
