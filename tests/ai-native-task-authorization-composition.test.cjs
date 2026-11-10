'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
// This test is executed from the worktree without installing or mutating
// dependencies. Resolve the shared source from this checkout instead of a
// possibly stale parent-worktree dist package.
const Module = require('node:module'), path = require('node:path');
const originalResolve = Module._resolveFilename;
Module._resolveFilename = function(request, parent, ...rest) {
  if (request === '@rental-os/shared') return path.resolve(__dirname, '../packages/shared/src/index.ts');
  return originalResolve.call(this, request, parent, ...rest);
};
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { SubscriptionService } = require('../apps/api/src/modules/subscription/subscription.service');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
const { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
const { Prisma } = require('@prisma/client');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { AiTaskCurrentIdentityAuthority } = require('../apps/api/src/modules/ai-native/task-current-identity.authority');
const { TenantModelConfigurationAuthority } = require('../apps/api/src/modules/ai-native/tenant-model-config.authority');
const { createPersistedTenantModelConfiguration } = require('../apps/api/src/modules/ai-native/tenant-model-config.composition');
const now = new Date('2026-10-06T12:00:00Z');
const scene = 'rental.order.explain';
const rejected = error => ['AI_RESOURCE_UNAVAILABLE', 'AI_ACCESS_DENIED', 'AI_STORAGE_UNAVAILABLE', 'AI_SCOPE_CHANGED'].includes(error.code);

test('client SQL unsigned revision normalizes bigint without relaxing current policy bounds', async () => {
  const { AiClientPolicyAuthority } = require('../apps/api/src/modules/ai-native/scenes/client-task.authority');
  const expiresAt = new Date(now.getTime() + 60000);
  let policy = { id: '11111111-1111-4111-8111-111111111111', tenantId: 'tenant-a', workspaceId: 'workspace-a',
    channel: 'web', customerType: 'personal', sceneCode: 'client.history', sceneVersion: '1', enabled: 1,
    allowCreate: 0, allowRead: 1, allowExecute: 0, allowRequestInput: 0, allowSubmitInput: 0,
    allowResumeInput: 0, allowCancel: 0, revision: 1n, expiresAt };
  const subject = { tenantId: 'tenant-a', workspaceId: 'workspace-a', channel: 'web', principalKind: 'personal',
    identity: { tenantId: 'tenant-a', workspaceId: 'workspace-a', customerType: 'personal',
      membershipStatus: 'active', sessionId: 'client-session', customerId: 'customer-a' } };
  const authority = new AiClientPolicyAuthority({ db: { $queryRaw: async () => [structuredClone(policy)],
    $transaction: async () => { throw Error('Read must not reserve or resolve execution entitlement'); } },
    subscriptions: { readCategoryCommercialContext: async () => { throw Error('Read must not consume execution entitlement'); } } },
    { sceneCode: 'client.history', sceneVersion: '1' }, 'revision-test', () => now);
  assert.equal((await authority.authorize(subject, 'read')).policy.revision, 1);
  policy.revision = 4294967294n;
  assert.equal((await authority.authorize(subject, 'read')).policy.revision, 4294967294);
  for (const invalid of [0n, -1n, 4294967295n, 9007199254740993n, 1.5, '1']) {
    policy.revision = invalid;
    await assert.rejects(authority.authorize(subject, 'read'), rejected);
  }
  policy.revision = 1;
  assert.equal((await authority.authorize(subject, 'read')).policy.revision, 1);
  await assert.rejects(authority.authorize(subject, 'execute'), rejected);
  policy.enabled = 0;
  await assert.rejects(authority.authorize(subject, 'read'), rejected);

  const { PrismaClientSceneMaterialRepository } = require('../apps/api/src/modules/ai-native/scenes/prisma-client-scene-material.repository');
  const { PrismaClientTaskInputRepository, clientTaskInputHash } = require('../apps/api/src/modules/ai-native/scenes/prisma-client-task-input.repository');
  const scope = { tenantId: 'tenant-a', workspaceId: 'workspace-a', channel: 'web', principalKind: 'personal', principalHash: '0'.repeat(64) };
  let material = { ...scope, id: '22222222-2222-4222-8222-222222222222', bindingHash: '1'.repeat(64), publicationHash: '2'.repeat(64),
    operationKey: 'original-material', inputHash: '3'.repeat(64), materialHash: '4'.repeat(64), command: { kind: 'order', orderId: 'order-a' },
    material: {}, publication: {}, revision: 1n, createdAt: now, expiresAt };
  const unread = async () => { throw Error('Decoder read must not write or resolve a new scope'); };
  const materials = new PrismaClientSceneMaterialRepository({ $queryRaw: async () => [structuredClone(material)],
    $executeRaw: unread, $transaction: unread, tenant: { findFirst: unread }, businessWorkspace: { findFirst: unread } });
  assert.equal((await materials.findSource(scope, material.id)).revision, 1);
  material.revision = 2n;
  await assert.rejects(materials.findSource(scope, material.id), { code: 'AI_CLIENT_STORAGE_UNAVAILABLE' });
  material.revision = 1n;
  const numeric = { ...scope, id: '33333333-3333-4333-8333-333333333333', creationKey: 'original-create',
    materialRef: material.id, materialInputHash: material.inputHash, materialHash: material.materialHash, materialRevision: 1,
    bindingHash: material.bindingHash, policyId: '11111111-1111-4111-8111-111111111111', policyRevision: 1, policyHash: '5'.repeat(64),
    sceneCode: 'client.history', sceneVersion: '1', revision: 1, dispatchState: 'UNKNOWN', createdAt: now, expiresAt };
  let rawInput = { ...numeric, inputHash: clientTaskInputHash(numeric), materialRevision: 1n, policyRevision: 1n, revision: 1n };
  const inputs = new PrismaClientTaskInputRepository({ $queryRaw: async () => [structuredClone(rawInput)] });
  const restored = await inputs.findCreation(scope, numeric.creationKey);
  assert.equal(restored.inputHash, clientTaskInputHash(numeric));
  assert.equal(restored.revision, 1); assert.equal(restored.materialRevision, 1); assert.equal(restored.policyRevision, 1);
  assert.equal(restored.dispatchState, 'UNKNOWN');
  rawInput.revision = 2n;
  await assert.rejects(inputs.findCreation(scope, numeric.creationKey), rejected);
  rawInput.revision = 1n; rawInput.inputHash = 'f'.repeat(64);
  await assert.rejects(inputs.findCreation(scope, numeric.creationKey), rejected);
});

test('client internal read revalidation keeps current Auth and public HTTP quotas separate', async () => {
  let active = true, authReads = 0, quotaReads = 0;
  const client = { tenantId: 'tenant-a', workspaceId: 'workspace-a', customerId: 'customer-a', sessionId: 'client-session',
    tenantCode: 'tenant-a', workspaceCode: 'workspace-a', workspaceName: 'Synthetic', categoryCode: 'CAMERA',
    customerType: 'personal', membershipStatus: 'active', displayName: 'Synthetic', phone: 'synthetic' };
  const clientAuth = { authenticate: async () => { authReads++; if (!active) throw Error('revoked client session'); return structuredClone(client); } };
  const guard = new ApiAuthGuard(undefined, undefined, clientAuth, { assertAllowed: async () => { quotaReads++; } });
  const request = (method, path) => ({ method, url: '/api'+path, originalUrl: '/api'+path,
    headers: { authorization: 'Bearer synthetic-client' }, query: {}, body: {}, internalClientRead: true });
  const context = value => ({ switchToHttp: () => ({ getRequest: () => value }) });
  const publicRequest = request('GET', '/client/v1/orders/order-a');
  assert.equal(await guard.canActivate(context(publicRequest)), true); assert.equal(quotaReads, 2);
  for (let index = 0; index < 5; index++) assert.equal(await guard.revalidateClientRead(context(request('GET', '/client/v1/orders/order-a'))), true);
  assert.equal(quotaReads, 2); assert.equal(authReads, 6);
  active = false;
  await assert.rejects(guard.revalidateClientRead(context(request('GET', '/client/v1/orders/order-a'))), /revoked client session/);
  active = true;
  await assert.rejects(guard.revalidateClientRead(context(request('POST', '/client/v1/orders'))));
  assert.equal(quotaReads, 2);
  // Reusing an HTTP request object after a server read cannot retain the marker;
  // a client body/header property with the same name never bypasses accounting.
  const reused = request('GET', '/client/v1/profile');
  await guard.revalidateClientRead(context(reused)); await guard.canActivate(context(reused));
  assert.equal(quotaReads, 4);
});

function harness() {
  const scopes = [{ id: 'scope-platform', ...aiPersistenceScopeColumns({ kind: 'platform' }) },
    { id: 'scope-tenant', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: 'tenant-a' }) },
    { id: 'scope-workspace', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) }];
  const state = { user: user(), session: true, membership: true, workspace: 'workspace-a', time: new Date(now),
    actionPolicy: true, task: { id: 'task-a', scopeId: 'scope-workspace', scopeKind: 'WORKSPACE', scope: scopes[2], ownerKind: 'USER', ownerId: 'operator-a', audience: 'OPERATOR',
      status: 'RUNNING', revision: 1, contractVersion: AI_TASK_DRAFT_VERSION, sceneCode: scene, sceneVersion: '1', archivedAt: null, cancelRequestedAt: null },
    subscription: { id: 'sub-a', tenantId: 'tenant-a', revision: 4, plan: 'PRO', source: 'HISTORICAL_REGISTER', startAt: new Date('2026-01-01'), endAt: new Date('2027-01-01'), serviceTimeZone: 'UTC', billingAnniversary: new Date('2026-01-01') },
    // Match the persisted SubscriptionFeatureCatalog projection consumed by
    // SubscriptionService.buildEntitlements; a partial row must not masquerade
    // as a valid commercial entitlement in this composition test.
    features: [{ code: 'ai.native.use', name: 'AI Native', module: 'ai', categories: [],
      currentOwnership: 'PRO', defaultOwnership: 'PRO', releaseStatus: 'RELEASED', valueText: null, externalFeeNote: null }],
    policies: [], configurations: [], profiles: [], plan: null, afterRead: null, entitlementReads: 0, gateBatchReads: [], writes: [] };
  state.policies = scopes.map(scope => ({ id: `policy-${scope.id}`, scopeId: scope.id, scopeKind: scope.kind, sceneCode: scene, configRevision: 1, enabled: true,
    settingsJson: { draftVersion: 'ain-c07-draft-2', scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-a' },
      config: { configRevision: 1 }, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
      sceneCode: scene, allowedModels: ['synthetic-model'], allowedScenes: [scene], budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } }, maxConcurrent: 1, maxCallsPerRun: 5 }
  }));
  const db = {
    aiScope: { findFirst: async ({ where }) => structuredClone(scopes.find(scope => Object.entries(where).every(([key, value]) => scope[key] === value)) ?? null),
      findMany: async query => { state.gateBatchReads.push({ kind: 'scope', query: structuredClone(query) });
        return structuredClone(scopes.filter(scope => query.where.OR.some(where => Object.entries(where).every(([key, value]) => scope[key] === value))).slice(0, query.take)); } },
    aiTask: { findFirst: async () => structuredClone(state.task) }, aiRun: {},
    aiTaskActionPolicy: { findUnique: async ({ where }) => state.actionPolicy ? { ...where.scopeId_taskId_operation, revision: 1, requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') } : null },
    aiBudgetPolicy: { findUnique: async ({ where }) => { const row = structuredClone(state.policies.find(policy => Object.entries(where.scopeId_scopeKind_sceneCode).every(([key, value]) => policy[key] === value)) ?? null); state.afterRead?.('gate'); return row; },
      findMany: async query => { state.gateBatchReads.push({ kind: 'policy', query: structuredClone(query) });
        const rows = structuredClone(state.policies.filter(policy => query.where.OR.some(where => Object.entries(where).every(([key, value]) => policy[key] === value))).slice(0, query.take));
        for (const _row of rows) state.afterRead?.('gate'); return rows; } },
    systemParameterSet: { findFirst: async () => null },
    aiTenantModelConfiguration: {
      findUnique: async ({ where }) => { const row = structuredClone(state.configurations.find(item => item.tenantId === where.tenantId) ?? null); state.afterRead?.('configuration'); return row; },
      create: async ({ data }) => { const row = structuredClone({ ...data, settings: data.settings === Prisma.DbNull ? null : data.settings,
        credentialsEncrypted: data.credentialsEncrypted ?? null }); state.configurations.push(row); state.writes.push('configuration'); return structuredClone(row); },
      updateMany: async ({ where, data }) => { const row = state.configurations.find(item => item.tenantId === where.tenantId && item.revision === where.revision);
        if (!row) return { count: 0 }; Object.assign(row, structuredClone({ ...data, settings: data.settings === Prisma.DbNull ? null : data.settings })); state.writes.push('configuration'); return { count: 1 }; }
    },
    aiProviderProfile: {
      findFirst: async ({ where }) => structuredClone(state.profiles.find(item => Object.entries(where).every(([key, value]) => item[key] === value)) ?? null),
      create: async ({ data }) => { const row = { id: 'profile-a', ...structuredClone(data) }; state.profiles.push(row); return structuredClone(row); },
      updateMany: async ({ where, data }) => { const row = state.profiles.find(item => Object.entries(where).every(([key, value]) => item[key] === value));
        if (!row) return { count: 0 }; Object.assign(row, structuredClone(data)); return { count: 1 }; }
    },
    aiTaskPlanPolicy: { findFirst: async ({ where }) => { const row = state.plan && Object.entries(where).every(([key, value]) => state.plan[key] === value) ? structuredClone(state.plan) : null; state.afterRead?.('plan'); return row; } },
    tenant: { findUnique: async () => ({ subscription: structuredClone(state.subscription), subscriptionSegments: [] }) },
    subscriptionFeatureCatalog: { findMany: async () => { state.entitlementReads++; const rows = structuredClone(state.features); state.afterRead?.('feature'); return rows; } },
    tenantFeatureGrant: { findMany: async () => [] }
  };
  db.$transaction = async fn => fn(db);
  const auth = new AuthService({ getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience: 'operator', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.membership ? state.user : undefined, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-task-authority-secret' : undefined }, undefined, undefined, undefined, db);
  const tokenExpiresAt = Math.floor(Date.now() / 1000) + 600;
  const credentials = { current: async () => ({ requestId: 'auth-request', audience: 'operator', authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', wid: 'workspace-a', aud: 'operator', exp: tokenExpiresAt })}` }) };
  const input = { db, auth, credentials, subscriptions: new SubscriptionService(db), clock: () => new Date(state.time) };
  const compose = () => require('../apps/api/src/modules/ai-native/task-authorization.composition').composePersistedTaskAuthorization(input);
  const management = new TenantModelConfigurationAuthority(new ApiAuthGuard(auth, undefined, undefined, undefined, {}),
    credentials, new AiTaskCurrentIdentityAuthority(auth, credentials, input.clock));
  const configuration = createPersistedTenantModelConfiguration({ db, authorize: management.authorize.bind(management),
    secrets: new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-task-gate-encryption' : undefined }) });
  const saveSettings = async (mode = 'platform_managed') => {
    if (!state.user.permissions.includes('system:params:manage')) state.user.permissions.push('system:params:manage');
    const result = await configuration.saveSettings({ tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: state.user.id }, {
      draftVersion: 'ain-c07-draft-2', configId: 'tenant-a', expectedRevision: state.configurations[0]?.revision ?? 0,
      mode, enabled: true, ...(mode === 'tenant_managed' ? { protocol: 'openai_chat_completions',
        baseUrl: 'https://synthetic-model.example.test/v1', model: 'synthetic-model',
        secretChange: { operation: 'replace', apiKey: 'synthetic-task-key' } } : {})
    });
    state.policies = state.policies.filter(row => row.scopeKind === 'PLATFORM');
    state.plan = { scopeId: 'scope-workspace', sceneCode: scene, sceneVersion: '1', revision: 1, enabled: true,
      allowedTools: [{ code: 'rental.order.explain', version: AI_TOOL_DRAFT_VERSION }], expiresAt: new Date('2027-01-01'),
      limits: { maxSteps: 4, maxCalls: 4, maxConcurrent: 1, maxTotalMs: 10000, maxStepMs: 1000, maxOutputBytes: 4096 } };
    return result;
  };
  return { state, input, compose, saveSettings };
}

function organizationHarness() {
  const h = harness();
  h.state.user.dataScope = 'organization'; h.state.user.organizationId = 'org-root';
  h.state.user.locationScope = { mode: 'selected', locationIds: ['location-a', 'location-outside'] };
  h.state.organizations = [{ id: 'org-root', parentId: null, status: 'enabled' },
    { id: 'org-child', parentId: 'org-root', status: 'enabled' },
    { id: 'org-disabled', parentId: 'org-root', status: 'disabled' }];
  h.state.organizationLocations = [{ id: 'location-a' }, { id: 'location-b' }];
  h.state.locationQueries = [];
  // Only persistent leaf lookups are substitutes; both callers use the actual
  // Auth/Guard projection and current action/entitlement policy services.
  h.input.db.organizationUnit = { findMany: async query => {
    assert.deepEqual(query, { where: { tenantId: 'tenant-a' }, select: { id: true, parentId: true, status: true } });
    return structuredClone(h.state.organizations);
  } };
  h.input.db.rentalFulfillmentLocation = { findMany: async query => {
    h.state.locationQueries.push(structuredClone(query)); return structuredClone(h.state.organizationLocations);
  } };
  return h;
}

test('organization task context equals the real HTTP Guard projection without changing raw role configuration', async () => {
  const h = organizationHarness();
  const credentials = await h.input.credentials.current();
  const request = { url: '/api/rental/v1/orders', originalUrl: '/api/rental/v1/orders', method: 'GET',
    headers: { authorization: credentials.authorization }, query: {} };
  const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const guard = new ApiAuthGuard(h.input.auth, undefined, undefined, undefined, h.input.db, h.input.subscriptions);
  const stored = await runWithRequestIdentity({}, async () => {
    assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
    return structuredClone(getRequestIdentity());
  });
  const context = await h.compose().execution.authorize('task-a');
  assert.deepEqual(context.access, { permissions: request.user.permissions, dataScope: stored.dataScope,
    locationScope: stored.locationScope, organizationId: stored.organizationId });
  assert.deepEqual(context.access.locationScope, { mode: 'selected', locationIds: ['location-a'] });
  assert.deepEqual(h.state.user.locationScope, { mode: 'selected', locationIds: ['location-a', 'location-outside'] });
  assert.ok(h.state.locationQueries.length > 1, 'task steps must reread the mapping, not inherit the HTTP ALS');
  for (const query of h.state.locationQueries) assert.deepEqual(query, {
    where: { tenantId: 'tenant-a', workspaceId: 'workspace-a', organizationId: { in: ['org-child', 'org-root'] } }, select: { id: true }
  });
});

test('organization narrowing, reassignment and revocation invalidate execution and recovery while ordinary cleanup stays independent of AI entitlement', async () => {
  for (const change of [
    h => { h.state.organizationLocations = [{ id: 'location-outside' }]; },
    h => { h.state.user.organizationId = 'org-child'; },
    h => { h.state.organizations[0].status = 'disabled'; }
  ]) {
    const h = organizationHarness(); let changed = false;
    h.state.afterRead = label => { if (!changed && label === 'gate') { changed = true; change(h); } };
    await assert.rejects(h.compose().execution.authorize('task-a'), rejected);
  }
  const h = organizationHarness(), root = h.compose(); h.state.features = [];
  assert.equal((await root.authority.resolve('task-a', 'claim_recovery_run')).access.organizationId, 'org-root');
  h.state.organizations[0].status = 'disabled';
  await assert.rejects(root.authority.resolve('task-a', 'claim_recovery_run'), rejected);
  delete h.input.db.organizationUnit;
  await assert.rejects(root.authority.resolve('task-a', 'read_metadata'), rejected);
});

test('current task authorization rejects location narrowing while metadata, empty events or retained results are buffered', async () => {
  const { AiTaskEventRepository } = require('../apps/api/src/modules/ai-native/ai-task-event.repository');
  const { AiTaskResultRepository } = require('../apps/api/src/modules/ai-native/runner/ai-task-result.repository');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  for (const observation of ['metadata', 'events', 'result']) {
    const h = harness(), root = h.compose();
    Object.assign(h.state.task, { createdAt: now, updatedAt: now, eventCursor: 0n });
    const readTask = h.input.db.aiTask.findFirst;
    h.input.db.aiTask.findFirst = async query => {
      const row = await readTask(query);
      h.state.user.locationScope = { mode: 'selected', locationIds: ['location-a'] };
      return row;
    };
    h.input.db.aiTaskEvent = { findMany: async () => [] };
    const payload = { text: 'retained synthetic original result' }, contentHash = requestFingerprint(payload);
    h.input.db.aiTaskResultArtifact = { findFirst: async () => ({ scopeId: 'scope-workspace', taskId: 'task-a', id: 'result-a',
      runId: 'run-a', stepId: 'step-a', actionId: 'action-a', stepFingerprint: 'a'.repeat(64),
      outcome: 'SUCCEEDED', errorCode: null, payload, contentHash, outputBytes: BigInt(Buffer.byteLength(JSON.stringify(payload))),
      activeMs: 1n, completeMeasurement: true, createdAt: now }) };
    h.input.db.aiStep = { findFirst: async () => ({ id: 'step-a', runId: 'run-a', actionId: 'action-a',
      requestFingerprint: 'a'.repeat(64), resultRef: 'result-a', status: 'SUCCEEDED' }) };
    const read = observation === 'metadata' ? () => root.tasks.readMetadata('task-a')
      : observation === 'events' ? () => new AiTaskEventRepository(h.input.db, root.authority, h.input.clock)
        .readPage({ taskId: 'task-a', after: '0', limit: 10 })
      : () => new AiTaskResultRepository(h.input.db, root.tasks, h.input.clock).read({ taskId: 'task-a', resultId: 'result-a' });
    await assert.rejects(read(), error => error.code === 'AI_ACCESS_DENIED', `${observation} cannot deliver a stale authorization binding`);
  }
});

test('current authorization binding includes rights but ignores correlation time and retains the exact historical owner tuple', async () => {
  const { aiTaskAccessFromContext } = require('../apps/api/src/modules/ai-native/ai-task.repository');
  const h = harness(), context = await h.compose().authority.resolve('task-a', 'read_metadata');
  const initial = aiTaskAccessFromContext(context, 'task-a', now);
  assert.equal(initial.ownershipBindingKey, JSON.stringify([aiPersistenceScopeColumns(context.scope), context.audience, 'USER', 'operator-a', null]));
  for (const access of [
    { ...context.access, permissions: ['rental-os:order:view'] },
    { ...context.access, dataScope: 'own' },
    { ...context.access, locationScope: { mode: 'selected', locationIds: ['location-a'] } },
    { ...context.access, organizationId: 'organization-a' }
  ]) {
    const current = aiTaskAccessFromContext({ ...context, access }, 'task-a', now);
    assert.notEqual(current.bindingKey, initial.bindingKey);
    assert.deepEqual(current.where, initial.where, 'current rights do not rewrite original owner/scope queries');
  }
  const correlated = aiTaskAccessFromContext({ ...context, requestId: 'other-request', authorizedAt: new Date(now.getTime() - 1000).toISOString() }, 'task-a', now);
  assert.equal(correlated.bindingKey, initial.bindingKey);
});

test('historical creation fingerprints remain byte-compatible after current rights change without granting a new creation', async () => {
  const { AiTaskCreationRepository } = require('../apps/api/src/modules/ai-native/ai-task-creation.repository');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const h = harness(), root = h.compose(), context = await root.authority.resolve('task-a', 'read_metadata');
  const scope = aiPersistenceScopeColumns(context.scope);
  const ownership = JSON.stringify([scope, context.audience, 'USER', 'operator-a', null]);
  const input = { sceneCode: scene, inputRef: 'original-input-a', creationKey: 'original-creation-a' };
  const originalFingerprint = requestFingerprint({ version: 'ai-task-creation-1', scope, audience: 'OPERATOR',
    ownerKind: 'USER', ownerId: 'operator-a', authorizationBinding: ownership, sceneCode: scene, sceneVersion: '1',
    inputRef: input.inputRef, inputRevision: 1, inputHash: 'a'.repeat(64) });
  const row = { id: 'legacy-task-a', status: 'RUNNING', revision: 1, contractVersion: AI_TASK_DRAFT_VERSION,
    archivedAt: null, creationKey: input.creationKey, creationFingerprint: originalFingerprint, runs: [{ id: 'legacy-run-a' }] };
  const authority = { resolve: async () => ({ context: await root.authority.resolve('task-a', 'read_metadata'), creationAllowed: true,
    sceneCode: scene, sceneVersion: '1', inputRef: input.inputRef, inputRevision: 1, inputHash: 'a'.repeat(64) }) };
  const repository = new AiTaskCreationRepository({ aiScope: {}, aiTask: { findFirst: async () => structuredClone(row) },
    $transaction: async () => assert.fail('a creation receipt read never creates another task') }, authority, h.input.clock);
  h.state.user.locationScope = { mode: 'selected', locationIds: ['location-a'] };
  const result = await repository.readCreation(input);
  assert.equal(result.state, 'observed'); assert.equal(result.task.taskId, row.id); assert.equal(result.task.runId, 'legacy-run-a');
  assert.equal(row.creationFingerprint, originalFingerprint);
});

test('formal Auth, canonical scope, stored task policy and actual subscription compose an execution gate', async () => {
  const h = harness(); const root = h.compose();
  const result = await root.execution.authorize('task-a');
  assert.equal(result.actor.userId, 'operator-a'); assert.equal(result.scope.workspaceId, 'workspace-a');
  assert.ok(h.state.entitlementReads >= 2);
  assert.deepEqual(h.state.gateBatchReads.map(x => x.kind), ['scope', 'policy', 'scope', 'policy']);
  for (const read of h.state.gateBatchReads) { assert.equal(read.query.take, 4); assert.equal(read.query.where.OR.length, 3); }
  for (const [leaf, corrupt] of [
    ['aiScope', rows => [...rows, { ...rows[0], id: 'duplicate-canonical-scope' }]],
    ['aiBudgetPolicy', rows => [...rows, { ...rows[0], id: 'duplicate-policy' }]],
    ['aiBudgetPolicy', rows => [{ ...rows[0], scopeId: 'foreign-scope' }, ...rows.slice(1)]]
  ]) {
    const invalid = harness(), read = invalid.input.db[leaf].findMany;
    invalid.input.db[leaf].findMany = async query => corrupt(await read(query));
    await assert.rejects(invalid.compose().execution.authorize('task-a'), rejected);
    assert.deepEqual(invalid.state.writes, []);
  }
  // These independent leaves are pure reads. Use barriers, not a permissive
  // authorization substitute or elapsed-time threshold, to prove overlap.
  const overlap = harness(); let markGate, releaseGate, featureStarted = false;
  const gateReached = new Promise(resolve => { markGate = resolve; });
  const gateRead = new Promise(resolve => { releaseGate = resolve; });
  const readConfig = overlap.input.db.aiTenantModelConfiguration.findUnique;
  overlap.input.db.aiTenantModelConfiguration.findUnique = async query => { markGate(); await gateRead; return readConfig(query); };
  const readFeatures = overlap.input.db.subscriptionFeatureCatalog.findMany;
  overlap.input.db.subscriptionFeatureCatalog.findMany = async (...args) => { featureStarted = true; return readFeatures(...args); };
  const overlapping = overlap.compose().execution.authorize('task-a');
  await gateReached; await Promise.resolve();
  const startedBeforeGateCompleted = featureStarted; releaseGate(); await overlapping;
  assert.equal(startedBeforeGateCompleted, true, 'entitlement read starts while the independent policy read is pending');
  assert.deepEqual(overlap.state.writes, []);
  const refused = harness(); let finishFeature, markFeature, featureCompleted = false, settled = false;
  const featureReached = new Promise(resolve => { markFeature = resolve; });
  const featurePending = new Promise(resolve => { finishFeature = resolve; });
  refused.input.db.aiTenantModelConfiguration.findUnique = async () => { throw Error('explicit gate refusal'); };
  refused.input.db.subscriptionFeatureCatalog.findMany = async () => { markFeature(); await featurePending; featureCompleted = true; return []; };
  const rejecting = refused.compose().execution.authorize('task-a');
  rejecting.then(() => { settled = true; }, () => { settled = true; });
  await featureReached; await Promise.resolve(); await Promise.resolve();
  const deliveredBeforeReadsCompleted = settled; finishFeature(); await assert.rejects(rejecting, rejected);
  assert.equal(deliveredBeforeReadsCompleted, false, 'failed authorization waits for both reads; no abandoned work escapes metering');
  assert.equal(featureCompleted, true); assert.deepEqual(refused.state.writes, []);
});
for (const [name, change] of Object.entries({
  'missing AI feature': s => s.features = [], 'PRO without released feature': s => s.features[0].releaseStatus = 'PLANNED',
  'expired subscription': s => s.subscription.endAt = now, 'missing action policy': s => s.actionPolicy = false,
  'cross-owner query hit': s => s.task.ownerId = 'other-user', 'cancelled task': s => s.task.cancelRequestedAt = now,
  'scope change': s => s.workspace = 'workspace-b', 'member revoked': s => s.membership = false,
  'missing policy tier': s => s.policies.pop(), 'platform disabled': s => s.policies[0].enabled = false,
  'tenant disabled': s => s.policies[1].settingsJson.gates.tenant.enabled = false,
  'scene disabled': s => s.policies[2].settingsJson.gates.scene.enabled = false,
  'scene outside allowlist': s => s.policies[2].settingsJson.allowedScenes = ['other-scene']
})) test(`execution rejects ${name}`, async () => {
  const h = harness(); change(h.state);
  await assert.rejects(h.compose().execution.authorize('task-a'), rejected);
});
test('new run admission requires AI entitlement but current history and lease cleanup remain accessible', async () => {
  const h = harness(); h.state.features = []; const root = h.compose();
  await assert.rejects(root.authority.resolve('task-a', 'claim_run'), rejected);
  for (const operation of ['read_metadata', 'read_step_terminal', 'release_run', 'claim_recovery_run']) {
    assert.equal((await root.authority.resolve('task-a', operation)).actor.userId, 'operator-a');
  }
});
for (const kind of ['identity', 'entitlement', 'gate revision']) test(`asynchronous ${kind} changes invalidate execution authorization`, async () => {
  const h = harness(); let changed = false;
  h.state.afterRead = label => {
    if (changed || (kind === 'gate revision' && label !== 'gate')) return; changed = true;
    if (kind === 'identity') h.state.user.permissions = [];
    if (kind === 'entitlement') h.state.features = [];
    if (kind === 'gate revision') h.state.policies[0].configRevision++;
  };
  await assert.rejects(h.compose().execution.authorize('task-a'), rejected);
});
test('missing real subscription dependency cannot construct a ready execution composition', () => {
  const h = harness(); delete h.input.subscriptions;
  assert.throws(h.compose, rejected);
});

test('platform request, SaaS approval and workspace allocation reach original task admission without manual scene budgets', async () => {
  const h = harness(); await h.saveSettings(); h.state.user.isPlatformAdmin = true;
  const { AiCreditService } = require('../apps/api/src/modules/ai-native/budget/ai-credit.service');
  const { assertPlatformCreditLimit } = require('../apps/api/src/modules/ai-native/budget/platform-credit-limit');
  const rows = [], accounts = [], operations = [], locks = [], db = h.input.db;
  const same = (row, where) => row && Object.entries(where).every(([key, value]) => row[key] === value);
  const hydrate = row => row && { ...row, tenant: { name: 'Synthetic tenant', status: 'ACTIVE' } };
  Object.assign(h.state.policies[0], { unitKind: 'money', moneyCurrency: 'CNY' });
  h.state.policies[0].settingsJson.budget = { state: 'limited', quantity: { unit: 'money', amount: '100.000000', currency: 'CNY', scale: 6 } };
  const readPolicyBatch = db.aiBudgetPolicy.findMany;
  db.aiBudgetPolicy.findMany = async query => query?.where?.OR ? readPolicyBatch(query) : [{ moneyCurrency: 'CNY' }];
  db.$queryRaw = async sql => { locks.push(sql.sql); return []; };
  db.aiTenantAiCreditRequest = {
    findUnique: async ({ where }) => hydrate(rows.find(row => same(row, where.tenantId_requestedBy_operationKey ?? where)) ?? null),
    findFirst: async ({ where }) => hydrate(rows.find(row => same(row, where)) ?? null),
    create: async ({ data }) => { const row = { ...data, revision: 1, state: 'pending', createdAt: now, decidedAt: null, grantedAmount: null };
      rows.push(row); return hydrate(row); },
    updateMany: async ({ where, data }) => { const row = rows.find(row => same(row, where)); if (!row) return { count: 0 };
      Object.assign(row, { ...data, revision: row.revision + data.revision.increment }); return { count: 1 }; },
    findUniqueOrThrow: async ({ where }) => { const row = rows.find(row => same(row, where)); assert.ok(row); return hydrate(row); }
  };
  db.aiTenantAiAllowance = {
    findUnique: async ({ where }) => accounts.find(row => same(row, where.tenantId_currency)) ?? null,
    upsert: async ({ create }) => { const row = { ...create, revision: 1 }; accounts.push(row); return row; },
    updateMany: async ({ where, data }) => { const row = accounts.find(row => same(row, where)); if (!row) return { count: 0 };
      Object.assign(row, { ...data, revision: row.revision + data.revision.increment }); return { count: 1 }; }
  };
  db.operationLog = { findUnique: async ({ where }) => operations.find(row => same(row, where)) ?? null,
    create: async ({ data }) => { operations.push(data); return data; } };
  db.businessWorkspace = { findMany: async ({ where }) => where.tenantId === 'tenant-a' && where.id.in.includes('workspace-a')
    ? [{ id: 'workspace-a', status: 'ACTIVE' }] : [] };
  db.aiBudgetReservation = { groupBy: async () => [] };
  const credit = new AiCreditService(db, h.input.auth), authorization = async () => (await h.input.credentials.current()).authorization;
  const request = await credit.request(await authorization(), { operationKey: 'request-a', currency: 'CNY', amount: '10' });
  const tenantUser = structuredClone(h.state.user);
  h.state.user = user({ id: 'saas-admin', isSaasAdmin: true, permissions: ['system:ai-provider:manage'] });
  assert.equal((await credit.platformDecide(await authorization(), { requestId: request.id, operationKey: 'approve-a',
    expectedRevision: 1, decision: 'approve', amount: '10' })).state, 'approved');
  h.state.user = tenantUser;
  assert.equal((await credit.allocate(await authorization(), { currency: 'CNY', operationKey: 'allocate-a', expectedRevision: 1,
    allocations: [{ workspaceId: 'workspace-a', amount: '10' }] })).state, 'allocated');
  assert.equal((await h.compose().authority.resolve('task-a', 'claim_run')).actor.userId, 'operator-a');
  await assertPlatformCreditLimit(db, 'tenant-a', 'workspace-a', 'CNY', '1.000000');
  await assert.rejects(assertPlatformCreditLimit(db, 'tenant-a', 'workspace-a', 'CNY', '11.000000'), error => error.code === 'EXHAUSTED');
  assert.equal(h.state.policies.length, 1); assert.equal(operations.length, 1);
  assert.ok(locks.some(sql => sql.includes('ai_tenant_ai_allowances') && sql.includes('FOR UPDATE')));
});

for (const mode of ['platform_managed', 'tenant_managed']) test(`saved ${mode} settings admit a current task without seeding legacy tenant or workspace budgets`, async () => {
  const h = harness(); assert.equal((await h.saveSettings(mode)).enabled, true);
  const before = structuredClone({ policies: h.state.policies, configurations: h.state.configurations, profiles: h.state.profiles, writes: h.state.writes });
  const root = h.compose();
  assert.equal((await root.authority.resolve('task-a', 'claim_run')).scope.workspaceId, 'workspace-a');
  assert.equal((await root.execution.authorize('task-a')).actor.userId, 'operator-a');
  assert.deepEqual({ policies: h.state.policies, configurations: h.state.configurations, profiles: h.state.profiles, writes: h.state.writes }, before);
});
test('BYOK obeys explicit platform scene gates but does not borrow its monetary ceiling', async () => {
  const h = harness(); await h.saveSettings('tenant_managed');
  h.state.policies[0].settingsJson.budget = { state: 'zero', quantity: { unit: 'money', amount: '0.000000', currency: 'CNY', scale: 6 } };
  h.state.policies[0].enabled = false;
  assert.equal((await h.compose().execution.authorize('task-a')).actor.userId, 'operator-a');
  h.state.policies[0].settingsJson.gates.scene.enabled = false;
  await assert.rejects(h.compose().execution.authorize('task-a'), rejected);
});
for (const [name, change] of Object.entries({
  'tenant service stopped': s => s.configurations[0].serviceEnabled = false,
  'malformed configured record': s => s.configurations[0].revision = 0,
  'missing scene policy': s => s.plan = null,
  'stopped scene policy': s => s.plan.enabled = false,
  'wrong scene version': s => s.plan.sceneVersion = '2',
  'expired scene policy': s => s.plan.expiresAt = now,
  'invalid calls ceiling': s => s.plan.limits.maxCalls = 0,
  'unregistered tool': s => s.plan.allowedTools = [{ code: 'arbitrary.http', version: '1' }],
  'legacy tenant stop retained': s => s.policies.push({ ...structuredClone(s.policies[0]), scopeId: 'scope-tenant', scopeKind: 'TENANT', enabled: false }),
  'missing platform scene': s => s.policies = [],
  'entitlement withdrawn': s => s.features = []
})) test(`new settings still deny ${name} without legacy fallback or policy writes`, async () => {
  const h = harness(); await h.saveSettings(); change(h.state);
  const before = structuredClone(h.state.writes);
  await assert.rejects(h.compose().execution.authorize('task-a'), rejected);
  assert.deepEqual(h.state.writes, before);
});
for (const kind of ['configuration', 'plan']) test(`current ${kind} revision changes invalidate the new admission snapshot`, async () => {
  const h = harness(); await h.saveSettings(); let changed = false;
  h.state.afterRead = label => { if (changed || label !== kind) return; changed = true;
    if (kind === 'configuration') h.state.configurations[0].revision++; else h.state.plan.revision++; };
  await assert.rejects(h.compose().execution.authorize('task-a'), rejected);
});
test('unconverted legacy BYOK keeps its original three policies, not modern settings admission', async () => {
  const h = harness(); await h.saveSettings('tenant_managed');
  delete h.state.configurations[0].mode; delete h.state.configurations[0].serviceEnabled;
  await assert.rejects(h.compose().execution.authorize('task-a'), rejected);
});
test('missing current configuration reader fails closed for execution while history remains accessible', async () => {
  const h = harness(); delete h.input.db.aiTenantModelConfiguration;
  const root = h.compose();
  await assert.rejects(root.execution.authorize('task-a'), rejected);
  assert.equal((await root.authority.resolve('task-a', 'read_metadata')).actor.userId, 'operator-a');
});
test('stopped new settings preserve original history, recovery and cleanup authority', async () => {
  const h = harness(); await h.saveSettings('tenant_managed'); await h.saveSettings('platform_managed');
  h.state.configurations[0].serviceEnabled = false;
  const root = h.compose();
  await assert.rejects(root.authority.resolve('task-a', 'claim_run'), rejected);
  for (const operation of ['read_metadata', 'read_step_terminal', 'release_run', 'claim_recovery_run']) {
    assert.equal((await root.authority.resolve('task-a', operation)).actor.userId, 'operator-a');
  }
});
