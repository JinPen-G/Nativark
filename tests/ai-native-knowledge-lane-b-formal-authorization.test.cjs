'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { FormalKnowledgeAuthorizationAdapter, FormalMemoryAuthorizationAdapter } = h.load('formal-knowledge-authorization.adapter');
const { PrismaKnowledgeActionPolicySource } = h.load('prisma-knowledge-policy.source');
const { randomUUID } = require('node:crypto');
const { KNOWLEDGE_POLICY_MANAGEMENT } = h.load('knowledge-policy-management.composition');
const { AI_KNOWLEDGE_POLICY_MANAGEMENT_VERSION: managementVersion } = require('../packages/shared/src/ai-knowledge-policy-management-draft');

function managementFixture(fileApplication = false) {
  const f = fixture(), { db } = f, { state } = db, clone = value => structuredClone(value);
  const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
  const actor = user({ id: 'user-1', tenantId: 'tenant-1', permissions: ['system:params:manage', 'synthetic-policy'] });
  const flags = { active: true, now: fileApplication ? Date.now() : h.now, lostCommit: false, lostPrepare: false, rejectCommit: false, lostClaim: false, loseTargetReply: false, writes: 0 };
  const auth = new AuthService({ getAuthSession: async () => flags.active ? { id: 'policy-session', userId: actor.id, audience: 'operator', currentWorkspaceId: 'space-1' } : undefined,
    findUserById: async () => actor, findWorkspaceScopedUser: async () => actor, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-policy-test-secret' : undefined });
  const request = { audience: 'operator', requestId: 'policy-request', authorization: `Bearer ${auth.signAccessToken({ sub: actor.id, tid: actor.tenantId, sid: 'policy-session', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 })}` };
  const credentials = { current: async () => clone(request) }, guard = new ApiAuthGuard(auth);
  for (const name of ['policyAuthorities', 'policyPreparations', 'policyOperations', 'actionPolicies', 'policyTargets', 'assets', 'uploads']) state[name] = new Map();
  const match = (row, where) => Object.entries(where).every(([key, value]) => value instanceof Date ? row[key]?.getTime() === value.getTime() : row[key] === value);
  const delegate = name => {
    const api = {
      async findFirst({ where, orderBy, include }) { const rows = [...state[name].values()].filter(row => match(row, where));
        if (orderBy?.resultRevision === 'desc') rows.sort((a, b) => b.resultRevision - a.resultRevision);
        const row = clone(rows[0] ?? null);
        if (row && include?.uploadSession) row.uploadSession = clone([...state.uploads.values()].find(session => session.fileAssetId === row.id) ?? null);
        return row; },
      async findUniqueOrThrow({ where }) { const row = await api.findFirst({ where }); if (!row) throw Error('missing'); return row; },
      async findUnique({ where }) { return api.findFirst({ where: where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey ?? where }); },
      async create({ data }) {
        const plain = { ...data, beforeJson: data.beforeJson === require('../apps/api/node_modules/@prisma/client').Prisma.JsonNull ? null : data.beforeJson };
        const key = name === 'actionPolicies' ? JSON.stringify([data.tenantId,data.workspaceId,data.actorKind,data.actorId,data.audience,data.domain,data.action,data.resourceKey]) : data.id;
        if (state[name].has(key)) throw Error('duplicate');
        if (name === 'policyTargets' && [...state[name].values()].some(row => row.documentId === data.documentId || row.operationKey === data.operationKey && row.managerId === data.managerId)) throw Error('duplicate target');
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
  db.aiKnowledgePolicyPreparationTarget = delegate('policyTargets'); db.fileAsset = delegate('assets'); db.fileUploadSession = delegate('uploads');
  db.aiKnowledgeDocument.findUnique = ({ where }) => db.aiKnowledgeDocument.findFirst({ where });
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
      if (flags.loseTargetReply) { flags.loseTargetReply = false; throw Error('target reply lost'); }
      if (flags.lostCommit && state.policyOperations.size > oldOps) { flags.lostCommit = false; throw Error('commit reply lost'); }
      if (flags.lostPrepare && state.policyPreparations.size > oldPrep) { flags.lostPrepare = false; throw Error('prepare reply lost'); }
      return result;
    }); queue = next.catch(() => {}); return next;
  };
  const deps = { db, policyDb: db, auth, credentials, clock: { now: () => flags.now }, memory: { db },
    policyManagement: { enabled: true, guard }, fileRuntime: { assertKnowledgeBinding: async () => { throw Error('no file binding'); }, readKnowledgeBytes: async () => { throw Error('no file read'); } } };
  const text = Buffer.from('Synthetic first document with trusted policy production.');
  if (fileApplication) {
    const config = { id: 'file-config', capability: 'file', provider: 's3_compatible', settings: { endpoint: 'https://objects.example.test', bucket: 'synthetic-bucket', region: 'us-east-1', forcePathStyle: true },
      credentials: { accessKeyId: 'synthetic-access', secretAccessKey: 'synthetic-secret' } };
    deps.integrations = { runtimeConfig: async () => clone(config), assertEnabledInTransaction: async () => {} };
    deps.objectIO = { egress: async url => url, transport: async () => new Response(text, { headers: { 'content-type': 'text/plain', 'content-length': String(text.length) } }) };
  }
  const module = fileApplication ? h.load('human-knowledge.module').HumanKnowledgeModule.registerFiles(deps)
    : h.load('human-knowledge.module').HumanKnowledgeModule.registerFormal(deps);
  const manage = module.providers.find(p => p.provide === KNOWLEDGE_POLICY_MANAGEMENT).useValue;
  const service = Type => module.providers.find(p => p.provide === Type).useValue;
  function authority(action, resource = {}, domain = 'knowledge', overrides = {}) {
    const row = { id: randomUUID(), tenantId: 'tenant-1', workspaceId: 'space-1', managerId: actor.id, revision: 1, enabled: true,
      basisRef: 'explicit-offline-admin-delegation', basisVersion: managementVersion, targetActorId: actor.id, targetAudience: 'operator', domain, action,
      resource: clone(resource), resourceKey: h.load('knowledge-validation').fingerprint(resource), requiredPermissions: ['system:params:manage'],
      allowedPermissions: ['synthetic-policy'], allowedOperations: ['create_disabled','update_disabled','enable','disable'], maxPolicySeconds: 86400,
      expiresAt: new Date(flags.now + 86400000), ...overrides };
    state.policyAuthorities.set(row.id, row); return row;
  }
  let sequence = 0;
  const command = (root, action = 'create_disabled', expectedRevision = 0) => ({ version: managementVersion, authorityId: root.id,
    operationKey: `policy-${++sequence}`, expectedRevision, action, requiredPermissions: ['synthetic-policy'], expiresAt: new Date(flags.now + 3600000).toISOString() });
  async function apply(value) { const prepared = await manage.prepare(request, value); assert.equal(prepared.state, 'prepared');
    const result = await manage.commit(request, { preparationId: prepared.preparationId, changeHash: prepared.changeHash, confirm: 'apply_knowledge_policy_change' });
    assert.equal(result.state, 'observed'); return { prepared, result }; }
  async function enable(root) { const created = await apply(command(root)); assert.equal(created.result.result.enabled, false);
    assert.equal([...state.actionPolicies.values()].filter(row => row.resourceKey === root.resourceKey && row.action === root.action && row.domain === root.domain)[0].enabled, false);
    return apply(command(root, 'enable', 1)); }
  return { ...f, deps, db, state, flags, actor, auth, request, manage, service, authority, command, apply, enable, text };
}

test('HTTP policy consumer uses current auth, exact targets and safe root refusal without default registration', async () => {
  const { KnowledgePolicyManagementController } = h.load('knowledge-policy-management.controller');
  const { KnowledgePolicyManagementHttpModule } = h.load('knowledge-policy-management-http.module');
  const f = managementFixture(), controller = new KnowledgePolicyManagementController(f.manage);
  const { ApiAuthGuard, requiredPermissions, UNMATCHED_ROUTE_PERMISSION } = require('../apps/api/src/common/api-auth.guard');
  const { isStaffBusinessRouteAllowed } = require('../apps/api/src/common/staff-api-policy');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { AI_KNOWLEDGE_POLICY_HTTP_DRAFT, AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT } = require('../packages/shared/src');
  const guard = new ApiAuthGuard(f.auth);
  const enter = (path, authorization = f.request.authorization) => runWithRequestIdentity({}, () => guard.canActivate({
    switchToHttp: () => ({ getRequest: () => ({ method: 'POST', url: `/api${path}`, headers: { authorization } }) }) }));
  for (const { basePath, method, ...operations } of [AI_KNOWLEDGE_POLICY_HTTP_DRAFT, AI_KNOWLEDGE_MANAGEMENT_HTTP_DRAFT]) {
    for (const operation of Object.values(operations)) {
      const path = `/${basePath}/${operation}`;
      assert.deepEqual(requiredPermissions(method, path), ['system:params:manage']);
      assert.deepEqual(requiredPermissions('GET', path), [UNMATCHED_ROUTE_PERMISSION]);
      assert.equal(isStaffBusinessRouteAllowed(method, path), false);
      assert.equal(await enter(path), true);
    }
    assert.deepEqual(requiredPermissions(method, `/${basePath}/execute`), [UNMATCHED_ROUTE_PERMISSION]);
  }
  const entry = `/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT.prepareTarget}`;
  await assert.rejects(enter(entry, ''));
  f.actor.permissions = ['synthetic-policy'];
  await assert.rejects(enter(entry));
  f.actor.permissions = ['system:params:manage', 'synthetic-policy'];
  const request = { headers: { authorization: f.request.authorization }, requestId: 'caller-request' };
  const spec = { version: 'knowledge-prepared-target-1', operationKey: 'http-target',
    upload: { documentId: 'http-doc', fileName: 'http.txt', mimeType: 'text/plain', sizeBytes: 12 },
    document: { documentVersion: 'http-v1', operationId: 'http-create', title: 'Synthetic HTTP document', validFrom: new Date(f.flags.now).toISOString() },
    expiresAt: new Date(f.flags.now + 3600000).toISOString().replace('Z', '+00:00') };
  const root = f.authority('upload', h.load('knowledge-policy-management.validation').preparedUploadResource(spec), 'knowledge',
    { preparationTarget: spec, allowedOperations: ['prepare_target','bind_target'] });
  const absent = await controller.target(request, { authorityId: root.id, operationKey: spec.operationKey });
  assert.equal(absent.state, 'not_observed');
  const prepared = await controller.prepareTarget(request, { authorityId: root.id });
  assert.equal(prepared.state, 'prepared');
  const { validateKnowledgeTargetResponse } = h.load('knowledge-target-http.contract');
  const current = await controller.read(request, { authorityId: root.id });
  for (const [action, result, command, corrupt, code] of [
    ['target', prepared, { authorityId: root.id, operationKey: spec.operationKey }, value => { value.specification.operationKey = 'other'; }, 'unavailable'],
    ['prepareTarget', prepared, { authorityId: root.id }, value => { value.attachmentId = 'not-yet-bound'; }, 'result_unknown'],
    ['target', prepared, { authorityId: root.id, operationKey: spec.operationKey }, value => { value.expiresAt = new Date(Date.parse(value.expiresAt) + 1).toISOString(); }, 'unavailable'],
    ['target', prepared, { authorityId: root.id, operationKey: spec.operationKey }, value => { value.revision = 2; }, 'unavailable'],
    ['read', current, { authorityId: root.id }, value => { value.resource.upload.storageKey = 'must-not-leak'; }, 'unavailable'],
    ['read', current, { authorityId: root.id }, value => { value.target.resourceKey = 'f'.repeat(64); }, 'unavailable']
  ]) {
    const invalid = structuredClone(result); corrupt(invalid);
    assert.throws(() => validateKnowledgeTargetResponse(action, invalid, command), error => error.code === code);
  }
  const bad = new KnowledgePolicyManagementController({ ...f.manage, bindTarget: async () => ({ ...prepared, unexpected: true }) });
  await assert.rejects(bad.bindTarget(request, { authorityId: root.id, operationKey: spec.operationKey, sessionId: 'session', expectedRevision: 1, confirm: 'bind_knowledge_upload' }),
    error => error.getStatus() === 409 && error.getResponse().nextAction === 'read_original_policy_target');
  const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
  const contracts = require('../packages/shared/src').AI_KNOWLEDGE_TARGET_HTTP_CONTRACTS;
  for (const [action, contract] of Object.entries(contracts)) {
    const operation = OPENAPI_DOCUMENT.paths[`/api/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT.basePath}/${AI_KNOWLEDGE_POLICY_HTTP_DRAFT[action]}`].post;
    assert.equal(operation.responses['200'].content['application/json'].schema.properties.data.$ref, `#/components/schemas/${contract.response}`);
  }
  assert.equal((await controller.read(request, { authorityId: root.id })).state, 'not_configured');
  assert.equal((await controller.target(request, { authorityId: root.id, operationKey: spec.operationKey })).targetId, prepared.targetId);
  const owner = { actorKind: 'user', actorId: f.actor.id };
  for (const [action, resource, domain] of [
    ['search', {}, 'knowledge'], ['read', { owner }, 'memory'],
    ['read', { memoryId: 'reserved-memory', revision: 1, aclRevision: 1, owner }, 'memory']
  ]) {
    const authority = f.authority(action, resource, domain);
    await f.enable(authority);
    const configured = await controller.read(request, { authorityId: authority.id });
    assert.equal(configured.state, 'configured'); assert.equal(configured.result.enabled, true);
    assert.deepEqual(configured.resource, resource);
    const invalid = structuredClone(configured); invalid.result = null;
    assert.throws(() => validateKnowledgeTargetResponse('read', invalid, { authorityId: authority.id }), { code: 'unavailable' });
  }
  await assert.rejects(controller.prepareTarget(request, { authorityId: randomUUID() }), error => {
    assert.deepEqual(error.getResponse(), { code: 'AI_RESOURCE_UNAVAILABLE', retryable: false }); return error.getStatus() === 503;
  });
  await assert.rejects(controller.prepareTarget(request, { authorityId: root.id, actor: 'self-authorized' }), error => error.getResponse().code === 'AI_INVALID_INPUT');
  f.flags.active = false;
  await assert.rejects(controller.target(request, { authorityId: root.id, operationKey: spec.operationKey }), error => error.getResponse().code === 'AI_RESOURCE_UNAVAILABLE');
  assert.deepEqual(KnowledgePolicyManagementHttpModule.registerHttp({ enabled: false }).controllers, []);
  assert.throws(() => KnowledgePolicyManagementHttpModule.registerHttp({ enabled: true }), { code: 'unavailable' });
  assert.equal(KnowledgePolicyManagementHttpModule.registerHttp({ enabled: true, application: f.manage }).controllers[0], KnowledgePolicyManagementController);
});

test('prepared first document produces exact policies and request-bound management lifecycle', async t => {
  const f = managementFixture(true), { preparedUploadResource } = h.load('knowledge-policy-management.validation');
  const { HumanKnowledgeModule } = h.load('human-knowledge.module');
  const { HumanKnowledgeManagementRequestFactory } = h.load('human-knowledge-management.composition');
  const { HumanKnowledgeManagementController } = h.load('human-knowledge-management.controller');
  const { AI_KNOWLEDGE_MANAGEMENT_HTTP_SCHEMAS: schemas } = require('../packages/shared/src/ai-knowledge-management-http-draft');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(schemas, {});
  for (const [name, schema] of Object.entries(schemas)) assert.doesNotThrow(() => aiLeafToOpenApi30(schema, name));
  assert.equal(aiLeafToOpenApi30(schemas.AiKnowledgeManagementBeginUploadResponseDraft).properties.uploadHeaders.maxProperties, 32);
  assert.throws(() => aiLeafToOpenApi30({ type: 'object', maxProperties: -1 }), /non-negative safe integer/);
  const valid = (name, value) => { assert.equal(validators[name](value), true, JSON.stringify(validators[name].errors)); return value; };
  assert.deepEqual(HumanKnowledgeModule.registerManagementHttp().controllers, []);
  assert.throws(() => HumanKnowledgeModule.registerManagementHttp({ enabled: true }), { code: 'unavailable' });
  assert.throws(() => HumanKnowledgeModule.registerManagementHttp({ enabled: true, dependencies: { ...f.deps, db: undefined } }), { code: 'unavailable' });
  const module = HumanKnowledgeModule.registerManagementHttp({ enabled: true, dependencies: f.deps });
  assert.deepEqual(module.controllers, [HumanKnowledgeManagementController]);
  const requests = module.providers.find(p => p.provide === HumanKnowledgeManagementRequestFactory).useValue;
  const http = new HumanKnowledgeManagementController(requests), request = { headers: { authorization: f.request.authorization } };
  const command = async (action, value, extra = {}) => {
    const result = await http[action](request, { confirmation: action, command: value, ...extra });
    return valid('AiKnowledgeManagementCommandResponseDraft', result).document;
  };
  const receipt = async operationId => valid('AiKnowledgeManagementOperationResponseDraft',
    await http.operationStatus(request, { documentId: 'first-doc', operationId }));
  const errorCode = code => error => valid('AiKnowledgeManagementHttpErrorDraft', error.getResponse()).code === code;
  let last;
  const open = requests.open.bind(requests);
  t.mock.method(requests, 'open', value => { last = open(value); return last; });
  let reads = 0;
  const transport = f.deps.objectIO.transport;
  f.deps.objectIO.transport = (...args) => { reads++; return transport(...args); };
  const { FileStorageRuntimeService } = require('../apps/api/src/modules/integrations/file-storage.runtime.service');
  t.mock.method(FileStorageRuntimeService.prototype, 'objectExists', async () => {
    assert.fail('knowledge completion must use its bounded content read, not an ambient HEAD');
  });
  const spec = { version: 'knowledge-prepared-target-1', operationKey: 'first-target',
    upload: { documentId: 'first-doc', fileName: 'first.txt', mimeType: 'text/plain', sizeBytes: f.text.length },
    document: { documentVersion: 'first-v1', operationId: 'first-create', title: 'First real document', validFrom: new Date(f.flags.now).toISOString() },
    expiresAt: new Date(f.flags.now + 7200000).toISOString() };
  const publication = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(
    require('../packages/shared/src/ai-entry-management-draft-schemas').AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS, {});
  assert.equal(publication.AiKnowledgePreparationTargetSpecDraft(spec), true);
  assert.equal(publication.AiKnowledgePreparationTargetSpecDraft({ ...spec, upload: { ...spec.upload, storageKey: 'caller-key' } }), false);
  const root = f.authority('upload', preparedUploadResource(spec), 'knowledge', { preparationTarget: spec,
    allowedOperations: ['prepare_target','bind_target','create_disabled','update_disabled','enable','disable'] });
  const uploads = f.service(h.load('human-knowledge-upload.service').HumanKnowledgeUploadService);
  const documents = f.service(h.load('human-knowledge.service').HumanKnowledgeService);
  await assert.rejects(f.manage.prepare(f.request, f.command(root)));
  await assert.rejects(f.manage.prepareTarget(f.request, { authorityId: root.id, targetActorId: 'other' }), { code: 'invalid_input' });
  const target = await f.manage.prepareTarget(f.request, { authorityId: root.id });
  assert.equal(target.state, 'prepared'); assert.equal(f.state.documents.size, 0); assert.equal(f.state.actionPolicies.size, 0);
  assert.equal((await f.manage.prepareTarget(f.request, { authorityId: root.id })).targetId, target.targetId);
  const dormant = await f.apply(f.command(root)); assert.equal(dormant.result.result.enabled, false);
  await assert.rejects(uploads.begin(spec.upload)); assert.equal(f.state.assets.size, 0);
  await f.apply(f.command(root, 'enable', 1));
  await assert.rejects(uploads.begin({ ...spec.upload, sizeBytes: spec.upload.sizeBytes + 1 }));
  const started = valid('AiKnowledgeManagementBeginUploadResponseDraft', await http.beginUpload(request, spec.upload));
  assert.equal(started.semantics, 'upload_intent_not_document');
  assert.equal(f.state.uploads.size, 1); assert.equal(f.state.assets.size, 1);
  const docResource = { documentId: spec.upload.documentId, documentVersion: spec.document.documentVersion, attachmentId: started.fileAssetId, aclRevision: 1 };
  const createRoot = f.authority('create', docResource, 'knowledge', { preparationTarget: spec });
  await assert.rejects(f.manage.prepare(f.request, f.command(createRoot)));
  const policyHttp = new (h.load('knowledge-policy-management.controller').KnowledgePolicyManagementController)(f.manage);
  const binding = { authorityId: root.id, operationKey: spec.operationKey, sessionId: started.sessionId, expectedRevision: 1, confirm: 'bind_knowledge_upload' };
  await assert.rejects(f.manage.bindTarget(f.request, binding)); assert.equal([...f.state.policyTargets.values()][0].revision, 1);
  const completed = valid('AiKnowledgeManagementCompleteUploadResponseDraft', await http.completeUpload(request,
    { documentId: spec.upload.documentId, sessionId: started.sessionId }));
  assert.equal(completed.attachmentId, started.fileAssetId);
  assert.equal(reads, 1);
  const asset = f.state.assets.get(completed.attachmentId), originalWorkspace = asset.metadata.workspaceId;
  assert.equal(asset.metadata.knowledgeContentHash, require('node:crypto').createHash('sha256').update(f.text).digest('hex'));
  asset.metadata.workspaceId = 'foreign-space'; await assert.rejects(f.manage.bindTarget(f.request, binding)); asset.metadata.workspaceId = originalWorkspace;
  f.flags.loseTargetReply = true;
  assert.equal((await policyHttp.bindTarget(request, binding)).state, 'unknown');
  const writes = f.flags.writes, bound = await policyHttp.target(request, { authorityId: root.id, operationKey: spec.operationKey });
  assert.equal(bound.state, 'bound'); assert.equal(bound.attachmentId, completed.attachmentId);
  assert.equal((await f.manage.bindTarget(f.request, binding)).state, 'bound'); assert.equal(f.flags.writes, writes);
  await assert.rejects(f.manage.bindTarget(f.request, { ...binding, operationKey: 'other-target' }), { code: 'conflict' });
  assert.equal(f.flags.writes, writes);
  await assert.rejects(f.manage.bindTarget(f.request, { ...binding, sessionId: 'replacement-session' }));
  const badExisting = f.authority('publish', docResource);
  await assert.rejects(f.manage.prepare(f.request, f.command(badExisting))); assert.equal(f.state.documents.size, 0);
  await f.enable(createRoot);
  await f.enable(f.authority('create', { attachmentId: completed.attachmentId }, 'knowledge', { preparationTarget: spec }));
  await f.enable(f.authority('create', {}, 'knowledge', { preparationTarget: spec }));
  const draft = { documentId: spec.upload.documentId, ...spec.document, attachmentId: completed.attachmentId };
  await assert.rejects(documents.create({ ...draft, documentVersion: 'unlimited-next' }));
  await assert.rejects(documents.create({ ...draft, operationId: 'replacement-key' }));
  await assert.rejects(documents.create({ ...draft, title: 'different-reviewed-content' }));
  assert.equal(f.state.documents.size, 0);
  await assert.rejects(http.prepareCreate(request, { ...draft, actor: 'caller' }), errorCode('AI_INVALID_INPUT'));
  await assert.rejects(http.create(request, { confirmation: 'publish', command: draft }), errorCode('AI_INVALID_INPUT'));
  assert.equal(valid('AiKnowledgeManagementPrepareResponseDraft', await http.prepareCreate(request, draft)).status, 'ready_to_create');
  assert.equal((await command('create', draft)).revision, 1);
  assert.equal((await command('create', draft)).revision, 1); assert.equal(f.state.documents.size, 1);
  await assert.rejects(last.operationStatus({ documentId: 'first-doc', operationId: 'first-create' }), { code: 'unavailable' });
  await assert.rejects(uploads.begin(spec.upload));
  const roots = [];
  for (const action of ['read_metadata','parse','read_body','index','publish','search','resolve_source','snippet']) for (const resource of [{}, docResource]) {
    const next = f.authority(action, resource); roots.push(next); await f.enable(next);
  }
  const parseInput = { documentId: spec.upload.documentId, expectedRevision: 1, operationId: 'first-parse' };
  assert.equal(reads, 1);
  const transaction = f.db.$transaction;
  let loseParseReply = true;
  const lostReply = t.mock.method(f.db, '$transaction', async (...args) => {
    const result = await transaction(...args);
    if (loseParseReply && [...f.state.operations.values()].some(row => row.operationId === 'first-parse:parse-result')) {
      loseParseReply = false; throw Error('synthetic committed parse reply lost');
    }
    return result;
  });
  await assert.rejects(command('parse', parseInput), errorCode('AI_RESULT_UNKNOWN'));
  lostReply.mock.restore();
  assert.equal(reads, 2);
  const operationCount = f.state.operations.size, readsBeforeReconcile = reads;
  const parsed = valid('AiKnowledgeManagementCommandResponseDraft', await http.reconcileParse(request, parseInput)).document;
  assert.equal(parsed.parsing, 'parsed'); assert.equal(reads, readsBeforeReconcile); assert.equal(f.state.operations.size, operationCount);
  assert.equal((await receipt('first-parse')).receipt, 'recorded');
  await assert.rejects(http.reconcileParse(request, { ...parseInput, expectedRevision: 2 }), errorCode('AI_REVISION_CONFLICT'));
  const indexing = f.service(h.load('human-knowledge-index.service').HumanKnowledgeIndexService);
  const queued = await indexing.request({ documentId: spec.upload.documentId, expectedRevision: parsed.revision, operationId: 'first-index', kind: 'upsert' });
  const indexed = await indexing.resume({ documentId: spec.upload.documentId, operationId: queued.indexJob.operationId, generation: queued.indexJob.generation });
  const publishInput = { documentId: spec.upload.documentId, expectedRevision: indexed.revision, operationId: 'first-publish' };
  const publishPolicy = roots.find(row => row.action === 'publish' && row.resource.documentId);
  publishPolicy.enabled = false;
  await assert.rejects(command('publish', publishInput), errorCode('AI_RESOURCE_UNAVAILABLE'));
  assert.equal((await receipt('first-publish')).receipt, 'not_recorded');
  publishPolicy.enabled = true;
  const published = await command('publish', publishInput);
  assert.equal(published.publication, 'published'); assert.equal(published.body, 'not_included');
  assert.equal((await documents.read(spec.upload.documentId)).publication, 'published');
  const inputs = f.service(h.load('human-knowledge-input.service').HumanKnowledgeInputService);
  const material = await inputs.collect({ requestId: 'first-consumer', query: 'Synthetic', maxSources: 3, maxSnippetChars: 1000, maxTotalBytes: 8192 });
  assert.equal(material.status, 'ready'); assert.equal(material.sources.length, 1);
  await f.apply(f.command(roots.find(row => row.action === 'search' && row.resource.documentId), 'disable', 2));
  await assert.rejects(inputs.revalidate(material));
  for (const resource of [{}, docResource]) await f.enable(f.authority('withdraw', resource));
  const oldSource = structuredClone(material.sources[0].source);
  assert.equal((await inputs.openSource(oldSource)).text, f.text.toString('utf8'));
  const withdrawn = await command('withdraw', { documentId: 'first-doc', expectedRevision: published.revision, operationId: 'first-withdraw' });
  assert.equal(withdrawn.indexJob.kind, 'remove'); assert.equal(withdrawn.indexJob.status, 'pending');
  await assert.rejects(inputs.openSource(oldSource));

  // Revision and tombstone policies use the existing explicit server-provisioned path, not caller grants.
  const revision = { documentVersion: 'first-v1', expectedRevision: withdrawn.revision, aclRevision: 1, targetVersion: 'first-v2' };
  const nextAsset = { ...structuredClone(asset), id: 'next-attachment', metadata: { ...asset.metadata, knowledgeRevision: revision } };
  f.state.assets.set(nextAsset.id, nextAsset);
  const nextUpload = { ...structuredClone(f.state.uploads.get(started.sessionId)), id: 'next-upload', fileAssetId: nextAsset.id,
    idempotencyKey: h.load('human-knowledge-upload.service').knowledgeUploadKey('first-doc', 'first-v2') };
  f.state.uploads.set(nextUpload.id, nextUpload);
  const nextResource = { ...docResource, documentVersion: 'first-v2', attachmentId: nextAsset.id };
  const provision = async (action, resource) => f.db.aiKnowledgeActionPolicy.create({ data: { id: randomUUID(),
    tenantId: 'tenant-1', workspaceId: 'space-1', actorKind: 'user', actorId: 'user-1', audience: 'operator', domain: 'knowledge',
    action, resource, resourceKey: h.load('knowledge-validation').fingerprint(resource), enabled: true, revision: 1,
    expiresAt: new Date(f.flags.now + 3600000), requiredPermissions: ['synthetic-policy'] } });
  for (const resource of [{}, docResource, { ...docResource, attachmentId: nextAsset.id }, nextResource]) await provision('revise', resource);
  await provision('read_metadata', nextResource);
  for (const resource of [{}, nextResource]) await provision('delete', resource);
  const nextDraft = { ...draft, documentVersion: 'first-v2', attachmentId: nextAsset.id, operationId: 'first-revise' };
  const revised = await command('revise', nextDraft, { expectedRevision: withdrawn.revision });
  assert.equal(revised.documentVersion, 'first-v2'); assert.equal(revised.parsing, 'pending');
  assert.equal((await receipt('first-parse')).document.documentVersion, 'first-v2');
  await assert.rejects(inputs.openSource(oldSource));
  const preserved = { assets: f.state.assets.size, chunks: f.state.chunks.size };
  f.db.responseError = Error('synthetic committed deletion reply lost');
  await assert.rejects(command('delete', { documentId: 'first-doc', expectedRevision: revised.revision, operationId: 'first-delete' }), errorCode('AI_RESULT_UNKNOWN'));
  f.db.responseError = null;
  const operationsBeforeRead = f.state.operations.size, readsBeforeDeletionReceipt = reads;
  const deleted = await receipt('first-delete');
  assert.equal(deleted.receipt, 'recorded'); assert.equal(deleted.document.publication, 'deleted');
  assert.equal(deleted.document.indexJob.status, 'pending'); assert.equal(deleted.document.physicalIndexDeletion, 'not_verified');
  assert.equal(f.state.operations.size, operationsBeforeRead); assert.equal(reads, readsBeforeDeletionReceipt);
  assert.deepEqual({ assets: f.state.assets.size, chunks: f.state.chunks.size }, preserved);
  const findOperation = f.db.aiKnowledgeOperation.findFirst;
  const revoked = t.mock.method(f.db.aiKnowledgeOperation, 'findFirst', async (...args) => {
    const result = await findOperation(...args); f.actor.permissions = ['system:params:manage']; return result;
  });
  await assert.rejects(receipt('first-delete'), errorCode('AI_RESOURCE_UNAVAILABLE'));
  revoked.mock.restore(); f.actor.permissions.push('synthetic-policy');
  await assert.rejects(last.operationStatus({ documentId: 'first-doc', operationId: 'first-delete' }), { code: 'unavailable' });
  f.flags.active = false;
  await assert.rejects(receipt('first-delete'), errorCode('AI_RESOURCE_UNAVAILABLE'));
  f.flags.active = true;
  root.enabled = false; await assert.rejects(documents.create(draft)); root.enabled = true;
  f.flags.now += 7200001; await assert.rejects(documents.create(draft));
  assert.deepEqual(h.attempts, []);
});

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
  const published = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(
    require('../packages/shared/src/ai-entry-management-draft-schemas').AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS, {});
  const { lifecycle, ...domainReceipt } = result;
  assert.equal(published.AiKnowledgePolicyManagementReceiptDraft(domainReceipt), true,
    JSON.stringify(published.AiKnowledgePolicyManagementReceiptDraft.errors));
  assert.equal(published.AiKnowledgePolicyManagementReceiptDraft({ ...domainReceipt, executionPermission: true }), false);
  const http = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(
    require('../packages/shared/src/ai-knowledge-policy-management-draft').AI_KNOWLEDGE_POLICY_MANAGEMENT_HTTP_SCHEMAS, {});
  assert.equal(http.AiKnowledgePolicyHttpReceiptDraft(result), true, JSON.stringify(http.AiKnowledgePolicyHttpReceiptDraft.errors));
  assert.equal(http.AiKnowledgePolicyHttpReceiptDraft({ ...result, executionPermission: true }), false);
  assert.deepEqual(lifecycle, { state: 'not_applicable', semantics: 'target_review_not_execution_permission' });
  const components = require('../apps/api/src/contracts/ai-leaf-components').AI_LEAF_COMPONENT_SCHEMAS;
  assert.ok(components.AiKnowledgePolicyHttpReceiptDraft);
  assert.ok(components.AiKnowledgeLifecycleTargetDraft);
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
