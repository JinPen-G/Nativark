'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { FormalKnowledgeAuthorizationAdapter, FormalMemoryAuthorizationAdapter } = h.load('formal-knowledge-authorization.adapter');
const { PrismaKnowledgeActionPolicySource } = h.load('prisma-knowledge-policy.source');

test('persisted action policy source composes with real current-identity adapter and denies absent, revoked and cross-principal grants', async () => {
  const { identity } = fixture();
  const context = await new (h.load('knowledge-current-session').KnowledgeCurrentSession)(identity.auth, identity.credentials, { now: () => h.now }).current();
  const { fingerprint } = h.load('knowledge-validation');
  let mode = 'missing', resource = {}, expectedResourceKey = fingerprint({});
  const db = { aiKnowledgeActionPolicy: { findUnique: async ({ where }) => {
    if (mode === 'missing') return null;
    const key = where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey;
    assert.equal(key.tenantId, 'tenant-1'); assert.equal(key.workspaceId, 'space-1');
    assert.equal(key.actorId, 'user-1'); assert.equal(key.domain, 'knowledge');
    assert.equal(key.resourceKey, expectedResourceKey);
    return { ...key, actorId: mode === 'cross-principal' ? 'other-user' : key.actorId,
      revision: 1, enabled: mode !== 'revoked', resource: structuredClone(resource), requiredPermissions: ['synthetic-policy'],
      expiresAt: new Date(h.now + 60000) };
  } } };
  const policies = new PrismaKnowledgeActionPolicySource(db, () => new Date(h.now));
  const adapter = new FormalKnowledgeAuthorizationAdapter(identity.auth, identity.credentials, policies.knowledge, () => new Date(h.now));
  const request = { action: 'read_metadata', scope: context.scope };
  assert.equal(await adapter.authorize(context, request), null);
  mode = 'enabled'; assert.ok(await adapter.authorize(context, request));
  mode = 'revoked'; assert.equal(await adapter.authorize(context, request), null);
  mode = 'cross-principal'; assert.equal(await adapter.authorize(context, request), null);
  mode = 'enabled';
  const upload = { documentId: 'doc-1', idempotencyKey: 'knowledge-upload', fileName: 'sop.txt', mimeType: 'text/plain', sizeBytes: 12 };
  resource = { upload }; expectedResourceKey = fingerprint(resource);
  const uploadRequest = { action: 'upload', scope: context.scope, upload };
  const granted = await adapter.authorize(context, uploadRequest); assert.ok(granted);
  resource = { upload: Object.fromEntries(Object.entries(upload).reverse()) };
  assert.notEqual(fingerprint(resource), expectedResourceKey);
  assert.deepEqual(await adapter.authorize(context, uploadRequest), granted);
  resource.upload.sizeBytes = 13;
  assert.equal(await adapter.authorize(context, uploadRequest), null);
  resource.upload.sizeBytes = '12';
  assert.equal(await adapter.authorize(context, uploadRequest), null);
});

test('memory policy binds nested owner by value and expires during current-identity recheck', async () => {
  const { identity } = fixture();
  const context = await new (h.load('knowledge-current-session').KnowledgeCurrentSession)(identity.auth, identity.credentials, { now: () => h.now }).current();
  const owner = { actorKind: 'user', actorId: 'user-1' };
  const memory = { memoryId: 'memory-1', revision: 2, aclRevision: 3, owner };
  let now = h.now, calls = 0;
  const policy = { action: 'read', scope: context.scope, audience: context.audience, actor: owner,
    revision: 1, expiresAt: new Date(h.now + 1000).toISOString(), requiredPermissions: ['synthetic-policy'], grantKey: 'memory-policy',
    resource: { memoryId: memory.memoryId, revision: 2, aclRevision: 3, owner: structuredClone(owner) } };
  const source = { resolve: async () => { calls++; if (calls === 4) now += 2000; return structuredClone(policy); } };
  const adapter = new FormalMemoryAuthorizationAdapter(identity.auth, identity.credentials, source, () => new Date(now));
  const request = { action: 'read', scope: context.scope, owner, memory };
  assert.ok(await adapter.authorize(context, request));
  assert.equal(await adapter.authorize(context, request), null);
});

test('formal knowledge and memory adapters fail closed without policy and bind policy to current identity', async () => {
  const { ports, identity } = fixture();
  const policy = { action: 'read_metadata', scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'space-1' }, audience: 'operator', actor: { actorKind: 'user', actorId: 'user-1' }, revision: 1, expiresAt: new Date(h.now + 3600000).toISOString(), requiredPermissions: ['ai:knowledge:read'], grantKey: 'policy-1' };
  const source = { resolve: async (_context, request) => request.action === 'read_metadata' ? structuredClone(policy) : null };
  const adapter = new FormalKnowledgeAuthorizationAdapter(identity.auth, identity.credentials, source, () => new Date(h.now));
  const context = await new (h.load('knowledge-current-session').KnowledgeCurrentSession)(identity.auth, identity.credentials, { now: () => h.now }).current();
  assert.equal(await adapter.authorize(context, { action: 'read_metadata', scope: context.scope }), null);
  const allowed = new FormalKnowledgeAuthorizationAdapter(identity.auth, { ...identity.credentials }, { resolve: async () => ({ ...policy, requiredPermissions: ['synthetic-policy'] }) }, () => new Date(h.now));
  assert.equal((await allowed.authorize(context, { action: 'read_metadata', scope: context.scope })).accessKey, 'policy-1');
  const memory = new FormalMemoryAuthorizationAdapter(identity.auth, identity.credentials, { resolve: async () => null }, () => new Date(h.now));
  assert.equal(await memory.authorize(context, { action: 'read', scope: context.scope, owner: { actorKind: 'user', actorId: 'user-1' } }), null);
});
