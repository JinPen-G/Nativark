'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { fixture, h } = require('./fixtures/ai-native/lane-b-functional.cjs');
const { HumanKnowledgeService } = h.load('human-knowledge.service');
const { KnowledgeError } = h.load('knowledge-errors');
test.after(() => assert.deepEqual(h.attempts, []));
test('declared parser capability and rejected input correct through a new immutable version', async () => {
  const { ports, f, db } = fixture();
  let unsupported = true;
  const api = new HumanKnowledgeService({ ...ports, files: { ...f.files, read: async (...args) => unsupported
    ? { mediaType: 'application/pdf', bytes: new Uint8Array([65]) } : f.files.read(...args) } });
  assert.deepEqual(api.parserCapabilities().mediaTypes, ['text/plain', 'text/markdown']);
  assert.equal(api.parserCapabilities().maxBytes, 262144);
  await api.create(h.draft());
  const failed = await api.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' });
  assert.equal(failed.failure, 'unsupported');
  assert.equal((await api.versionStatus('doc-1')).parseRecovery, 'revise_new_version');
  f.rule = (_ctx, request) => request.attachmentId !== 'denied-file';
  await assert.rejects(api.revise(3, h.draft({ documentVersion: 'v2', operationId: 'revise-1', attachmentId: 'denied-file' })), { code: 'unavailable' });
  await api.revise(3, h.draft({ documentVersion: 'v2', operationId: 'revise-2' }));
  const status = await api.versionStatus('doc-1');
  assert.equal(status.currentVersion, 'v2'); assert.equal(status.pendingParseVersion, 'v2');
  assert.equal(status.indexedPublishedVersion, null); assert.equal(status.historicalVersions, 'unavailable');
  assert.equal(db.state.versions.size, 2);
  unsupported = false;
  assert.equal((await api.parse({ documentId: 'doc-1', expectedRevision: 4, operationId: 'parse-2' })).parsing, 'parsed');
  assert.equal((await api.detail('doc-1')).nextStepAuthorization, 'authorized');
  f.rule = (_context, request) => request.action !== 'index';
  assert.equal((await api.detail('doc-1')).nextStepAuthorization, 'unavailable');
});
test('unknown parsing must be reconciled instead of overwritten by a new version', async () => {
  const { ports } = fixture();
  const api = new HumanKnowledgeService({ ...ports, files: { read: async () => { throw new KnowledgeError('unavailable'); } } });
  await api.create(h.draft());
  await assert.rejects(api.parse({ documentId: 'doc-1', expectedRevision: 1, operationId: 'parse-1' }), { code: 'unavailable' });
  await assert.rejects(api.revise(2, h.draft({ documentVersion: 'v2', operationId: 'revise-1' })), { code: 'result_unknown' });
  assert.equal((await api.versionStatus('doc-1')).currentVersion, 'v1');
});

test('managed successor and tombstone grants bind reviewed commands and original receipts', async t => {
  const { ports, db } = fixture(), { state } = db, { randomUUID } = require('node:crypto');
  const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const { HumanKnowledgePolicyManagementService } = h.load('human-knowledge-policy-management.service');
  const { PrismaKnowledgeActionPolicySource } = h.load('prisma-knowledge-policy.source');
  const { FormalKnowledgeAuthorizationAdapter } = h.load('formal-knowledge-authorization.adapter');
  const { fingerprint } = h.load('knowledge-validation');
  const { knowledgeUploadKey } = h.load('human-knowledge-upload.service');
  const version = 'knowledge-policy-management-1', expiresAt = new Date(h.now + 3600000).toISOString();
  const actor = user({ id: 'user-1', tenantId: 'tenant-1', permissions: ['system:params:manage', 'synthetic-policy'] });
  const auth = new AuthService({ getAuthSession: async () => ({ id: 'lifecycle-session', userId: actor.id, audience: 'operator', currentWorkspaceId: 'space-1' }),
    findUserById: async () => actor, findWorkspaceScopedUser: async () => actor, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-lifecycle-secret' : undefined });
  const token = auth.signAccessToken({ sub: actor.id, tid: actor.tenantId, sid: 'lifecycle-session', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 });
  const credentials = { current: async () => ({ authorization: `Bearer ${token}`, audience: 'operator', requestId: 'lifecycle-request' }) };
  const clock = () => new Date(h.now), match = (row, where) => Object.entries(where).every(([key, value]) => row[key] === value);
  const delegate = name => {
    state[name] = new Map();
    const api = {
      findFirst: async ({ where, orderBy }) => {
        const rows = [...state[name].values()].filter(row => match(row, where));
        if (orderBy?.resultRevision === 'desc') rows.sort((a, b) => b.resultRevision - a.resultRevision);
        return structuredClone(rows[0] ?? null);
      },
      findUnique: async ({ where }) => api.findFirst({ where: where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey ?? where }),
      create: async ({ data }) => {
        const row = { id: randomUUID(), createdAt: clock(), ...data };
        if (row.beforeJson === Prisma.JsonNull) row.beforeJson = null;
        state[name].set(row.id, structuredClone(row)); return structuredClone(row);
      },
      updateMany: async ({ where, data }) => {
        let count = 0;
        for (const row of state[name].values()) if (match(row, where)) {
          if (data.commitSlot && [...state[name].values()].some(other => other !== row && other.commitSlot === data.commitSlot)) throw Error('duplicate slot');
          Object.assign(row, structuredClone(data)); count++;
        }
        return { count };
      },
    }; return api;
  };
  db.aiKnowledgeActionPolicy = delegate('policies'); db.aiKnowledgePolicyManagementAuthority = delegate('authorities');
  db.aiKnowledgePolicyPreparation = delegate('preparations'); db.aiKnowledgePolicyManagementOperation = delegate('policyOperations');
  db.fileAsset = delegate('assets'); db.fileUploadSession = delegate('uploads');
  db.businessWorkspace = { findFirst: async () => ({ id: 'space-1', tenantId: 'tenant-1', status: 'ACTIVE' }) };
  db.user = { findFirst: async () => structuredClone(actor) };
  db.workspaceMember = { findFirst: async ({ where }) => ({ ...where, isActive: true }) };
  db.aiKnowledgeAcl = { findFirst: async () => null }; db.$queryRaw = async () => [];
  const { createKnowledgePolicyManagementFactory } = h.load('knowledge-policy-management.composition');
  const { KnowledgePolicyManagementController } = h.load('knowledge-policy-management.controller');
  const { AI_KNOWLEDGE_POLICY_MANAGEMENT_HTTP_SCHEMAS: schemas } = require('../packages/shared/src/ai-knowledge-policy-management-draft');
  const { AI_ENTRY_MANAGEMENT_DRAFT_SCHEMAS: requestSchemas } = require('../packages/shared/src/ai-entry-management-draft-schemas');
  const { aiLeafToOpenApi30 } = require('../apps/api/src/contracts/ai-leaf-openapi');
  const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor({ ...requestSchemas, ...schemas }, {});
  for (const [name, schema] of Object.entries(schemas)) assert.doesNotThrow(() => aiLeafToOpenApi30(schema, name));
  const valid = (name, value) => { assert.equal(validators[name](value), true, JSON.stringify(validators[name].errors)); return value; };
  const application = createKnowledgePolicyManagementFactory({ enabled: true, db, auth, guard: new ApiAuthGuard(auth), clock });
  const http = new KnowledgePolicyManagementController(application), request = { headers: { authorization: `Bearer ${token}` } };
  const contracts = { prepare: ['AiKnowledgePolicyChangeDraft', 'AiKnowledgePolicyPrepareHttpResponseDraft'],
    preparation: ['AiKnowledgePolicyPreparationSelectionDraft', 'AiKnowledgePolicyReviewHttpResponseDraft'],
    commit: ['AiKnowledgePolicyCommitDraft', 'AiKnowledgePolicyCommitHttpResponseDraft'],
    operation: ['AiKnowledgePolicyReceiptSelectionDraft', 'AiKnowledgePolicyOperationHttpResponseDraft'] };
  const call = async (method, value) => valid(contracts[method][1], await http[method](request, valid(contracts[method][0], value)));
  let lastScoped;
  const originalPrepare = HumanKnowledgePolicyManagementService.prototype.prepare;
  t.mock.method(HumanKnowledgePolicyManagementService.prototype, 'prepare', async function(value) {
    lastScoped = this; const result = await originalPrepare.call(this, value);
    result.internalOnly = 'not-public'; if (result.proposal) result.proposal.internalOnly = 'not-public'; return result;
  });
  const originalReview = HumanKnowledgePolicyManagementService.prototype.reviewLifecycleTarget;
  t.mock.method(HumanKnowledgePolicyManagementService.prototype, 'reviewLifecycleTarget', async function(value) {
    const result = await originalReview.call(this, value);
    if (result.state === 'current') { result.target.internalOnly = 'not-public'; result.target.from.internalOnly = 'not-public'; }
    return result;
  });
  const source = new PrismaKnowledgeActionPolicySource(db, clock);
  const api = new HumanKnowledgeService({ ...ports, auth, credentials,
    authorization: new FormalKnowledgeAuthorizationAdapter(auth, credentials, source.knowledge, clock) });
  await new HumanKnowledgeService(ports).create(h.draft());
  const from = { documentId: 'doc-1', documentVersion: 'v1', attachmentId: 'attachment-1', aclRevision: 1, revision: 1 };
  const target = { version: 'knowledge-successor-target-1', action: 'revise', operationId: 'approved-revise', from,
    to: { documentVersion: 'v2', attachmentId: 'attachment-2', uploadSessionId: 'upload-2', title: 'Reviewed successor', validFrom: new Date(h.now).toISOString() }, expiresAt };
  await db.fileAsset.create({ data: { id: 'attachment-2', tenantId: 'tenant-1', businessModule: 'ai-native', businessType: 'ai_knowledge_document',
    businessId: 'doc-1', uploadScene: 'ai-knowledge', status: 'active', uploadedBy: actor.id, storageProvider: 's3_compatible', storageKey: 'synthetic-key',
    metadata: { workspaceId: 'space-1', knowledgeUploadVersion: 1, knowledgeRevision: { documentVersion: 'v1', expectedRevision: 1, aclRevision: 1, targetVersion: 'v2' } } } });
  await db.fileUploadSession.create({ data: { id: 'upload-2', tenantId: 'tenant-1', fileAssetId: 'attachment-2', status: 'completed',
    provider: 's3_compatible', storageKey: 'synthetic-key', idempotencyKey: knowledgeUploadKey('doc-1', 'v2'), completedAt: clock(), expiresAt: new Date(expiresAt) } });
  const authority = (action, resource, preparationTarget) => {
    const row = { id: randomUUID(), tenantId: 'tenant-1', workspaceId: 'space-1', managerId: actor.id, targetActorId: actor.id,
      targetAudience: 'operator', domain: 'knowledge', action, resource, resourceKey: fingerprint(resource), preparationTarget,
      revision: 1, enabled: true, basisRef: 'explicit-lifecycle-delegation', basisVersion: version, requiredPermissions: ['system:params:manage'],
      allowedPermissions: ['synthetic-policy'], allowedOperations: ['create_disabled', 'update_disabled', 'enable', 'disable'], maxPolicySeconds: 86400, expiresAt: new Date(expiresAt) };
    state.authorities.set(row.id, row); return row;
  };
  let sequence = 0;
  const prepare = (root, action, expectedRevision) => call('prepare', { version, authorityId: root.id, operationKey: `policy-${++sequence}`,
    action, expectedRevision, requiredPermissions: ['synthetic-policy'], expiresAt });
  const commit = prepared => call('commit', { preparationId: prepared.preparationId, changeHash: prepared.changeHash, confirm: 'apply_knowledge_policy_change' });
  const apply = async (root, action, expectedRevision) => {
    const prepared = await prepare(root, action, expectedRevision); assert.equal(prepared.state, 'prepared');
    if (root.preparationTarget) assert.deepEqual(prepared.lifecycle.target, root.preparationTarget.action === 'delete'
      ? { ...root.preparationTarget, receiptOperationId: root.preparationTarget.operationId } : root.preparationTarget);
    const result = await commit(prepared); assert.equal(result.state, 'observed'); return result;
  };
  const enable = async root => { await apply(root, 'create_disabled', 0); await apply(root, 'enable', 1); };
  for (const action of ['revise', 'read_metadata', 'delete']) await enable(authority(action, {}));
  const oldResource = { documentId: 'doc-1', documentVersion: 'v1', attachmentId: 'attachment-1', aclRevision: 1 };
  const { revisionUploadResource } = h.load('knowledge-policy-management.validation');
  const uploadTarget = { version: 'knowledge-revision-upload-target-1', from: { ...oldResource, revision: 1 },
    upload: { documentId: 'doc-1', fileName: 'revision.txt', mimeType: 'text/plain', sizeBytes: 64 },
    targetVersion: 'v2', expiresAt };
  const uploadResource = revisionUploadResource(uploadTarget), uploadRoot = authority('upload', uploadResource, uploadTarget);
  const uploadAuthority = h.load('knowledge-policy-management-authority').validateKnowledgeManagementAuthority(uploadRoot, clock());
  await h.load('knowledge-policy-management-authority').knowledgePolicyResourceBasis(db, uploadAuthority, false, clock());
  const disabledUpload = await prepare(uploadRoot, 'create_disabled', 0);
  assert.equal(disabledUpload.lifecycle.state, 'not_applicable');
  assert.equal((await commit(disabledUpload)).state, 'observed');
  assert.equal((await commit(await prepare(uploadRoot, 'enable', 1))).state, 'observed');
  const currentUploadContext = await api.session.current();
  const formalUpload = new FormalKnowledgeAuthorizationAdapter(auth, credentials, source.knowledge, clock);
  const uploadRequest = { action: 'upload', scope: currentUploadContext.scope, upload: uploadResource.upload };
  assert.ok(await formalUpload.authorize(currentUploadContext, uploadRequest));
  const { PrismaKnowledgeFileAccess } = h.load('prisma-knowledge-file-access');
  const { HumanKnowledgeUploadService } = h.load('human-knowledge-upload.service');
  const fileAccess = new PrismaKnowledgeFileAccess(db, api.session, formalUpload, { read: async () => { throw Error('no storage access'); } });
  let uploadCalls = 0;
  const uploads = new HumanKnowledgeUploadService(api.session, { createUploadSession: async (tenantId, request, owner) => {
    await fileAccess.authorizeUpload(tenantId, request, owner); uploadCalls++;
    return { sessionId: 'offline-revision-session' };
  }, completeUpload: async () => { throw Error('not exercised'); } }, fileAccess.repository);
  const uploadInput = { ...uploadTarget.upload, expectedRevision: 1, targetVersion: 'v2' };
  assert.equal((await uploads.beginRevision(uploadInput)).semantics, 'upload_intent_not_revision_commit');
  assert.equal(uploadCalls, 1);
  await assert.rejects(uploads.beginRevision({ ...uploadInput, targetVersion: 'v3' }));
  assert.equal(uploadCalls, 1, 'unbound revision cannot reach storage session creation');
  assert.equal(await formalUpload.authorize(currentUploadContext, { ...uploadRequest,
    upload: { ...uploadResource.upload, revision: { ...uploadResource.upload.revision, targetVersion: 'v3' } } }), null);
  uploadRoot.enabled = false;
  assert.equal(await formalUpload.authorize(currentUploadContext, uploadRequest), null);
  uploadRoot.enabled = true;
  const storedHead = state.documents.get('doc-1');
  storedHead.revision++;
  assert.equal(await formalUpload.authorize(currentUploadContext, uploadRequest), null);
  storedHead.revision--;
  assert.ok(await formalUpload.authorize(currentUploadContext, uploadRequest));
  assert.equal(db.aiKnowledgePolicyPreparationTarget, undefined, 'version upload does not allocate a conflicting first-create target');
  const newResource = { ...oldResource, documentVersion: 'v2', attachmentId: 'attachment-2' };
  const roots = [oldResource, { ...oldResource, attachmentId: 'attachment-2' }, newResource].map(resource => authority('revise', resource, structuredClone(target)));
  const stale = await prepare(roots[0], 'create_disabled', 0);
  await assert.rejects(lastScoped.reviewLifecycleTarget({ operationKey: stale.operationKey, changeHash: stale.changeHash }));
  await assert.rejects(http.prepare(request, { ...stale.proposal, lifecycleTarget: target }), error => {
    valid('AiKnowledgePolicyHttpErrorDraft', error.getResponse()); return error.getResponse().code === 'AI_INVALID_INPUT';
  });
  await assert.rejects(lastScoped.reviewLifecycleTarget({ operationKey: stale.operationKey, changeHash: stale.changeHash }));
  state.assets.get('attachment-2').metadata.knowledgeRevision.aclRevision = 2;
  const staleReview = await call('preparation', { operationKey: stale.operationKey, changeHash: stale.changeHash });
  assert.equal(staleReview.state, 'stale'); assert.equal(staleReview.lifecycle.state, 'unavailable');
  await assert.rejects(commit(stale));
  state.assets.get('attachment-2').metadata.knowledgeRevision.aclRevision = 1;
  assert.equal((await commit(stale)).state, 'observed'); await apply(roots[0], 'enable', 1);
  for (const root of roots.slice(1)) await enable(root);
  const readRoot = authority('read_metadata', newResource, structuredClone(target));
  await apply(readRoot, 'create_disabled', 0);
  const enabling = await prepare(readRoot, 'enable', 1), selection = { operationKey: enabling.operationKey, changeHash: enabling.changeHash };
  assert.equal((await call('preparation', selection)).lifecycle.state, 'current');
  db.responseError = Error('synthetic governance commit reply lost');
  assert.equal((await commit(enabling)).state, 'unknown'); db.responseError = null;
  const policyOperationCount = state.policyOperations.size, observed = await call('operation', selection);
  assert.equal(observed.state, 'observed'); assert.equal(observed.lifecycle.target.to.documentVersion, 'v2');
  assert.equal(state.policyOperations.size, policyOperationCount);
  readRoot.enabled = false;
  const unavailableTarget = await call('operation', selection);
  assert.equal(unavailableTarget.state, 'observed'); assert.equal(unavailableTarget.lifecycle.state, 'unavailable');
  assert.equal(unavailableTarget.changeHash, observed.changeHash); assert.deepEqual(unavailableTarget.result, observed.result);
  readRoot.enabled = true;
  const draft = h.draft({ documentVersion: 'v2', attachmentId: 'attachment-2', title: target.to.title, operationId: target.operationId });
  await assert.rejects(api.revise(1, { ...draft, operationId: 'replacement' }), { code: 'unavailable' });
  await assert.rejects(api.revise(1, { ...draft, title: 'not reviewed' }), { code: 'unavailable' });
  db.responseError = Error('synthetic revise reply lost');
  await assert.rejects(api.revise(1, draft), { code: 'result_unknown' }); db.responseError = null;
  const operationCount = state.operations.size;
  assert.equal((await api.operationStatus('doc-1', target.operationId)).document.documentVersion, 'v2');
  assert.equal(state.operations.size, operationCount);
  await assert.rejects(api.publish({ documentId: 'doc-1', expectedRevision: 2, operationId: 'not-approved-publish' }), { code: 'unavailable' });
  await apply(readRoot, 'disable', 2);
  const deletion = { version: 'knowledge-deletion-target-1', action: 'delete', operationId: 'approved-delete', from: { ...newResource, revision: 2 }, expiresAt };
  await enable(authority('delete', newResource, structuredClone(deletion)));
  const tombstone = authority('read_metadata', newResource, structuredClone(deletion));
  await apply(tombstone, 'update_disabled', 3);
  const tombstonePolicy = await apply(tombstone, 'enable', 4);
  assert.equal((await api.delete({ documentId: 'doc-1', expectedRevision: 2, operationId: deletion.operationId })).publication, 'deleted');
  const reviewedDeletion = await call('operation', { operationKey: tombstonePolicy.operationKey, changeHash: tombstonePolicy.changeHash });
  assert.equal(reviewedDeletion.lifecycle.target.receiptOperationId, deletion.operationId);
  assert.equal((await api.operationStatus('doc-1', reviewedDeletion.lifecycle.target.receiptOperationId)).receipt, 'recorded');
  await assert.rejects(api.read('doc-1'), { code: 'unavailable' });
  await assert.rejects(api.operationStatus('doc-1', target.operationId), { code: 'unavailable' });
  const context = await api.session.current(), document = (await api.repository.read(context.scope, 'doc-1')).document;
  assert.equal(await api.authorization.authorize(context, { action: 'read_body', scope: context.scope, document }), null);
  assert.equal(await api.authorization.authorize(context, { action: 'index', scope: context.scope, document }), null);
  actor.permissions = ['system:params:manage'];
  await assert.rejects(api.operationStatus('doc-1', deletion.operationId), { code: 'unavailable' });
});
