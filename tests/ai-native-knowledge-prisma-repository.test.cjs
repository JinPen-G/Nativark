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
  const state = { documents: new Map(), versions: new Map(), chunks: new Map(), operations: new Map(), failOperation: false, casCount: 1 };
  const delegates = () => ({
    aiKnowledgeDocument: {
      findFirst: async ({ where, include }) => { const row = [...state.documents.values()].find(v => v.id === where.id && v.tenantId === where.tenantId && v.workspaceId === where.workspaceId); if (!row) return null; const out = clone(row); if (include?.versions) out.versions = [...state.versions.values()].filter(v => v.documentId === row.id).sort((a, b) => b.version - a.version).slice(0, include.versions.take ?? 100); return out; },
      create: async ({ data }) => { const row = { ...clone(data) }; state.documents.set(row.id, row); return clone(row); },
      update: async ({ where, data }) => { const row = state.documents.get(where.id); if (!row) throw new Error('missing'); Object.assign(row, clone(data)); return clone(row); },
      updateMany: async ({ where, data }) => { const row = state.documents.get(where.id); if (state.casCount !== 1) return { count: state.casCount }; if (!row || row.revision !== where.revision || row.tenantId !== where.tenantId || row.workspaceId !== where.workspaceId) return { count: 0 }; Object.assign(row, clone(data)); return { count: 1 }; }
    },
    aiKnowledgeVersion: {
      findFirst: async ({ where, orderBy }) => [...state.versions.values()].filter(v => v.documentId === where.documentId).sort((a, b) => orderBy?.version === 'desc' ? b.version - a.version : a.version - b.version)[0] ?? null,
      create: async ({ data }) => { const row = { id: data.id, documentId: data.documentId, version: data.version, status: data.status, contentHash: data.contentHash }; state.versions.set(row.id, row); for (const c of data.chunks?.create ?? []) state.chunks.set(c.id, { ...clone(c), versionId: row.id }); return clone(row); }
    },
    aiKnowledgeChunk: { findFirst: async () => null, create: async ({ data }) => { state.chunks.set(data.id, clone(data)); return clone(data); } },
    aiKnowledgeOperation: {
      findFirst: async ({ where }) => [...state.operations.values()].find(v => v.tenantId === where.tenantId && v.workspaceId === where.workspaceId && v.documentId === where.documentId && v.operationId === where.operationId) ?? null,
      create: async ({ data }) => { if (state.failOperation) throw new Error('commit failed'); const row = clone(data); state.operations.set(row.id, row); return row; }
    }
  });
  return { state, ...delegates(), async $transaction(callback) { const snapshot = clone({ documents: [...state.documents], versions: [...state.versions], chunks: [...state.chunks], operations: [...state.operations] }); const original = { documents: state.documents, versions: state.versions, chunks: state.chunks, operations: state.operations }; state.documents = new Map(snapshot.documents); state.versions = new Map(snapshot.versions); state.chunks = new Map(snapshot.chunks); state.operations = new Map(snapshot.operations); try { return await callback(delegates()); } catch (error) { state.documents = new Map(original.documents); state.versions = new Map(original.versions); state.chunks = new Map(original.chunks); state.operations = new Map(original.operations); throw error; } } };
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
  assert.equal(await repo.commit({ scope, documentId: 'doc-a', expectedRevision: 0, operation: { id: 'op-a', fingerprint: 'hash-a' }, next: record, newVersion: true }), 'conflict');
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
  await assert.rejects(repo.commit({ scope, documentId: 'doc-a', expectedRevision: 1, operation: { id: 'op-b', fingerprint: 'hash-b' }, next: { ...record, revision: 2 }, newVersion: true }), e => e.code === 'conflict');
  assert.equal(db.state.documents.get('doc-a').revision, 1); assert.equal(db.state.operations.size, 1); assert.equal(db.state.versions.size, 1);
});
