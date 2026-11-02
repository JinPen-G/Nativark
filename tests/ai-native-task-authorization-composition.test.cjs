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
    policies: [], configurations: [], profiles: [], plan: null, afterRead: null, entitlementReads: 0, writes: [] };
  state.policies = scopes.map(scope => ({ id: `policy-${scope.id}`, scopeId: scope.id, scopeKind: scope.kind, sceneCode: scene, configRevision: 1, enabled: true,
    settingsJson: { draftVersion: 'ain-c07-draft-2', scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-a' },
      config: { configRevision: 1 }, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
      sceneCode: scene, allowedModels: ['synthetic-model'], allowedScenes: [scene], budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } }, maxConcurrent: 1, maxCallsPerRun: 5 }
  }));
  const db = {
    aiScope: { findFirst: async ({ where }) => structuredClone(scopes.find(scope => Object.entries(where).every(([key, value]) => scope[key] === value)) ?? null) },
    aiTask: { findFirst: async () => structuredClone(state.task) }, aiRun: {},
    aiTaskActionPolicy: { findUnique: async ({ where }) => state.actionPolicy ? { ...where.scopeId_taskId_operation, revision: 1, requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') } : null },
    aiBudgetPolicy: { findUnique: async ({ where }) => { const row = structuredClone(state.policies.find(policy => Object.entries(where.scopeId_scopeKind_sceneCode).every(([key, value]) => policy[key] === value)) ?? null); state.afterRead?.('gate'); return row; } },
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
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-task-authority-secret' : undefined });
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

test('formal Auth, canonical scope, stored task policy and actual subscription compose an execution gate', async () => {
  const h = harness(); const root = h.compose();
  const result = await root.execution.authorize('task-a');
  assert.equal(result.actor.userId, 'operator-a'); assert.equal(result.scope.workspaceId, 'workspace-a');
  assert.ok(h.state.entitlementReads >= 2);
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
  db.aiBudgetPolicy.findMany = async () => [{ moneyCurrency: 'CNY' }];
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
