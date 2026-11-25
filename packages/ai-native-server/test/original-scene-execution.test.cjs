'use strict';
/** Selected 三场景真实请求/准入/原事务回归。复用原 Auth/Guard/仓储夹具，
 * 不改变其45项断言；持久化与协议运输可控，授权、CAS、Gateway/预算均沿正式实现。
 * node packages/ai-native-server/test/original-scene-execution.test.cjs --deps <node_modules>
 * 全程零磁盘产物，不实例化Client、不连接业务库或真实模型。 */
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { AsyncLocalStorage } = require('node:async_hooks');
const { fixture, bodies, reference, load, loader, shared, identity, runtime, aiPersistenceScopeColumns, requestFingerprint } = require('./original-scene-transactions.test.cjs');
const extraTables = ['aiTaskActionPolicy','aiTaskExecutionBudget','aiTaskEvent','aiTaskInputRequest','aiTaskInputReceipt',
    'aiTaskResultArtifact','aiProviderProfile','aiTenantModelConfiguration','systemParameterSet','aiPlatformModelConnection',
    'aiProviderCapabilityEvidence','aiTextCapabilityReceipt','aiModelConfigurationOperation','aiInvocationAdmission',
    'aiBudgetPolicy','aiBudgetReservation','aiBudgetAllocation','aiBudgetLedgerEntry','aiGatewayAccountingReceipt',
    'aiConversation','aiConversationTurn','aiConversationTurnAcceptance','aiConversationModelDisclosure','rentalRuleVersion',
    'aiTaskExecutionPhaseStart','aiTaskExecutionPhaseReceipt','aiApprovedOrderSnapshot','aiProposal','aiApproval',
    'aiTaskRunPreparation','aiTaskRunOverhead','aiDataErasure','customerProfile'];
const { createOriginalTaskStartAdmission } = load('packages/ai-native-server/src/runtime/task-start-admission.composition.ts');
const { composeTaskExecutionAdmission } = load('packages/ai-native-server/src/runtime/task-execution-admission.application.ts');
const { composeAiOriginalScenes } = load('packages/ai-native-server/src/runtime/scenes/original-scenes.composition.ts');
const { composeRequestBoundPersistedOriginalSceneModel, composeRequestBoundPersistedOriginalOrderRead } = load('packages/ai-native-server/src/runtime/scenes/request-bound-scenes.application.ts');
const { withOriginalSceneTaskTransactions } = load('packages/ai-native-server/src/runtime/scenes/original-scene-transactions.ts');
const { createTaskProviderDispatchCheck } = load('packages/ai-native-server/src/runtime/task-provider-dispatch.ts');
const { RoutedModelTransport } = load('packages/ai-native-server/src/runtime/routed-model-transport.ts');
const { capabilityProfileFingerprint } = load('packages/ai-native-server/src/runtime/capability-verification.ts');
const { tenantModelCredentialReference } = load('packages/ai-native-server/src/runtime/tenant-model-config.service.ts');
const { textProbeIntent, textProbeConfiguration, textDigest, textProbeEvidenceHash, TEXT_PROBE_METHOD, TEXT_PROBE_TTL_MS } = load('packages/ai-native-server/src/runtime/text-capability-probe.ts');
const { PrismaTextCapabilityReceiptRepository, createPersistedTextCapabilityEvidence } = load('packages/ai-native-server/src/runtime/prisma-text-capability-receipt.repository.ts');
const { SecretBox } = load('packages/platform-server/src/common/secret-box.ts');
const { RentalCoreService } = load('packages/rental-core/src/mysql-core-runtime.ts');
const { MembershipService } = load('packages/rental-core/src/mysql-membership.ts');
const { RentalBusinessService } = load('packages/rental-core/src/mysql-business-runtime.ts');
const { RentalBusinessConfigRepository } = load('packages/rental-core/src/mysql-business-configuration.ts');
const { ConfigService } = loader.requireDependency('@nestjs/config');
const { AiOriginalQuoteModelExecutionController, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS } = load('packages/ai-native-server/src/runtime/scenes/original-scenes.controller.ts');
const { AiOriginalOpeningModelExecutionController, AI_ORIGINAL_OPENING_MODEL_REQUESTS } = load('packages/ai-native-server/src/runtime/scenes/opening-model-execution.controller.ts');
const { AiOriginalOrderReadController, AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS } = load('packages/ai-native-server/src/runtime/scenes/original-order-read.controller.ts');
const limits = { maxSteps: 10, maxCalls: 5, maxConcurrent: 1, maxTotalMs: 60000, maxStepMs: 15000, maxOutputBytes: 131072 };
let checks = 0;
const test = async (name, work) => { await work(); checks++; console.log('PASS ' + name); };
function setup(body = bodies[0]) {
  const f = fixture(body, false, Object.fromEntries(extraTables.map(name => [name, []])));
  f.db.aiPlatformModelConnection.update = async ({ where, data, select }) => {
    const changed = await f.db.aiPlatformModelConnection.updateMany({ where, data });
    assert.equal(changed.count, 1, '原单行更新必须命中一行');
    return f.db.aiPlatformModelConnection.findUnique({ where, select });
  };
  // Original result readers open separate default-isolation transactions inside
  // the input checkpoint. Model their MySQL repeatable-read snapshots without
  // queuing behind our outer write; the existing fixture rejects snapshot writes.
  // Explicit locking transactions still use the original serialized transport.
  const transaction = f.db.$transaction, transactionScope = new AsyncLocalStorage();
  f.control.inputTransactions = []; f.control.inputWrites = [];
  f.db.$transaction = (work, options) => {
    const snapshot = options?.isolationLevel === 'RepeatableRead' || transactionScope.getStore() && !options;
    const actualOptions = snapshot ? { ...options, isolationLevel: 'RepeatableRead' } : options;
    const transactionRecord = { isolation: actualOptions?.isolationLevel, nested: Boolean(transactionScope.getStore()), locks: 0 };
    f.control.inputTransactions.push(transactionRecord);
    return transaction(tx => transactionScope.run(true, async () => {
      const original = tx.$queryRaw;
      tx.$queryRaw = async (query, ...values) => {
        const q = Array.isArray(query) ? runtime.sql(query, ...values) : query;
        if (/FOR (?:UPDATE|SHARE)|LOCK IN SHARE MODE/iu.test(q.sql)) {
          transactionRecord.locks++;
          assert.equal(Boolean(snapshot), false, '只读快照不得取得行锁');
        }
        if (q.sql.includes('FROM ai_text_capability_receipts')) return tx.aiTextCapabilityReceipt.findMany({ where: { id: q.values[0] } });
        if (/FROM (?:ai_scopes|ai_task_plan_policies|ai_tasks|ai_runs|ai_steps|ai_task_run_|ai_task_execution_budgets|ai_task_input_requests|ai_budget_policies)/u.test(q.sql)) {
          f.trace.push('sql:' + q.sql.replace(/\s+/gu, ' ').trim());
          if (q.sql.includes('FROM ai_scopes')) return tx.aiScope.findMany({ where: { id: q.values[0] } });
          return [];
        }
        return original(query, ...values);
      };
      for (const table of ['aiTaskInputRequest', 'aiTaskInputReceipt']) for (const method of ['create', 'createMany', 'updateMany', 'upsert']) {
        const write = tx[table][method];
        if (typeof write === 'function') tx[table][method] = (...args) => {
          f.control.inputWrites.push({ table, method, isolation: actualOptions?.isolationLevel });
          assert.equal(Boolean(snapshot), false, '只读快照不得写问题或回答');
          return write(...args);
        };
      }
      return work(tx);
    }), actualOptions);
  };
  const configure = async () => {
    const policy = await f.db.aiTaskPlanPolicy.findFirst({ where: { sceneCode: body.sceneCode } });
    await f.db.aiTaskPlanPolicy.updateMany({ where: { sceneCode: body.sceneCode }, data: { ...policy, limits,
      allowedTools: [{ code: 'ai.model.text', version: shared.AI_TOOL_DRAFT_VERSION },
        ...(body.sceneCode === 'order_explanation' ? [{ code: 'rental.order.explain', version: shared.AI_TOOL_DRAFT_VERSION }] : [])] } });
    if (body.sceneCode === 'quote_clarification') {
      const member = await f.db.workspaceMember.findFirst({ where: {} });
      await f.db.workspaceMember.updateMany({ where: {}, data: { role: { ...member.role,
        permissions: [...member.role.permissions, { permission: { code: 'rental-os:order:create' } }] } } });
      const category = shared.RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'camera');
      assert(category, '正式相机品类不存在');
      // Explicit persisted-source sample; the real Core normalizer, request
      // identity and guarded AI preparation remain unchanged. No quote is made.
      const facts = { tenantId: 'tenant-a', workspaceId: 'workspace-a', categoryCode: category.code,
        profile: { tenantId: 'tenant-a', categoryCode: category.code, capabilities: [], terminology: { navigationLabels: {} } },
        settings: { tenantId: 'tenant-a', categoryCode: category.code, configVersion: 'fixture-v1',
          pricing: { enabledUnits: [...category.businessModel.pricingUnits], defaultUnit: category.businessModel.defaultPricingUnit,
            currency: 'CNY', taxIncluded: true, holidayPricingEnabled: false },
          fulfillment: { enabledModes: [...category.businessModel.fulfillmentModes] },
          payment: { enabledMethods: [...shared.DEFAULT_RENTAL_PAYMENT_METHODS] },
          calendar: { timeZone: 'Asia/Shanghai', weekendDays: [0, 6], holidayPricingEnabled: false } },
        groups: [], pricingGroups: [], couponTemplates: [], locations: [], operators: [] };
      const catalog = [{ id: 'group-camera', tenantId: 'tenant-a', categoryCode: 'camera', code: 'camera',
        name: '相机', status: 'enabled', unit: '台' }];
      const core = new RentalCoreService({ readQuoteConfigurationFacts: async (tenant, workspace) => {
        assert.equal(tenant, facts.tenantId); assert.equal(workspace, facts.workspaceId);
        return structuredClone(facts);
      }, listItemGroupsPage: async (tenant, workspace, query) => {
        assert.equal(tenant, facts.tenantId); assert.equal(workspace, facts.workspaceId);
        const rows = catalog.filter(row => (!query.itemGroupId || row.id === query.itemGroupId)
          && (!query.name || row.name === query.name) && (!query.cursor || row.id > query.cursor));
        assert(rows.length <= query.limit);
        return { rows: structuredClone(rows), source: 'persisted_workspace_configuration',
          configurationVersion: requestFingerprint(catalog), truncated: false, nextCursor: null };
      } }, f.orders);
      f.businessDependencies.core.readQuoteConfiguration = core.readQuoteConfiguration.bind(core);
      f.businessDependencies.core.listItemGroupsPage = core.listItemGroupsPage.bind(core);
      const members = new MembershipService(f.db);
      f.businessDependencies.memberships.listPersonalOptionsPage = members.listPersonalOptionsPage.bind(members);
      const originalRaw = f.db.$queryRaw;
      f.db.$queryRaw = async (query, ...values) => {
        const q = Array.isArray(query) ? runtime.sql(query, ...values) : query;
        if (!q.sql.includes('FROM rental_price_versions')) return originalRaw(query, ...values);
        assert.equal(q.values[0], 'tenant-a'); assert.equal(q.values[1], 'workspace-a');
        assert(q.values[2] instanceof Date);
        // Persisted SQL transport sample; the real price-version projection
        // validates target/unit identity. No amount, quote or approval is made.
        return [{ tenantId: 'tenant-a', workspaceId: 'workspace-a', id: 'price-version-a', sequence: 1,
          ratesType: 'ARRAY', rateCount: 1, rateIndex: 1, pricingGroupId: null, itemGroupId: 'group-camera', unit: category.businessModel.defaultPricingUnit }];
      };
      const configuration = new RentalBusinessConfigRepository(f.db, { ...identity,
        resolveWorkspaceId: async (_db, tenant) => { assert.equal(tenant, identity.getRequestIdentity().tenantId); return identity.getRequestWorkspaceId(); } });
      const business = new RentalBusinessService(configuration, f.input.transactions.quotes, {});
      f.businessDependencies.business.readQuoteRateTargets = business.readQuoteRateTargets.bind(business);
    }
    if (body.sceneCode === 'opening_diagnosis') {
      const category = shared.RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'camera');
      const facts = { tenantId: 'tenant-a', workspaceId: 'workspace-a', categoryCode: category.code, settingsRevision: 1,
        profile: { configVersion: 'fixture-v1', configurationRevision: 1, configurationSource: 'TenantRentalProfile', terminology: {} },
        settings: { configVersion: 'fixture-v1', pricing: { currency: 'CNY', enabledUnits: [...category.businessModel.pricingUnits],
          defaultUnit: category.businessModel.defaultPricingUnit }, fulfillment: { enabledModes: [...category.businessModel.fulfillmentModes] } },
        groups: [], pricingGroups: [], locations: [], truncated: { groups: false, pricingGroups: false, locations: false },
        enabledItemGroupCount: 0, enabledLocationCount: 0 };
      const core = new RentalCoreService({ readOpeningConfigurationFacts: async (tenant, workspace) => {
        assert.equal(tenant, facts.tenantId); assert.equal(workspace, facts.workspaceId); return structuredClone(facts);
      } }, f.orders);
      f.businessDependencies.core.readOpeningConfiguration = core.readOpeningConfiguration.bind(core);
    }
  };
  return { ...f, configure };
}
function preparedAdmission(f) {
  const originals = composeAiOriginalScenes(f.businessDependencies).requests;
  return composeTaskExecutionAdmission({ db: f.db, originals }, { ...f.businessDependencies, originals });
}
async function publishBudgets(f, body) {
  for (const [id, scope] of [['scope-platform', { kind: 'platform' }], ['scope-tenant', { kind: 'tenant', tenantId: 'tenant-a' }]])
    await f.db.aiScope.create({ data: { id, ...aiPersistenceScopeColumns(scope) } });
  for (const scope of await f.db.aiScope.findMany({ where: {} })) await f.db.aiBudgetPolicy.create({ data: {
    id: 'policy-' + scope.id, scopeId: scope.id, scopeKind: scope.kind, sceneCode: body.sceneCode, configRevision: 1, enabled: true,
    settingsJson: { draftVersion: shared.AI_USAGE_DRAFT_VERSION, scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant-a' },
      config: { configRevision: 1 }, gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
      sceneCode: body.sceneCode, allowedModels: ['offline-model'], allowedScenes: [body.sceneCode],
      budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } }, maxConcurrent: 1, maxCallsPerRun: 5 }
  } });
}
function modelRequests(f, body, { generate, ...options } = {}) {
  const { credentials: _, ...dependencies } = f.businessDependencies;
  const secrets = new SecretBox(new ConfigService({ NODE_ENV: 'test', AUTH_TOKEN_SECRET: 'offline-scene-fixture' }));
  const requests = body.sceneCode === 'order_explanation' ? composeRequestBoundPersistedOriginalOrderRead : composeRequestBoundPersistedOriginalSceneModel;
  return requests({ ...dependencies, scene: { code: body.sceneCode, version: '1' },
    gatewayScene: { sceneCode: body.sceneCode, routeScene: 'chat', maxOutputTokens: 64,
      ...(body.sceneCode === 'order_explanation' ? { orderExplainTool: true } : {}) },
    gateway: { secrets, platformProfileId: 'platform-profile', routeScene: 'chat', pricing: { kind: 'calls', priceVersion: 'offline-calls-1' },
      adapters: [{ provider: 'openai_chat_completions', features: ['tools'], generate: generate ?? (async () => { throw Error('缺配置/证据时不可派发'); }) }] }
  }, { enabled: true, audience: 'operator', host: { holderId: 'selected-scene-worker', leaseMs: 100000 },
    ...(body.sceneCode === 'order_explanation' ? { orderReadChain: { enabled: true, answerRoundTrip: true } } : {}),
    ...(body.sceneCode === 'quote_clarification' ? { inputContinuation: { db: f.db,
      currentRuntimeEnabled: async (scene, version) => scene === body.sceneCode && version === '1' } } : {}), ...options });
}
async function configureTenant(f, evidence) {
  const secrets = new SecretBox(new ConfigService({ NODE_ENV: 'test', AUTH_TOKEN_SECRET: 'offline-scene-fixture' }));
  const settings = { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://model.invalid/v1',
    model: 'offline-model', timeoutMs: 1000, maxConcurrent: 1, maxOutputTokens: 64 };
  await f.db.aiTenantModelConfiguration.create({ data: { tenantId: 'tenant-a', revision: 1, mode: 'tenant_managed',
    serviceEnabled: true, settings, credentialsEncrypted: secrets.encrypt({ tenantId: 'tenant-a', protocol: settings.protocol,
      baseUrl: settings.baseUrl, model: settings.model, apiKey: 'fixture-only-encrypted-key' }) } });
  const profile = { id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'tenant_managed', protocol: settings.protocol, provider: 'offline', model: settings.model,
    credentialRef: tenantModelCredentialReference('tenant-a', 1), configRevision: 1, enabled: true,
    allowedCapabilities: ['text', 'tools'], disabledAt: null };
  await f.db.aiProviderProfile.create({ data: profile });
  if (evidence === 'mock') for (const capability of profile.allowedCapabilities) await f.db.aiProviderCapabilityEvidence.create({ data: {
    id: 'evidence-' + capability, profileId: profile.id, scopeId: profile.scopeId, scopeKind: profile.scopeKind,
    capability, observedRevision: 1, status: 'supported', source: 'connection_test', evidenceHash: 'f'.repeat(64),
    checkedAt: new Date(Date.now() - 1000), expiresAt: new Date(Date.now() + 60000),
    details: { verification: { evidence: 'mock', methodVersion: 'fixture-only', capability,
      profileFingerprint: capabilityProfileFingerprint(profile) } }
  } });
  return profile;
}
async function seedVerifiedTextReceipt(f, profile) {
  // Synthetic native-receipt fixture, adapted from the original connection-test
  // regression. It verifies every persisted link with the production verifier;
  // it is not evidence that this test contacted or certified a live provider.
  const now = new Date(Date.now() - 1000), prepared = textProbeIntent('offline-proof', 'scope-a');
  const context = { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: (await f.db.user.findFirst({ where: {} })).id };
  const fingerprint = capabilityProfileFingerprint(profile), configuration = textProbeConfiguration(profile, { kind: 'workspace', tenantId: context.tenantId });
  const descriptor = { command: { operationId: 'offline-proof', profileKey: profile.profileKey, profileFingerprint: fingerprint },
    context, scopeId: 'scope-a', profileId: profile.id, profileFingerprint: fingerprint, methodVersion: TEXT_PROBE_METHOD,
    callId: prepared.intent.requestId, intentHash: prepared.intentHash, challengeHash: prepared.challengeHash,
    configuration, configurationHash: requestFingerprint(configuration), runId: 'probe-run', stepId: 'probe-step' };
  const observation = { admissionId: 'probe-admission', dispatchId: 'probe-dispatch', requestHash: 'a'.repeat(64), reservationId: 'probe-reservation',
    transport: 'node_https', matched: true, responseHash: textDigest(prepared.expected), usage: { inputTokens: 1, outputTokens: 2 },
    checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TEXT_PROBE_TTL_MS).toISOString() };
  const stored = { id: 'probe-proof', descriptor, descriptorHash: requestFingerprint(descriptor), observation, observationHash: requestFingerprint(observation) };
  const common = { scopeId: descriptor.scopeId, taskId: 'probe-task', actorId: context.actorId, callId: descriptor.callId,
    runId: descriptor.runId, stepId: descriptor.stepId, actionId: 'probe-action', sceneCode: 'ai.capability.text', priceVersion: 'probe-price' };
  const accounting = { id: 'probe-accounting', scopeId: descriptor.scopeId, scopeKind: 'WORKSPACE', taskId: common.taskId,
    tenantId: context.tenantId, workspaceId: context.workspaceId, invocationId: 'probe-invocation', admissionId: observation.admissionId,
    reservationId: observation.reservationId, dispatchToken: observation.dispatchId, requestHash: observation.requestHash,
    state: 'dispatched', inputTokens: 1n, outputTokens: 2n, usageDetails: null };
  accounting.usageHash = requestFingerprint({ receiptId: accounting.id, invocationId: accounting.invocationId, admissionId: accounting.admissionId,
    reservationId: accounting.reservationId, dispatchToken: accounting.dispatchToken, requestHash: accounting.requestHash, usage: observation.usage });
  const rows = {
    aiTextCapabilityReceipt: stored,
    aiGatewayInvocation: { ...common, id: 'probe-invocation', intentHash: descriptor.intentHash, stepFingerprint: requestFingerprint(descriptor.command),
      mode: 'invoke', maxOutputTokens: 32, configuration, configurationHash: descriptor.configurationHash },
    aiInvocationAdmission: { id: observation.admissionId, ...context, scopeKind: 'WORKSPACE', platformDedupKey: null,
      callId: descriptor.callId, requestHash: observation.requestHash, profileId: profile.id, dispatchId: observation.dispatchId,
      revokedAt: null, status: 'completed', completedAt: now },
    aiGatewayAccountingReceipt: accounting,
    aiBudgetReservation: { ...common, id: observation.reservationId, scopeKind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId,
      requestId: descriptor.callId, idempotencyKey: descriptor.callId, configRevision: profile.configRevision, configurationHash: descriptor.configurationHash,
      dispatchState: 'completed', status: 'settled', billingMode: profile.serviceMode, unitKind: 'calls',
      actualTokens: null, actualCalls: 1, actualMoney: null, moneyCurrency: null },
    aiBudgetLedgerEntry: { id: 'probe-ledger', reservationId: observation.reservationId, scopeId: descriptor.scopeId, scopeKind: 'WORKSPACE', tenantId: context.tenantId,
      kind: 'settle', inputTokens: null, outputTokens: null, calls: 1, moneyAmount: null, moneyCurrency: null, reason: null,
      evidenceHash: requestFingerprint({ usageHash: accounting.usageHash, priceVersion: common.priceVersion, quantity: { unit: 'calls', value: 1 } }) }
  };
  for (const [name, data] of Object.entries(rows)) await f.db[name].create({ data });
  const input = { profile, capability: 'text', status: 'supported', source: 'connection_test',
    evidenceHash: textProbeEvidenceHash(stored), checkedAt: now, expiresAt: new Date(observation.expiresAt),
    details: { receiptId: stored.id, verification: { evidence: 'live', methodVersion: TEXT_PROBE_METHOD, capability: 'text', profileFingerprint: fingerprint } } };
  assert.equal(await new PrismaTextCapabilityReceiptRepository(f.db).verify(input), true);
  const capabilities = createPersistedTextCapabilityEvidence(f.db);
  assert.equal((await capabilities.record(input)).status, 'supported');
  assert.equal((await capabilities.preflight(profile, ['text'])).allowed, true);
}
function transport(f, onVault = async () => {}, generate) {
  // This fixture isolates the real dispatch participant. Route/config data are
  // explicit input, not a successful persisted capability or financial grant.
  const profile = { id: 'profile-a', scopeId: 'scope-tenant', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'offline', model: 'offline-model',
    credentialRef: 'fixture-credential', configRevision: 1, enabled: true, allowedCapabilities: ['text'], disabledAt: null };
  const resolve = async () => {
    assert.equal(f.state.currentTx, undefined, 'Vault 不得占用业务事务');
    await onVault();
    return { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: 'https://model.invalid/v1',
      credential: 'fixture-only-credential', maxOutputTokens: 64 };
  };
  const connection = { resolve, assertCurrent: async () => {} };
  const gateway = new RoutedModelTransport({ platform: connection, tenant: connection },
    [{ provider: profile.protocol, features: [], generate }], undefined, createTaskProviderDispatchCheck(f.db, f.taskId));
  return () => gateway.invoke({ tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: identity.getRequestIdentity().userId },
    { callId: 'call-a', model: profile.model, messages: [{ role: 'user', content: 'offline dispatch boundary' }], maxOutputTokens: 32 },
    { profile, scope: { id: profile.scopeId, kind: 'TENANT', tenantId: 'tenant-a' }, role: 'DEFAULT',
      preflight: { allowed: true, required: ['text'], missing: [], stale: [] } }, new AbortController().signal);
}
async function assertOriginalAccounting(f, taskId, expectedCalls) {
  const invocations = await f.db.aiGatewayInvocation.findMany({ where: { taskId } });
  const accounting = await f.db.aiGatewayAccountingReceipt.findMany({ where: { taskId } });
  assert.equal(invocations.length, expectedCalls); assert.equal(accounting.length, expectedCalls);
  for (const invocation of invocations) {
    const receipt = accounting.find(row => row.invocationId === invocation.id);
    assert(receipt); assert.equal(receipt.state, 'dispatched');
    assert.equal(receipt.inputTokens, 12n); assert.equal(receipt.outputTokens, 18n);
    const admission = await f.db.aiInvocationAdmission.findUnique({ where: { id: receipt.admissionId } });
    assert.equal(admission.callId, invocation.callId); assert.equal(admission.status, 'completed');
    const reservations = await f.db.aiBudgetReservation.findMany({ where: { callId: invocation.callId } });
    assert.equal(reservations.length, 1);
    const reservation = reservations[0]; assert.equal(reservation.id, receipt.reservationId);
    assert.equal(reservation.status, 'settled'); assert.equal(reservation.dispatchState, 'completed');
    assert.equal(reservation.billingMode, 'tenant_managed'); assert.equal(reservation.unitKind, 'calls');
    assert.equal(reservation.actualCalls, 1); assert.equal(reservation.actualMoney ?? null, null);
    const settled = await f.db.aiBudgetLedgerEntry.findMany({ where: { reservationId: reservation.id, kind: 'settle' } });
    assert.equal(settled.length, 1); assert.equal(settled[0].calls, 1); assert.equal(settled[0].moneyAmount ?? null, null);
    assert.equal(await f.db.aiBudgetAllocation.count({ where: { reservationId: reservation.id } }), 3);
  }
  const budgets = await f.db.aiTaskExecutionBudget.findMany({ where: { taskId } });
  assert.equal(budgets.length, 1); assert.equal(budgets[0].consumedCalls, BigInt(expectedCalls));
  assert.equal(budgets[0].reservedCalls, 0n);
  return budgets[0];
}
function assertParentBeforePolicy(trace) {
  const write = trace.findIndex(entry => /^aiTaskActionPolicy\.(?:create|update)$/u.test(entry));
  assert(write >= 0, '须实际写入原policy CAS');
  const begin = trace.lastIndexOf('transaction.begin', write), transaction = trace.slice(begin, write);
  const parent = transaction.findIndex(entry => entry.includes('platform_core_access_locks'));
  const scope = transaction.findIndex(entry => entry.includes('FROM ai_scopes'));
  assert(parent >= 0 && scope > parent, 'Auth/Core参加者必须在原scope/policy锁之前');
}

async function main() {
  let successfulQuote;
  await test('三Controller固定13/6/17方法与唯一token，无额外驱动', async () => {
    const definitions = [
      [AiOriginalQuoteModelExecutionController, 13, AI_ORIGINAL_SCENE_PERSISTED_MODEL_REQUESTS],
      [AiOriginalOpeningModelExecutionController, 6, AI_ORIGINAL_OPENING_MODEL_REQUESTS],
      [AiOriginalOrderReadController, 17, AI_ORIGINAL_ORDER_READ_HTTP_REQUESTS],
    ];
    for (const [controller, count, token] of definitions) {
      const methods = Object.getOwnPropertyNames(controller.prototype).filter(name => name !== 'constructor' && Reflect.hasMetadata('path', controller.prototype[name]));
      assert.equal(methods.length, count); assert.equal(Reflect.getMetadata('self:paramtypes', controller)[0].param, token);
      assert.equal(new Set(methods.map(name => Reflect.getMetadata('path', controller.prototype[name]))).size, count);
    }
  });
  for (const body of [bodies[0], bodies[1], bodies[3]]) await test('真实启动准入在selected下保留身份与原CAS：' + body.sceneCode, async () => {
    const f = setup(body); await f.configure();
    const admission = createOriginalTaskStartAdmission(f.businessDependencies, body.sceneCode);
    await f.invoke(async request => {
      await f.createThroughRequest(request); const store = identity.getRequestIdentity(), at = f.trace.length;
      await admission(request, reference);
      assert.equal(identity.getRequestIdentity(), store);
      assert.equal(await f.db.aiTaskActionPolicy.count({}), body.sceneCode === 'quote_clarification' ? 11 : 8);
      assert.equal(await f.db.operationLog.count({}), body.sceneCode === 'quote_clarification' ? 11 : 8);
      const writes = f.trace.filter(entry => entry === 'aiTaskActionPolicy.create').length;
      await admission(request, reference);
      assert.equal(f.trace.filter(entry => entry === 'aiTaskActionPolicy.create').length, writes);
      const tail = f.trace.slice(at), tenantAt = tail.findIndex(entry => entry.includes('platform_core_access_locks'));
      assert(tenantAt >= 0 && tenantAt < tail.findIndex(entry => entry.includes('FROM ai_scopes')));
      assert(tail.findIndex(entry => entry.includes('business_workspaces')) < tail.findIndex(entry => entry.includes('FROM ai_task_plan_policies')));
      assert.equal(await f.db.aiGatewayInvocation.count({}), 0);
      assert.equal((await f.db.aiRun.findFirst({ where: {} })).status, 'QUEUED');
    });
  });
  for (const revoke of ['core', 'session', 'input']) await test('策略CAS末次复核撤销即回滚：' + revoke, async () => {
    const f = setup(); await f.configure();
    await f.invoke(async request => {
      await f.createThroughRequest(request);
      f.control.beforeWrite = async (table, _args, data) => {
        if (table !== 'aiTaskActionPolicy') return;
        if (revoke === 'core') f.state.grant = 'disabled';
        if (revoke === 'session') data.authSession[0].revokedAt = new Date();
        if (revoke === 'input') data.aiTaskOriginalRequest[0].contentHash = '0'.repeat(64);
      };
      await assert.rejects(createOriginalTaskStartAdmission(f.businessDependencies, bodies[0].sceneCode)(request, reference),
        error => error.code === 'AI_RESULT_UNKNOWN');
      assert.equal(await f.db.aiTaskActionPolicy.count({}), 0);
      assert.equal(await f.db.operationLog.count({}), 0);
      assert.equal(await f.db.aiGatewayInvocation.count({}), 0);
      assert.equal((await f.db.aiRun.findFirst({ where: {} })).status, 'QUEUED');
    });
  });
  await test('原策略提交失回复只读原CAS收据，不继续签发或启动', async () => {
    const f = setup(); await f.configure();
    await f.invoke(async request => {
      await f.createThroughRequest(request);
      const application = preparedAdmission(f), prepared = await application.prepare({ original: reference, intent: 'explicit_start' });
      assert.equal(prepared.phase, 'prepared');
      f.control.loseReply = true;
      const issued = await withOriginalSceneTaskTransactions(f.businessDependencies, reference,
        () => application.issue({ reference: prepared.reference, intent: 'explicit_start' }));
      assert.equal(issued.phase, 'issuance_requires_original_receipt'); assert.equal(issued.signing, 'unknown');
      assert.equal(issued.automaticRetry, false); assert.equal(issued.execution, 'not_started');
      assert.equal(await f.db.aiTaskActionPolicy.count({}), 1);
      assert.equal(await f.db.operationLog.count({}), 1);
      const writes = f.trace.filter(entry => entry === 'aiTaskActionPolicy.create').length;
      const receipt = await application.readReceipt(prepared.reference);
      assert.equal(receipt.entries.filter(entry => entry.state === 'recorded').length, 1);
      assert.equal(receipt.entries.filter(entry => entry.state === 'not_observed').length, 7);
      assert.equal(receipt.admission, 'not_granted'); assert.equal(receipt.automaticRetry, false);
      assert.equal(f.trace.filter(entry => entry === 'aiTaskActionPolicy.create').length, writes);
      assert.equal(await f.db.aiGatewayInvocation.count({}), 0);
    });
  });
  for (const mode of ['current', 'vault_revoked', 'lost_reply']) await test('真实派发参加者在Vault后复核，外部运输在事务外：' + mode, async () => {
    const f = setup(); await f.configure(); let sent = 0;
    await f.invoke(async request => {
      await f.createThroughRequest(request); await f.step();
      f.taskId = (await f.db.aiTask.findFirst({ where: {} })).id;
      const send = transport(f, async () => { if (mode === 'vault_revoked') f.state.assignment = 'removed'; }, async () => {
        assert.equal(f.state.currentTx, undefined, '外部运输不得占用业务事务'); sent++;
        if (mode === 'lost_reply') throw Error('synthetic lost provider reply');
        return { text: 'observed offline response', usage: { inputTokens: 1, outputTokens: 1 } };
      });
      const work = () => withOriginalSceneTaskTransactions(f.businessDependencies, reference, send);
      if (mode === 'current') assert.equal((await work()).text, 'observed offline response');
      else await assert.rejects(work());
      assert.equal(sent, mode === 'vault_revoked' ? 0 : 1);
      assert.equal(await f.db.aiGatewayInvocation.count({}), 1);
    });
  });
  for (const body of [bodies[0], bodies[1], bodies[3]]) await test('真实持久化请求工厂缺模型配置保持关闭：' + body.sceneCode, async () => {
    const f = setup(body); await f.configure();
    await f.invoke(async request => {
      await f.createThroughRequest(request);
      await createOriginalTaskStartAdmission(f.businessDependencies, body.sceneCode)(request, reference);
      const requests = modelRequests(f, body);
      await assert.rejects(requests.start(request, reference), error => error.code === 'AI_ACCESS_DENIED');
      assert.equal((await f.db.aiRun.findFirst({ where: {} })).status, 'QUEUED');
      await publishBudgets(f, body);
      await assert.rejects(requests.start(request, reference), error => error.code === 'DISABLED');
      assert.equal(await f.db.aiBudgetReservation.count({}), 0);
      assert.equal(await f.db.aiInvocationAdmission.count({}), 0);
      const run = await f.db.aiRun.findFirst({ where: {} });
      assert.equal(run.leaseOwnerId, null);
      assert.equal(await f.db.aiTaskActionInput.count({}), 0);
      const writes = f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length;
      if (body.sceneCode === 'order_explanation') {
        const result = await new AiOriginalOrderReadController(requests).readPreparation(request, reference);
        assert.equal(result.preparation.publishedInputs, 0); assert.equal(result.preparation.requiredInputs, 3);
        assert.equal(result.automaticRetry, false);
      } else {
        const Controller = body.sceneCode === 'opening_diagnosis' ? AiOriginalOpeningModelExecutionController : AiOriginalQuoteModelExecutionController;
        const result = await new Controller(requests).readExecution(request, reference);
        assert.equal(result.task.taskId, run.taskId); assert.equal(result.run.runId, run.id);
      }
      assert.equal(f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length, writes);
    });
  });
  for (const body of [bodies[0], bodies[1], bodies[3]]) await test('真实Gateway拒绝把mock能力证据作为生产授权：' + body.sceneCode, async () => {
    const f = setup(body); await f.configure(); await publishBudgets(f, body); await configureTenant(f, 'mock');
    await f.invoke(async request => {
      await f.createThroughRequest(request);
      await createOriginalTaskStartAdmission(f.businessDependencies, body.sceneCode)(request, reference);
      const requests = modelRequests(f, body);
      await assert.rejects(requests.start(request, reference), error => error.code === 'CAPABILITY_UNSUPPORTED');
      assert(f.trace.includes('aiProviderCapabilityEvidence.readMany'), '须经过真实持久能力校验');
      assert.equal(await f.db.aiBudgetReservation.count({}), 0);
      assert.equal(await f.db.aiInvocationAdmission.count({}), 0);
      assert.equal(await f.db.aiGatewayInvocation.count({}), 0);
    });
  });
  await test('真实报价继续工厂拒绝跨Task收据，无新策略、Run或模型调用', async () => {
    const f = setup(bodies[3]); await f.configure();
    await f.invoke(async request => {
      await f.createThroughRequest(request);
      const requests = modelRequests(f, bodies[3]), before = f.trace.length;
      await assert.rejects(requests.continueAnswer(request, { original: reference,
        reference: { taskId: 'other-task', requestId: 'other-request', expectedRevision: 1, submissionKey: 'other-submission' } }),
      error => error.code === 'AI_ACCESS_DENIED');
      assert.equal(f.trace.slice(before).filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length, 0);
      assert.equal(await f.db.aiTaskActionPolicy.count({}), 0);
      assert.equal(await f.db.aiRun.count({}), 1);
      assert.equal(await f.db.aiGatewayInvocation.count({}), 0);
    });
  });
  await test('真实报价准入→持久runner/Gateway→原结果与单账收据', async () => {
    const f = setup(bodies[3]); await f.configure(); await publishBudgets(f, bodies[3]);
    const profile = await configureTenant(f); await seedVerifiedTextReceipt(f, profile); let sent = 0;
    await f.invoke(async request => {
      await f.createThroughRequest(request);
      const admission = createOriginalTaskStartAdmission(f.businessDependencies, 'quote_clarification');
      const requests = modelRequests(f, bodies[3], { generate: async input => {
        assert.equal(f.state.currentTx, undefined); assert.equal(input.signal.aborted, false); sent++;
        return { text: JSON.stringify({ kind: 'quote_goal_candidates', draftVersion: shared.AI_QUOTE_GOAL_DRAFT_VERSION,
          conditions: { items: [{ productName: '相机', quantity: 1 }] }, unresolvedFields: ['customerType', 'start', 'end', 'locationName'] }),
        usage: { inputTokens: 12, outputTokens: 18 } };
      } });
      await admission(request, reference);
      const controller = new AiOriginalQuoteModelExecutionController(requests);
      const result = await controller.start(request, reference);
      assert.equal(result.execution.kind, 'run_outcome'); assert.equal(result.execution.outcome.status, 'paused');
      assert.equal(result.execution.outcome.completedSteps, 1); assert.equal(sent, 1);
      const task = await f.db.aiTask.findFirst({ where: { id: result.taskId } });
      const run = await f.db.aiRun.findFirst({ where: { id: result.runId } });
      assert.equal(task.status, 'WAITING_INPUT'); assert.equal(run.leaseOwnerId, null);
      const artifacts = await f.db.aiTaskResultArtifact.findMany({ where: { taskId: task.id } });
      assert.equal(artifacts.length, 1); assert.equal(artifacts[0].outcome, 'SUCCEEDED');
      const budget = await assertOriginalAccounting(f, task.id, 1);
      const beforeReads = f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length;
      const resultReference = { original: reference, resultId: artifacts[0].id };
      const observed = await requests.readModelResult(request, resultReference);
      assert.equal(observed.status, 'available'); assert.equal(observed.runId, run.id);
      assert.equal((await requests.readModelResult(request, resultReference)).callId, observed.callId);
      const input = await requests.readInput(request, reference);
      assert.equal(input.contract.code, 'original_quote_goal_parameters');
      assert.equal(f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length, beforeReads);
      assert.equal(sent, 1);
      successfulQuote = { f, requests, controller, taskId: task.id, originRunId: run.id, input, budget, sent: () => sent };
    });
  });
  await test('真实报价回答保存与显式续程沿原CAS、同Task资源和Gateway单账', async () => {
    const { f, requests, controller, taskId, originRunId, input, budget, sent } = successfulQuote;
    await f.invoke(async request => {
      const submission = { draftVersion: shared.AI_TASK_INPUT_DRAFT_VERSION, taskId, requestId: input.requestId,
        expectedRevision: input.revision, submissionKey: 'offline-answer-1', answers: input.contract.fields
          .filter(field => field.required || field.fieldId === 'clarification_text')
          .map(field => ({ fieldId: field.fieldId, value: field.kind === 'choice' ? field.options[0].value
            : field.kind === 'integer' ? 1 : field.fieldId === 'starts_at' ? '2027-02-01T00:00:00.000Z'
            : field.fieldId === 'ends_at' ? '2027-02-02T00:00:00.000Z' : '请继续说明还缺少哪些资料。' })) };
      assert.equal(shared.validateAiTaskInputAnswersDraft(input.contract, submission.answers), true);
      await f.db.aiTaskActionPolicy.updateMany({ where: { taskId, operation: 'submit_input' }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const submitAt = f.trace.length;
      const saved = await controller.submitAnswer(request, { original: reference, submission });
      assertParentBeforePolicy(f.trace.slice(submitAt));
      assert.equal(saved.continuation.kind, 'not_started'); assert.equal(saved.continuation.reason, 'answer_saved_without_execution');
      assert.equal(saved.orderApproval, 'not_granted'); assert.equal(sent(), 1);
      const receiptReference = { taskId, requestId: submission.requestId, expectedRevision: submission.expectedRevision,
        submissionKey: submission.submissionKey };
      const receipt = await requests.readAnswer(request, { original: reference, reference: receiptReference });
      assert.equal(receipt.state, 'observed'); assert.equal(receipt.receiptId, saved.receipt.receiptId);
      assert.equal(await f.db.aiTaskInputReceipt.count({ where: { taskId } }), 1);
      assert.equal(await f.db.aiRun.count({ where: { taskId } }), 2);
      const successor = await f.db.aiRun.findFirst({ where: { id: receipt.runId } });
      assert.equal(successor.resourceOriginRunId, originRunId); assert.equal(successor.inputReceiptId, receipt.receiptId);
      const beforeDenial = f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length;
      f.state.grant = 'disabled';
      try { await assert.rejects(controller.continueAnswer(request, { original: reference, reference: receiptReference })); }
      finally { f.state.grant = 'enabled'; }
      assert.equal(f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length, beforeDenial);
      assert.equal(sent(), 1);
      assert.equal((await requests.readAnswer(request, { original: reference, reference: receiptReference })).receiptId, saved.receipt.receiptId);
      await f.db.aiTaskActionPolicy.updateMany({ where: { taskId, operation: 'claim_run' }, data: { expiresAt: new Date(Date.now() - 1000) } });
      const continueAt = f.trace.length;
      const continued = await controller.continueAnswer(request, { original: reference, reference: receiptReference });
      assertParentBeforePolicy(f.trace.slice(continueAt));
      assert.equal(continued.receipt.receiptId, saved.receipt.receiptId);
      assert.equal(continued.execution.kind, 'run_outcome'); assert.equal(continued.execution.outcome.status, 'paused'); assert.equal(sent(), 2);
      const currentBudget = await assertOriginalAccounting(f, taskId, 2);
      assert.equal(currentBudget.policyFingerprint, budget.policyFingerprint);
      assert.equal(currentBudget.maxCalls, budget.maxCalls);
      assert.equal(await f.db.aiRun.count({ where: { taskId } }), 2);
      assert.equal(await f.db.aiTaskInputReceipt.count({ where: { taskId } }), 1);
      assert.equal((await requests.readAnswer(request, { original: reference, reference: receiptReference })).receiptId, saved.receipt.receiptId);
      assert(f.control.inputWrites.some(row => row.table === 'aiTaskInputReceipt' && row.method === 'create'));
      assert(f.control.inputWrites.every(row => row.isolation === 'Serializable'));
      const snapshots = f.control.inputTransactions.filter(row => row.isolation === 'RepeatableRead');
      assert(snapshots.some(row => row.nested)); assert(snapshots.every(row => row.locks === 0));
      const beforeReplay = f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length;
      await assert.rejects(controller.continueAnswer(request, { original: reference, reference: receiptReference }));
      assert.equal(f.trace.filter(entry => /\.(?:create|update|upsert)$/u.test(entry)).length, beforeReplay);
      assert.equal(sent(), 2);
    });
  });
  await test('部署停新后原报价恢复保留同Run/Step/Plan及原计量，不重新派发', async () => {
    const { f, controller, taskId, sent } = successfulQuote;
    const identities = async () => ({
      runs: (await f.db.aiRun.findMany({ where: { taskId }, orderBy: { sequence: 'asc' } })).map(row => row.id),
      steps: (await f.db.aiStep.findMany({ where: { taskId }, orderBy: { id: 'asc' } })).map(row => row.id),
      plans: (await f.db.aiTaskRunPlan.findMany({ where: { taskId }, orderBy: { runId: 'asc' } })).map(row => [row.runId, row.planHash]),
      calls: (await f.db.aiGatewayInvocation.findMany({ where: { taskId }, orderBy: { callId: 'asc' } })).map(row => row.callId)
    });
    const before = await identities(), sends = sent();
    f.state.admission = 'stopped';
    try {
      await f.invoke(async request => {
        const result = await controller.recover(request, reference);
        assert.equal(result.kind, 'run_outcome');
        assert.equal(result.outcome.status, 'paused');
      }, { recovery: true });
      assert.deepEqual(await identities(), before); assert.equal(sent(), sends);
    } finally { f.state.admission = 'accepting'; }
  });
  assert.equal(fs.existsSync(path.resolve(__dirname, '../../../output/.tmp/dev2-original-scene-transactions')), false);
  console.log(JSON.stringify({ checks, database: 'rollback-memory-transport', realModels: 0, diskOutputs: 0 }));
}
main().catch(error => { console.error(error.stack, error.getResponse?.() ?? ''); process.exitCode = 1; });
