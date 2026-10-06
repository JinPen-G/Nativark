'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { PrismaStructuredMemoryRepository } = require('./fixtures/ai-native/knowledge-repository-baseline.cjs').load('apps/api/src/modules/ai-native/knowledge/prisma-memory.repository.ts', () => require('../apps/api/src/modules/ai-native/knowledge/prisma-memory.repository'));
const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'space-a' }, owner = { actorKind: 'user', actorId: 'user-a' };
const memory = { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-a', revision: 1, owner, scope, aclRevision: 1, expiresAt: '2026-12-01T00:00:00.000Z', status: 'proposed', preference: { kind: 'locale', value: 'zh-CN' } };
const clone = value => structuredClone(value);
function dbFactory() {
  const state = { memories: new Map(), operations: new Map(), confirmations: new Map(), failOperation: false, casCount: 1 };
  const delegates = () => ({
    aiStructuredMemory: {
      findFirst: async ({ where }) => [...state.memories.values()].find(v => v.id === where.id && v.tenantId === where.tenantId && v.workspaceId === where.workspaceId && v.ownerKind === where.ownerKind && v.ownerId === where.ownerId) ?? null,
      create: async ({ data }) => { const row = { ...clone(data) }; state.memories.set(row.id, row); return row; },
      update: async ({ where, data }) => { const row = state.memories.get(where.id); if (!row) throw new Error('missing'); Object.assign(row, clone(data)); return row; },
      updateMany: async ({ where, data }) => { const row = state.memories.get(where.id); if (state.casCount !== 1) return { count: state.casCount }; if (!row || Object.entries(where).some(([key, value]) => row[key] !== value)) return { count: 0 }; Object.assign(row, clone(data)); return { count: 1 }; }
    },
    aiMemoryOperation: {
      findFirst: async ({ where }) => [...state.operations.values()].find(v => v.tenantId === where.tenantId && v.workspaceId === where.workspaceId && v.memoryId === where.memoryId && v.operationId === where.operationId) ?? null,
      create: async ({ data }) => { if (state.failOperation) throw new Error('commit failed'); const row = clone(data); state.operations.set(row.id, row); return row; }
    },
    aiHumanConfirmation: { findFirst: async ({ where }) => { const row = state.confirmations.get(where.id); return row && row.tenantId === where.tenantId && row.workspaceId === where.workspaceId ? row : null; }, create: async ({ data }) => { const row = clone(data); state.confirmations.set(row.id, row); return row; }, update: async () => { throw new Error('not used'); } }
  });
  return { state, ...delegates(), async $transaction(callback) { const snapshot = { memories: new Map(state.memories), operations: new Map(state.operations) }; try { return await callback(delegates()); } catch (error) { state.memories = snapshot.memories; state.operations = snapshot.operations; throw error; } } };
}

test('memory adapter persists owner/revision state and idempotent operation receipt', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db, () => new Date('2026-10-06T00:00:00.000Z'));
  assert.equal(await repo.commit({ scope, owner, memoryId: 'memory-a', expectedRevision: 0, next: memory, operation: { id: 'op-a', fingerprint: 'hash-a' } }), 'committed');
  assert.deepEqual(await repo.read(scope, owner, 'memory-a'), memory);
  assert.deepEqual(await repo.operation(scope, owner, 'memory-a', 'op-a'), { id: 'op-a', fingerprint: 'hash-a' });
  assert.equal(await repo.commit({ scope, owner, memoryId: 'memory-a', expectedRevision: 0, next: memory, operation: { id: 'op-a', fingerprint: 'hash-a' } }), 'committed');
  assert.equal(await repo.commit({ scope, owner, memoryId: 'memory-a', expectedRevision: 0, next: memory, operation: { id: 'op-a', fingerprint: 'hash-b' } }), 'conflict');
});

test('memory CAS loser cannot write a receipt', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db);
  await repo.commit({ scope, owner, memoryId: 'memory-a', expectedRevision: 0, next: memory, operation: { id: 'op-a', fingerprint: 'hash-a' } });
  db.state.casCount = 0;
  await assert.rejects(repo.commit({ scope, owner, memoryId: 'memory-a', expectedRevision: 1, next: { ...memory, revision: 2 }, operation: { id: 'op-b', fingerprint: 'hash-b' } }), e => e.code === 'conflict');
  assert.equal(db.state.memories.get('memory-a').revision, 1); assert.equal(db.state.operations.size, 1);
});

test('confirmed state requires the matching current server confirmation inside transaction', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db, () => new Date('2026-10-06T00:00:00Z'));
  await repo.commit({ scope, owner, memoryId: 'memory-a', expectedRevision: 0, next: memory, operation: { id: 'op-a', fingerprint: 'hash-a' } });
  const confirmation = { id: 'proof-a', memoryId: 'memory-a', revision: 1, aclRevision: 1, owner, scope, audience: 'operator', preference: memory.preference, memoryExpiresAt: memory.expiresAt, status: 'confirmed', issuedAt: '2026-10-05T00:00:00Z', expiresAt: '2026-11-01T00:00:00Z' };
  const input = { scope, owner, memoryId: 'memory-a', expectedRevision: 1, next: { ...memory, revision: 2, status: 'confirmed', confirmationRecordId: 'proof-a' }, operation: { id: 'op-confirm', fingerprint: 'hash-confirm' }, confirmation };
  await assert.rejects(repo.commit(input), e => e.code === 'conflict');
  db.state.confirmations.set('proof-a', { id: 'proof-a', tenantId: scope.tenantId, workspaceId: scope.workspaceId, state: { ...confirmation, status: 'revoked' } });
  await assert.rejects(repo.commit(input), e => e.code === 'conflict');
  assert.equal(db.state.memories.get('memory-a').revision, 1);
  db.state.confirmations.get('proof-a').state = confirmation;
  assert.equal(await repo.commit(input), 'committed');
});

test('confirmation is read by scoped server record and missing state is unavailable', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db);
  db.state.confirmations.set('confirmation-a', { id: 'confirmation-a', tenantId: 'tenant-a', workspaceId: 'space-a', state: { id: 'confirmation-a', memoryId: 'memory-a', revision: 1, aclRevision: 1, owner, scope, audience: 'operator', preference: memory.preference, memoryExpiresAt: memory.expiresAt, status: 'confirmed', issuedAt: '2026-10-06T00:00:00.000Z', expiresAt: '2026-11-01T00:00:00.000Z' } });
  const context = { actor: { kind: 'user', userId: 'user-a' }, audience: 'operator', scope, contractVersion: 'test', requestId: 'req-a', authorizedAt: '2026-10-06T00:00:00.000Z' };
  assert.equal((await repo.read(context, 'confirmation-a')).status, 'confirmed');
  db.state.confirmations.set('confirmation-b', { id: 'confirmation-b', tenantId: 'tenant-a', workspaceId: 'space-a', state: null });
  await assert.rejects(() => repo.read(context, 'confirmation-b'), error => error.code === 'unavailable');
  assert.equal(await repo.read({ ...context, scope: { ...scope, workspaceId: 'other' } }, 'confirmation-a'), null);
});
