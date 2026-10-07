'use strict';
const { AsyncLocalStorage } = require('node:async_hooks');
const { setup: businessSetup } = require('./lane-a-business-consumption.cjs');
const { createTaskInputStore, clone } = require('./task-input-store.cjs');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { SubscriptionService } = require('../../../apps/api/src/modules/subscription/subscription.service');
const { aiPersistenceScopeColumns } = require('../../../apps/api/src/modules/ai-native/persistence-scope');
const { composeAiOriginalScenes } = require('../../../apps/api/src/modules/ai-native/scenes/original-scenes.composition');
const { AI_SCENE_REQUEST_DRAFT_VERSION } = require('../../../packages/shared/src/ai-scene-request-draft');
const { order } = require('./authorization-baseline.cjs');

exports.setup = async () => {
  const b = await businessSetup(), tenantId = 'tenant_001';
  const scope = { id: 'scope-a', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId, workspaceId: 'workspace-a' }) };
  const tenant = clone(b.h.state.tenant[0]); tenant.id = tenantId; tenant.subscription.tenantId = tenantId;
  const sceneCodes = ['order_explanation', 'opening_diagnosis', 'quote_clarification'];
  const policies = sceneCodes.map(sceneCode => ({ scopeId: scope.id, sceneCode, sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [], limits: {}, expiresAt: new Date('2027-01-01T00:00:00Z') }));
  const store = createTaskInputStore({ aiScope: [scope], aiTaskOriginalRequest: [], aiTask: [], aiRun: [], aiStep: [], aiTaskRunPlan: [],
    aiTaskPlanPolicy: policies, tenant: [tenant], subscriptionFeatureCatalog: clone(b.h.state.subscriptionFeatureCatalog), tenantFeatureGrant: [] },
  { aiTaskOriginalRequest: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'requestKey']], aiTask: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'creationKey']] });
  const decorate = client => {
    const findTask = client.aiTask.findFirst.bind(client.aiTask);
    return { ...client, aiTask: { ...client.aiTask, findFirst: async args => {
      const row = await findTask({ ...args, select: undefined });
      if (!row || !args.select?.runs) return row;
      row.runs = await client.aiRun.findMany({ where: { taskId: row.id, sequence: 1 }, take: 1 });
      for (const run of row.runs) run.executionPlan = await client.aiTaskRunPlan.findFirst({ where: { taskId: row.id, runId: run.id } });
      return row;
    } }, aiScope: { ...client.aiScope, upsert: async args => {
      const row = store.state.aiScope.find(row => row.scopeKey === args.where.scopeKey); if (!row) throw Error('synthetic unexpected scope creation'); return clone(row);
    } } };
  };
  Object.assign(store.db, decorate(store.db));
  const active = new AsyncLocalStorage(), transaction = store.db.$transaction;
  store.db.$transaction = callback => active.getStore() ? callback(store.db) : transaction(tx => active.run(true, () => callback(decorate(tx))));
  store.control.beforeWrite = async (table, args) => {
    if (table === 'aiTask') Object.assign(args.data, { scope: clone(scope), archivedAt: null, resultRef: null });
  };
  b.facts.findOrder = async (_tenantId, id) => id === 'order-a' ? order({ tenantId }) : null;
  const guard = new ApiAuthGuard(b.h.authorization.auth, undefined, undefined, undefined, {
    rentalOrder: { findFirst: async ({ where }) => where.id === 'order-a' ? { id: 'order-a' } : null }
  });
  const creationRules = sceneCodes.map(sceneCode => ({ sceneCode, sceneVersion: '1', revision: 1, audiences: ['operator'],
    requiredPermissions: ['rental-os:order:operate'], maxInputAgeMs: 3600000 }));
  const dependencies = { db: store.db, auth: b.h.authorization.auth, credentials: b.h.authorization.credentials,
    subscriptions: new SubscriptionService(store.db), core: b.core, business: b.business, memberships: b.memberships,
    reports: b.reports, guard, creationRules, clock: () => new Date(b.h.control.now) };
  const app = composeAiOriginalScenes(dependencies);
  const command = (sceneCode = 'order_explanation', requestKey = 'original-a') => ({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, requestKey, sceneCode,
    input: sceneCode === 'order_explanation' ? { orderId: 'order-a', question: 'status' }
      : sceneCode === 'opening_diagnosis' ? { sections: ['item_groups'] } : { candidate: { customerType: 'personal' } } });
  return { ...store, b, app, dependencies, command, ref: inputRef => ({ draftVersion: AI_SCENE_REQUEST_DRAFT_VERSION, inputRef }) };
};
