'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { FormalKnowledgeAuthorizationAdapter, FormalMemoryAuthorizationAdapter } = h.load('formal-knowledge-authorization.adapter');
const { PrismaKnowledgeActionPolicySource } = h.load('prisma-knowledge-policy.source');
const { randomUUID } = require('node:crypto');
const { KNOWLEDGE_POLICY_MANAGEMENT } = h.load('knowledge-policy-management.composition');
const { AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION: managementVersion } = require('../packages/shared/src/ai-knowledge-policy-management-draft');

function managementFixture() {
  const f = fixture(), { db } = f, { state } = db, clone = value => structuredClone(value);
  const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
  const actor = user({ id: 'user-1', tenantId: 'tenant-1', permissions: ['system:params:manage', 'synthetic-policy'] });
  const flags = { active: true, now: h.now, lostCommit: false, lostPrepare: false, rejectCommit: false, lostClaim: false, writes: 0 };
  const auth = new AuthService({ getAuthSession: async () => flags.active ? { id: 'policy-session', userId: actor.id, audience: 'operator', currentWorkspaceId: 'space-1' } : undefined,
    findUserById: async () => actor, findWorkspaceScopedUser: async () => actor, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-policy-test-secret' : undefined });
  const request = { audience: 'operator', requestId: 'policy-request', authorization: `Bearer ${auth.signAccessToken({ sub: actor.id, tid: actor.tenantId, sid: 'policy-session', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 })}` };
  const credentials = { current: async () => clone(request) }, guard = new ApiAuthGuard(auth);
  for (const name of ['policyAuthorities', 'policyPreparations', 'policyOperations', 'actionPolicies']) state[name] = new Map();
  const match = (row, where) => Object.entries(where).every(([key, value]) => value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value);
  const delegate = name => {
    const api = {
      async findFirst({ where, orderBy }) { const rows = [...state[name].values()].filter(row => match(row, where));
        if (orderBy?.resultRevision === 'desc') rows.sort((a, b) => b.resultRevision - a.resultRevision); return clone(rows[0] ?? null); },
      async findUnique({ where }) { return api.findFirst({ where: where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey ?? where }); },
      async create({ data }) {
        const plain = { ...data, beforeJson: data.beforeJson === require('../apps/api/node_modules/@prisma/client').Prisma.JsonNull ? null : data.beforeJson };
        const key = name === 'actionPolicies' ? JSON.stringify([data.tenantId,data.workspaceId,data.actorKind,data.actorId,data.audience,data.domain,data.action,data.resourceKey]) : data.id;
        if (state[name].has(key)) throw Error('duplicate');
        if (name === 'policyPreparations' && [...state[name].values()].some(row => row.operationKey === data.operationKey && row.actorId === data.actorId)) throw Error('duplicate operation');
        const row = { createdAt: new Date(flags.now), updatedAt: new Date(flags.now), ...clone(plain) };
        flags.writes++; state[name].set(key, row); return clone(row);
      },
      async updateMany({ where, data }) { let count = 0;
        for (const row of state[name].values()) if (match(row, where)) {
          if (data.commitSlot && [...state[name].values()].some(other => other !== row && other.commitSlot === data.commitSlot)) throw Error('duplicate commit slot');
          Object.assign(row, clone(data)); count++; flags.writes++;
        }
        if (name === 'policyPreparations' && data.commitSlot && flags.lostClaim) { flags.lostClaim = false; throw Error('claim reply lost'); }
        return { count };
      },
    }; return api;
  };
  db.aiKnowledgeActionPolicy = delegate('actionPolicies'); db.aiKnowledgePolicyManagementAuthority = delegate('policyAuthorities');
  db.aiKnowledgePolicyPreparation = delegate('policyPreparations'); db.aiKnowledgePolicyManagementOperation = delegate('policyOperations');
  db.businessWorkspace = { findFirst: async () => ({ id: 'space-1', tenantId: 'tenant-1', status: 'ACTIVE' }) };
  db.user = { findFirst: async ({ where }) => where.id === actor.id ? clone(actor) : null };
  db.workspaceMember = { findFirst: async ({ where }) => ({ ...where, isActive: flags.active }) };
  db.aiKnowledgeAcl = { findFirst: async () => null }; db.$queryRaw = async () => [];
  const transaction = db.$transaction; let queue = Promise.resolve();
  db.$transaction = callback => {
    const next = queue.then(async () => {
      const oldOps = state.policyOperations.size, oldPrep = state.policyPreparations.size;
      const result = await transaction(async tx => {
        const result = await callback(tx);
        if (flags.rejectCommit && state.policyOperations.size > oldOps) { flags.rejectCommit = false; throw Error('commit not observed'); }
        return result;
      });
      if (flags.lostCommit && state.policyOperations.size > oldOps) { flags.lostCommit = false; throw Error('commit reply lost'); }
      if (flags.lostPrepare && state.policyPreparations.size > oldPrep) { flags.lostPrepare = false; throw Error('prepare reply lost'); }
      return result;
    }); queue = next.catch(() => {}); return next;
  };
  const deps = { db, policyDb: db, auth, credentials, clock: { now: () => flags.now }, memory: { db },
    policyManagement: { enabled: true, guard }, fileRuntime: { assertKnowledgeBinding: async () => { throw Error('no file binding'); }, readKnowledgeBytes: async () => { throw Error('no file read'); } } };
  const module = h.load('human-knowledge.module').HumanKnowledgeModule.registerFormal(deps);
  const manage = module.providers.find(p => p.provide === KNOWLEDGE_POLICY_MANAGEMENT).useValue;
  const service = Type => module.providers.find(p => p.provide === Type).useValue;
  function authority(action, resource = {}, domain = 'knowledge', overrides = {}) {
    const row = { id: randomUUID(), tenantId: 'tenant-1', workspaceId: 'space-1', managerId: actor.id, revision: 1, enabled: true,
      basisRef: 'explicit-offline-admin-delegation', basisVersion: managementVersion, targetActorId: actor.id, targetAudience: 'operator', domain, action,
      resource: clone(resource), resourceKey: h.load('knowledge-validation').fingerprint(resource), requiredPermissions: ['system:params:manage'],
      allowedPermissions: ['synthetic-policy'], allowedOperations: ['create_disabled','update_disabled','enable','disable'], maxPolicySeconds: 86400,
      expiresAt: new Date(h.now + 86400000), ...overrides };
    state.policyAuthorities.set(row.id, row); return row;
  }
  let sequence = 0;
  const command = (root, action = 'create_disabled', expectedRevision = 0) => ({ version: managementVersion, authorityId: root.id,
    operationKey: `policy-${++sequence}`, expectedRevision, action, requiredPermissions: ['synthetic-policy'], expiresAt: new Date(h.now + 3600000).toISOString() });
  async function apply(value) { const prepared = await manage.prepare(request, value); assert.equal(prepared.state, 'prepared');
    const result = await manage.commit(request, { preparationId: prepared.preparationId, changeHash: prepared.changeHash, confirm: 'apply_knowledge_policy_change' });
    assert.equal(result.state, 'observed'); return { prepared, result }; }
  async function enable(root) { const created = await apply(command(root)); assert.equal(created.result.result.enabled, false);
    assert.equal([...state.actionPolicies.values()].filter(row => row.resourceKey === root.resourceKey && row.action === root.action && row.domain === root.domain)[0].enabled, false);
    return apply(command(root, 'enable', 1)); }
  return { ...f, deps, db, state, flags, actor, auth, request, manage, service, authority, command, apply, enable };
}

 test('managed exact policies drive original knowledge publish and memory confirmation with live revocation', async () => {
  const f = managementFixture(), { HumanKnowledgeService } = h.load('human-knowledge.service');
  const seed = new HumanKnowledgeService(f.ports);
  await seed.create(h.draft()); await seed.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  const stored = f.db.state.documents.get('doc-1'); stored.state.document.indexing = 'indexed';
  const d = stored.state.document, resource = { documentId: d.documentId, documentVersion: d.documentVersion, attachmentId: d.attachmentId, aclRevision: d.aclRevision };
  const documents = f.service(HumanKnowledgeService);
  await assert.rejects(documents.read('doc-1'));
  const roots = [];
  for (const action of ['read_metadata','publish','read_body','snippet','resolve_source','search']) for (const r of [{}, resource]) {
    const root = f.authority(action, r); roots.push(root); await f.enable(root);
  }
  const published = await documents.publish({ documentId: 'doc-1', expectedRevision: stored.revision, operationId: 'publish-real-policy' });
  assert.equal(published.publication, 'published'); assert.equal((await documents.read('doc-1')).publication, 'published');
  const body = await documents.preview('doc-1'); assert.ok(body.sources.length);
  const inputs = f.service(h.load('human-knowledge-input.service').HumanKnowledgeInputService);
  const collected = await inputs.collect({ requestId: 'managed-input', query: 'Synthetic', maxSources: 3, maxSnippetChars: 1000, maxTotalBytes: 8192 });
  assert.equal(collected.status, 'ready'); assert.ok(collected.sources.length);
  assert.ok((await inputs.revalidate(collected)).sources.length);
  const search = roots.find(r => r.action === 'search' && r.resource.documentId);
  await f.apply(f.command(search, 'disable', 2)); await assert.rejects(inputs.revalidate(collected));
  const source = roots.find(r => r.action === 'read_body' && r.resource.documentId);
  await f.apply(f.command(source, 'disable', 2));
  await assert.rejects(documents.preview('doc-1'));
  const reader = roots.find(r => r.action === 'read_metadata' && r.resource.documentId);
  reader.enabled = false; await assert.rejects(documents.read('doc-1')); reader.enabled = true;
  f.actor.permissions = ['system:params:manage']; await assert.rejects(documents.read('doc-1')); f.actor.permissions.push('synthetic-policy');
  const memory = f.service(h.load('persistent-memory-consent.service').PersistentMemoryConsentService), owner = { actorKind: 'user', actorId: 'user-1' };
  for (const action of ['propose','confirm','read','delete']) await f.enable(f.authority(action, { owner }, 'memory'));
  const expiresAt = new Date(h.now + 3600000).toISOString();
  await f.enable(f.authority('propose', { memoryId: 'managed-memory', revision: 1, aclRevision: 1, owner }, 'memory'));
  await f.enable(f.authority('read', { memoryId: 'managed-memory', revision: 1, aclRevision: 1, owner }, 'memory'));
  await memory.propose({ memoryId: 'managed-memory', operationId: 'managed-propose', expiresAt, preference: { kind: 'locale', value: 'zh-CN' } });
  await f.enable(f.authority('confirm', { memoryId: 'managed-memory', revision: 1, aclRevision: 1, owner }, 'memory'));
  const memoryRead = f.authority('read', { memoryId: 'managed-memory', revision: 2, aclRevision: 1, owner }, 'memory'); await f.enable(memoryRead);
  await memory.confirm({ memoryId: 'managed-memory', expectedRevision: 1, operationId: 'managed-confirm', expiresAt });
  await f.enable(f.authority('delete', { memoryId: 'managed-memory', revision: 2, aclRevision: 1, owner }, 'memory'));
  assert.equal((await memory.read('managed-memory')).status, 'confirmed');
  memoryRead.allowedPermissions = ['different']; await assert.rejects(memory.read('managed-memory')); memoryRead.allowedPermissions = ['synthetic-policy'];
  await memory.revoke({ memoryId: 'managed-memory', expectedRevision: 2 }); await assert.rejects(memory.read('managed-memory'));
  assert.ok(f.state.actionPolicies.size > 0);
 });

 test('policy management rejects privilege escalation and recovers original receipts without redispatch', async () => {
  const f = managementFixture(), root = f.authority('read_metadata');
  const dormant = h.load('knowledge-policy-management.composition').createKnowledgePolicyManagementFactory({ enabled: false, db: f.db, auth: f.auth,
    guard: f.deps.policyManagement.guard, clock: () => new Date(f.flags.now) });
  const untouched = f.flags.writes;
  assert.throws(() => dormant.prepare(f.request, f.command(root)), { code: 'unavailable' }); assert.equal(f.flags.writes, untouched);
  assert.throws(() => f.manage.read({ ...f.request, audience: 'staff' }, { authorityId: root.id }), { code: 'invalid_input' });
  await assert.rejects(f.manage.prepare(f.request, { ...f.command(root), expiresAt: new Date(h.now + 2 * 86400000).toISOString() }));
  const foreign = f.authority('read_metadata', {}, 'knowledge', { targetActorId: 'other-user' });
  await assert.rejects(f.manage.prepare(f.request, f.command(foreign)));
  const expired = f.authority('read_metadata', {}, 'knowledge', { expiresAt: new Date(h.now) });
  await assert.rejects(f.manage.prepare(f.request, f.command(expired)));
  await assert.rejects(f.manage.prepare(f.request, f.command({ id: randomUUID() })), { code: 'trusted_authority_missing' });
  await assert.rejects(f.manage.prepare(f.request, { ...f.command(root), enabled: true }), { code: 'invalid_input' });
  root.enabled = false; await assert.rejects(f.manage.prepare(f.request, f.command(root))); root.enabled = true;
  await assert.rejects(f.manage.prepare(f.request, { ...f.command(root), requiredPermissions: ['escalated'] }));
  const { prepared, result } = await f.apply(f.command(root));
  const read = { operationKey: prepared.operationKey, changeHash: prepared.changeHash };
  assert.deepEqual(await f.manage.operation(f.request, read), result);
  assert.deepEqual(await f.manage.preparation(f.request, { operationKey: prepared.operationKey }), result);
  const storedPreparation = f.state.policyPreparations.get(prepared.preparationId), originalBefore = storedPreparation.beforeJson;
  storedPreparation.beforeJson = { revision: 99 }; await assert.rejects(f.manage.operation(f.request, read), { code: 'conflict' }); storedPreparation.beforeJson = originalBefore;
  await assert.rejects(f.manage.operation(f.request, { ...read, changeHash: '0'.repeat(64) }), { code: 'conflict' });
  const stale = await f.manage.prepare(f.request, f.command(root, 'enable', 1)); root.revision++;
  await assert.rejects(f.manage.commit(f.request, { preparationId: stale.preparationId, changeHash: stale.changeHash, confirm: 'apply_knowledge_policy_change' }), { code: 'conflict' }); root.revision--;
  f.actor.permissions = ['synthetic-policy']; await assert.rejects(f.manage.commit(f.request, { preparationId: stale.preparationId, changeHash: stale.changeHash, confirm: 'apply_knowledge_policy_change' })); f.actor.permissions.unshift('system:params:manage');
  f.flags.lostCommit = true;
  const commit = { preparationId: stale.preparationId, changeHash: stale.changeHash, confirm: 'apply_knowledge_policy_change' };
  const unknown = await f.manage.commit(f.request, commit); assert.equal(unknown.state, 'unknown'); assert.equal(unknown.retryable, false);
  const count = f.flags.writes;
  assert.equal((await f.manage.operation(f.request, { operationKey: stale.operationKey, changeHash: stale.changeHash })).state, 'observed');
  assert.equal((await f.manage.commit(f.request, commit)).state, 'observed'); assert.equal(f.flags.writes, count);
  const disable = await f.manage.prepare(f.request, f.command(root, 'disable', 2)); f.flags.rejectCommit = true;
  const uncertain = await f.manage.commit(f.request, { preparationId: disable.preparationId, changeHash: disable.changeHash, confirm: 'apply_knowledge_policy_change' }); assert.equal(uncertain.state, 'unknown');
  const writes = f.flags.writes;
  assert.equal((await f.manage.commit(f.request, { preparationId: disable.preparationId, changeHash: disable.changeHash, confirm: 'apply_knowledge_policy_change' })).state, 'unknown'); assert.equal(f.flags.writes, writes);
  const swapped = await f.manage.prepare(f.request, f.command(root, 'disable', 2));
  const blocked = await f.manage.commit(f.request, { preparationId: swapped.preparationId, changeHash: swapped.changeHash, confirm: 'apply_knowledge_policy_change' });
  assert.equal(blocked.state, 'unknown'); assert.equal(blocked.operationKey, disable.operationKey); assert.equal([...f.state.actionPolicies.values()][0].enabled, true);
  f.flags.active = false; await assert.rejects(f.manage.operation(f.request, read));
 });

test('persisted action policy source composes with real current-identity adapter and denies absent, revoked and cross-principal grants', async () => {
  const { identity } = fixture();
  const context = await new (h.load('knowledge-current-session').KnowledgeCurrentSession)(identity.auth, identity.credentials, { now: () => h.now }).current();
  const { fingerprint } = h.load('knowledge-validation');
  let mode = 'missing', resource = {}, expectedResourceKey = fingerprint({});
  const db = { aiKnowledgePolicyManagementOperation: { findFirst: async () => null }, aiKnowledgeActionPolicy: { findUnique: async ({ where }) => {
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
