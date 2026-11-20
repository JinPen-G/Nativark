'use strict';
/** 标准客户入口原资料→Task→模型→回答续程。真实 ClientAuth/Guard/ClientApi/Core、
 * Controller、runner 与 Gateway；复用原会话行锁和原 Task 回滚运输夹具。
 * node --no-compilation-cache packages/ai-native-server/test/client-selected-transactions.test.cjs --deps <node_modules>
 * 无磁盘输出、服务、默认 Client、真实模型或数据库。 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { load, loader, shared, identity, runtime, aiPersistenceScopeColumns } = require('./original-scene-transactions.test.cjs');
const root = path.resolve(__dirname, '../../..');
// Reuse the original ClientAuth fixture definitions without executing its test
// main or modifying any assertion. Production code is loaded unmodified.
const sessionFile = path.join(root, 'tests/client-current-session-lease.test.cjs');
const sessionText = fs.readFileSync(sessionFile, 'utf8');
const fixtureEnd = sessionText.indexOf('\nconst rejected =');
assert(fixtureEnd > 0);
const sessionRequire = name => name === 'ts-node' ? { register() {} }
  : name.startsWith('.') || name.startsWith('@rental-os/')
    ? loader.load(loader.resolveSource(sessionFile, name, true)) : loader.requireDependency(name);
const { fixture: sessionFixture, signed, secret } = new Function('require', sessionText.slice(0, fixtureEnd)
  + '\nreturn { fixture, signed, secret };')(sessionRequire);
const storeFile = path.join(root, 'tests/fixtures/ai-native/task-input-store.cjs'), storeModule = { exports: {} };
new Function('require', 'module', 'exports', fs.readFileSync(storeFile, 'utf8'))(
  name => name === '../../../apps/api/node_modules/@prisma/client' ? { Prisma: runtime } : createRequire(storeFile)(name),
  storeModule, storeModule.exports);
const { createTaskInputStore, clone } = storeModule.exports;
const { ClientAuthService } = load('packages/rental-core/src/mysql-client-auth.ts');
const { ClientApiService } = load('packages/rental-core/src/mysql-client-application.ts');
const { RentalCoreFactRepository } = load('packages/rental-core/src/mysql-core-facts.ts');
const { createRentalAuthorization } = load('packages/rental-core/src/http-auth.ts');
const { createRentalApplicationAccess } = load('packages/rental-core/src/application-access.ts');
const { captureRentalClientInternalAuthority, captureRentalInternalAuthority } = load('packages/rental-core/src/application-internal-authority.ts');
const { createAiGuardedClientSession } = load('packages/ai-native-server/src/runtime/client-scene.composition.ts');
const { composeStandardClientBookingEntry, WebsiteClientEntryController, WechatClientEntryController, AI_WEBSITE_ENTRY, AI_WECHAT_ENTRY } =
  load('packages/ai-native-server/src/runtime/scenes/standard-client-entry.application.ts');
const { AI_NATIVE_CLIENT_ENTRY_PROVIDERS } = load('packages/ai-native-server/src/runtime/ai-native-application.providers.ts');
const { PrismaClientSceneMaterialRepository } = load('packages/ai-native-server/src/runtime/scenes/prisma-client-scene-material.repository.ts');
const { AI_BODY_STORAGE, AiBodyStorageCodec } = load('packages/ai-native-server/src/runtime/privacy/ai-body-storage.codec.ts');
const { SecretBox } = loader.load(loader.resolveSource(__filename, '@rental-os/platform-server/secret-box', true));
const { ConfigService } = loader.requireDependency('@nestjs/config');

function fixture(channel = 'web', options = {}) {
  const authRows = sessionFixture(), now = new Date(), expiresAt = new Date(now.getTime() + 600000);
  const scopes = [{ kind: 'platform' }, { kind: 'tenant', tenantId: 'tenant' },
    { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }].map((value, index) =>
      ({ id: `scope-${index}`, ...aiPersistenceScopeColumns(value) }));
  const sceneCode = 'quote_clarification', sceneVersion = '1';
  const workspace = { ...authRows.state.workspace, clientChannelPublications: [{ tenantId: 'tenant', enabled: true }] };
  const profile = { id: 'channel-profile', tenantId: 'tenant', revision: 1,
    publishedWorkspaces: [{ workspaceId: 'workspace', enabled: true, workspace }], defaultWorkspaceId: 'workspace' };
  const settings = scope => ({ draftVersion: 'ain-c07-draft-2', config: { configRevision: 1 },
    scope: scope.kind === 'PLATFORM' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant' }, sceneCode,
    allowedScenes: [sceneCode], allowedModels: ['synthetic-model'], maxConcurrent: 1, maxCallsPerRun: 1,
    budget: { state: 'limited', quantity: { unit: 'calls', value: 10 } },
    gates: Object.fromEntries(['platform', 'tenant', 'scene'].map(kind => [kind, { enabled: true, revision: 1 }])) });
  const store = createTaskInputStore({
    ...Object.fromEntries((options.tables ?? []).map(name => [name, []])),
    aiScope: scopes, aiTask: [], aiRun: [], aiStep: [], aiTaskExecutionCharge: [], aiTaskRunPlan: [], aiTaskEvent: [],
    aiClientSceneMaterial: [], aiClientTaskInput: [], operationLog: [], tenantAppearanceProfile: [], miniProgramChannel: [],
    tenant: [{ ...authRows.state.tenant, name: '商户', subscription: { startAt: now, endAt: expiresAt }, subscriptionSegments: [] }],
    businessWorkspace: [workspace], clientChannelProfile: [profile],
    clientChannelWorkspace: [{ id: 'published-workspace', tenantId: 'tenant', workspaceId: 'workspace', profileId: profile.id, enabled: true }],
    websiteChannelProfile: [{ id: 'website', tenantId: 'tenant', revision: 1, enabled: true }],
    aiClientTaskPolicy: [{ id: 'b77ec266-e3a2-48a4-98be-d5b49222d5b1', tenantId: 'tenant', workspaceId: 'workspace',
      channel, customerType: 'personal', sceneCode, sceneVersion, enabled: true, allowRead: true, allowCreate: true,
      allowExecute: true, allowRequestInput: true, allowSubmitInput: true, allowResumeInput: true, revision: 1, expiresAt }],
    aiBudgetPolicy: scopes.map(scope => ({ id: `${scope.id}-budget`, scopeId: scope.id, scopeKind: scope.kind,
      sceneCode, enabled: true, configRevision: 1, settingsJson: settings(scope) })),
    rentalOrder: [{ id: 'own-order', tenantId: 'tenant', workspaceId: 'workspace', status: 'RESERVED', categoryCode: 'CAMERA',
      customerId: 'customer', customerType: 'PERSONAL', customerName: '客户', orderNo: 'SYNTHETIC-ORDER', createdBy: 'staff',
      rentalAmount: 100, serviceAmount: 0, discountAmount: 0, couponAmount: 0, depositAmount: 20, preAuthAmount: 0, finalPayableAmount: 100,
      startAt: now, endAt: expiresAt, createdAt: now, updatedAt: now, lines: [], reservations: [], allocations: [], currency: 'CNY' }],
  }, { aiTask: [['id'], ['scopeId', 'audience', 'ownerKind', 'ownerId', 'creationKey']], aiClientSceneMaterial: [['id']] });
  const state = { grant: 'enabled', beforeQuery: undefined, beforeWrite: undefined, lost: undefined,
    scope: undefined, authRows, events: [], inWrite: false, guardCalls: 0 };
  const wrap = (reader, authReader, owner, readOnly) => {
    const rawQuery = reader.$queryRaw, rawExecute = reader.$executeRaw;
    const sessionReader = authReader ?? authRows.db;
    const db = { ...reader, clientAuthSession: sessionReader.clientAuthSession,
      customerAccount: sessionReader.customerAccount, customerMembership: sessionReader.customerMembership };
    db.$queryRaw = async (query, ...values) => {
      const q = Array.isArray(query) ? runtime.sql(query, ...values) : query, sql = q.sql.replace(/\s+/gu, ' ').trim();
      if (readOnly) assert(!/FOR UPDATE|LOCK IN SHARE MODE/u.test(sql), '只读快照不能取行锁');
      state.events.push({ owner, sql, identity: identity.getRequestIdentity() });
      await state.beforeQuery?.(sql, reader, owner);
      if (/FROM (Tenant|customer_profiles|customer_accounts|client_auth_sessions|customer_memberships) /u.test(sql)
        && sql.endsWith('FOR UPDATE')) {
        assert(authReader, '会话行锁必须在原事务中');
        return authReader.$queryRaw(q);
      }
      if (sql.includes('FROM Tenant')) return [{ id: 'tenant', status: authRows.state.tenant.status.toLowerCase() }];
      if (sql.includes('FROM platform_core_access_locks')) return [{ tenantId: 'tenant', coreId: 'rental' }];
      if (sql.includes('FROM platform_tenant_core_grants')) return [{ state: state.grant, revision: 1n, operationId: 'grant' }];
      if (sql.includes('FROM platform_core_bindings')) return [{ bindingId: 'binding', revision: 1n, dataVersion: '0.1.0',
        containerType: 'rental-workspace', containerId: 'workspace' }];
      if (sql.includes('platform_member_core_assignments') || sql.includes('auth_sessions') && !sql.includes('client_auth_sessions'))
        throw Error('客户不能借用营运成员权限');
      if (sql.includes('FROM `rental_orders`')) return reader.rentalOrder.findMany({ where: { tenantId: q.values[0], workspaceId: q.values[1], id: q.values[2] } });
      if (sql.includes('FROM ai_client_scene_materials')) {
        const [tenantId, workspaceId, channel, principalHash, reference] = q.values;
        const field = sql.includes('AND operationKey =') ? 'operationKey' : 'id';
        return reader.aiClientSceneMaterial.findMany({ where: { tenantId, workspaceId, channel, principalHash, [field]: reference } });
      }
      return rawQuery(q);
    };
    db.$executeRaw = async q => {
      assert(!readOnly, '只读快照不能写入');
      const sql = q.sql.replace(/\s+/gu, ' ').trim();
      state.events.push({ owner, sql, identity: identity.getRequestIdentity() });
      if (sql.startsWith('INSERT INTO ai_client_scene_materials')) {
        const fields = sql.match(/\(([^)]+)\) VALUES/u)[1].split(',').map(value => value.trim());
        const row = Object.fromEntries(fields.map((field, index) => [field, clone(q.values[index])]));
        for (const field of ['command', 'material', 'publication']) row[field] = JSON.parse(row[field]);
        await db.aiClientSceneMaterial.create({ data: row });
        return 1;
      }
      if (sql.startsWith('INSERT INTO ai_client_task_inputs') && state.lost === 'input') store.control.loseReply = true;
      return rawExecute(q);
    };
    return db;
  };
  const db = wrap(store.db, undefined, 'root', false), originalTransaction = store.db.$transaction;
  const secrets = new SecretBox(new ConfigService({ NODE_ENV: 'test', INTEGRATION_ENCRYPTION_KEY: 'synthetic-client-selected-body-key' }));
  Object.defineProperty(db, AI_BODY_STORAGE, { value: new AiBodyStorageCodec(secrets) });
  let sequence = 0;
  db.$transaction = (consume, options) => {
    const owner = `tx-${++sequence}`, readOnly = options?.isolationLevel === 'RepeatableRead';
    state.events.push({ owner, isolation: options?.isolationLevel });
    if (readOnly) return originalTransaction(tx => consume(wrap(tx, undefined, owner, true)), options);
    // These are two cooperating pieces of one in-memory transport: original
    // ClientAuth row locks plus original AI draft/rollback; production opens one tx.
    return authRows.tx(authTx => originalTransaction(async tx => {
      state.inWrite = true;
      try { return await consume(wrap(tx, authTx, owner, false)); }
      finally { state.inWrite = false; }
    }, options));
  };
  store.control.beforeWrite = async (table, args, draft) => {
    state.events.push({ write: table, identity: identity.getRequestIdentity() });
    // This end-to-end host uses the wall clock; model the schema's now()
    // default instead of the older task fixture's fixed October timestamp.
    if (!args.where && args.data) {
      const defaults = row => ({ createdAt: new Date(), ...row });
      args.data = Array.isArray(args.data) ? args.data.map(defaults) : defaults(args.data);
    }
    if (table === 'operationLog') args.data.id ??= randomUUID();
    await state.beforeWrite?.(table, args, draft);
    if (table === 'aiClientSceneMaterial' && state.lost === 'material'
      || table === 'aiRun' && state.lost === 'task') store.control.loseReply = true;
  };
  const auth = new ClientAuthService(db, {}, {}, {}), authorization = createRentalAuthorization(shared);
  const guard = new authorization.Guard({}, undefined, auth, { assertAllowed: async () => {} }, db);
  const canActivate = guard.canActivate.bind(guard);
  guard.canActivate = (...args) => { state.guardCalls++; return canActivate(...args); };
  const access = createRentalApplicationAccess({ database: db, authorization,
    term: { requireNewBusiness: async () => { throw Error('本片不执行租赁业务'); } },
    deploymentForTransaction: () => ({ requireAvailable: async () => {} }) });
  const orders = new RentalCoreFactRepository(db, { ...identity,
    resolveWorkspaceId: async (_tx, tenantId) => { assert.equal(tenantId, identity.getRequestTenantId()); return identity.getRequestWorkspaceId(); } });
  const client = new ClientApiService(db, auth, {}, {
    getOrder: (tenantId, orderId) => orders.findOrder(tenantId, orderId), listCategories: () => [],
    getBusinessSettings: async () => ({ fulfillment: { enabledModes: [] } }),
  }, {}, {}, {}, {}, {}, { catalog: async () => ({ configs: [] }) }, {}, {}, {}, null);
  const subscriptions = { readCategoryCommercialContext: async () => ({ revision: 1, serviceStatus: 'active', newBusinessAllowed: true,
    entitlements: [{ code: 'ai.native.use', available: true, categories: [] }] }) };
  const dependencies = { db, client, guard, tasks: { db, subscriptions, sceneCode, sceneVersion }, transactions: { clientAuth: auth, orders } };
  const provider = AI_NATIVE_CLIENT_ENTRY_PROVIDERS.find(value => value.provide === (channel === 'web' ? AI_WEBSITE_ENTRY : AI_WECHAT_ENTRY));
  assert(provider);
  const application = provider.useFactory(db, guard, subscriptions, client, secrets, undefined, auth, orders,
    options.model ?? { enabled: false }, options.adapters);
  const controller = channel === 'web' ? new WebsiteClientEntryController(application) : new WechatClientEntryController(application);
  const base = channel === 'web' ? shared.AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedBasePath : shared.AI_CLIENT_ENTRY_HTTP_DRAFT.authenticatedWechatBasePath;
  const routes = { prepareOrderMaterial: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.prepareOrderMaterial,
    readOrderMaterialReceipt: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.readOrderMaterialReceipt,
    createTask: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.createTask, readTaskCreation: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskCreation,
    startTaskModel: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.startTaskModel, recoverTaskModel: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.recoverTaskModel,
    reconcileTaskModel: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.reconcileTaskModel, continueTaskInput: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.continueTaskInput,
    readTaskInput: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInput, submitTaskInput: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.submitTaskInput,
    readTaskInputReceipt: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskInputReceipt, readTaskModelResult: shared.AI_CLIENT_ENTRY_HTTP_DRAFT.readTaskModelResult };
  const invoke = (method, value, callback) => identity.runWithRequestIdentity({}, () => access.run(async () => {
    assert(routes[method]);
    const request = { method: 'POST', url: `/api/${base}/${routes[method]}`,
      headers: { authorization: `Bearer ${signed({ iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 60 })}` }, body: value, query: {} };
    assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
    return access.withRequest(request, async () => {
      state.scope = identity.getRequestIdentity();
      return callback ? callback(request) : controller[method](request, value);
    }, ['prepareOrderMaterial', 'createTask', 'startTaskModel', 'recoverTaskModel', 'continueTaskInput', 'submitTaskInput'].includes(method)
      ? undefined : { auditedRead: true });
  }));
  for (const key of Object.keys(store.state)) Object.defineProperty(state, key, { get: () => store.state[key] });
  return { ...store, db, state, auth, guard, client, application, controller, invoke, dependencies, channel, secrets };
}
const materialCommand = key => ({ operationKey: key, orderId: 'own-order' });
const rejected = error => ['AI_ACCESS_DENIED', 'AI_RESOURCE_UNAVAILABLE', 'AI_RESULT_UNKNOWN'].includes(error.getResponse?.().code);
const modelTables = ['aiTaskActionPolicy', 'aiTaskExecutionBudget', 'aiTaskInputRequest', 'aiTaskInputReceipt',
  'aiTaskResultArtifact', 'aiProviderProfile', 'aiTenantModelConfiguration', 'systemParameterSet', 'aiPlatformModelConnection',
  'aiProviderCapabilityEvidence', 'aiTextCapabilityReceipt', 'aiModelConfigurationOperation', 'aiInvocationAdmission',
  'aiBudgetReservation', 'aiBudgetAllocation', 'aiBudgetLedgerEntry', 'aiGatewayAccountingReceipt', 'aiGatewayInvocation',
  'aiTaskActionInput', 'aiTaskPlanPolicy', 'aiTaskExecutionPhaseStart', 'aiTaskExecutionPhaseReceipt', 'aiDataErasure'];
const modelLimits = { maxSteps: 10, maxCalls: 5, maxConcurrent: 1, maxTotalMs: 60000, maxStepMs: 15000, maxOutputBytes: 131072 };
async function modelFixture(transport, channel = 'web') {
  let f, sent = 0;
  f = fixture(channel, { tables: modelTables, model: { enabled: true, pricing: { kind: 'calls', priceVersion: 'client-calls-1' },
    systemPrompt: '解释原订单，只请求必要的租赁背景。', maxOutputTokens: 64, limits: modelLimits,
    clarification: true, host: { holderId: 'client-model-worker', leaseMs: 100000 } },
    adapters: [{ provider: 'openai_chat_completions', features: [], generate: async input => {
      assert.equal(f.state.inWrite, false, 'Provider 运输必须在业务事务外');
      assert.equal(input.signal.aborted, false); sent++;
      localModelTransports++;
      if (transport) return transport(f, input, sent);
      return { text: JSON.stringify({ kind: 'client-context-question-1', code: 'rental_requirements' }),
        usage: { inputTokens: 12, outputTokens: 18 } };
    } }] });
  await f.db.aiTaskPlanPolicy.create({ data: { scopeId: 'scope-2', sceneCode: 'quote_clarification', sceneVersion: '1',
    revision: 1, enabled: true, limits: modelLimits, allowedTools: [{ code: 'ai.model.text', version: shared.AI_TOOL_DRAFT_VERSION }],
    expiresAt: new Date(Date.now() + 600000) } });
  for (const row of f.state.aiBudgetPolicy) {
    row.settingsJson.allowedModels = ['offline-model']; row.settingsJson.maxCallsPerRun = 5;
  }
  const { tenantModelCredentialReference } = load('packages/ai-native-server/src/runtime/tenant-model-config.service.ts');
  const settings = { enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://model.invalid/v1',
    model: 'offline-model', timeoutMs: 1000, maxConcurrent: 1, maxOutputTokens: 64 };
  await f.db.aiTenantModelConfiguration.create({ data: { tenantId: 'tenant', revision: 1, mode: 'tenant_managed',
    serviceEnabled: true, settings, credentialsEncrypted: f.secrets.encrypt({ tenantId: 'tenant', protocol: settings.protocol,
      baseUrl: settings.baseUrl, model: settings.model, apiKey: 'synthetic-client-key' }) } });
  const profile = { id: 'client-model-profile', scopeId: 'scope-1', scopeKind: 'TENANT', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'tenant_managed', protocol: settings.protocol, provider: 'offline', model: settings.model,
    credentialRef: tenantModelCredentialReference('tenant', 1), configRevision: 1, enabled: true,
    allowedCapabilities: ['text'], disabledAt: null };
  await f.db.aiProviderProfile.create({ data: profile });
  await seedTextEvidence(f, profile);
  return { ...f, sent: () => sent };
}
async function seedTextEvidence(f, profile) {
  // Same formal receipt shape as original-scene-execution.test.cjs, with this
  // fixture's scope/profile. The real verifier validates every link. This is a
  // synthetic database sample, not a live supplier probe or real capability claim.
  const { capabilityProfileFingerprint } = load('packages/ai-native-server/src/runtime/capability-verification.ts');
  const { textProbeIntent, textProbeConfiguration, textDigest, textProbeEvidenceHash, TEXT_PROBE_METHOD, TEXT_PROBE_TTL_MS } =
    load('packages/ai-native-server/src/runtime/text-capability-probe.ts');
  const { PrismaTextCapabilityReceiptRepository, createPersistedTextCapabilityEvidence } =
    load('packages/ai-native-server/src/runtime/prisma-text-capability-receipt.repository.ts');
  const { requestFingerprint: hash } = load('packages/ai-native-server/src/runtime/rental-adapters/rental-idempotency.repository.ts');
  const now = new Date(Date.now() - 1000), prepared = textProbeIntent('client-offline-proof', 'scope-2');
  const context = { tenantId: 'tenant', workspaceId: 'workspace', actorId: 'probe-operator' };
  const fingerprint = capabilityProfileFingerprint(profile), configuration = textProbeConfiguration(profile, { kind: 'workspace', tenantId: 'tenant' });
  const descriptor = { command: { operationId: 'client-offline-proof', profileKey: profile.profileKey, profileFingerprint: fingerprint },
    context, scopeId: 'scope-2', profileId: profile.id, profileFingerprint: fingerprint, methodVersion: TEXT_PROBE_METHOD,
    callId: prepared.intent.requestId, intentHash: prepared.intentHash, challengeHash: prepared.challengeHash,
    configuration, configurationHash: hash(configuration), runId: 'probe-run', stepId: 'probe-step' };
  const observation = { admissionId: 'probe-admission', dispatchId: 'probe-dispatch', requestHash: 'a'.repeat(64), reservationId: 'probe-reservation',
    transport: 'node_https', matched: true, responseHash: textDigest(prepared.expected), usage: { inputTokens: 1, outputTokens: 2 },
    checkedAt: now.toISOString(), expiresAt: new Date(now.getTime() + TEXT_PROBE_TTL_MS).toISOString() };
  const stored = { id: 'probe-proof', descriptor, descriptorHash: hash(descriptor), observation, observationHash: hash(observation) };
  const common = { scopeId: descriptor.scopeId, taskId: 'probe-task', actorId: context.actorId, callId: descriptor.callId,
    runId: descriptor.runId, stepId: descriptor.stepId, actionId: 'probe-action', sceneCode: 'ai.capability.text', priceVersion: 'probe-price' };
  const accounting = { id: 'probe-accounting', scopeId: descriptor.scopeId, scopeKind: 'WORKSPACE', taskId: common.taskId,
    tenantId: 'tenant', workspaceId: 'workspace', invocationId: 'probe-invocation', admissionId: observation.admissionId,
    reservationId: observation.reservationId, dispatchToken: observation.dispatchId, requestHash: observation.requestHash,
    state: 'dispatched', inputTokens: 1n, outputTokens: 2n, usageDetails: null };
  accounting.usageHash = hash({ receiptId: accounting.id, invocationId: accounting.invocationId, admissionId: accounting.admissionId,
    reservationId: accounting.reservationId, dispatchToken: accounting.dispatchToken, requestHash: accounting.requestHash, usage: observation.usage });
  const rows = { aiTextCapabilityReceipt: stored,
    aiGatewayInvocation: { ...common, id: 'probe-invocation', intentHash: descriptor.intentHash, stepFingerprint: hash(descriptor.command),
      mode: 'invoke', maxOutputTokens: 32, configuration, configurationHash: descriptor.configurationHash },
    aiInvocationAdmission: { id: observation.admissionId, ...context, scopeKind: 'WORKSPACE', platformDedupKey: null,
      callId: descriptor.callId, requestHash: observation.requestHash, profileId: profile.id, dispatchId: observation.dispatchId,
      revokedAt: null, status: 'completed', completedAt: now }, aiGatewayAccountingReceipt: accounting,
    aiBudgetReservation: { ...common, id: observation.reservationId, scopeKind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace',
      requestId: descriptor.callId, idempotencyKey: descriptor.callId, configRevision: profile.configRevision, configurationHash: descriptor.configurationHash,
      dispatchState: 'completed', status: 'settled', billingMode: 'tenant_managed', unitKind: 'calls',
      actualTokens: null, actualCalls: 1, actualMoney: null, moneyCurrency: null },
    aiBudgetLedgerEntry: { id: 'probe-ledger', reservationId: observation.reservationId, scopeId: descriptor.scopeId, scopeKind: 'WORKSPACE', tenantId: 'tenant',
      kind: 'settle', inputTokens: null, outputTokens: null, calls: 1, moneyAmount: null, moneyCurrency: null, reason: null,
      evidenceHash: hash({ usageHash: accounting.usageHash, priceVersion: common.priceVersion, quantity: { unit: 'calls', value: 1 } }) } };
  for (const [table, data] of Object.entries(rows)) await f.db[table].create({ data });
  const input = { profile, capability: 'text', status: 'supported', source: 'connection_test', evidenceHash: textProbeEvidenceHash(stored),
    checkedAt: now, expiresAt: new Date(observation.expiresAt), details: { receiptId: stored.id,
      verification: { evidence: 'live', methodVersion: TEXT_PROBE_METHOD, capability: 'text', profileFingerprint: fingerprint } } };
  assert.equal(await new PrismaTextCapabilityReceiptRepository(f.db).verify(input), true);
  const evidence = createPersistedTextCapabilityEvidence(f.db);
  assert.equal((await evidence.record(input)).status, 'supported'); assert.equal((await evidence.preflight(profile, ['text'])).allowed, true);
}
async function assertAccounting(f, taskId, calls) {
  const invocations = await f.db.aiGatewayInvocation.findMany({ where: { taskId } });
  assert.equal(invocations.length, calls);
  for (const invocation of invocations) {
    const receipt = await f.db.aiGatewayAccountingReceipt.findFirst({ where: { invocationId: invocation.id } });
    assert(receipt); assert.equal(receipt.state, 'dispatched'); assert.equal(receipt.inputTokens, 12n); assert.equal(receipt.outputTokens, 18n);
    const reservations = await f.db.aiBudgetReservation.findMany({ where: { callId: invocation.callId } });
    assert.equal(reservations.length, 1); assert.equal(reservations[0].id, receipt.reservationId);
    assert.equal(reservations[0].status, 'settled'); assert.equal(reservations[0].actualCalls, 1); assert.equal(reservations[0].actualMoney, null);
    assert.equal(await f.db.aiBudgetAllocation.count({ where: { reservationId: receipt.reservationId } }), 3);
    assert.equal(await f.db.aiBudgetLedgerEntry.count({ where: { reservationId: receipt.reservationId, kind: 'settle' } }), 1);
  }
  const resources = await f.db.aiTaskExecutionBudget.findFirst({ where: { taskId } });
  assert(resources); assert.equal(resources.consumedCalls, BigInt(calls)); assert.equal(resources.reservedCalls, 0n);
  return resources;
}
let groups = 0, localModelTransports = 0, completed = false;
async function check(name, work) { await work(); groups++; console.log(`PASS ${name}`); }
async function main() {
  const priorSecret = process.env.AUTH_TOKEN_SECRET;
  process.env.AUTH_TOKEN_SECRET = secret;
  try {
    for (const channel of ['web', 'wechat_miniprogram']) await check(`${channel} 原 Controller 资料→收据→任务→收据与当前锁序`, async () => {
      const f = fixture(channel), command = materialCommand('normal');
      const material = await f.invoke('prepareOrderMaterial', command);
      assert.equal(material.state, 'observed');
      assert.equal((await f.invoke('readOrderMaterialReceipt', command)).materialRef, material.materialRef);
      const taskCommand = { materialRef: material.materialRef, creationKey: 'normal-task' };
      const created = await f.invoke('createTask', taskCommand);
      assert.equal(created.state, 'observed'); assert.equal(created.task.status, 'queued');
      const receipt = await f.invoke('readTaskCreation', taskCommand);
      assert.equal(receipt.task.taskId, created.task.taskId); assert.equal(f.state.aiTask.length, 1);
      assert.equal(f.state.aiRun.length, 1); assert.equal(f.state.aiClientTaskInput.length, 1);
      assert.equal(f.state.aiTask[0].ownerKind, 'CUSTOMER'); assert.equal(f.state.aiTask[0].audience, 'CLIENT');
      assert.equal(f.state.aiTask[0].ownerId, 'customer');
      assert.equal(f.state.aiClientSceneMaterial[0].material.__aiBody, 'rental-os-ai-body-1');
      assert.equal((await f.invoke('createTask', taskCommand)).task.taskId, created.task.taskId);
      const transactions = [...new Set(f.state.events.filter(event => event.sql?.endsWith('FOR UPDATE')).map(event => event.owner))];
      for (const owner of transactions) {
        const events = f.state.events.filter(event => event.owner === owner && event.sql).map(event => event.sql);
        assert.match(events[0], /^SELECT id FROM Tenant .*FOR UPDATE$/u);
        assert(events.findIndex(sql => sql.includes('platform_core_access_locks')) > events.findIndex(sql => sql.includes('client_auth_sessions')));
        assert(events.findIndex(sql => sql.includes('FROM `rental_orders`')) > events.findIndex(sql => sql.includes('platform_core_access_locks')));
      }
      assert(!f.state.events.some(event => event.sql?.includes('platform_member_core_assignments')));
    });
    await check('原客户桥保持原 context/ALS，拒绝复制、跨会话及营运桥', async () => {
      const f = fixture();
      await f.invoke('prepareOrderMaterial', materialCommand('bridge'), async request => {
        assert.equal(f.state.authRows.writes, 1, '普通 HTTP 认证仍更新活跃时间');
        const source = createAiGuardedClientSession(f.guard, { current: async () => ({ authorization: request.headers.authorization }) });
        assert.equal(await source.current(), request.client);
        await source.withRead('order', 'own-order', async context => {
          assert.equal(context, request.client); assert.equal(identity.getRequestIdentity(), f.state.scope);
        });
        let lease;
        await f.db.$transaction(async tx => {
          lease = await f.auth.lockCurrentSession(tx, request.client);
          await source.current(); await lease.revalidate();
          assert.equal(f.state.authRows.writes, 1, '持 Session 锁的内部复验不发根连接活跃写');
        }, { isolationLevel: 'Serializable' });
        await assert.rejects(() => lease.revalidate(), '已结束事务不能复用 Session 租约');
        assert.throws(() => captureRentalInternalAuthority());
        await assert.rejects(() => f.db.$transaction(tx => f.auth.lockCurrentSession(tx, { ...request.client }), { isolationLevel: 'Serializable' }));
        const ticket = captureRentalClientInternalAuthority();
        await assert.rejects(() => identity.runWithRequestIdentity(f.state.scope,
          () => ticket.runVerified({ ...request.client, sessionId: 'other-session' }, async () => assert.fail('不应恢复'))));
      });
    });
    await check('Core/会话/本人归属/发布撤回在原写事务回滚', async () => {
      for (const kind of ['core', 'session', 'owner', 'publication']) {
        const f = fixture(); let fired = false;
        f.state.beforeQuery = async (sql, tx, owner) => {
          if (owner === 'root' || fired || !sql.includes('FROM customer_profiles')) return;
          fired = true;
          if (kind === 'core') f.state.grant = 'disabled';
          if (kind === 'session') f.state.authRows.state.session.revokedAt = new Date();
          if (kind === 'owner') await tx.rentalOrder.updateMany({ where: { id: 'own-order' }, data: { customerId: 'another' } });
          if (kind === 'publication') await tx.clientChannelWorkspace.updateMany({ where: {}, data: { enabled: false } });
        };
        await assert.rejects(() => f.invoke('prepareOrderMaterial', materialCommand(kind)), rejected);
        assert(fired); assert.equal(f.state.aiClientSceneMaterial.length, 0); assert.equal(f.state.aiTask.length, 0);
      }
    });
    await check('person/enterprise、空间、渠道均不能借原资料', async () => {
      const f = fixture(), command = materialCommand('scope'), material = await f.invoke('prepareOrderMaterial', command);
      const task = { materialRef: material.materialRef, creationKey: 'scope-task' };
      for (const update of [() => { f.state.authRows.state.customer.customerType = 'corporate'; },
        () => { f.state.authRows.state.session.workspaceId = 'other-space'; }]) {
        update(); await assert.rejects(() => f.invoke('createTask', task));
        f.state.authRows.state.customer.customerType = 'personal'; f.state.authRows.state.session.workspaceId = 'workspace';
      }
      const other = composeStandardClientBookingEntry(f.dependencies, 'wechat_miniprogram');
      await assert.rejects(() => f.invoke('createTask', task, request => other.createTask(request, task)));
      assert.equal(f.state.aiClientTaskInput.length, 0); assert.equal(f.state.aiTask.length, 0);
      // The original own-order predicate retains an enterprise-paid order
      // whose recorded personal user is this client, without opening coworkers.
      f.state.rentalOrder[0].customerId = 'enterprise';
      f.state.rentalOrder[0].membershipSnapshot = { personalCustomerId: 'customer' };
      assert.equal((await f.invoke('prepareOrderMaterial', materialCommand('own-enterprise'))).state, 'observed');
      f.state.rentalOrder[0].membershipSnapshot = { personalCustomerId: 'coworker' };
      await assert.rejects(() => f.invoke('prepareOrderMaterial', materialCommand('coworker')));
    });
    await check('原资料、输入 claim、Task COMMIT 失回复只读原键不重建', async () => {
      for (const lost of ['material', 'input', 'task']) {
        const f = fixture(), command = materialCommand(`lost-${lost}`);
        if (lost === 'material') {
          f.state.lost = lost;
          await assert.rejects(() => f.invoke('prepareOrderMaterial', command), error => error.getResponse?.().code === 'AI_RESULT_UNKNOWN');
          f.state.lost = undefined;
          assert.equal((await f.invoke('readOrderMaterialReceipt', command)).state, 'observed');
          assert.equal(f.state.aiClientSceneMaterial.length, 1);
        } else {
          const material = await f.invoke('prepareOrderMaterial', command), task = { materialRef: material.materialRef, creationKey: `task-${lost}` };
          f.state.lost = lost;
          await assert.rejects(() => f.invoke('createTask', task), error => error.getResponse?.().code === 'AI_RESULT_UNKNOWN');
          f.state.lost = undefined;
          const receipt = await f.invoke('readTaskCreation', task);
          assert.equal(receipt.state, lost === 'task' ? 'observed' : 'unknown');
          assert.equal(f.state.aiClientTaskInput.length, 1); assert.equal(f.state.aiTask.length, lost === 'task' ? 1 : 0);
          await f.invoke('createTask', task); assert.equal(f.state.aiTask.length, lost === 'task' ? 1 : 0);
        }
      }
    });
    await check('缺同实例参加者及已选宿主直接写仓储均关闭', async () => {
      const f = fixture(), material = await f.invoke('prepareOrderMaterial', materialCommand('denied'));
      await f.invoke('prepareOrderMaterial', materialCommand('direct'), async () => {
        const original = f.state.aiClientSceneMaterial[0];
        await assert.rejects(() => new PrismaClientSceneMaterialRepository(f.db).save({ ...original, id: randomUUID(), operationKey: 'direct' }));
      });
      const unavailable = composeStandardClientBookingEntry({ ...f.dependencies, transactions: undefined }, 'web');
      await assert.rejects(() => f.invoke('prepareOrderMaterial', materialCommand('missing'), request =>
        unavailable.prepare(request, { operationKey: 'missing', command: { kind: 'order', orderId: 'own-order' } })));
      assert.equal(f.state.aiClientSceneMaterial.length, 1); assert(material.materialRef);
    });
    await check('原客户模型→等待回答→保存原收据→同Task继续及累计单账', async () => {
      const f = await modelFixture();
      const material = await f.invoke('prepareOrderMaterial', materialCommand('model'));
      const command = { materialRef: material.materialRef, creationKey: 'model-task' };
      const created = await f.invoke('createTask', command), taskId = created.task.taskId;
      const guards = f.state.guardCalls, at = performance.now();
      const started = await f.invoke('startTaskModel', command);
      assert.equal(started.execution.outcome.status, 'paused');
      console.log(JSON.stringify({ clientStartMs: Math.round(performance.now() - at), guardReads: f.state.guardCalls - guards }));
      assert.equal(f.state.aiTask[0].status, 'WAITING_INPUT'); assert.equal(f.sent(), 1);
      const budget = await assertAccounting(f, taskId, 1);
      const observed = await f.invoke('readTaskModelResult', command);
      assert.equal(observed.state, 'observed'); assert.equal(observed.resultPurpose, 'clarification');
      assert.equal(observed.authority, 'generated_text_not_business_fact');
      const question = await f.invoke('readTaskInput', command);
      const pending = question.question;
      const submission = { draftVersion: shared.AI_TASK_INPUT_DRAFT_VERSION, requestId: pending.requestId,
        expectedRevision: pending.revision, submissionKey: 'client-answer',
        answers: [{ fieldId: 'clarification_text', value: '用于周末拍摄，继续说明原订单。' }] };
      const saved = await f.invoke('submitTaskInput', { ...command, submission });
      assert.equal(f.sent(), 1); assert.equal(f.state.aiTaskInputReceipt.length, 1); assert.equal(f.state.aiRun.length, 2);
      const reference = { ...submission }; delete reference.answers; delete reference.draftVersion;
      const receipt = await f.invoke('readTaskInputReceipt', { ...command, submission: reference });
      assert.equal(receipt.state, 'observed'); assert.equal(receipt.receipt.receiptId, saved.receiptId);
      f.state.grant = 'disabled';
      await assert.rejects(() => f.invoke('continueTaskInput', { ...command, submission: reference }));
      f.state.grant = 'enabled';
      assert.equal(f.sent(), 1); assert.equal(f.state.aiTaskInputReceipt.length, 1);
      f.state.aiClientTaskPolicy[0].allowExecute = false;
      await assert.rejects(() => f.invoke('continueTaskInput', { ...command, submission: reference }));
      assert.equal((await f.invoke('readTaskInputReceipt', { ...command, submission: reference })).receipt.receiptId, saved.receiptId);
      assert.equal(f.sent(), 1); f.state.aiClientTaskPolicy[0].allowExecute = true;
      const continueAt = performance.now(), continueGuards = f.state.guardCalls;
      const continued = await f.invoke('continueTaskInput', { ...command, submission: reference });
      assert.equal(continued.execution.outcome.status, 'paused');
      console.log(JSON.stringify({ clientContinueMs: Math.round(performance.now() - continueAt), guardReads: f.state.guardCalls - continueGuards }));
      assert.equal(f.sent(), 2); assert.equal(f.state.aiTask.length, 1); assert.equal(f.state.aiRun.length, 2);
      const currentBudget = await assertAccounting(f, taskId, 2);
      assert.equal(currentBudget.policyFingerprint, budget.policyFingerprint); assert.equal(currentBudget.maxCalls, budget.maxCalls);
      assert.equal(f.state.aiRun[1].resourceOriginRunId, f.state.aiRun[0].id);
      assert.equal(f.state.aiRun[1].inputReceiptId, saved.receiptId);
      await assert.rejects(() => f.invoke('continueTaskInput', { ...command, submission: reference }));
      assert.equal(f.sent(), 2);
    });
    await check('小程序原模型回复丢失后只观察同Task/Invocation，不重发或退额度', async () => {
      const f = await modelFixture(async () => { throw Error('synthetic lost provider reply'); }, 'wechat_miniprogram');
      const material = await f.invoke('prepareOrderMaterial', materialCommand('unknown'));
      const command = { materialRef: material.materialRef, creationKey: 'unknown-task' };
      const created = await f.invoke('createTask', command), taskId = created.task.taskId;
      const started = await f.invoke('startTaskModel', command);
      assert.equal(started.execution.outcome.status, 'unknown'); assert.equal(f.sent(), 1);
      assert.equal(f.state.aiTask[0].status, 'WAITING_EXTERNAL'); assert.equal(f.state.aiStep[0].status, 'UNKNOWN');
      const original = f.state.aiGatewayInvocation.filter(row => row.taskId === taskId).map(row => [row.id, row.callId]);
      const reservations = f.state.aiBudgetReservation.filter(row => original.some(([, callId]) => callId === row.callId)).map(row => row.id);
      assert.equal(original.length, 1); assert.equal(reservations.length, 1);
      f.state.aiClientTaskPolicy[0].allowExecute = false;
      // The original recovery timing writer still requires its transition
      // policy. Revocation may deny recovery; it never authorizes redispatch.
      assert.equal((await f.invoke('reconcileTaskModel', command)).retryable, false);
      await assert.rejects(() => f.invoke('recoverTaskModel', command), rejected);
      assert.equal(f.sent(), 1);
      f.state.aiClientTaskPolicy[0].allowExecute = true;
      const recovered = await f.invoke('recoverTaskModel', command);
      assert.equal(recovered.execution.outcome.status, 'unknown');
      await assert.rejects(() => f.invoke('startTaskModel', command));
      assert.equal(f.sent(), 1); assert.equal(f.state.aiTask.length, 1); assert.equal(f.state.aiRun.length, 1);
      assert.deepEqual(f.state.aiGatewayInvocation.filter(row => row.taskId === taskId).map(row => [row.id, row.callId]), original);
      assert.deepEqual(f.state.aiBudgetReservation.filter(row => original.some(([, callId]) => callId === row.callId)).map(row => row.id), reservations);
      assert(f.state.aiTaskExecutionBudget[0].reservedCalls > 0n);
      assert.equal(f.state.aiBudgetLedgerEntry.filter(row => reservations.includes(row.reservationId) && row.kind === 'settle').length, 0);
    });
    await check('Vault后最后原RC事务重验Core/客户Session/执行策略，运输零发出', async () => {
      for (const kind of ['core', 'session', 'policy']) {
        const f = await modelFixture(), decrypt = f.secrets.decrypt.bind(f.secrets); let vault = false, revoked = false;
        const material = await f.invoke('prepareOrderMaterial', materialCommand(`vault-${kind}`));
        const command = { materialRef: material.materialRef, creationKey: `vault-${kind}` };
        const created = await f.invoke('createTask', command), taskId = created.task.taskId;
        f.secrets.decrypt = value => {
          const result = decrypt(value);
          if (result.apiKey && f.state.aiInvocationAdmission.some(row => row.dispatchId
            && f.state.aiGatewayInvocation.some(invocation => invocation.taskId === taskId && invocation.callId === row.callId))) vault = true;
          return result;
        };
        f.state.beforeQuery = async (sql, tx, owner) => {
          if (revoked || !vault || !sql.startsWith('SELECT id FROM Tenant ')
            || !f.state.events.some(event => event.owner === owner && event.isolation === 'ReadCommitted')) return;
          revoked = true;
          if (kind === 'core') f.state.grant = 'disabled';
          if (kind === 'session') f.state.authRows.state.session.revokedAt = new Date();
          if (kind === 'policy') {
            f.state.aiClientTaskPolicy[0].allowExecute = false;
            await tx.aiClientTaskPolicy.updateMany({ where: {}, data: { allowExecute: false } });
          }
        };
        await f.invoke('startTaskModel', command).catch(error => assert(rejected(error)));
        assert(vault && revoked, `${kind} 必须到达Vault后最后RC事务`);
        assert.equal(f.sent(), 0); assert.equal(f.state.aiTask.length, 1);
        assert.equal(f.state.aiGatewayInvocation.filter(row => row.taskId === taskId).length, 1);
      }
    });
    await check('原租约释放失败时reconcile只恢复同一占用，不发出新模型', async () => {
      const f = await modelFixture(async () => { throw Error('synthetic lost provider reply'); });
      const material = await f.invoke('prepareOrderMaterial', materialCommand('held'));
      const command = { materialRef: material.materialRef, creationKey: 'held' };
      await f.invoke('createTask', command); let releaseFailed = false;
      f.state.beforeWrite = async (table, args) => {
        if (table === 'aiRun' && args.data.leaseOwnerId === null && args.where && !releaseFailed) {
          releaseFailed = true; throw Error('synthetic original release rollback');
        }
      };
      await f.invoke('startTaskModel', command).catch(error => {
        assert(['AI_RESULT_UNKNOWN', 'AI_RESOURCE_UNAVAILABLE'].includes(error.getResponse?.().code));
        assert.equal(error.getResponse().retryable, false);
      });
      assert(releaseFailed); assert.equal(f.sent(), 1); assert.equal(f.state.aiRun[0].leaseOwnerId, 'client-model-worker');
      const observed = await f.invoke('reconcileTaskModel', command);
      assert.equal(observed.execution.outcome.status, 'unknown'); assert.equal(f.sent(), 1);
      assert.equal(f.state.aiTask.length, 1); assert.equal(f.state.aiRun.length, 1); assert.equal(f.state.aiStep.length, 1);
      assert.equal(f.state.aiGatewayInvocation.filter(row => row.taskId === f.state.aiTask[0].id).length, 1);
      assert(f.state.aiTaskExecutionBudget[0].reservedCalls > 0n);
    });
    await check('原Run/输入/本人不匹配与缺能力/预算均不能发出模型', async () => {
      const f = await modelFixture(), material = await f.invoke('prepareOrderMaterial', materialCommand('closed'));
      const command = { materialRef: material.materialRef, creationKey: 'closed' };
      await f.invoke('createTask', command);
      const cases = [['aiRun', 'actorId', 'coworker'], ['aiTask', 'inputHash', 'f'.repeat(64)],
        ['aiTask', 'ownerId', 'coworker'], ['aiProviderCapabilityEvidence', 'status', 'unverified'],
        ['aiBudgetPolicy', 'enabled', false]];
      for (const [table, field, value] of cases) {
        const row = f.state[table][0];
        const prior = row[field]; row[field] = value;
        try { await assert.rejects(() => f.invoke('startTaskModel', command)); }
        finally { f.state[table][0][field] = prior; }
        assert.equal(f.sent(), 0);
      }
      assert.equal(f.state.aiGatewayInvocation.filter(row => row.taskId === f.state.aiTask[0].id).length, 0);
    });
    completed = true;
    console.log(JSON.stringify({ groups, database: 'original session-lock and task-rollback memory transport',
      diskOutputs: 0, localModelTransports, realModelCalls: 0 }));
  } finally { if (priorSecret === undefined) delete process.env.AUTH_TOKEN_SECRET; else process.env.AUTH_TOKEN_SECRET = priorSecret; }
}
module.exports = { fixture };
if (require.main === module) {
  process.once('beforeExit', () => assert(completed || process.exitCode === 1, '客户片不能留下未结束等待'));
  main().catch(error => { console.error(error.stack, error.getResponse?.()); process.exitCode = 1; });
}
