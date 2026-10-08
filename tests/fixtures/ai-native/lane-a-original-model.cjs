'use strict';
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setup } = require('./lane-a-original-request.cjs');
const { clone } = require('./task-input-store.cjs');
const { composeAiOriginalSceneModel } = require('../../../apps/api/src/modules/ai-native/scenes/original-scene-model.composition');
const { aiPersistenceScopeColumns } = require('../../../apps/api/src/modules/ai-native/persistence-scope');
const { TASK_TEXT_MODEL_TOOL } = require('../../../apps/api/src/modules/ai-native/model-input/task-model-input');
const { PrismaGatewayInvocationBindings } = require('../../../apps/api/src/modules/ai-native/budget/prisma-gateway-invocation-bindings');
const { PrismaGatewayAccountingFacts } = require('../../../apps/api/src/modules/ai-native/budget/prisma-gateway-accounting-facts');
const { AI_TOOL_DRAFT_VERSION } = require('./local-shared.cjs');

exports.originalModelApplicationHarness = async (sceneCode = 'order_explanation') => {
  const profile = { id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', configRevision: 1, credentialRef: 'vault-a',
    protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic-model', serviceMode: 'tenant_managed', enabled: true, disabledAt: null };
  const tables = Object.fromEntries(['aiTaskResultArtifact', 'aiGatewayInvocation', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge',
    'aiTaskEvent', 'aiTaskInputRequest', 'aiTaskInputReceipt', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission', 'aiBudgetReservation'].map(key => [key, []]));
  const h = await setup({ ...tables, aiProviderProfile: [profile] }), beforeWrite = h.control.beforeWrite;
  h.control.beforeRead = async (table, args) => {
    if (table === 'aiGatewayInvocation' && typeof args.where?.fencingToken === 'string') {
      args.where.fencingToken = new (require('../../../apps/api/node_modules/@prisma/client').Prisma.Decimal)(args.where.fencingToken);
    }
  };
  h.control.beforeWrite = async (table, args, data) => {
    await beforeWrite?.(table, args, data);
    if (!args.where && table === 'aiTask') { args.data.cancelRequestedAt ??= null; args.data.updatedAt ??= h.dependencies.clock(); }
    if (!args.where && ['aiGatewayInvocation', 'aiGatewayAccountingReceipt'].includes(table)) args.data.id ??= randomUUID();
    if (!args.where && table === 'aiGatewayAccountingReceipt') Object.assign(args.data, { usageHash: null, inputTokens: null, outputTokens: null });
  };
  for (const [id, scope] of [['scope-platform', { kind: 'platform' }], ['scope-tenant', { kind: 'tenant', tenantId: 'tenant_001' }]]) {
    h.state.aiScope.push({ id, ...aiPersistenceScopeColumns(scope) });
  }
  h.state.aiBudgetPolicy = clone(h.b.h.state.aiBudgetPolicy).map(row => JSON.parse(JSON.stringify(row)
    .replaceAll('tenant-a', 'tenant_001').replaceAll('synthetic-clarification', sceneCode)));
  const policy = h.state.aiTaskPlanPolicy.find(row => row.sceneCode === sceneCode);
  policy.allowedTools = [{ code: TASK_TEXT_MODEL_TOOL, version: AI_TOOL_DRAFT_VERSION }];
  policy.limits = { ...h.b.h.plan.limits, maxTotalMs: 30000, maxStepMs: 5000 };
  const created = await h.app.create(h.command(sceneCode)), taskId = created.task.taskId, reference = h.ref(created.receipt.inputRef);
  for (const operation of ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task',
    'read_step_terminal', 'request_input', 'submit_input', 'resume_input']) {
    h.state.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId, operation, revision: 1,
      requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  }
  const execution = { sent: [], events: [], routeReads: 0, beforeTransport: null,
    result: { text: 'Synthetic authorized explanation', usage: { inputTokens: 1, outputTokens: 2 } } };
  let model, bindings, financial;
  // Routing, admission, monetary lifecycle and transport are explicit offline doubles; financial reads use the real persisted adapter.
  const ports = {
    routing: { resolve: async (_caller, required) => {
      execution.routeReads++;
      const context = await model.runtime.authorization.execution.authorize(taskId);
      return { context, consumerScope: { id: 'scope-a', kind: 'WORKSPACE', tenantId: 'tenant_001', workspaceId: 'workspace-a' },
        route: { profile: clone(h.state.aiProviderProfile[0]), scope: { id: 'scope-tenant', kind: 'TENANT', tenantId: 'tenant_001' },
          role: 'DEFAULT', preflight: { allowed: true, required, missing: [], stale: [] } }, selection: { mode: 'tenant_managed', revision: 1 },
        scene: 'chat', requiredCapabilities: required };
    }, assertCurrent: async (_caller, route) => {
      assert.equal(route.route.profile.configRevision, h.state.aiProviderProfile[0].configRevision);
    } },
    admission: { admit: async value => {
      const row = { ...value, id: randomUUID(), tenantId: value.scope.tenantId, workspaceId: value.scope.workspaceId,
        status: 'admitted', revokedAt: null, completedAt: null, dispatchId: null };
      await h.db.aiInvocationAdmission.create({ data: row }); return row;
    } },
    dispatch: { claim: async binding => {
      const changed = await h.db.aiInvocationAdmission.updateMany({ where: { id: binding.id, dispatchId: null }, data: { dispatchId: binding.dispatchId } });
      assert.equal(changed.count, 1); execution.events.push('claim');
    }, finish: async (binding, status) => {
      await h.db.aiInvocationAdmission.updateMany({ where: { id: binding.id, dispatchId: binding.dispatchId }, data: { status } });
    } },
    budget: { reserve: async call => {
      const bound = await bindings.resolveForReserve(call.context, call.request), a = bound.association;
      const row = { id: randomUUID(), scopeId: 'scope-a', scopeKind: 'WORKSPACE', tenantId: call.context.tenantId,
        workspaceId: call.context.workspaceId, actorId: bound.actorId, sceneCode: bound.sceneCode, callId: a.requestId,
        requestId: a.requestId, idempotencyKey: a.idempotencyKey, runId: a.runId, stepId: a.stepId, actionId: a.actionId,
        configRevision: a.config.configRevision, configurationHash: require('../../../apps/api/src/modules/rental-core/rental-idempotency.repository').requestFingerprint(a.config),
        priceVersion: a.priceVersion, status: 'reserved', dispatchState: 'not_dispatched' };
      await h.db.aiBudgetReservation.create({ data: row }); await financial.link(call, row.id); return { id: row.id };
    }, dispatch: async (call, id) => {
      await h.db.aiBudgetReservation.updateMany({ where: { id }, data: { dispatchState: 'dispatched' } });
      await financial.dispatch(call, id); execution.events.push('dispatch');
    }, settle: async (call, id, _key, usage) => {
      await financial.recordUsage(call, id, usage);
      await h.db.aiBudgetReservation.updateMany({ where: { id }, data: { status: 'settled' } }); execution.events.push('settle');
    }, abandon: async (_call, id, reason) => {
      await h.db.aiBudgetReservation.updateMany({ where: { id }, data: { status: 'pending_reconciliation' } }); execution.events.push(reason);
    } },
    audit: { append: async () => {} },
    transport: { invoke: async (_context, request, _route, signal) => {
      assert.equal(signal.aborted, false); execution.sent.push(clone(request));
      if (execution.beforeTransport) await execution.beforeTransport(signal);
      return clone(execution.result);
    }, stream: async function* () { throw Error('invoke-only fixture'); } }
  };
  model = composeAiOriginalSceneModel({ ...h.dependencies, scene: { code: sceneCode, version: '1' },
    gatewayScene: { sceneCode, routeScene: 'chat', maxOutputTokens: 64 }, priceVersion: 'price-1',
    runtime: { ports, evidence: 'mock', verifyEvidence: async () => true } });
  bindings = new PrismaGatewayInvocationBindings(h.db, model.runtime.authorization.scopes, h.dependencies.clock);
  financial = new PrismaGatewayAccountingFacts(h.db, bindings, model.runtime.authorization.scopes,
    { quantity: async () => { throw Error('pricing not exercised by dispatch evidence'); } }, h.dependencies.clock);
  const run = { inputSource: h.b.h.source, financialEvidence: financial };
  const app = model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, run);
  return { ...h, created, reference, model, run, app, execution, financial };
};
