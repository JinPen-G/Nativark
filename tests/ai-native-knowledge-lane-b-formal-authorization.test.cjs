'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { FormalKnowledgeAuthorizationAdapter, FormalMemoryAuthorizationAdapter } = h.load('formal-knowledge-authorization.adapter');
const { PrismaKnowledgeActionPolicySource } = h.load('prisma-knowledge-policy.source');

test('persisted action policy source composes with real current-identity adapter and denies absent, revoked and cross-principal grants', async () => {
  const { identity } = fixture();
  const context = await new (h.load('knowledge-current-session').KnowledgeCurrentSession)(identity.auth, identity.credentials, { now: () => h.now }).current();
  let mode = 'missing';
  const db = { aiKnowledgeActionPolicy: { findUnique: async ({ where }) => {
    if (mode === 'missing') return null;
    const key = where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey;
    assert.equal(key.tenantId, 'tenant-1'); assert.equal(key.workspaceId, 'space-1');
    assert.equal(key.actorId, 'user-1'); assert.equal(key.domain, 'knowledge');
    return { ...key, actorId: mode === 'cross-principal' ? 'other-user' : key.actorId,
      revision: 1, enabled: mode !== 'revoked', resource: {}, requiredPermissions: ['synthetic-policy'],
      expiresAt: new Date(h.now + 60000) };
  } } };
  const policies = new PrismaKnowledgeActionPolicySource(db, () => new Date(h.now));
  const adapter = new FormalKnowledgeAuthorizationAdapter(identity.auth, identity.credentials, policies.knowledge, () => new Date(h.now));
  const request = { action: 'read_metadata', scope: context.scope };
  assert.equal(await adapter.authorize(context, request), null);
  mode = 'enabled'; assert.ok(await adapter.authorize(context, request));
  mode = 'revoked'; assert.equal(await adapter.authorize(context, request), null);
  mode = 'cross-principal'; assert.equal(await adapter.authorize(context, request), null);
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
  const { ports, identity, db } = fixture();
  const policy = { action: 'read_metadata', scope: { kind: 'workspace', tenantId: 'tenant-1', workspaceId: 'space-1' }, audience: 'operator', actor: { actorKind: 'user', actorId: 'user-1' }, revision: 1, expiresAt: new Date(h.now + 3600000).toISOString(), requiredPermissions: ['ai:knowledge:read'], grantKey: 'policy-1' };
  const source = { resolve: async (_context, request) => request.action === 'read_metadata' ? structuredClone(policy) : null };
  const adapter = new FormalKnowledgeAuthorizationAdapter(identity.auth, identity.credentials, source, () => new Date(h.now));
  const context = await new (h.load('knowledge-current-session').KnowledgeCurrentSession)(identity.auth, identity.credentials, { now: () => h.now }).current();
  assert.equal(await adapter.authorize(context, { action: 'read_metadata', scope: context.scope }), null);
  const allowed = new FormalKnowledgeAuthorizationAdapter(identity.auth, { ...identity.credentials }, { resolve: async () => ({ ...policy, requiredPermissions: ['synthetic-policy'] }) }, () => new Date(h.now));
  assert.equal((await allowed.authorize(context, { action: 'read_metadata', scope: context.scope })).accessKey, 'policy-1');
  const memory = new FormalMemoryAuthorizationAdapter(identity.auth, identity.credentials, { resolve: async () => null }, () => new Date(h.now));
  assert.equal(await memory.authorize(context, { action: 'read', scope: context.scope, owner: { actorKind: 'user', actorId: 'user-1' } }), null);
  const owner={actorKind:'user',actorId:'user-1'};
  const record={memoryId:'memory-1',revision:2,aclRevision:1,owner};
  const memoryPolicy={...policy,action:'read',requiredPermissions:['synthetic-policy'],
    resource:{memoryId:record.memoryId,revision:record.revision,aclRevision:record.aclRevision,owner:structuredClone(owner)}};
  const currentMemory=new FormalMemoryAuthorizationAdapter(identity.auth,identity.credentials,
    {resolve:async()=>structuredClone(memoryPolicy)},()=>new Date(h.now));
  const request={action:'read',scope:context.scope,owner,memory:record};
  assert.equal((await currentMemory.authorize(context,request))?.accessKey,'policy-1');
  memoryPolicy.resource.owner.actorId='foreign';
  assert.equal(await currentMemory.authorize(context,request),null);
  const {HumanKnowledgeModule}=h.load('human-knowledge.module');
  const {PersistentMemoryConsentService}=h.load('persistent-memory-consent.service');
  const module=HumanKnowledgeModule.registerFormal({...ports,knowledgePolicy:source,
    fileRuntime:{assertKnowledgeBinding:async()=>{throw Error('no formal file binding');},readKnowledgeBytes:async()=>{throw Error('no formal bytes');}},
    memory:{db,policy:{resolve:async(current,input)=>({...policy,action:input.action,requiredPermissions:['synthetic-policy'],
      resource:input.memory?{memoryId:input.memory.memoryId,revision:input.memory.revision,aclRevision:input.memory.aclRevision,owner:structuredClone(input.memory.owner)}:undefined})}}});
  const consent=module.providers.find(row=>row.provide===PersistentMemoryConsentService).useValue;
  const expiresAt=new Date(h.now+3600000).toISOString();
  await consent.propose({memoryId:'formal-memory',operationId:'formal-propose',expiresAt,preference:{kind:'locale',value:'zh-CN'}});
  await consent.confirm({memoryId:'formal-memory',expectedRevision:1,operationId:'formal-confirm',expiresAt});
  assert.equal((await consent.read('formal-memory')).status,'confirmed');
  await consent.revoke({memoryId:'formal-memory',expectedRevision:2});
  await assert.rejects(consent.read('formal-memory'));
});
