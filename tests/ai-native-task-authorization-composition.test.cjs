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
const { AI_TASK_DRAFT_VERSION } = require('@rental-os/shared');
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
    policies: [], afterRead: null, entitlementReads: 0 };
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
    tenant: { findUnique: async () => ({ subscription: structuredClone(state.subscription), subscriptionSegments: [] }) },
    subscriptionFeatureCatalog: { findMany: async () => { state.entitlementReads++; const rows = structuredClone(state.features); state.afterRead?.('feature'); return rows; } },
    tenantFeatureGrant: { findMany: async () => [] }
  };
  db.$transaction = async fn => fn(db);
  const auth = new AuthService({ getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience: 'operator', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.membership ? state.user : undefined, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-task-authority-secret' : undefined });
  const credentials = { current: async () => ({ requestId: 'auth-request', audience: 'operator', authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 })}` }) };
  const input = { db, auth, credentials, subscriptions: new SubscriptionService(db), clock: () => new Date(state.time) };
  const compose = () => require('../apps/api/src/modules/ai-native/task-authorization.composition').composePersistedTaskAuthorization(input);
  return { state, input, compose };
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
  h.state.afterRead = () => {
    if (changed) return; changed = true;
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
