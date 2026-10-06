'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { PrismaKnowledgeRepository } = require('./fixtures/ai-native/knowledge-repository-baseline.cjs').load('apps/api/src/modules/ai-native/knowledge/prisma-knowledge.repository.ts', () => require('../apps/api/src/modules/ai-native/knowledge/prisma-knowledge.repository'));
const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'space-a' };
const document = { draftVersion: 'ain-c06-draft-1', documentId: 'doc-a', documentVersion: 'v1', attachmentId: 'attachment-a', owner: { actorKind: 'user', actorId: 'user-a' }, scope, aclRevision: 1, title: 'Synthetic SOP', publication: 'draft', parsing: 'parsed', indexing: 'not_indexed', validFrom: '2026-10-01T00:00:00.000Z' };
const record = { document, revision: 1 };
const chunk = { draftVersion: 'ain-c06-draft-1', documentId: 'doc-a', documentVersion: 'v1', chunkId: 'chunk-a', scope, aclRevision: 1, locator: { kind: 'section', sectionId: 'section-a', paragraph: 1 }, text: 'untrusted synthetic text', trust: 'untrusted_data' };
const clone = value => structuredClone(value);
function dbFactory() {
  const state = { documents: new Map(), versions: new Map(), chunks: new Map(), operations: new Map(), failOperation: false, failOperationIds: [], casCount: 1, admissionError: null, responseError: null, operationError: null, readError: null };
  const delegates = () => ({
    aiKnowledgeDocument: {
      findFirst: async ({ where, include }) => { if (state.readError) throw state.readError; const row = [...state.documents.values()].find(v => v.id === where.id && v.tenantId === where.tenantId && v.workspaceId === where.workspaceId); if (!row) return null; const out = clone(row); if (include?.versions) out.versions = [...state.versions.values()].filter(v => v.documentId === row.id).sort((a, b) => b.version - a.version).slice(0, include.versions.take ?? 100); return out; },
      create: async ({ data }) => { const row = { ...clone(data) }; state.documents.set(row.id, row); return clone(row); },
      update: async ({ where, data }) => { const row = state.documents.get(where.id); if (!row) throw new Error('missing'); Object.assign(row, clone(data)); return clone(row); },
      updateMany: async ({ where, data }) => { const row = state.documents.get(where.id); if (state.casCount !== 1) return { count: state.casCount }; if (!row || row.revision !== where.revision || row.tenantId !== where.tenantId || row.workspaceId !== where.workspaceId) return { count: 0 }; Object.assign(row, clone(data)); return { count: 1 }; }
    },
    aiKnowledgeVersion: {
      findFirst: async ({ where, orderBy }) => [...state.versions.values()].filter(v => v.documentId === where.documentId && (where.contentHash === undefined || where.contentHash === v.contentHash)).sort((a, b) => orderBy?.version === 'desc' ? b.version - a.version : a.version - b.version)[0] ?? null,
      create: async ({ data }) => { const row = { id: data.id, documentId: data.documentId, version: data.version, status: data.status, contentHash: data.contentHash }; state.versions.set(row.id, row); for (const c of data.chunks?.create ?? []) state.chunks.set(c.id, { ...clone(c), versionId: row.id }); return clone(row); }
    },
    aiKnowledgeChunk: { findFirst: async ({ where }) => [...state.chunks.values()].find(value => value.versionId === where.versionId) ?? null, create: async ({ data }) => { state.chunks.set(data.id, clone(data)); return clone(data); } },
    aiKnowledgeOperation: {
      findFirst: async ({ where }) => { if (state.readError) throw state.readError; return [...state.operations.values()].find(v => v.tenantId === where.tenantId && v.workspaceId === where.workspaceId && v.documentId === where.documentId && v.operationId === where.operationId) ?? null; },
      create: async ({ data }) => { if (state.operationError) throw state.operationError; if (state.failOperation || state.failOperationIds.includes(data.operationId)) throw new Error('commit failed'); const row = clone(data); state.operations.set(row.id, row); return row; }
    }
  });
  return { state, ...delegates(), async $transaction(callback) {
    if (state.admissionError) throw state.admissionError;
    const original = { documents: state.documents, versions: state.versions, chunks: state.chunks, operations: state.operations };
    for (const key of Object.keys(original)) state[key] = clone(original[key]);
    let result;
    try { result = await callback(delegates()); }
    catch (error) { Object.assign(state, original); throw error; }
    if (state.responseError) throw state.responseError;
    return result;
  } };
}

test('Prisma adapter persists a scoped record, immutable chunks and operation receipt in one transaction', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db, () => new Date('2026-10-06T00:00:00.000Z'));
  assert.equal(await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, chunks: [chunk], newVersion: true }), 'committed');
  assert.deepEqual(await repo.read(scope, 'doc-a'), record);
  assert.deepEqual(await repo.operation(scope, 'doc-a', 'op-a'), { id: 'op-a', fingerprint: 'hash-a' });
  assert.equal(db.state.versions.size, 1); assert.equal(db.state.chunks.size, 1);
});

test('same operation replays only the same fingerprint and different payload conflicts', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, newVersion: true });
  assert.equal(await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, newVersion: true }), 'committed');
  assert.equal(await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-b' }, next: record, newVersion: true }), 'conflict');
});

test('revision conflict and transaction failure leave no partial document or operation', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  assert.equal(await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 2, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: { ...record, revision: 3 }, newVersion: true }), 'conflict');
  db.state.failOperation = true;
  await assert.rejects(repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, newVersion: true }), e => e.code === 'result_unknown');
  assert.equal(db.state.documents.size, 0); assert.equal(db.state.operations.size, 0); assert.equal(db.state.versions.size, 0); assert.equal(db.state.chunks.size, 0);
});

test('cross-workspace reads do not return a scoped record', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, newVersion: true });
  assert.equal(await repo.read({ ...scope, workspaceId: 'space-other' }, 'doc-a'), null);
});

test('lost database CAS does not write a version or operation receipt', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, newVersion: true });
  db.state.casCount = 0;
  await assert.rejects(repo.commit({ scope, documentId: 'doc-a', expectedRevision: 1, operation: { id: 'op-b', fingerprint: 'hash-b' }, next: { ...record, revision: 2, document: { ...document, documentVersion: 'v2' } }, newVersion: true }), e => e.code === 'conflict');
  assert.equal(db.state.documents.get('doc-a').revision, 1); assert.equal(db.state.operations.size, 1); assert.equal(db.state.versions.size, 1);
});

const command = () => ({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, chunks: [chunk], newVersion: true });
const unknown = error => error.code === 'result_unknown' && error.nextAction === 'reconcile' && error.message === 'result_unknown' && !error.cause;
test('knowledge COMMIT response loss preserves facts and reconciles the original receipt', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  db.state.responseError = new Error('private database response lost');
  await assert.rejects(repo.commit(command()), unknown);
  assert.equal(db.state.documents.size, 1); assert.equal(db.state.versions.size, 1); assert.equal(db.state.operations.size, 1);
  db.state.responseError = null;
  assert.deepEqual(await repo.operation(scope, 'doc-a', 'op-a'), command().operation);
  assert.equal(await repo.commit(command()), 'committed');
  assert.equal(db.state.versions.size, 1); assert.equal(db.state.chunks.size, 1); assert.equal(db.state.operations.size, 1);
});
test('knowledge transaction admission failure is unavailable, not a revision conflict', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db); db.state.admissionError = new Error('private admission failure');
  await assert.rejects(repo.commit(command()), e => e.code === 'unavailable' && e.message === 'unavailable' && !e.cause);
  assert.equal(db.state.documents.size, 0); assert.equal(db.state.operations.size, 0);
});
for (const code of ['P2002', 'P2034']) test(`knowledge explicit ${code} rollback stays conflict`, async () => {
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  db.state.operationError = new Prisma.PrismaClientKnownRequestError('private rollback', { code, clientVersion: '5.22.0' });
  assert.equal(await repo.commit(command()), 'conflict');
  assert.equal(db.state.documents.size, 0); assert.equal(db.state.operations.size, 0); assert.equal(db.state.versions.size, 0);
});
test('an error with only a Prisma-looking code cannot prove rollback', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  db.state.operationError = Object.assign(new Error('private failure'), { code: 'P2002' });
  await assert.rejects(repo.commit(command()), unknown);
});
test('knowledge COMMIT failure after the callback cannot become a retryable conflict', async () => {
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  db.state.responseError = new Prisma.PrismaClientKnownRequestError('late response', { code: 'P2002', clientVersion: '5.22.0' });
  await assert.rejects(repo.commit(command()), unknown);
  assert.equal(db.state.documents.size, 1); assert.equal(db.state.operations.size, 1);
});
test('actual document service preserves unknown and replays a committed create without another version', async () => {
  const { KnowledgeDocumentService } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-document.service');
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  const context = { scope, actor: { kind: 'user', userId: document.owner.actorId }, audience: 'operator' };
  const service = new KnowledgeDocumentService({ repository: repo, clock: { now: () => Date.parse('2026-10-06T00:00:00Z') },
    authorization: { authorize: async () => ({ scope, actor: document.owner, audience: 'operator', accessKey: 'synthetic-grant' }) },
    files: { read: async () => { throw new Error('must not read files'); } }, parser: { parse: () => { throw new Error('must not parse'); } } });
  const input = { documentId: document.documentId, documentVersion: document.documentVersion, attachmentId: document.attachmentId, title: document.title, validFrom: document.validFrom, operationId: 'create-a' };
  db.state.responseError = new Error('private COMMIT response lost');
  await assert.rejects(service.create(context, input), unknown);
  db.state.responseError = null;
  assert.equal((await service.create(context, input)).document.publication, 'draft');
  assert.equal(db.state.documents.size, 1); assert.equal(db.state.versions.size, 1); assert.equal(db.state.operations.size, 1);
});
async function parsedDocument(db = dbFactory()) {
  const { KnowledgeDocumentService } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-document.service');
  const { KnowledgeTextParser } = require('../apps/api/src/modules/ai-native/knowledge/knowledge-text-parser');
  const repo = new PrismaKnowledgeRepository(db), context = { scope, actor: { kind: 'user', userId: document.owner.actorId }, audience: 'operator' };
  const service = new KnowledgeDocumentService({ repository: repo, clock: { now: () => Date.parse('2026-10-06T00:00:00Z') },
    authorization: { authorize: async () => ({ scope, actor: document.owner, audience: 'operator', accessKey: 'synthetic-grant' }) },
    files: { read: async () => ({ mediaType: 'text/plain', bytes: Buffer.from('First section.\n\nSecond section.') }) }, parser: new KnowledgeTextParser() });
  await service.create(context, { documentId: document.documentId, documentVersion: document.documentVersion, attachmentId: document.attachmentId, title: document.title, validFrom: document.validFrom, operationId: 'create-a' });
  return { db, repo, service, context, input: { documentId: document.documentId, expectedRevision: 1, operationId: 'parse-a' } };
}
test('real create then parse persists chunks on the existing immutable document version and replays once', async () => {
  const h = await parsedDocument(), result = await h.service.parseDocument(h.context, h.input);
  assert.equal(result.document.parsing, 'parsed'); assert.equal(result.revision, 3);
  assert.equal(h.db.state.versions.size, 1); assert.equal(h.db.state.chunks.size, 2);
  const stored = [...h.db.state.chunks.values()].sort((a, b) => a.chunkIndex - b.chunkIndex);
  assert.deepEqual(stored.map(row => row.text), ['First section.', 'Second section.']);
  for (const row of stored) {
    assert.equal(row.versionId, [...h.db.state.versions.values()][0].id);
    assert.equal(row.state.documentVersion, 'v1'); assert.equal(row.state.trust, 'untrusted_data');
  }
  const receipts = h.db.state.operations.size;
  await h.service.parseDocument(h.context, h.input);
  assert.equal(h.db.state.chunks.size, 2); assert.equal(h.db.state.operations.size, receipts);
  await assert.rejects(h.repo.commit({ scope, documentId: 'doc-a', expectedRevision: 3, next: { ...result, revision: 4 }, chunks: [chunk], newVersion: false, operation: { id: 'replace-chunks', fingerprint: 'other-hash' } }), e => e.code === 'conflict');
  assert.equal(h.db.state.chunks.size, 2); assert.equal(h.db.state.documents.get('doc-a').revision, 3);
});
test('parse-result receipt failure rolls back chunks and never reports a parsed head', async () => {
  const h = await parsedDocument(); h.db.state.failOperationIds = ['parse-a:parse-result'];
  await assert.rejects(h.service.parseDocument(h.context, h.input), unknown);
  assert.equal(h.db.state.chunks.size, 0); assert.equal(h.db.state.versions.size, 1);
  assert.equal(h.db.state.documents.get('doc-a').state.document.parsing, 'pending');
  assert.equal(h.db.state.documents.get('doc-a').revision, 2);
  assert.equal(await h.repo.operation(scope, 'doc-a', 'parse-a:parse-result'), null);
});
test('published document-version identifiers cannot be reused for different immutable content', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  await repo.commit(command());
  const next = { ...record, revision: 2, document: { ...document, documentVersion: 'v2' } };
  await repo.commit({ ...command(), expectedRevision: 1, next, chunks: [{ ...chunk, documentVersion: 'v2' }], operation: { id: 'v2', fingerprint: 'v2-hash' } });
  await assert.rejects(repo.commit({ ...command(), expectedRevision: 2, next: { ...record, revision: 3 }, operation: { id: 'reuse-v1', fingerprint: 'new-hash' } }), e => e.code === 'conflict');
  assert.equal(db.state.versions.size, 2); assert.equal(db.state.documents.get('doc-a').revision, 2);
});
test('chunks cannot be acknowledged without their matching document version', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db);
  await assert.rejects(repo.commit({ ...command(), newVersion: false }), e => e.code === 'conflict');
  assert.equal(db.state.documents.size, 0); assert.equal(db.state.operations.size, 0); assert.equal(db.state.chunks.size, 0);
});
test('knowledge read errors expose no database details', async () => {
  const db = dbFactory(), repo = new PrismaKnowledgeRepository(db); db.state.readError = new Error('private db secret');
  for (const read of [() => repo.read(scope, 'doc-a'), () => repo.operation(scope, 'doc-a', 'op-a')]) {
    await assert.rejects(read(), e => e.code === 'unavailable' && e.message === 'unavailable' && !e.cause);
  }
});
