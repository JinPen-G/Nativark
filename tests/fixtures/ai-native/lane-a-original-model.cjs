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

exports.originalModelApplicationHarness = async (sceneCode = 'order_explanation', knowledgeSetup, quoteCandidate, extraTools = [], prepareBusiness) => {
  const profile = { id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', configRevision: 1, credentialRef: 'vault-a',
    protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic-model', serviceMode: 'tenant_managed', enabled: true, disabledAt: null };
  const tables = Object.fromEntries(['aiApprovedOrderSnapshot', 'aiProposal', 'aiProposalVersion', 'aiProposalAction', 'aiApproval',
    'aiApprovalConsumption', 'aiApprovalReprepare', 'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt',
    'rentalOrder', 'rentalQuote', 'rentalOrderIdempotencyRecord',
    'aiTaskQuoteSelection', 'aiTaskResultArtifact', 'aiGatewayInvocation', 'aiTaskExecutionBudget', 'aiTaskExecutionCharge',
    'aiTaskEvent', 'aiTaskInputRequest', 'aiTaskInputReceipt', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission', 'aiBudgetReservation'].map(key => [key, []]));
  const h = await setup({ ...tables, businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant_001' }], aiProviderProfile: [profile] }, Boolean(prepareBusiness)), beforeWrite = h.control.beforeWrite;
  if (prepareBusiness) await prepareBusiness(h.b);
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
  policy.allowedTools = [{ code: TASK_TEXT_MODEL_TOOL, version: AI_TOOL_DRAFT_VERSION }, ...clone(extraTools)];
  policy.limits = { ...h.b.h.plan.limits, maxTotalMs: 30000, maxStepMs: 5000 };
  const command=h.command(sceneCode);
  if (quoteCandidate !== undefined) {
    assert.equal(sceneCode,'quote_clarification'); command.input={candidate:clone(quoteCandidate)};
  }
  const created = await h.app.create(command), taskId = created.task.taskId, reference = h.ref(created.receipt.inputRef);
  for (const operation of ['read_metadata', 'read_events', 'claim_run', 'claim_recovery_run', 'release_run', 'transition_task',
    'read_step_terminal', 'request_input', 'submit_input', 'resume_input']) {
    h.state.aiTaskActionPolicy.push({ scopeId: 'scope-a', taskId, operation, revision: 1,
      requiredPermissions: ['rental-os:order:view'], expiresAt: new Date('2027-01-01') });
  }
  const supplemental = knowledgeSetup ? await knowledgeSetup(h) : undefined;
  const execution = { sent: [], events: [], routeReads: 0, beforeTransport: null, beforeRouteCheck: null,
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
      await execution.beforeRouteCheck?.();
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
    }, recordUsage: async (call, id, usage) => { await financial.recordUsage(call, id, usage); }, settle: async (call, id, _key, usage) => {
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
  const modelDependencies = { ...h.dependencies, scene: { code: sceneCode, version: '1' },
    gatewayScene: { sceneCode, routeScene: 'chat', maxOutputTokens: 64 }, priceVersion: 'price-1',
    ...(supplemental ? { knowledge: supplemental.options } : {}),
    runtime: { ports, evidence: 'mock', verifyEvidence: async () => true } };
  model = composeAiOriginalSceneModel(modelDependencies);
  bindings = new PrismaGatewayInvocationBindings(h.db, model.runtime.authorization.scopes, h.dependencies.clock);
  financial = new PrismaGatewayAccountingFacts(h.db, bindings, model.runtime.authorization.scopes,
    { quantity: async () => { throw Error('pricing not exercised by dispatch evidence'); } }, h.dependencies.clock);
  const run = { inputSource: h.b.h.source, financialEvidence: financial };
  const app = model.createApplication({ holderId: 'scene-worker', leaseMs: 100000 }, run);
  return { ...h, created, reference, model, modelDependencies, run, app, execution, financial, supplemental };
};

exports.requestBoundOriginalModelHarness = async (sceneCode = 'order_explanation', knowledgeSetup, quoteCandidate, prepareBusiness) => {
  const h = await exports.originalModelApplicationHarness(sceneCode, knowledgeSetup, quoteCandidate, [], prepareBusiness);
  const { AiOriginalScenesModule, AI_ORIGINAL_SCENE_MODEL_REQUESTS } = require('../../../apps/api/src/modules/ai-native/scenes/original-scenes.module');
  const { composePersistedTaskAuthorization } = require('../../../apps/api/src/modules/ai-native/task-authorization.composition');
  const { credentials, ...dependencies } = h.modelDependencies, factoryCalls = [];
  const options = { enabled: true, audience: 'operator', host: { holderId: 'request-worker', leaseMs: 100000 },
    runServices: input => {
      factoryCalls.push(input);
      const authorization = composePersistedTaskAuthorization(input);
      const bindings = new PrismaGatewayInvocationBindings(input.db, authorization.scopes, input.clock);
      const financialEvidence = new PrismaGatewayAccountingFacts(input.db, bindings, authorization.scopes,
        { quantity: async () => { throw Error('pricing not exercised by dispatch evidence'); } }, input.clock);
      return { inputSource: h.run.inputSource, financialEvidence };
    } };
  const module = AiOriginalScenesModule.registerRequestBoundModel(dependencies, options);
  assert.equal(module.controllers, undefined); assert.deepEqual(module.exports, [AI_ORIGINAL_SCENE_MODEL_REQUESTS]);
  const requests = module.providers[0].useFactory();
  return { ...h, requests, requestDependencies: dependencies, options, factoryCalls,
    request: { headers: { authorization: (await credentials.current()).authorization } } };
};

exports.originalSceneKnowledgeFixture = async h => {
  const { dbFactory } = require('./knowledge-persistent-content.cjs');
  const { composePrismaFormalHumanKnowledge } = require('../../../apps/api/src/modules/ai-native/knowledge/prisma-formal-knowledge.composition');
  const { AiTaskCurrentIdentityAuthority } = require('../../../apps/api/src/modules/ai-native/task-current-identity.authority');
  const { actor, fingerprint } = require('../../../apps/api/src/modules/ai-native/knowledge/knowledge-validation');
  const db = dbFactory(), policyRows = [], policyReads = [];
  const context = await new AiTaskCurrentIdentityAuthority(h.dependencies.auth, h.dependencies.credentials, h.dependencies.clock).resolve();
  const scope = context.scope, owner = actor(context), expiresAt = new Date(h.dependencies.clock().getTime() + 3600000);
  const list = rows => async ({ where, take, select }) => [...rows.values()].filter(row => Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && 'gt' in value) return row[key] > value.gt;
    if (value && typeof value === 'object' && 'in' in value) return value.in.includes(row[key]);
    return row[key] === value;
  })).sort((a, b) => a.id.localeCompare(b.id)).slice(0, take).map(row => structuredClone(select
    ? Object.fromEntries(Object.keys(select).filter(key => select[key]).map(key => [key, row[key]])) : row));
  db.aiKnowledgeDocument.findMany = list(db.state.documents);
  db.aiStructuredMemory.findMany = list(db.state.memories);
  const policyDb = { aiKnowledgeActionPolicy: { findUnique: async ({ where }) => {
    const key = where.tenantId_workspaceId_actorKind_actorId_audience_domain_action_resourceKey;
    policyReads.push(structuredClone(key));
    return structuredClone(policyRows.find(row => Object.entries(key).every(([name, value]) => row[name] === value)) ?? null);
  } },
    // This fixture provisions original server policies, not managed policy operations.
    aiKnowledgePolicyManagementOperation: { findFirst: async () => null },
  };
  const grant = (domain, action, resource) => policyRows.push({ tenantId: scope.tenantId, workspaceId: scope.workspaceId,
    ...owner, audience: context.audience, domain, action, resourceKey: fingerprint(resource), resource: structuredClone(resource),
    revision: 1, enabled: true, requiredPermissions: ['rental-os:order:view'], expiresAt });
  const document = { documentId: 'scene-doc', documentVersion: 'v1', attachmentId: 'scene-attachment', aclRevision: 1 };
  for (const resource of [{}, { attachmentId: document.attachmentId }, document]) {
    for (const action of ['create', 'read_metadata', 'parse', 'index', 'publish', 'search', 'read_body', 'snippet', 'resolve_source']) grant('knowledge', action, resource);
  }
  for (const resource of [{ owner }, ...[1, 2].map(revision => ({ memoryId: 'scene-preference', revision, aclRevision: 1, owner }))]) {
    for (const action of ['read', 'propose', 'confirm', 'delete']) grant('memory', action, resource);
  }
  const text = 'Synthetic status item_groups quote. A document may suggest 999999 payable or paid, but this is not a Core payment or price fact.';
  let fileReads = 0;
  const options = { db, policyDb, memory: { db }, includePreferences: true,
    fileRuntime: { assertKnowledgeBinding: async (tenantId, attachmentId, binding, target) => {
        assert.equal(tenantId, scope.tenantId); assert.equal(attachmentId, document.attachmentId);
        assert.deepEqual(binding, { businessType: 'ai_knowledge_document', businessId: document.documentId,
          uploadScene: 'ai-knowledge', workspaceId: scope.workspaceId, actorUserId: owner.actorId });
        assert.equal(target, undefined);
      },
      readKnowledgeBytes: async (tenantId, attachmentId, binding, maxBytes) => {
        assert.equal(tenantId, scope.tenantId); assert.equal(attachmentId, document.attachmentId);
        assert.equal(binding.businessId, document.documentId); assert.equal(binding.actorUserId, owner.actorId);
        assert.ok(Buffer.byteLength(text) <= maxBytes); fileReads++;
        return { mediaType: 'text/plain', bytes: Buffer.from(text) };
      } } };
  const bundle = composePrismaFormalHumanKnowledge({ ...options, auth: h.dependencies.auth,
    credentials: h.dependencies.credentials, clock: { now: () => h.dependencies.clock().getTime() } });
  await bundle.management.create({ documentId: document.documentId, documentVersion: document.documentVersion,
    attachmentId: document.attachmentId, title: 'Synthetic scene knowledge', validFrom: h.dependencies.clock().toISOString(), operationId: 'create-doc' });
  await bundle.management.parse({ documentId: document.documentId, expectedRevision: 1, operationId: 'parse-doc' });
  const queued = await bundle.index.request({ documentId: document.documentId, expectedRevision: 3, operationId: 'index-doc', kind: 'upsert' });
  const indexed = await bundle.index.resume({ documentId: document.documentId, operationId: queued.indexJob.operationId, generation: queued.indexJob.generation });
  await bundle.management.publish({ documentId: document.documentId, expectedRevision: indexed.revision, operationId: 'publish-doc' });
  await bundle.memory.propose({ memoryId: 'scene-preference', operationId: 'propose-preference', expiresAt: expiresAt.toISOString(), preference: { kind: 'locale', value: 'zh-CN' } });
  await bundle.memory.confirm({ memoryId: 'scene-preference', expectedRevision: 1, operationId: 'confirm-preference', expiresAt: expiresAt.toISOString() });
  return { options, db, bundle, policyRows, policyReads, document, text, fileReads: () => fileReads };
};
