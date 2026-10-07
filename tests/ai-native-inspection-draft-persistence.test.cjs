'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/lane-b-functional.cjs');
const { PrismaInspectionDraftRepository } = require('../apps/api/src/modules/ai-native/inspection-assist/prisma-inspection-draft.repository');
const { Prisma } = require('../apps/api/node_modules/@prisma/client');
const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a', ownerId: 'user-a', audience: 'staff' };
const digest = 'a'.repeat(64);
const operation = (id, revision = 0, fingerprint = digest) => ({ operationId: id, fingerprint, expectedRevision: revision });
const data = () => ({ ...scope, orderId: 'order-a', allocationId: 'allocation-a', assetId: 'asset-a', stage: 'return',
  templateId: 'template-a', templateVersion: 'v1', bindingFingerprint: digest, evidenceFingerprint: digest,
  status: 'draft_saved', state: { version: 1, fields: {}, candidates: [], evidence: [], missingFields: [], reviewRequired: false },
  expiresAt: new Date('2026-11-07T00:00:00Z') });
function fixture() {
  let drafts = new Map(), receipts = new Map(), queue = Promise.resolve();
  const flags = { lost: false, unavailable: false, failReceipt: false, updates: [] };
  const match = (row, where) => Object.entries(where).every(([key, value]) => value && typeof value === 'object' ? row[key] > value.gt : row[key] === value);
  const receiptKey = row => JSON.stringify([row.tenantId, row.workspaceId, row.operationId]);
  const db = {
    aiInspectionDraft: {
      create: async ({ data }) => { const row = { inspectionId: null, ...structuredClone(data) }; drafts.set(row.id, row); return structuredClone(row); },
      findFirst: async ({ where }) => structuredClone([...drafts.values()].find(row => match(row, where)) ?? null),
      findFirstOrThrow: async args => { const row = await db.aiInspectionDraft.findFirst(args); if (!row) throw Error('missing'); return row; },
      findMany: async ({ where, take, select }) => [...drafts.values()].filter(row => match(row, where)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take)
        .map(row => Object.fromEntries(Object.keys(select).map(key => [key, row[key]]))),
      updateMany: async ({ where, data }) => { flags.updates.push(structuredClone(where)); const row = [...drafts.values()].find(row => match(row, where));
        if (!row) return { count: 0 }; Object.assign(row, structuredClone(data), { revision: row.revision + data.revision.increment }); return { count: 1 }; }
    },
    aiInspectionOperation: {
      findUnique: async ({ where }) => { if (flags.unavailable) throw Error('storage failed'); return structuredClone(receipts.get(receiptKey(where.tenantId_workspaceId_operationId)) ?? null); },
      create: async ({ data }) => { if (flags.failReceipt) throw Error('receipt write failed'); const key = receiptKey(data);
        if (receipts.has(key)) throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: 'test' });
        receipts.set(key, structuredClone(data)); return structuredClone(data); }
    },
    $transaction: callback => { const work = queue.then(async () => { const oldDrafts = structuredClone(drafts), oldReceipts = structuredClone(receipts); let result;
      try { result = await callback(db); } catch (error) { drafts = oldDrafts; receipts = oldReceipts; throw error; }
      if (flags.lost) { flags.lost = false; throw Error('commit response lost'); } return result;
    }); queue = work.catch(() => undefined); return work; }
  };
  return { repository: new PrismaInspectionDraftRepository(db), flags, db, counts: () => [drafts.size, receipts.size] };
}

test('actual Prisma repository creates immutable receipts and rejects payload/owner collision', async () => {
  const f = fixture(), first = await f.repository.create(scope, operation('create-a'), data());
  assert.deepEqual(await f.repository.create(scope, operation('create-a'), data()), first);
  await assert.rejects(f.repository.create(scope, operation('create-a', 0, 'b'.repeat(64)), data()), { code: 'REVISION_CONFLICT' });
  await assert.rejects(f.repository.receipt({ ...scope, ownerId: 'foreign' }, 'create-a', digest), { code: 'ACCESS_DENIED' });
  assert.deepEqual(f.counts(), [1, 1]);
});
test('concurrent same-key creation rolls back losing insert and returns exact receipt', async () => {
  const f = fixture();
  const result = await Promise.all([f.repository.create(scope, operation('same'), data()), f.repository.create(scope, operation('same'), data())]);
  assert.deepEqual(result[0], result[1]); assert.deepEqual(f.counts(), [1, 1]);
});
test('two edits race on real repository CAS, not unconditional update', async () => {
  const f = fixture(), created = await f.repository.create(scope, operation('create'), data());
  const results = await Promise.allSettled(['edit-a','edit-b'].map(id => f.repository.change(scope, created.draftId, operation(id, 1), digest, { state: { manual: 42 } })));
  assert.equal(results.filter(row => row.status === 'fulfilled').length, 1);
  assert.equal(results.find(row => row.status === 'rejected').reason.code, 'REVISION_CONFLICT');
  for (const where of f.flags.updates) assert.deepEqual(where, { id: created.draftId, ...scope, revision: 1, bindingFingerprint: digest });
  assert.equal((await f.repository.read(scope, created.draftId)).revision, 2);
  assert.equal((await f.repository.receipt(scope, 'create', digest)).result.revision, 1);
});
test('lost reply recovers original operation; absence is distinct from failed storage', async () => {
  const f = fixture(); f.flags.lost = true;
  const result = await f.repository.create(scope, operation('lost'), data());
  assert.equal(result.revision, 1); assert.deepEqual(f.counts(), [1,1]);
  assert.deepEqual(await f.repository.receipt(scope, 'missing', digest), { status: 'absent' });
  f.flags.unavailable = true;
  assert.deepEqual(await f.repository.receipt(scope, 'missing', digest), { status: 'unavailable' });
  await assert.rejects(f.repository.create(scope, operation('new'), data()), { code: 'STORAGE_UNAVAILABLE' });
});
test('receipt failure rolls back draft; bounded listing never leaks another owner', async () => {
  const f = fixture(); f.flags.failReceipt = true;
  await assert.rejects(f.repository.create(scope, operation('create'), data()), { code: 'RECONCILIATION_REQUIRED' });
  assert.deepEqual(f.counts(), [0,0]); f.flags.failReceipt = false;
  await f.repository.create(scope, operation('create'), data());
  assert.equal((await f.repository.list(scope, 'order-a', undefined, 1)).length, 1);
  assert.equal((await f.repository.list({ ...scope, ownerId: 'other' }, 'order-a', undefined, 1)).length, 0);
  await assert.rejects(f.repository.list(scope, 'order-a', undefined, 51), { code: 'INVALID_INPUT' });
});
