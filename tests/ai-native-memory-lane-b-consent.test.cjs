'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/knowledge-service.cjs');
const { dbFactory } = require('./fixtures/ai-native/knowledge-persistent-content.cjs');
test.after(() => assert.deepEqual(h.attempts, []));

test('server human consent persists a bound confirmation consumed by existing memory lifecycle', async () => {
  const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');
  const { PrismaStructuredMemoryRepository } = h.load('prisma-memory.repository');
  const { StructuredMemoryService } = h.load('structured-memory.service');
  const db = dbFactory(), f = h.harness(), ctx = h.context();
  const repo = new PrismaStructuredMemoryRepository(db, () => new Date(h.now));
  const user = { id: 'user-1', tenantId: 'tenant-1', isActive: true, isSaasAdmin: false, permissions: ['synthetic-memory-policy'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } };
  let active = true;
  const auth = { resolveAccessContext: async () => ({ user: { ...user, isActive: active }, tenantUser: user, workspaceValid: true, workspaceId: 'space-1' }) };
  const credentials = { current: async () => ({ authorization: 'synthetic-session', requestId: 'request-1', audience: 'operator' }) };
  const memory = new StructuredMemoryService({ repository: repo, confirmations: repo, authorization: f.authorization, clock: f.clock });
  await memory.propose(ctx, { memoryId: 'memory-1', operationId: 'propose-1', expiresAt: new Date(h.now + 3600000).toISOString(), preference: { kind: 'locale', value: 'zh-CN' } });
  const consent = new PersistentMemoryConsentService({ db, auth, credentials, authorization: f.authorization, clock: f.clock });
  const input = { memoryId: 'memory-1', expectedRevision: 1, operationId: 'consent-1', expiresAt: new Date(h.now + 1800000).toISOString() };
  const result = await consent.confirm(input);
  assert.equal(result.status, 'confirmed');
  assert.equal(db.state.confirmations.size, 1);
  assert.equal((await consent.confirm(input)).revision, result.revision);
  assert.equal(db.state.confirmations.size, 1);
  await assert.rejects(consent.confirm({ ...input, expiresAt: new Date(h.now + 1700000).toISOString() }), { code: 'conflict' });
  active = false;
  await assert.rejects(consent.confirm(input), { code: 'unavailable' });
  active = true;
  await memory.change(ctx, 'delete-1', { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-1', expectedRevision: 2, operation: 'delete' });
  await assert.rejects(consent.confirm(input), { code: 'unavailable' });
  assert.equal((await memory.read(ctx, 'memory-1')).status, 'deleted');
});

test('human facade reads, modifies and deletes through current identity without caller scope', async () => {
  const { PersistentMemoryConsentService } = h.load('persistent-memory-consent.service');
  const db = dbFactory(), f = h.harness();
  let active = true;
  const user = { id: 'user-1', tenantId: 'tenant-1', isActive: true, isSaasAdmin: false, permissions: ['synthetic-memory-policy'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } };
  const consent = new PersistentMemoryConsentService({ db, authorization: f.authorization, clock: f.clock,
    auth: { resolveAccessContext: async () => ({ user: { ...user, isActive: active }, tenantUser: user, workspaceValid: true, workspaceId: 'space-1' }) },
    credentials: { current: async () => ({ authorization: 'synthetic-session', requestId: 'request-1', audience: 'operator' }) } });
  const expiry = new Date(h.now + 3600000).toISOString();
  await consent.propose({ memoryId: 'memory-2', operationId: 'propose-2', expiresAt: expiry, preference: { kind: 'locale', value: 'zh-CN' } });
  await consent.confirm({ memoryId: 'memory-2', expectedRevision: 1, operationId: 'consent-2', expiresAt: expiry });
  assert.equal((await consent.read('memory-2')).status, 'confirmed');
  const modified = await consent.change('modify-2', { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-2', expectedRevision: 2, operation: 'modify', preference: { kind: 'locale', value: 'en-US' } });
  assert.equal(modified.status, 'proposed');
  assert.equal(modified.confirmationRecordId, undefined);
  const original = db.aiStructuredMemory.findFirst;
  db.aiStructuredMemory.findFirst = async args => { const result = await original(args); active = false; return result; };
  await assert.rejects(consent.read('memory-2'), { code: 'unavailable' });
  active = true; db.aiStructuredMemory.findFirst = original;
  await assert.rejects(consent.change('forged', { operation: 'confirm', confirmationRecordId: 'arbitrary-string' }), { code: 'invalid_input' });
  await consent.change('delete-2', { draftVersion: 'ain-c06-draft-1', memoryId: 'memory-2', expectedRevision: 3, operation: 'delete' });
  assert.equal((await consent.read('memory-2')).status, 'deleted');
});
