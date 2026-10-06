'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { PrismaStructuredMemoryRepository } = require('./fixtures/ai-native/knowledge-repository-baseline.cjs').load('apps/api/src/modules/ai-native/knowledge/prisma-memory.repository.ts', () => require('../apps/api/src/modules/ai-native/knowledge/prisma-memory.repository'));
const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'space-a' }, owner = { actorKind: 'user', actorId: 'user-a' };
const memory = { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-a', revision: 1, owner, scope, aclRevision: 1, expiresAt: '2026-12-01T00:00:00.000Z', status: 'proposed', preference: { kind: 'locale', value: 'zh-CN' } };
const clone = value => structuredClone(value);
function dbFactory() {
  const state = { memories: new Map(), operations: new Map(), confirmations: new Map(), failOperation: false, casCount: 1, admissionError: null, responseError: null, operationError: null, readError: null };
  const delegates = () => ({
    aiStructuredMemory: {
      findFirst: async ({ where }) => { if (state.readError) throw state.readError; return [...state.memories.values()].find(v => v.id === where.id && v.tenantId === where.tenantId && v.workspaceId === where.workspaceId && v.ownerKind === where.ownerKind && v.ownerId === where.ownerId) ?? null; },
      create: async ({ data }) => { const row = { ...clone(data) }; state.memories.set(row.id, row); return row; },
      update: async ({ where, data }) => { const row = state.memories.get(where.id); if (!row) throw new Error('missing'); Object.assign(row, clone(data)); return row; },
      updateMany: async ({ where, data }) => { const row = state.memories.get(where.id); if (state.casCount !== 1) return { count: state.casCount }; if (!row || Object.entries(where).some(([key, value]) => row[key] !== value)) return { count: 0 }; Object.assign(row, clone(data)); return { count: 1 }; }
    },
    aiMemoryOperation: {
      findFirst: async ({ where }) => { if (state.readError) throw state.readError; return [...state.operations.values()].find(v => v.tenantId === where.tenantId && v.workspaceId === where.workspaceId && v.memoryId === where.memoryId && v.operationId === where.operationId) ?? null; },
      create: async ({ data }) => { if (state.operationError) throw state.operationError; if (state.failOperation) throw new Error('commit failed'); const row = clone(data); state.operations.set(row.id, row); return row; }
    },
    aiHumanConfirmation: { findFirst: async ({ where }) => { if (state.readError) throw state.readError; const row = state.confirmations.get(where.id); return row && row.tenantId === where.tenantId && row.workspaceId === where.workspaceId ? row : null; }, create: async ({ data }) => { const row = clone(data); state.confirmations.set(row.id, row); return row; }, update: async () => { throw new Error('not used'); } }
  });
  return { state, ...delegates(), async $transaction(callback) {
    if (state.admissionError) throw state.admissionError;
    const original = { memories: state.memories, operations: state.operations };
    state.memories = clone(original.memories); state.operations = clone(original.operations);
    let result;
    try { result = await callback(delegates()); }
    catch (error) { Object.assign(state, original); throw error; }
    if (state.responseError) throw state.responseError;
    return result;
  } };
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

const command = () => ({ scope, owner, memoryId: 'memory-a', expectedRevision: 0, next: memory, operation: { id: 'op-a', fingerprint: 'hash-a' } });
const unknown = error => error.code === 'result_unknown' && error.nextAction === 'reconcile' && error.message === 'result_unknown' && !error.cause;
test('memory COMMIT response loss preserves facts and reconciles the original receipt', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db);
  db.state.responseError = new Error('private database response lost');
  await assert.rejects(repo.commit(command()), unknown);
  assert.equal(db.state.memories.size, 1); assert.equal(db.state.operations.size, 1);
  db.state.responseError = null;
  assert.deepEqual(await repo.operation(scope, owner, 'memory-a', 'op-a'), command().operation);
  assert.equal(await repo.commit(command()), 'committed');
  assert.equal(db.state.memories.get('memory-a').revision, 1); assert.equal(db.state.operations.size, 1);
});
test('memory transaction admission failure is unavailable, not a revision conflict', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db); db.state.admissionError = new Error('private admission failure');
  await assert.rejects(repo.commit(command()), e => e.code === 'unavailable' && e.message === 'unavailable' && !e.cause);
  assert.equal(db.state.memories.size, 0); assert.equal(db.state.operations.size, 0);
});
for (const code of ['P2002', 'P2034']) test(`memory explicit ${code} rollback stays conflict`, async () => {
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db);
  db.state.operationError = new Prisma.PrismaClientKnownRequestError('private rollback', { code, clientVersion: '5.22.0' });
  assert.equal(await repo.commit(command()), 'conflict');
  assert.equal(db.state.memories.size, 0); assert.equal(db.state.operations.size, 0);
});
test('memory failed update restores the prior revision in the transaction double', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db);
  await repo.commit(command()); db.state.failOperation = true;
  await assert.rejects(repo.commit({ ...command(), expectedRevision: 1, next: { ...memory, revision: 2 }, operation: { id: 'op-b', fingerprint: 'hash-b' } }), unknown);
  assert.equal(db.state.memories.get('memory-a').revision, 1); assert.equal(db.state.operations.size, 1);
});
test('memory COMMIT failure after the callback cannot become a retryable conflict', async () => {
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db);
  db.state.responseError = new Prisma.PrismaClientKnownRequestError('late response', { code: 'P2002', clientVersion: '5.22.0' });
  await assert.rejects(repo.commit(command()), unknown);
  assert.equal(db.state.memories.size, 1); assert.equal(db.state.operations.size, 1);
});
test('memory and confirmation read errors expose no database details', async () => {
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db); db.state.readError = new Error('private db secret');
  for (const read of [() => repo.read(scope, owner, 'memory-a'), () => repo.operation(scope, owner, 'memory-a', 'op-a'), () => repo.read({ scope }, 'proof-a')]) {
    await assert.rejects(read(), e => e.code === 'unavailable' && e.message === 'unavailable' && !e.cause);
  }
});
test('actual memory service propagates uncertainty and replays the same operation without another write', async () => {
  const { StructuredMemoryService } = require('../apps/api/src/modules/ai-native/knowledge/structured-memory.service');
  const db = dbFactory(), repo = new PrismaStructuredMemoryRepository(db);
  const context = { scope, actor: { kind: 'user', userId: owner.actorId }, audience: 'operator' };
  const service = new StructuredMemoryService({ repository: repo, confirmations: repo, clock: { now: () => Date.parse('2026-10-06T00:00:00Z') },
    authorization: { authorize: async () => ({ scope, actor: owner, audience: 'operator', accessKey: 'synthetic-grant' }) } });
  const input = { memoryId: 'memory-a', operationId: 'propose-a', expiresAt: memory.expiresAt, preference: memory.preference };
  db.state.responseError = new Error('private COMMIT response lost');
  await assert.rejects(service.propose(context, input), unknown);
  db.state.responseError = null;
  assert.equal((await service.propose(context, input)).status, 'proposed');
  assert.equal(db.state.memories.size, 1); assert.equal(db.state.operations.size, 1);
});
