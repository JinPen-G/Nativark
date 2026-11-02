'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { approvedOrderHarness } = require('./approved-order-composition.cjs');
const { SubscriptionService } = require('../../../apps/api/src/modules/subscription/subscription.service');
const { aiPersistenceScopeColumns } = require('../../../apps/api/src/modules/ai-native/persistence-scope');
const { AI_TASK_DRAFT_VERSION } = require('../../../packages/shared/src/index.ts');

async function persistedApprovedOrderHarness() {
  const h = await approvedOrderHarness(), { state, dependencies: d } = h;
  const scopes = [{ id: 'scope-platform', ...aiPersistenceScopeColumns({ kind: 'platform' }) },
    { id: 'scope-tenant', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: 'tenant-a' }) },
    { id: 'scope-a', ...aiPersistenceScopeColumns(h.context.scope) }];
  const scene = 'rental.order.explain';
  Object.assign(state.records.aiTask[0], { scope: scopes[2], contractVersion: AI_TASK_DRAFT_VERSION, sceneCode: scene, sceneVersion: '1' });
  Object.assign(state.records, {
    aiScope: scopes,
    aiTaskActionPolicy: ['read_metadata', 'transition_task'].map(operation => ({ scopeId: 'scope-a', taskId: 'task-a', operation,
      revision: 1, expiresAt: new Date('2099-01-01'), requiredPermissions: [operation === 'read_metadata' ? 'rental-os:order:view' : 'rental-os:order:create'] })),
    aiBudgetPolicy: scopes.map(scope => ({ id: `policy-${scope.id}`, scopeId: scope.id, scopeKind: scope.kind, sceneCode: scene,
      configRevision: 1, enabled: true, settingsJson: { draftVersion: 'ain-c07-draft-2',
        scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-a' }, config: { configRevision: 1 },
        gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
        sceneCode: scene, allowedModels: ['synthetic-model'], allowedScenes: [scene], budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } },
        maxConcurrent: 1, maxCallsPerRun: 5 } })),
    tenant: [{ id: 'tenant-a', subscription: { id: 'sub-a', tenantId: 'tenant-a', revision: 1, plan: 'PRO', source: 'HISTORICAL_REGISTER',
      startAt: new Date('2026-01-01'), endAt: new Date('2099-01-01'), serviceTimeZone: 'UTC', billingAnniversary: new Date('2026-01-01') }, subscriptionSegments: [] }],
    subscriptionFeatureCatalog: [{ code: 'ai.native.use', name: 'Synthetic AI', module: 'ai', categories: [], currentOwnership: 'PRO', defaultOwnership: 'PRO',
      releaseStatus: 'RELEASED', valueText: null, externalFeeNote: null }],
    tenantFeatureGrant: [], aiTenantModelConfiguration: []
  });
  Object.assign(d.db, h.client(null, false));
  const transaction = d.db.$transaction.bind(d.db), active = new AsyncLocalStorage();
  // Auth's independent read transactions do not share Core's write transaction or simulate MySQL locks.
  d.db.$transaction = callback => active.getStore() ? callback(h.client(null, false)) : transaction(tx => active.run(true, () => callback(tx)));
  const policyDependencies = { db: d.db, auth: h.auth, credentials: d.credentials,
    subscriptions: new SubscriptionService(d.db), toolVersion: d.toolVersion, clock: d.clock };
  const policy = () => new (require('../../../apps/api/src/modules/ai-native/approval-execution/persisted-approved-order-policy.authority').PersistedApprovedOrderPolicyAuthority)(policyDependencies);
  return { ...h, policyDependencies, policy };
}
module.exports = { persistedApprovedOrderHarness };
