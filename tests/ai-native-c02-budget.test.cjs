'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
process.env.TS_NODE_COMPILER_OPTIONS = JSON.stringify({ module: 'CommonJS', moduleResolution: 'Node' });
require('ts-node/register/transpile-only');
const { Prisma } = require('@prisma/client');
const { PrismaBudgetRepository } = require('../apps/api/src/modules/ai-native/budget/prisma-budget.repository.ts');
const { PersistedBudgetEvidenceAdapter, ServerBudgetAuthorityAdapter, SubscriptionBudgetEntitlementAdapter } = require('../apps/api/src/modules/ai-native/budget/budget-dependency-adapters.ts');
const { BudgetError } = require('../apps/api/src/modules/ai-native/budget/budget.ports.ts');
const { BudgetService } = require('../apps/api/src/modules/ai-native/budget/budget.service.ts');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');

const association = { requestId: 'req', runId: 'run', stepId: 'step', actionId: 'action', idempotencyKey: 'idem', priceVersion: 'price',
  scope: { kind: 'workspace', tenantId: 'tenant', workspaceId: 'workspace' }, config: { configId: 'cfg', configRevision: 2, credentialRef: 'vault', protocol: 'openai-compatible', provider: 'synthetic', model: 'model', tenantId: 'tenant', serviceMode: 'tenant_managed', configurationScope: { kind: 'tenant', tenantId: 'tenant' } } };
const record = { id: 'reservation', scopeId: 'workspace', scopeKind: 'WORKSPACE', actorId: 'actor', revision: 2, storageVersion: new Date('2026-10-04T12:00:00.000Z'), association, callId: 'call', sceneCode: 'scene', status: 'reserved', reserved: { unit: 'tokens', value: 10 }, actual: null, dispatched: true, unknownReason: null, expiresAt: new Date('2026-10-04T12:01:00.000Z') };

test('actual budget settings keep the authorized input across awaits and retain lost COMMIT as unknown', async () => {
  const now = new Date('2026-10-04T12:00:00Z');
  const key = { scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene' };
  const settings = { draftVersion: 'ain-c07-draft-2', scope: association.config.configurationScope, config: association.config,
    gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
    sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  const initial = structuredClone(settings), queries = [], writes = [];
  let mutate, loseCommit = false;
  const db = { $queryRaw: async () => [], aiBudgetPolicy: {
    findUnique: async args => { queries.push(structuredClone(args.where)); return null; },
    create: async ({ data }) => { writes.push(structuredClone(data)); return data; }
  }, $transaction: async callback => { const result = await callback(db); if (loseCommit) throw Error('COMMIT response lost'); return result; } };
  const context = { contractVersion: 'ain-c01-c02-draft-1', requestId: 'auth', authorizedAt: now.toISOString(), audience: 'operator',
    actor: { kind: 'user', userId: 'actor' }, scope: association.scope,
    access: { permissions: ['ai:manage'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } } };
  const authority = { resolve: async () => { mutate?.(); return { context, entitled: true, authorizationKey: 'grant', expiresAt: new Date(now.getTime() + 60000) }; } };
  const unavailable = async () => { throw Error('no invocation in settings'); };
  const service = new BudgetService(new PrismaBudgetRepository(db), authority, { quote: unavailable }, { dispatch: unavailable, usage: unavailable }, () => now);
  mutate = () => { key.sceneCode = 'other-scene'; };
  assert.equal(await service.settings(key), null);
  assert.equal(queries[0].scopeId_scopeKind_sceneCode.sceneCode, 'scene');
  key.sceneCode = 'scene';
  mutate = () => { key.sceneCode = 'other-scene'; settings.allowedModels[0] = 'other-model'; settings.budget.quantity.value = 999; };
  const saved = await service.saveSettings(key, settings, 0);
  assert.equal(saved.sceneCode, 'scene'); assert.deepEqual(saved.settings, initial);
  assert.equal(writes[0].sceneCode, 'scene'); assert.deepEqual(writes[0].settingsJson, initial);
  mutate = undefined; loseCommit = true;
  const second = { ...initial, sceneCode: 'scene-second', allowedScenes: ['scene-second'] };
  await assert.rejects(service.saveSettings({ ...key, sceneCode: 'scene-second' }, second, 0), error => error.code === 'PENDING_RECONCILIATION');
  assert.equal(writes.length, 2, 'unknown reply does not rerun the write');
  assert.equal(writes[1].sceneCode, 'scene-second');
  loseCommit = false; db.aiBudgetPolicy.updateMany = async () => ({ count: 0 });
  await assert.rejects(service.saveSettings({ ...key, sceneCode: 'scene' }, initial, 1), error => error.code === 'REVISION_CONFLICT');
  assert.equal(writes.length, 2, 'real CAS conflict does not become unknown or write again');
});

test('budget settings and indexed unit/currency projections commit together without stale money metadata', async () => {
  const key = { scopeId: 'platform', scopeKind: 'PLATFORM', sceneCode: 'scene' };
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'platform' }, config: association.config,
    gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
    sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'money', amount: '10.250000', currency: 'USD', scale: 6 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  let row, failRevalidation = false;
  const db = { aiBudgetPolicy: { create: async ({ data }) => { row = structuredClone(data); return row; },
    updateMany: async ({ data }) => { const revision = row.configRevision; Object.assign(row, structuredClone(data)); row.configRevision = revision + data.configRevision.increment; return { count: 1 }; },
    findUnique: async () => row }, aiBudgetAllocation: { findFirst: async () => null },
    $transaction: async work => { const before = structuredClone(row); try { return await work(db); } catch (error) { row = before; throw error; } } };
  const repository = new PrismaBudgetRepository(db);
  await repository.saveSettings(key, settings, 0, async () => {});
  assert.equal(row.moneyCurrency, 'USD'); assert.equal(row.moneyLimit, '10.250000'); assert.equal(row.unitKind, 'money');
  db.aiBudgetPolicy.findMany = async ({ where }) => row.scopeKind === where.scopeKind && row.enabled === where.enabled
    && row.unitKind === where.unitKind && row.moneyCurrency !== null ? [{ moneyCurrency: row.moneyCurrency }] : [];
  const { AiCreditService } = require('../apps/api/src/modules/ai-native/budget/ai-credit.service');
  const credits = new AiCreditService(db, {});
  assert.deepEqual(await credits.currencies(), ['USD'], 'the actual credit currency reader discovers the just-saved indexed currency');
  assert.equal((await repository.settings(key)).settings.budget.quantity.currency, 'USD');
  const disabled = { ...settings, gates: { ...settings.gates, scene: { enabled: false, revision: 2 } } };
  await repository.saveSettings(key, disabled, 1, async () => {});
  assert.equal(row.enabled, false); assert.equal(row.moneyCurrency, 'USD');
  const calls = { ...settings, budget: { state: 'limited', quantity: { unit: 'calls', value: 7 } } };
  await repository.saveSettings(key, calls, 2, async () => {});
  assert.equal(row.unitKind, 'calls'); assert.equal(row.callLimit, 7); assert.equal(row.moneyCurrency, null); assert.equal(row.moneyLimit, null); assert.equal(row.tokenLimit, null);
  const before = structuredClone(row);
  await assert.rejects(repository.saveSettings(key, settings, 3, async () => {
    if (failRevalidation) throw Error('revoked after write'); failRevalidation = true;
  }));
  assert.deepEqual(row, before);
  const notConfigured = { ...settings, budget: { state: 'not_configured' } };
  await repository.saveSettings(key, notConfigured, 3, async () => {});
  assert.equal(row.moneyCurrency, null); assert.equal(row.callLimit, null); assert.equal(row.enabled, false);
});

// Existing serialized store plus the real platform Guard/Controller. These
// cases configure synthetic policies only; they never grant a model dispatch.
function platformSettingsHarness() {
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
  const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
  const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { composeRequestBoundBudgetManagement } = require('../apps/api/src/modules/ai-native/budget/budget-management.application');
  const { AiBudgetManagementController } = require('../apps/api/src/modules/ai-native/budget/budget-management.module');
  const state = { user: user(), active: true };
  state.user.isSaasAdmin = true; state.user.permissions = ['system:ai-provider:view', 'system:ai-provider:manage'];
  const auth = new AuthService({
    getAuthSession: async () => state.active ? { id: 'budget-settings-session', userId: state.user.id, audience: 'operator', currentWorkspaceId: 'workspace-a' } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.user, listUserWorkspaces: async () => []
  }, { get: name => name === 'AUTH_TOKEN_SECRET' ? 'synthetic-settings-token-signing-only' : undefined });
  const scope = { id: 'budget-platform-scope', ...aiPersistenceScopeColumns({ kind: 'platform' }) };
  const profile = { id: 'budget-platform-profile', scopeId: scope.id, scopeKind: 'PLATFORM', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'platform_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic-settings-model',
    credentialRef: 'unconfigured', configRevision: 1, enabled: false, disabledAt: null, allowedCapabilities: [] };
  const store = createTaskInputStore({ aiScope: [scope], aiProviderProfile: [profile], aiBudgetPolicy: [],
    aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [], aiModelConfigurationOperation: [] });
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, {});
  const application = composeRequestBoundBudgetManagement({ platform: { db: store.db, guard, profileId: profile.id } }, { enabled: true });
  const controller = new AiBudgetManagementController(application);
  const request = { headers: { authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId,
    sid: 'budget-settings-session', wid: 'workspace-a', aud: 'operator', exp: Math.floor(Date.now() / 1000) + 600 })}` } };
  const command = budget => ({ sceneCode: 'synthetic.settings', operationKey: 'first-platform-settings', expectedRevision: 0,
    settings: { gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
      allowedModels: [profile.model], allowedScenes: ['synthetic.settings'], budget, maxConcurrent: 2, maxCallsPerRun: 2 } });
  return { state, store, controller, request, command, auth, guard, profile };
}

function tenantSettingsHarness(mode = 'platform_managed') {
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
  const { SubscriptionService } = require('../apps/api/src/modules/subscription/subscription.service');
  const { SecretBox } = require('../apps/api/src/common/secret-box');
  const { tenantModelCredentialReference } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
  const { composeRequestBoundBudgetManagement } = require('../apps/api/src/modules/ai-native/budget/budget-management.application');
  const { AiBudgetManagementController } = require('../apps/api/src/modules/ai-native/budget/budget-management.module');
  const h = platformSettingsHarness(), now = new Date();
  h.state.user.isSaasAdmin = false; h.state.user.isPlatformAdmin = true;
  h.state.user.permissions = ['system:params:view', 'system:params:manage'];
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY'
    ? 'synthetic-tenant-settings-encryption-key-only-0123456789' : key === 'NODE_ENV' ? 'production' : undefined });
  const tenant = { id: 'tenant-budget-scope', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: 'tenant-a' }) };
  const workspace = { id: 'workspace-budget-scope', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) };
  const platform = { ...h.profile, enabled: true, disabledAt: null };
  const byok = { ...platform, id: 'tenant-budget-profile', scopeId: tenant.id, scopeKind: 'TENANT', serviceMode: 'tenant_managed',
    provider: 'openai_chat_completions', model: 'synthetic-byok-settings-model', credentialRef: tenantModelCredentialReference('tenant-a', 1) };
  const record = { tenantId: 'tenant-a', revision: 1, mode: 'tenant_managed', serviceEnabled: true,
    settings: { enabled: true, protocol: byok.protocol, baseUrl: 'https://synthetic-settings.example.test/v1', model: byok.model,
      timeoutMs: 1000, maxConcurrent: 2, maxOutputTokens: 32 }, credentialsEncrypted: secrets.encrypt({ apiKey: 'synthetic-byok-settings-key-only' }) };
  const store = createTaskInputStore({ aiScope: [h.store.state.aiScope[0], tenant, workspace], aiProviderProfile: [platform, byok],
    aiTenantModelConfiguration: mode === 'tenant_managed' ? [record] : [], systemParameterSet: [], aiModelConfigurationOperation: [],
    aiBudgetPolicy: [], aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [], operationLog: [],
    aiTask: [], aiRun: [], aiStep: [], aiTaskActionInput: [], aiTaskActionPolicy: [], aiTaskExecutionCharge: [],
    aiGatewayInvocation: [], aiGatewayAccountingReceipt: [], aiInvocationAdmission: [],
    tenant: [{ id: 'tenant-a', subscription: { id: 'settings-subscription', tenantId: 'tenant-a', revision: 1, plan: 'PRO', source: 'HISTORICAL_REGISTER',
      startAt: new Date(now.getTime() - 86400000), endAt: new Date(now.getTime() + 365 * 86400000), serviceTimeZone: 'UTC', billingAnniversary: now }, subscriptionSegments: [] }],
    subscriptionFeatureCatalog: [{ code: 'ai.native.use', name: 'Synthetic AI', module: 'ai-native', categories: [], currentOwnership: 'PRO',
      defaultOwnership: 'PRO', releaseStatus: 'RELEASED', externalFeeNote: null }], tenantFeatureGrant: [] });
  const application = composeRequestBoundBudgetManagement({ tenant: { db: store.db, auth: h.auth, guard: h.guard,
    subscriptions: new SubscriptionService(store.db), callPriceVersion: 'synthetic-settings-no-dispatch', clock: () => new Date(now),
    initialConfiguration: { db: store.db, secrets, platformProfileId: platform.id } } }, { enabled: true });
  const controller = new AiBudgetManagementController(application);
  const command = (scope, budget) => ({ scope, sceneCode: 'synthetic.settings', expectedRevision: 0, operationKey: 'first-tenant-settings',
    budget, maxConcurrent: 2, maxCallsPerRun: 2, enabled: false });
  return { ...h, store, controller, command, mode, tenant, workspace, byok };
}

test('tenant budget first configuration covers both owner scopes and original units without disclosing platform data', async () => {
  const base = [{ state: 'limited', quantity: { unit: 'calls', value: 7 } }, { state: 'limited', quantity: { unit: 'tokens', value: Number.MAX_SAFE_INTEGER } },
    { state: 'zero', quantity: { unit: 'calls', value: 0 } }, { state: 'zero', quantity: { unit: 'tokens', value: 0 } }, { state: 'not_configured' }];
  for (const mode of ['platform_managed', 'tenant_managed']) for (const scope of ['tenant', 'workspace']) {
    const budgets = mode === 'platform_managed' ? [...base, { state: 'limited', quantity: { unit: 'money', amount: '0.123456', currency: 'USD', scale: 6 } },
      { state: 'zero', quantity: { unit: 'money', amount: '0.000000', currency: 'USD', scale: 6 } }] : base;
    for (const budget of budgets) {
      const h = tenantSettingsHarness(mode), command = h.command(scope, budget);
      const cipher = h.store.state.aiTenantModelConfiguration[0]?.credentialsEncrypted;
      const result = await h.controller.initialize(h.request, command), row = h.store.state.aiBudgetPolicy[0];
      assert.equal(result.savedRevision, 1); assert.equal(result.observation, 'same_revision');
      assert.equal(result.policy.scope, scope); assert.equal(result.policy.admission, 'not_granted');
      assert.deepEqual(result.policy.settings.budget, budget);
      assert.equal(row.scopeKind, scope === 'tenant' ? 'TENANT' : 'WORKSPACE');
      assert.equal(row.scopeId, scope === 'tenant' ? h.tenant.id : h.workspace.id);
      assert.equal(row.enabled, false);
      assert.equal(row.tokenLimit, budget.quantity?.unit === 'tokens' ? BigInt(budget.quantity.value) : null);
      assert.equal(row.callLimit, budget.quantity?.unit === 'calls' ? budget.quantity.value : null);
      assert.equal(row.moneyLimit, budget.quantity?.unit === 'money' ? budget.quantity.amount : null);
      if (mode === 'platform_managed') assert.deepEqual(result.policy.modelPolicy, { mode, serviceName: 'Rental OS AI', selection: 'managed_by_platform' });
      else assert.deepEqual(result.policy.modelPolicy, { mode, allowedModels: [h.byok.model] });
      const serialized = JSON.stringify(result);
      for (const privateValue of ['credentialRef', 'synthetic-byok-settings-key-only', 'baseUrl', 'budget-platform-profile']) assert.ok(!serialized.includes(privateValue));
      if (mode === 'platform_managed') assert.ok(!serialized.includes(h.profile.model));
      const original = await h.controller.readOperation(h.request, { scope, sceneCode: command.sceneCode, operationKey: command.operationKey });
      assert.equal(original.state, 'recorded'); assert.equal(original.savedRevision, 1); assert.equal(original.automaticRetry, false);
      await assert.rejects(h.controller.initialize(h.request, command), e => e.getResponse().code === 'AI_RESULT_UNKNOWN');
      assert.equal(h.store.trace.filter(x => x === 'aiBudgetPolicy.create').length, 1);
      assert.equal(h.store.trace.filter(x => x === 'operationLog.create').length, 1);
      assert.ok(h.store.state.aiTenantModelConfiguration[0]?.credentialsEncrypted === cipher);
      for (const table of ['aiTask', 'aiGatewayInvocation', 'aiBudgetReservation', 'aiBudgetLedgerEntry']) assert.equal(h.store.state[table].length, 0);
    }
  }
});

test('tenant budget first configuration refuses BYOK money budgets and keeps missing entitlements or current authority closed', async () => {
  const money = { state: 'limited', quantity: { unit: 'money', amount: '1.000001', currency: 'USD', scale: 6 } };
  for (const scope of ['tenant', 'workspace']) for (const budget of [money, { state: 'zero', quantity: { ...money.quantity, amount: '0.000000' } }]) {
    const h = tenantSettingsHarness('tenant_managed');
    await assert.rejects(h.controller.initialize(h.request, h.command(scope, budget)), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
    assert.equal(h.store.state.aiBudgetPolicy.length, 0); assert.equal(h.store.state.operationLog.length, 0);
  }
  for (const [change, status] of [[h => { h.store.state.subscriptionFeatureCatalog = []; }, 403],
    [h => { h.state.user.permissions = ['system:params:view']; h.state.user.isPlatformAdmin = false; }, 403],
    [h => { h.store.state.aiProviderProfile[0].scopeId = 'foreign-scope'; }, 503]]) {
    const h = tenantSettingsHarness(); change(h);
    await assert.rejects(h.controller.initialize(h.request, h.command('workspace', money)), e => e.getStatus() === status);
    assert.equal(h.store.state.aiBudgetPolicy.length, 0); assert.equal(h.store.state.operationLog.length, 0);
  }
});

// These are committed-configuration fixtures, not real rotation, capability or
// MySQL evidence. Rebinding must retain the original budget and financial rows.
test('tenant budget configuration lifecycle preserves original money, held rows and receipts across modes and revisions', async () => {
  const { tenantModelCredentialReference } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
  const money = { state: 'limited', quantity: { unit: 'money', amount: '1.000001', currency: 'USD', scale: 6 } };
  for (const scope of ['tenant', 'workspace']) {
    const h = tenantSettingsHarness('tenant_managed'), configuration = () => h.store.state.aiTenantModelConfiguration[0];
    configuration().mode = 'platform_managed';
    const first = h.command(scope, money), cipher = configuration().credentialsEncrypted;
    h.store.state.aiBudgetReservation.push({ id: 'synthetic-original-unknown', status: 'unknown', reservedMoney: new Prisma.Decimal('0.123456') });
    h.store.state.aiBudgetAllocation.push({ id: 'synthetic-original-held', reservationId: 'synthetic-original-unknown' });
    const financial = () => requestFingerprint({ reservations: h.store.state.aiBudgetReservation,
      allocations: h.store.state.aiBudgetAllocation, ledger: h.store.state.aiBudgetLedgerEntry });
    const originalFinancial = financial();
    await h.controller.initialize(h.request, first);
    const rebind = (expectedRevision, operationKey) => ({ scope, sceneCode: first.sceneCode, expectedRevision,
      operationKey, confirmCurrentConfiguration: true });
    for (const [revision, mode] of [[2, 'tenant_managed'], [3, 'tenant_managed'], [4, 'platform_managed'], [5, 'tenant_managed']]) {
      configuration().mode = mode; configuration().revision = revision;
      if (mode === 'tenant_managed') {
        const profile = h.store.state.aiProviderProfile.find(row => row.id === h.byok.id);
        profile.configRevision = revision; profile.credentialRef = tenantModelCredentialReference('tenant-a', revision);
      }
      const command = rebind(revision - 1, `original-rebind-${revision}`);
      const result = await h.controller.refreshConfiguration(h.request, command);
      assert.equal(result.savedRevision, revision); assert.equal(result.policy.modelPolicy.mode, mode);
      assert.deepEqual(result.policy.settings.budget, money); assert.equal(result.policy.admission, 'not_granted');
      assert.equal(h.store.state.aiBudgetPolicy[0].enabled, false);
      assert.equal(result.policy.settings.gates[scope === 'tenant' ? 'tenant' : 'scene'].enabled, false);
      assert.equal(configuration().credentialsEncrypted, cipher); assert.equal(financial(), originalFinancial);
      const original = await h.controller.readOperation(h.request, { scope, sceneCode: first.sceneCode, operationKey: command.operationKey });
      assert.equal(original.state, 'recorded'); assert.equal(original.savedRevision, revision); assert.equal(original.automaticRetry, false);
      await assert.rejects(h.controller.refreshConfiguration(h.request, command), e => e.getResponse().code === 'AI_RESULT_UNKNOWN');
      await assert.rejects(h.controller.refreshConfiguration(h.request, rebind(revision - 1, `stale-rebind-${revision}`)), e => e.getStatus() === 409);
      if (mode === 'tenant_managed') await assert.rejects(h.controller.change(h.request, { scope, sceneCode: first.sceneCode,
        expectedRevision: revision, operationKey: `no-money-reopen-${revision}`, changes: { enabled: true } }), e => e.getStatus() === 400);
    }
    configuration().serviceEnabled = false; configuration().settings.enabled = false;
    const receipt = await h.controller.readOperation(h.request, { scope, sceneCode: first.sceneCode, operationKey: 'original-rebind-5' });
    assert.equal(receipt.state, 'recorded'); assert.equal(receipt.savedRevision, 5);
    const firstReceipt = await h.controller.readOperation(h.request, { scope, sceneCode: first.sceneCode, operationKey: first.operationKey });
    assert.equal(firstReceipt.savedRevision, 1);
    const history = await h.controller.read(h.request, { scope, sceneCode: first.sceneCode });
    assert.deepEqual(history.settings.budget, money); assert.equal(history.admission, 'not_granted');
    assert.equal(h.store.state.operationLog.length, 5); assert.equal(financial(), originalFinancial);
    for (const table of ['aiTask', 'aiGatewayInvocation', 'aiGatewayAccountingReceipt', 'aiInvocationAdmission']) assert.equal(h.store.state[table].length, 0);
  }
});

test('tenant budget configuration lifecycle rejects stale selection and revoked authority and retains unknown COMMIT receipts', async () => {
  for (const failure of ['profile-revised', 'manage-revoked', 'commit-reply-lost']) {
    const h = tenantSettingsHarness(), first = h.command('workspace', { state: 'limited', quantity: { unit: 'calls', value: 7 } });
    await h.controller.initialize(h.request, first);
    const command = { scope: first.scope, sceneCode: first.sceneCode, expectedRevision: 1,
      operationKey: 'original-refresh-operation', confirmCurrentConfiguration: true };
    let changed = false;
    h.store.control.beforeWrite = table => {
      if (table !== 'aiBudgetPolicy' || changed) return;
      changed = true;
      if (failure === 'profile-revised') h.store.state.aiProviderProfile[0].configRevision += 1;
      if (failure === 'manage-revoked') { h.state.user.isPlatformAdmin = false; h.state.user.permissions = ['system:params:view']; }
      if (failure === 'commit-reply-lost') h.store.control.loseReply = true;
    };
    await assert.rejects(h.controller.refreshConfiguration(h.request, command), e =>
      failure === 'commit-reply-lost' ? e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN' : [403, 409].includes(e.getStatus()));
    assert.equal(changed, true); h.store.control.beforeWrite = null;
    assert.equal(h.store.state.aiBudgetPolicy[0].configRevision, failure === 'commit-reply-lost' ? 2 : 1);
    assert.equal(h.store.state.operationLog.length, failure === 'commit-reply-lost' ? 2 : 1);
    // Losing this administrator identity also loses receipt-read authority;
    // retained history is not a grant to expose it after revocation.
    if (failure === 'manage-revoked') {
      await assert.rejects(h.controller.readOperation(h.request, { scope: first.scope, sceneCode: first.sceneCode,
        operationKey: command.operationKey }), e => e.getStatus() === 403 && e.getResponse().code === 'AI_ACCESS_DENIED');
      assert.equal(h.store.state.aiGatewayInvocation.length, 0); continue;
    }
    const original = await h.controller.readOperation(h.request, { scope: first.scope, sceneCode: first.sceneCode, operationKey: command.operationKey });
    assert.equal(original.state, failure === 'commit-reply-lost' ? 'recorded' : 'unknown');
    assert.equal(original.automaticRetry, false); assert.equal(original.admission, 'not_granted');
    if (failure === 'commit-reply-lost') {
      assert.equal(original.savedRevision, 2);
      const writes = h.store.trace.filter(x => x === 'aiBudgetPolicy.updateMany').length;
      await assert.rejects(h.controller.refreshConfiguration(h.request, command), e => e.getResponse().code === 'AI_RESULT_UNKNOWN');
      assert.equal(h.store.trace.filter(x => x === 'aiBudgetPolicy.updateMany').length, writes);
      assert.equal(h.store.state.aiBudgetPolicy[0].configRevision, 2);
    }
    for (const table of ['aiTask', 'aiGatewayInvocation', 'aiBudgetReservation', 'aiBudgetLedgerEntry']) assert.equal(h.store.state[table].length, 0);
  }
});

test('tenant budget changes refuse new BYOK money limits but preserve disabled original money snapshots', async () => {
  const money = { state: 'limited', quantity: { unit: 'money', amount: '1.000001', currency: 'USD', scale: 6 } };
  for (const scope of ['tenant', 'workspace']) {
    const h = tenantSettingsHarness('tenant_managed'), first = h.command(scope, { state: 'limited', quantity: { unit: 'calls', value: 7 } });
    await h.controller.initialize(h.request, first);
    const change = { scope, sceneCode: first.sceneCode, expectedRevision: 1, operationKey: 'byok-money-change', changes: { budget: money } };
    await assert.rejects(h.controller.change(h.request, change), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
    assert.equal(h.store.state.aiBudgetPolicy[0].configRevision, 1);
    assert.equal(h.store.state.operationLog.length, 1);
    // A legacy save without an operation key could already have kept a money
    // policy. Represent that prior revision, not a new receipt or settled debt.
    const row = h.store.state.aiBudgetPolicy[0];
    row.configRevision = 2; row.settingsJson.budget = money; row.unitKind = 'money';
    row.callLimit = null; row.tokenLimit = null; row.moneyLimit = money.quantity.amount; row.moneyCurrency = 'USD';
    const before = await h.controller.read(h.request, { scope, sceneCode: first.sceneCode });
    assert.deepEqual(before.settings.budget, money); assert.equal(before.admission, 'not_granted');
    await assert.rejects(h.controller.change(h.request, { ...change, expectedRevision: 2, changes: { enabled: true } }), e => e.getStatus() === 400);
    const saved = await h.controller.change(h.request, { ...change, expectedRevision: 2, operationKey: 'disable-original-money', changes: { enabled: false } });
    assert.equal(saved.savedRevision, 3); assert.deepEqual(saved.policy.settings.budget, money);
    assert.equal(h.store.state.aiBudgetPolicy[0].moneyLimit, money.quantity.amount);
    // Disabling the actual configuration must not erase the authorized receipt.
    h.store.state.aiTenantModelConfiguration[0].serviceEnabled = false;
    h.store.state.aiTenantModelConfiguration[0].settings.enabled = false;
    const original = await h.controller.readOperation(h.request, { scope, sceneCode: first.sceneCode, operationKey: 'disable-original-money' });
    assert.equal(original.state, 'recorded'); assert.equal(original.savedRevision, 3);
    for (const table of ['aiGatewayInvocation', 'aiBudgetReservation', 'aiBudgetLedgerEntry']) assert.equal(h.store.state[table].length, 0);
  }
});

test('platform budget settings initialize each original unit and explicit zero/absence with one immutable receipt', async () => {
  for (const budget of [
    { state: 'limited', quantity: { unit: 'calls', value: 4294967295 } },
    { state: 'limited', quantity: { unit: 'tokens', value: Number.MAX_SAFE_INTEGER } },
    { state: 'limited', quantity: { unit: 'money', amount: '0.123456', currency: 'USD', scale: 6 } },
    { state: 'zero', quantity: { unit: 'calls', value: 0 } },
    { state: 'zero', quantity: { unit: 'tokens', value: 0 } },
    { state: 'zero', quantity: { unit: 'money', amount: '0.000000', currency: 'USD', scale: 6 } },
    { state: 'not_configured' }
  ]) {
    const h = platformSettingsHarness(), command = h.command(budget);
    const saved = await h.controller.platformSave(h.request, command), row = h.store.state.aiBudgetPolicy[0];
    assert.equal(saved.state, 'configured'); assert.equal(saved.revision, 1); assert.equal(saved.admission, 'not_granted');
    assert.deepEqual(saved.settings.budget, budget);
    assert.equal(row.enabled, budget.state === 'limited');
    assert.equal(row.unitKind, budget.quantity?.unit ?? 'tokens');
    assert.equal(row.tokenLimit, budget.quantity?.unit === 'tokens' ? BigInt(budget.quantity.value) : null);
    assert.equal(row.callLimit, budget.quantity?.unit === 'calls' ? budget.quantity.value : null);
    assert.equal(row.moneyLimit, budget.quantity?.unit === 'money' ? budget.quantity.amount : null);
    assert.equal(row.moneyCurrency, budget.quantity?.unit === 'money' ? 'USD' : null);
    const receipt = await h.controller.platformReadOperation(h.request, { sceneCode: command.sceneCode, operationKey: command.operationKey });
    assert.equal(receipt.state, 'recorded'); assert.equal(receipt.savedRevision, 1); assert.equal(receipt.automaticRetry, false);
    await assert.rejects(h.controller.platformSave(h.request, command), e => e.getStatus() === 409 && e.getResponse().code === 'AI_RESULT_UNKNOWN');
    assert.equal(h.store.trace.filter(x => x === 'aiBudgetPolicy.create').length, 1);
    assert.equal(h.store.trace.filter(x => x === 'aiModelConfigurationOperation.create').length, 1);
    assert.equal(h.store.state.aiBudgetReservation.length, 0); assert.equal(h.store.state.aiBudgetLedgerEntry.length, 0);
  }
});

test('platform budget settings preserve lost COMMIT and reject invalid units or revoked current authority', async () => {
  const budget = { state: 'limited', quantity: { unit: 'money', amount: '1.000001', currency: 'USD', scale: 6 } };
  const lost = platformSettingsHarness(), original = lost.command(budget);
  lost.store.control.loseReply = true;
  await assert.rejects(lost.controller.platformSave(lost.request, original), e => e.getResponse().code === 'AI_RESULT_UNKNOWN');
  assert.equal(lost.store.state.aiBudgetPolicy.length, 1);
  const receipt = await lost.controller.platformReadOperation(lost.request, { sceneCode: original.sceneCode, operationKey: original.operationKey });
  assert.equal(receipt.state, 'recorded'); assert.equal(receipt.savedRevision, 1);
  assert.equal(lost.store.trace.filter(x => x === 'aiBudgetPolicy.create').length, 1);
  for (const invalid of [
    { state: 'limited', quantity: { unit: 'calls', value: 4294967296 } },
    { state: 'limited', quantity: { unit: 'tokens', value: Number.MAX_SAFE_INTEGER + 1 } },
    { state: 'limited', quantity: { unit: 'money', amount: '1.0000001', currency: 'USD', scale: 6 } },
    { state: 'zero', quantity: { unit: 'tokens', value: 1 } }
  ]) {
    const h = platformSettingsHarness();
    await assert.rejects(h.controller.platformSave(h.request, h.command(invalid)), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
    assert.equal(h.store.state.aiBudgetPolicy.length, 0); assert.equal(h.store.state.aiModelConfigurationOperation.length, 0);
  }
  const denied = platformSettingsHarness(); denied.state.user.permissions = ['system:ai-provider:view'];
  await assert.rejects(denied.controller.platformSave(denied.request, denied.command(budget)), e => e.getStatus() === 403);
  denied.state.active = false;
  await assert.rejects(denied.controller.platformRead(denied.request, { sceneCode: 'synthetic.settings' }), e => e.getStatus() === 403);
  assert.equal(denied.store.state.aiBudgetPolicy.length, 0);
});

function fakeDb() {
  const row = { id: record.id, scopeId: record.scopeId, scopeKind: record.scopeKind, actorId: record.actorId, status: 'reserved', dispatchState: 'dispatched', unitKind: 'tokens', reservedTokens: 10n, reservedCalls: null, reservedMoney: null, moneyCurrency: null, actualTokens: null, actualCalls: null, actualMoney: null, unknownReason: null, expiresAt: record.expiresAt, updatedAt: record.storageVersion, callId: record.callId, idempotencyKey: 'idem', sceneCode: 'scene', configRevision: 2, tenantId: 'tenant', workspaceId: 'workspace' };
  const ledger = new Map();
  Object.assign(row, { configurationHash: requestFingerprint(association.config), requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, priceVersion: association.priceVersion });
  const keys = ['PLATFORM', 'TENANT', 'WORKSPACE'].map((scopeKind, index) => ({ id: `p-${index}`, scopeId: `s-${index}`, scopeKind, sceneCode: 'scene', configRevision: 2 }));
  const db = {
    aiScope: { findUnique: async ({ where }) => { const key = keys.find(item => item.scopeId === where.id); return { id: key.scopeId,
      kind: key.scopeKind, tenantId: key.scopeKind === 'PLATFORM' ? null : 'tenant', workspaceId: key.scopeKind === 'WORKSPACE' ? 'workspace' : null }; } },
    aiBudgetPolicy: { findUnique: async ({ where }) => keys.find(item => where.id ? item.id === where.id : item.scopeId === where.scopeId_scopeKind_sceneCode.scopeId) },
    aiBudgetAllocation: { findMany: async () => keys.map(item => ({ policyId: item.id, policyRevision: 2 })) },
    $queryRaw: async () => [],
    aiBudgetLedgerEntry: { findUnique: async ({ where }) => ledger.get(`${where.reservationId_eventKey.reservationId}:${where.reservationId_eventKey.eventKey}`) ?? null,
      create: async ({ data }) => { ledger.set(`${data.reservationId}:${data.eventKey}`, data); return data; } },
    aiBudgetReservation: { updateMany: async ({ data }) => { Object.assign(row, data); if (data.actualTokens !== undefined) row.actualTokens = data.actualTokens; row.updatedAt = new Date(row.updatedAt.getTime() + 1); return { count: 1 }; },
      findUnique: async () => row },
    $transaction: async callback => callback(db)
  };
  return { db, ledger, row };
}

test('Prisma repository replays only identical settlement payloads', async () => {
  const { db, ledger } = fakeDb();
  const repo = new PrismaBudgetRepository(db);
  const usage = { quantity: { unit: 'tokens', value: 4 }, evidenceHash: 'a'.repeat(64) };
  const first = await repo.mutate(record, { action: 'settle', eventKey: 'event-1', usage }, async () => {});
  assert.equal(first.status, 'settled');
  assert.equal(ledger.size, 1);
  const replay = await repo.mutate({ ...record, status: 'settled', storageVersion: first.storageVersion }, { action: 'settle', eventKey: 'event-1', usage }, async () => {});
  assert.equal(replay.status, 'settled');
  await assert.rejects(() => repo.mutate(record, { action: 'settle', eventKey: 'event-1', usage: { ...usage, quantity: { unit: 'tokens', value: 5 } } }, async () => {}), error => error instanceof BudgetError && error.code === 'IDEMPOTENCY_CONFLICT');
});

test('server authority adapter fails closed when the formal AI entitlement is absent', async () => {
  const source = { resolveContext: async () => ({ actor: { kind: 'user', userId: 'u' }, scope: { kind: 'tenant', tenantId: 't' }, authorizedAt: new Date().toISOString(), requestId: 'r', audience: 'staff', access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, contractVersion: 'ain-c01-c02-draft-1' }), authorize: async () => ({ authorizationKey: 'key', expiresAt: new Date(Date.now() + 1000) }) };
  const adapter = new ServerBudgetAuthorityAdapter(source, { check: async () => ({ available: false, revision: 1 }) });
  await assert.rejects(() => adapter.resolve('reserve', {}), error => error instanceof BudgetError && error.code === 'FORBIDDEN');
});

test('subscription entitlement adapter consumes only a formal catalog row', async () => {
  const reader = new SubscriptionBudgetEntitlementAdapter({ read: async () => ({ revision: 4, entitlements: [{ code: 'ai.native.use', available: true }] }) });
  const context = { actor: { kind: 'user', userId: 'u' }, scope: { kind: 'tenant', tenantId: 't' }, authorizedAt: new Date().toISOString(), requestId: 'r', audience: 'staff', access: { permissions: ['ai:use'], dataScope: 'all', locationScope: { mode: 'all', locationIds: [] } }, contractVersion: 'ain-c01-c02-draft-1' };
  assert.deepEqual(await reader.check(context, 'ai.native.use'), { available: true, revision: 4 });
  const missing = new SubscriptionBudgetEntitlementAdapter({ read: async () => ({ revision: 4, entitlements: [] }) });
  await assert.rejects(() => missing.check(context, 'ai.native.use'), error => error instanceof BudgetError && error.code === 'FORBIDDEN');
  await assert.rejects(() => reader.check({ ...context, scope: { kind: 'platform' } }, 'ai.native.use'), error => error instanceof BudgetError && error.code === 'UNAVAILABLE');
});

test('persisted evidence adapter rejects a row from another scope', async () => {
  const adapter = new PersistedBudgetEvidenceAdapter({ readDispatch: async () => ({ state: 'dispatched', reservationId: 'reservation', requestId: association.requestId, runId: association.runId, stepId: association.stepId, actionId: association.actionId, callId: 'call', actorId: 'actor', scopeKey: 'TENANT:other', sceneCode: 'scene', configRevision: association.config.configRevision, priceVersion: association.priceVersion, dispatchToken: 'dispatch' }), readUsage: async () => { throw new Error('must not read usage'); } });
  await assert.rejects(() => adapter.dispatch(record), error => error instanceof BudgetError && error.code === 'FORBIDDEN');
});

test('settled actual usage remains in the durable budget aggregate', async () => {
  const settings = { draftVersion: 'ain-c07-draft-2', scope: { kind: 'tenant', tenantId: 'tenant' }, config: association.config,
    gates: { platform: { enabled: true, revision: 1 }, tenant: { enabled: true, revision: 1 }, scene: { enabled: true, revision: 1 } },
    sceneCode: 'scene', allowedModels: ['model'], allowedScenes: ['scene'], budget: { state: 'limited', quantity: { unit: 'tokens', value: 10 } }, maxConcurrent: 2, maxCallsPerRun: 2 };
  const policyRow = { id: 'policy', scopeId: 'workspace', scopeKind: 'WORKSPACE', sceneCode: 'scene', configRevision: 2, settingsJson: settings };
  const policies = ['PLATFORM', 'TENANT', 'WORKSPACE'].map((scopeKind, index) => ({ ...policyRow, id: `policy-${index}`, scopeId: `scope-${index}`, scopeKind }));
  const db = { aiScope: { findUnique: async ({ where }) => { const key = policies.find(item => item.scopeId === where.id); return { id: key.scopeId,
    kind: key.scopeKind, tenantId: key.scopeKind === 'PLATFORM' ? null : 'tenant', workspaceId: key.scopeKind === 'WORKSPACE' ? 'workspace' : null }; } },
    aiBudgetPolicy: { findUnique: async ({ where }) => policies.find(item => item.scopeId === where.scopeId_scopeKind_sceneCode.scopeId) },
    aiBudgetReservation: { findUnique: async () => null,
      groupBy: async () => [{ status: 'settled', unitKind: 'tokens', moneyCurrency: null, _count: { _all: 1, actualTokens: 1 }, _sum: { actualTokens: 10n } }],
      count: async () => 0, create: async () => { throw new Error('must reject before create'); } },
    $transaction: async callback => callback(db), $queryRaw: async () => [] };
  const repo = new PrismaBudgetRepository(db);
  const quote = { association, callId: 'call-new', sceneCode: 'scene', model: 'model', actorId: 'actor', quantity: { unit: 'tokens', value: 1 }, policies: policies.map(({ scopeId, scopeKind, sceneCode }) => ({ scopeId, scopeKind, sceneCode })), consumerScope: { scopeId: 'scope-2', scopeKind: 'WORKSPACE', sceneCode: 'scene' }, evidenceHash: 'b'.repeat(64), expiresAt: new Date('2026-10-04T12:01:00.000Z') };
  await assert.rejects(() => repo.reserve(quote, { association, callId: 'call-new', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {}), error => error instanceof BudgetError && error.code === 'EXHAUSTED');
});

test('BYOK configuration and price rotation retain original concurrency and Run call limits', async () => {
  const { createTaskInputStore, clone } = require('./fixtures/ai-native/task-input-store.cjs');
  const { byokMeterScene, ensureByokMeterPolicy } = require('../apps/api/src/modules/ai-native/budget/byok-usage-meter');
  const now = new Date('2026-10-04T12:00:00Z');
  for (const scenario of [
    { status: 'pending_reconciliation', count: 4 },
    { status: 'reserved', count: 4 },
    { status: 'settled', count: 32 },
    { status: 'pending_reconciliation', count: 3, available: true },
    { status: 'pending_reconciliation', count: 4, tenantId: 'foreign', available: true },
    { status: 'pending_reconciliation', count: 4, sceneCode: 'other-scene', available: true }
  ]) {
    const scopes = ['PLATFORM', 'TENANT', 'WORKSPACE'].map((kind, index) => ({ id: `scope-${index}`, kind,
      tenantId: kind === 'PLATFORM' ? null : 'tenant', workspaceId: kind === 'WORKSPACE' ? 'workspace' : null }));
    const store = createTaskInputStore({ aiScope: scopes, aiBudgetPolicy: [], aiBudgetReservation: [], aiBudgetAllocation: [], aiBudgetLedgerEntry: [] });
    const original = { ...association, priceVersion: 'price-original', config: { ...association.config, configRevision: 1 } };
    const current = { ...association, requestId: 'next-call', idempotencyKey: 'next-call', priceVersion: 'price-next' };
    const policies = [];
    for (const scope of scopes) {
      const old = await ensureByokMeterPolicy(store.db, { scopeId: scope.id, scopeKind: scope.kind,
        sceneCode: byokMeterScene('scene', original) }, original, 'scene', true);
      policies.push(await ensureByokMeterPolicy(store.db, { scopeId: scope.id, scopeKind: scope.kind,
        sceneCode: byokMeterScene('scene', current) }, current, 'scene', true));
      for (let index = 0; index < scenario.count; index++) store.state.aiBudgetAllocation.push({
        reservationId: `old-${index}`, policyId: old.id, policyRevision: old.configRevision });
    }
    for (let index = 0; index < scenario.count; index++) store.state.aiBudgetReservation.push({
      id: `old-${index}`, scopeId: 'scope-2', scopeKind: 'WORKSPACE', tenantId: scenario.tenantId ?? 'tenant', workspaceId: 'workspace',
      sceneCode: scenario.sceneCode ?? 'scene', runId: 'run', callId: `old-call-${index}`, idempotencyKey: `old-call-${index}`,
      billingMode: 'tenant_managed', configurationHash: requestFingerprint(original.config), configRevision: 1, priceVersion: original.priceVersion,
      status: scenario.status, dispatchState: scenario.status === 'settled' ? 'completed' : 'unknown', unitKind: 'calls', reservedCalls: 1,
      actualCalls: scenario.status === 'settled' ? 1 : null, expiresAt: new Date(now.getTime() - 1) });
    const before = clone(store.state.aiBudgetReservation), links = clone(store.state.aiBudgetAllocation), locks = [];
    const transact = store.db.$transaction.bind(store.db);
    store.db.$transaction = (work, options) => transact(tx => {
      const query = tx.$queryRaw;
      tx.$queryRaw = async sql => { if (sql.sql.includes('ai_scopes')) locks.push([...sql.values]); return query(sql); };
      return work(tx);
    }, options);
    const quote = { association: current, callId: 'next-call', sceneCode: 'scene', model: 'model', actorId: 'actor',
      quantity: { unit: 'calls', value: 1 }, policies: policies.map(({ scopeId, scopeKind, sceneCode }) => ({ scopeId, scopeKind, sceneCode })),
      consumerScope: { scopeId: 'scope-2', scopeKind: 'WORKSPACE', sceneCode: byokMeterScene('scene', current) },
      evidenceHash: 'b'.repeat(64), expiresAt: new Date(now.getTime() + 60000) };
    const repository = new PrismaBudgetRepository(store.db, () => now);
    const reserve = () => repository.reserve(quote, { association: current, callId: 'next-call', sceneCode: 'scene', expiresAt: quote.expiresAt }, 'identity', async () => {});
    if (scenario.available) {
      const saved = await reserve(); assert.equal(saved.status, 'reserved');
      assert.equal((await reserve()).id, saved.id, 'same-key observation does not reserve again even at the concurrency limit');
      assert.equal(store.state.aiBudgetReservation.length, before.length + 1);
    } else {
      await assert.rejects(reserve(), error => error.code === 'EXHAUSTED');
      assert.deepEqual(store.state.aiBudgetReservation, before); assert.deepEqual(store.state.aiBudgetAllocation, links);
    }
    assert.deepEqual(store.state.aiBudgetReservation.filter(row => row.id.startsWith('old-')), before, 'rotation never rewrites old unknown or settled calls');
    assert.equal(store.state.aiBudgetLedgerEntry.length, 0, 'capacity checks do not settle, release or manufacture usage');
    assert.deepEqual(locks[0], ['scope-1'], 'all revisions serialize on the same canonical tenant scope');
  }
});

function callHistoryRow(id = 'call-001', mode = 'platform_managed', unit = 'money') {
  const configuration = { ...association.config, serviceMode: mode, provider: 'private-provider', model: 'private-model',
    credentialRef: 'private-credential', configurationScope: mode === 'platform_managed' ? { kind: 'platform' } : { kind: 'tenant', tenantId: 'tenant' } };
  const configurationHash = requestFingerprint(configuration);
  const row = { id, scopeId: 'scope-workspace', taskId: `task-${id}`, runId: `run-${id}`, stepId: `step-${id}`, actionId: `action-${id}`,
    actorId: 'actor', callId: id, sceneCode: 'scene', createdAt: new Date('2026-10-04T12:00:00Z'),
    configuration, configurationHash, priceVersion: 'original-price', prompt: 'private-prompt', businessInput: 'private-business', accountingReceipts: [] };
  Object.assign(row, { registrationHash: 'a'.repeat(64), intentHash: 'b'.repeat(64), maxOutputTokens: 10 });
  const reservation = { id: `reservation-${id}`, scopeId: row.scopeId, scopeKind: 'WORKSPACE', tenantId: 'tenant', workspaceId: 'workspace',
    actorId: row.actorId, callId: row.callId, requestId: row.callId, idempotencyKey: row.callId,
    runId: row.runId, stepId: row.stepId, actionId: row.actionId, sceneCode: row.sceneCode,
    configurationHash, configRevision: configuration.configRevision, priceVersion: row.priceVersion, billingMode: mode, unitKind: unit,
    status: 'settled', dispatchState: 'completed', actualTokens: unit === 'tokens' ? 15n : null, actualCalls: unit === 'calls' ? 1 : null,
    actualMoney: unit === 'money' ? new Prisma.Decimal('0.123456') : null, moneyCurrency: unit === 'money' ? 'USD' : null, ledger: [] };
  const receipt = { id: `receipt-${id}`, scopeId: row.scopeId, scopeKind: 'WORKSPACE', taskId: row.taskId, tenantId: 'tenant', workspaceId: 'workspace',
    invocationId: row.id, reservationId: reservation.id, admissionId: `admission-${id}`, dispatchToken: 'private-dispatch-token',
    requestHash: 'request-hash', state: 'dispatched', inputTokens: 12n, outputTokens: 3n,
    usageDetails: { cachedInputTokens: 4, cacheCreationInputTokens: 0 }, reservation };
  receipt.admission = { id: receipt.admissionId, scopeKind: 'WORKSPACE', tenantId: receipt.tenantId,
    workspaceId: receipt.workspaceId, actorId: row.actorId, callId: row.callId, profileId: configuration.configId,
    dispatchId: receipt.dispatchToken, requestHash: receipt.requestHash };
  row.accountingReceipts.push(receipt);
  refreshCallHistoryEvidence(row);
  return row;
}
function refreshCallHistoryEvidence(row) {
  const receipt = row.accountingReceipts[0], reservation = receipt.reservation;
  const usage = { inputTokens: Number(receipt.inputTokens), outputTokens: Number(receipt.outputTokens),
    ...(receipt.usageDetails != null ? { billingDetails: receipt.usageDetails } : {}) };
  receipt.usageHash = requestFingerprint({ receiptId: receipt.id, invocationId: row.id, admissionId: receipt.admissionId,
    reservationId: receipt.reservationId, dispatchToken: receipt.dispatchToken, requestHash: receipt.requestHash, usage });
  const quantity = reservation.unitKind === 'money' ? { unit: 'money', amount: reservation.actualMoney.toFixed(6), currency: reservation.moneyCurrency, scale: 6 }
    : reservation.unitKind === 'tokens' ? { unit: 'tokens', value: Number(reservation.actualTokens) } : { unit: 'calls', value: reservation.actualCalls };
  reservation.ledger = [{ reservationId: reservation.id, scopeId: row.scopeId, scopeKind: 'WORKSPACE', tenantId: 'tenant', kind: 'settle',
    evidenceHash: requestFingerprint({ usageHash: receipt.usageHash, priceVersion: row.priceVersion, quantity }), reason: null,
    inputTokens: reservation.actualTokens, outputTokens: null, calls: reservation.actualCalls,
    moneyAmount: reservation.actualMoney, moneyCurrency: reservation.moneyCurrency }];
}
function callHistoryMatches(row, where) {
  if (where.AND && !where.AND.every(item => callHistoryMatches(row, item))) return false;
  if (where.OR && !where.OR.some(item => callHistoryMatches(row, item))) return false;
  if (where.scopeId && !where.scopeId.in.includes(row.scopeId)) return false;
  if (typeof where.id === 'string' && row.id !== where.id || where.id?.lt && !(row.id < where.id.lt)) return false;
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  const time = where.createdAt;
  if (time instanceof Date && row.createdAt.getTime() !== time.getTime()) return false;
  if (time?.gte && row.createdAt < time.gte || time?.lt && !(row.createdAt < time.lt)) return false;
  return !where.configuration || row.configuration.serviceMode === where.configuration.equals;
}
function callHistoryHarness(rows = [callHistoryRow()]) {
  const { AiCreditService } = require('../apps/api/src/modules/ai-native/budget/ai-credit.service');
  const { AiCreditController } = require('../apps/api/src/modules/ai-native/budget/ai-credit.controller');
  const trace = [], current = { user: { id: 'manager', tenantId: 'tenant', isActive: true, isSaasAdmin: false,
    isPlatformAdmin: false, permissions: ['system:params:manage'] }, tenantUser: { isPlatformAdmin: true, permissions: ['system:params:manage'] },
    hasWorkspaces: true, workspaceValid: true, workspaceId: 'workspace' };
  const harness = { rows, trace, current, onAuthorize: null, onList: null, failRead: false, transactions: 0, queries: [], counts: [] };
  const tx = {
    businessWorkspace: { findMany: async args => { trace.push(['workspaces', args]); return !args.where.id || args.where.id === 'workspace'
      ? [{ id: 'workspace', name: '空间一' }] : []; } },
    aiScope: { findMany: async args => { trace.push(['scopes', args]); return args.where.workspaceId.in.includes('workspace')
      ? [{ id: 'scope-workspace', workspaceId: 'workspace' }] : []; } },
    aiGatewayInvocation: {
      findFirst: async args => { trace.push(['anchor', args]); return harness.rows.find(row => callHistoryMatches(row, args.where)) ?? null; },
      findMany: async args => { trace.push(['calls', args]); harness.queries.push(args); harness.onList?.();
        return harness.rows.filter(row => callHistoryMatches(row, args.where))
          .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, args.take); } },
    user: { findMany: async args => { trace.push(['users', args]); return [{ id: 'actor', displayName: '操作人' }]; } },
    $queryRaw: async query => {
      trace.push(['counts', query]);
      assert.ok(query.sql.includes('FROM OperationLog c LEFT JOIN ai_gateway_invocations g'));
      assert.ok(query.sql.includes('c.tenantId = ?') && query.sql.includes('c.workspaceId IN'));
      assert.ok(query.values.includes('tenant') && query.values.includes('scope-workspace') && query.values.includes('workspace'));
      const dates = query.values.filter(value => value instanceof Date), [since, until, position] = dates;
      const mode = query.values.find(value => ['platform_managed', 'tenant_managed'].includes(value));
      const lookup = query.sql.includes('AND c.id = ?'), tuple = query.sql.includes('c.id < ?');
      const cursor = query.values.find(value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value));
      const limit = query.values.at(-1); assert.equal(limit, lookup ? 1 : 51);
      return harness.counts.filter(item => item.claim.tenantId === 'tenant' && item.claim.workspaceId === 'workspace')
        .map(item => ({ ...item.claim, invocationId: harness.rows.includes(item.parent) ? item.parent.id : null,
          scopeId: harness.rows.includes(item.parent) ? item.parent.scopeId : null }))
        .filter(row => row.createdAt >= since && row.createdAt < until && (!lookup || row.id === cursor)
          && (!position || (tuple ? row.createdAt < position || row.createdAt.getTime() === position.getTime() && row.id < cursor : row.createdAt <= position))
          && (!mode || !row.invocationId || harness.rows.find(parent => parent.id === row.invocationId).configuration.serviceMode === mode))
        .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)).slice(0, limit);
    },
    aiBudgetReservation: { findMany: async args => { trace.push(['count-reservations', args]);
      return harness.counts.map(item => item.reservation).filter(row => args.where.id.in.includes(row.id)
        && row.tenantId === args.where.tenantId && args.where.scopeId.in.includes(row.scopeId)).slice(0, args.take); } },
    operationLog: { findMany: async args => { trace.push(['count-receipts', args]);
      return harness.counts.map(item => item.receipt).filter(row => row && args.where.id.in.includes(row.id)
        && row.tenantId === args.where.tenantId && row.action === args.where.action).slice(0, args.take); } }
  };
  const db = { $transaction: async (work, options) => { harness.transactions++; trace.push(['transaction', options]);
    const result = await work(tx); if (harness.failRead) throw Error('private-database-url private-key private-SQL'); return result; } };
  const auth = { resolveAccessContext: async (_authorization, options) => { trace.push(['auth', options]); harness.onAuthorize?.(); return current; } };
  harness.service = new AiCreditService(db, auth); harness.controller = new AiCreditController(harness.service);
  harness.read = input => harness.controller.calls({ headers: { authorization: 'Bearer synthetic' } }, input ?? {
    since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z' });
  return harness;
}
const callHistoryError = code => error => error.getResponse?.().code === code;

function callHistoryCount(parent, receiptState = 'observed', settled = true) {
  const count = require('../apps/api/src/modules/ai-native/input-counting/input-count-tokens.receipt');
  parent.configuration.protocol = 'anthropic_messages'; parent.configurationHash = requestFingerprint(parent.configuration);
  parent.accountingReceipts[0].reservation.configurationHash = parent.configurationHash;
  refreshCallHistoryEvidence(parent);
  const binding = { tenantId: 'tenant', workspaceId: 'workspace', actorId: parent.actorId, callId: parent.callId,
    registrationHash: parent.registrationHash, intentHash: parent.intentHash, configurationHash: parent.configurationHash,
    countRequestHash: 'c'.repeat(64), reservationId: `count-${parent.id}` };
  const detail = { version: 'ai-count-tokens-receipt-1', state: receiptState, ...binding,
    countCallId: count.countTokensCallId(parent.callId), invocationId: parent.id, scopeId: parent.scopeId,
    sceneCode: parent.sceneCode, protocol: parent.configuration.protocol, model: parent.configuration.model,
    priceVersion: parent.priceVersion, maxOutputTokens: parent.maxOutputTokens, method: 'provider_count_tokens_receipt',
    admission: { reservationId: binding.reservationId, sceneCode: count.countTokensSceneCode(parent.sceneCode), unit: 'calls' },
    observedAt: '2026-10-04T12:00:00Z', expiresAt: '2026-10-05T12:00:00Z',
    ...(receiptState === 'observed' ? { inputTokens: 7 } : {}) };
  delete detail.reservationId;
  const claim = { id: count.countTokensDispatchOperationId(binding), action: 'ai.model.count_tokens.dispatch',
    tenantId: 'tenant', workspaceId: 'workspace', userId: parent.actorId, detail: binding, createdAt: new Date(parent.createdAt) };
  const receipt = { id: count.countTokensOperationId(detail), action: 'ai.model.count_tokens',
    tenantId: 'tenant', workspaceId: 'workspace', userId: parent.actorId, detail };
  const reservation = { id: binding.reservationId, scopeId: parent.scopeId, scopeKind: 'WORKSPACE',
    tenantId: 'tenant', workspaceId: 'workspace', actorId: parent.actorId, callId: detail.countCallId,
    requestId: detail.countCallId, idempotencyKey: detail.countCallId, runId: parent.runId, stepId: parent.stepId, actionId: parent.actionId,
    sceneCode: detail.admission.sceneCode, configurationHash: parent.configurationHash,
    configRevision: parent.configuration.configRevision, unitKind: 'calls', reservedCalls: 1, reservedTokens: null, reservedMoney: null,
    moneyCurrency: null, status: settled ? 'settled' : 'reserved', dispatchState: settled ? 'completed' : 'dispatched',
    actualCalls: settled ? 1 : null, actualTokens: null, actualMoney: null, ledger: settled ? [{ kind: 'settle', reservationId: binding.reservationId,
      scopeId: parent.scopeId, scopeKind: 'WORKSPACE', tenantId: 'tenant', evidenceHash: count.countTokensReceiptDocumentHash(detail),
      reason: null, calls: 1, inputTokens: null, outputTokens: null, moneyAmount: null, moneyCurrency: null }] : [] };
  return { parent, claim, receipt, reservation };
}

function creditCommandHarness(platform = false) {
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const { AiCreditService } = require('../apps/api/src/modules/ai-native/budget/ai-credit.service');
  const { AiCreditController } = require('../apps/api/src/modules/ai-native/budget/ai-credit.controller');
  const h = platformSettingsHarness();
  h.state.user.isSaasAdmin = platform; h.state.user.isPlatformAdmin = !platform;
  h.state.user.permissions = platform ? ['system:ai-provider:view', 'system:ai-provider:manage'] : ['system:params:manage'];
  const store = createTaskInputStore({ aiTenantAiCreditRequest: [], aiTenantAiAllowance: [], operationLog: [], aiBudgetReservation: [],
    aiBudgetPolicy: ['USD', 'EUR'].map(moneyCurrency => ({ id: moneyCurrency, scopeKind: 'PLATFORM', enabled: true, unitKind: 'money', moneyCurrency })),
    businessWorkspace: ['workspace-a', 'workspace-b'].map(id => ({ id, tenantId: 'tenant-a', status: 'ACTIVE' })) });
  const defaults = { state: 'pending', revision: 1, grantedAmount: null, decidedAt: null, decidedBy: null,
    decisionOperationKey: null, decisionHash: null, tenant: { name: 'Synthetic tenant', status: 'ACTIVE' } };
  const transaction = store.db.$transaction.bind(store.db);
  store.db.$transaction = (work, options) => transaction(async tx => {
    // The reused store sorts aggregate arrays; Prisma also accepts one orderBy object.
    const groupBy = tx.aiBudgetReservation.groupBy;
    tx.aiBudgetReservation.groupBy = args => groupBy({ ...args,
      orderBy: Array.isArray(args.orderBy) ? args.orderBy : args.orderBy ? [args.orderBy] : undefined });
    const create = tx.aiTenantAiCreditRequest.create;
    tx.aiTenantAiCreditRequest.create = args => create({ ...args, data: { ...defaults, ...args.data } });
    tx.aiTenantAiCreditRequest.findUniqueOrThrow = async args => {
      const row = await tx.aiTenantAiCreditRequest.findUnique(args); assert.ok(row); return row;
    };
    return work(tx);
  }, options);
  const resolve = h.auth.resolveAccessContext.bind(h.auth);
  h.onAuthorize = null;
  h.auth.resolveAccessContext = async (...args) => { const run = h.onAuthorize; h.onAuthorize = null; run?.(); return resolve(...args); };
  const service = new AiCreditService(store.db, h.auth), controller = new AiCreditController(service);
  const seedRequest = (id, operationKey = 'original-request') => store.state.aiTenantAiCreditRequest.push({ ...defaults,
    id, tenantId: 'tenant-a', requestedBy: h.state.user.id, operationKey, requestHash: 'a'.repeat(64), currency: 'USD',
    requestedAmount: new Prisma.Decimal('10.000000'), createdAt: new Date() });
  return Object.assign(h, { store, controller, seedRequest });
}

test('credit writes keep postcommit authority failures unknown and recover only the original authorized receipt', async () => {
  const prepare = action => {
    const h = creditCommandHarness(action === 'decision');
    if (action === 'request') {
      const input = { operationKey: 'postcommit-request', currency: 'USD', amount: '1.000001' };
      return { h, invoke: () => h.controller.request(h.request, input),
        read: () => h.controller.receipt(h.request, { operationKey: input.operationKey }),
        committed: () => { const rows = h.store.state.aiTenantAiCreditRequest; assert.equal(rows.length, 1);
          assert.equal(rows[0].operationKey, input.operationKey); assert.equal(rows[0].requestedAmount.toFixed(6), input.amount); } };
    }
    if (action === 'allocation') {
      h.store.state.aiTenantAiAllowance.push({ tenantId: 'tenant-a', currency: 'USD', revision: 1,
        grantedAmount: new Prisma.Decimal('10.000000'), allocationsJson: {} });
      const input = { operationKey: 'postcommit-allocation', currency: 'USD', expectedRevision: 1,
        allocations: [{ workspaceId: 'workspace-a', amount: '5.000001' }] };
      return { h, invoke: () => h.controller.allocate(h.request, input),
        read: () => h.controller.allocationReceipt(h.request, { operationKey: input.operationKey, currency: input.currency }),
        committed: () => { assert.equal(h.store.state.operationLog.length, 1);
          assert.equal(h.store.state.aiTenantAiAllowance[0].revision, 2);
          assert.deepEqual(h.store.state.aiTenantAiAllowance[0].allocationsJson, { 'workspace-a': '5.000001' }); } };
    }
    h.seedRequest('postcommit-credit');
    const input = { requestId: 'postcommit-credit', operationKey: 'postcommit-decision', expectedRevision: 1,
      decision: 'approve', amount: '1.000001' };
    return { h, invoke: () => h.controller.platformDecide(h.request, input),
      read: () => h.controller.platformReceipt(h.request, { requestId: input.requestId, operationKey: input.operationKey }),
      committed: () => { const row = h.store.state.aiTenantAiCreditRequest[0]; assert.equal(row.state, 'approved');
        assert.equal(row.decisionOperationKey, input.operationKey); assert.equal(row.grantedAmount.toFixed(6), input.amount);
        assert.equal(h.store.state.aiTenantAiAllowance[0].grantedAmount.toFixed(6), input.amount); } };
  };
  for (const action of ['request', 'allocation', 'decision']) {
    for (const failure of ['revoked', 'identity-unavailable']) {
      const { h, invoke, read, committed } = prepare(action);
      const transaction = h.store.db.$transaction.bind(h.store.db);
      let commits = 0, unavailable = false;
      h.store.db.$transaction = async (...args) => {
        const result = await transaction(...args); commits++;
        if (failure === 'revoked') h.state.active = false; else unavailable = true;
        return result;
      };
      const resolve = h.auth.resolveAccessContext.bind(h.auth);
      h.auth.resolveAccessContext = (...args) => {
        if (unavailable) throw Error('private-identity-url private-key');
        return resolve(...args);
      };
      await assert.rejects(invoke(), error => error.getStatus() === 409
        && error.getResponse().code === 'AI_RESULT_UNKNOWN'
        && error.getResponse().nextAction === 'read_original_operation'
        && !JSON.stringify(error.getResponse()).includes('private-'));
      assert.equal(commits, 1); committed();
      await assert.rejects(read(), callHistoryError(failure === 'revoked' ? 'AI_ACCESS_DENIED' : 'AI_RESOURCE_UNAVAILABLE'));
      committed(); assert.equal(commits, 1);
      // A later independently authorized fixture read, not a production grant
      // or a replay of the write. Revocation continues to forbid receipt access.
      h.state.active = true; unavailable = false;
      const original = await read(); assert.equal(original.state, 'recorded');
      if (action === 'decision') assert.equal(original.originalDecision, 'matched');
      committed(); assert.equal(commits, 1);
    }
    const { h, invoke } = prepare(action), resolve = h.auth.resolveAccessContext.bind(h.auth);
    const before = requestFingerprint(h.store.state); let authorizations = 0;
    h.auth.resolveAccessContext = (...args) => { if (++authorizations === 2) h.state.active = false; return resolve(...args); };
    await assert.rejects(invoke(), callHistoryError('AI_ACCESS_DENIED'));
    assert.equal(requestFingerprint(h.store.state), before); // precommit rejection remains a rollback, not unknown
  }
});

test('credit command snapshots retain original request, allocation and approval keys across authentication awaits', async () => {
  const requested = creditCommandHarness(), apply = { operationKey: 'original-request', currency: 'USD', amount: '1.000001' };
  requested.onAuthorize = () => Object.assign(apply, { operationKey: 'mutated-request', currency: 'EUR', amount: '2.000002' });
  const result = await requested.controller.request(requested.request, apply);
  assert.equal(result.currency, 'USD'); assert.equal(result.requestedAmount, '1.000001');
  assert.equal(requested.store.state.aiTenantAiCreditRequest[0].operationKey, 'original-request');
  const allocated = creditCommandHarness();
  allocated.store.state.aiTenantAiAllowance.push({ tenantId: 'tenant-a', currency: 'USD', revision: 1,
    grantedAmount: new Prisma.Decimal('10.000000'), allocationsJson: {} });
  const allocation = { operationKey: 'original-allocation', currency: 'USD', expectedRevision: 1,
    allocations: [{ workspaceId: 'workspace-a', amount: '5.000001' }] };
  allocated.onAuthorize = () => { allocation.operationKey = 'mutated-allocation'; allocation.allocations[0] = { workspaceId: 'workspace-b', amount: '9.000009' }; };
  await allocated.controller.allocate(allocated.request, allocation);
  assert.deepEqual(allocated.store.state.aiTenantAiAllowance[0].allocationsJson, { 'workspace-a': '5.000001' });
  const approved = creditCommandHarness(true); approved.seedRequest('original-credit'); approved.seedRequest('other-credit', 'other-request');
  const decision = { requestId: 'original-credit', operationKey: 'original-decision', expectedRevision: 1, decision: 'approve', amount: '1.000001' };
  approved.onAuthorize = () => Object.assign(decision, { requestId: 'other-credit', operationKey: 'mutated-decision', amount: '3.000003' });
  const saved = await approved.controller.platformDecide(approved.request, decision);
  assert.equal(saved.id, 'original-credit'); assert.equal(saved.grantedAmount, '1.000001');
  assert.equal(approved.store.state.aiTenantAiCreditRequest[1].state, 'pending');
  assert.equal(approved.store.state.aiTenantAiCreditRequest[0].decisionOperationKey, 'original-decision');
  assert.equal(approved.store.state.aiTenantAiAllowance[0].grantedAmount.toFixed(6), '1.000001');
  assert.equal(approved.store.trace.filter(x => x === 'aiTenantAiAllowance.upsert').length, 1);
});

test('credit command snapshots keep original receipt selectors and do not disclose invalid input before authority', async () => {
  const h = creditCommandHarness(); h.seedRequest('original-credit', 'read-original');
  const selector = { operationKey: 'read-original' };
  h.onAuthorize = () => { selector.operationKey = 'mutated-key'; };
  const receipt = await h.controller.receipt(h.request, selector);
  assert.equal(receipt.state, 'recorded'); assert.equal(receipt.request.id, 'original-credit');
  const allocation = creditCommandHarness();
  allocation.store.state.aiTenantAiAllowance.push({ tenantId: 'tenant-a', currency: 'USD', revision: 1,
    grantedAmount: new Prisma.Decimal('10.000000'), allocationsJson: {} });
  await allocation.controller.allocate(allocation.request, { operationKey: 'allocation-original', currency: 'USD', expectedRevision: 1,
    allocations: [{ workspaceId: 'workspace-a', amount: '5.000001' }] });
  const allocationKey = { currency: 'USD', operationKey: 'allocation-original' };
  allocation.onAuthorize = () => { allocationKey.currency = 'EUR'; allocationKey.operationKey = 'mutated-key'; };
  assert.equal((await allocation.controller.allocationReceipt(allocation.request, allocationKey)).state, 'recorded');
  const queue = creditCommandHarness(true); queue.seedRequest('original-credit'); queue.seedRequest('other-credit');
  const list = queue.store.db.aiTenantAiCreditRequest.findMany; let listQuery;
  queue.store.db.aiTenantAiCreditRequest.findMany = async args => { listQuery = args; return list(args); };
  const cursor = { cursor: 'original-credit' };
  queue.onAuthorize = () => { cursor.cursor = 'other-credit'; };
  await queue.controller.platformRead(queue.request, cursor);
  assert.equal(listQuery.cursor.id, 'original-credit');
  const platform = creditCommandHarness(true); platform.seedRequest('original-credit'); platform.seedRequest('other-credit');
  const query = { requestId: 'original-credit', operationKey: 'original-decision' };
  platform.onAuthorize = () => { query.requestId = 'other-credit'; query.operationKey = 'mutated-key'; };
  const original = await platform.controller.platformReceipt(platform.request, query);
  assert.equal(original.request.id, 'original-credit'); assert.equal(original.originalDecision, 'unknown');
  const invalid = creditCommandHarness(), uncloneable = { operationKey: 'invalid', currency: 'USD', amount: '1', extra: () => {} };
  await assert.rejects(invalid.controller.request(invalid.request, uncloneable), e => e.getStatus() === 400 && e.getResponse().code === 'AI_INVALID_INPUT');
  invalid.state.active = false;
  await assert.rejects(invalid.controller.request(invalid.request, uncloneable), e => e.getStatus() === 403 && e.getResponse().code === 'AI_ACCESS_DENIED');
  assert.equal(invalid.store.state.aiTenantAiCreditRequest.length, 0);
});

// Reuse the original service identity harness. This storage double preserves a
// snapshot while a separate committed view changes; it is not a MySQL proof.
function creditSummaryHarness() {
  const h = callHistoryHarness([]), db = h.service.db;
  h.live = { granted: '10.000000', spent: '2.000001', held: '3.000002', allocated: '5.000000', revision: 3 };
  h.rootReads = 0; h.accountRows = 1; h.onAccountRead = null;
  const delegates = (state, snapshot) => {
    const note = kind => { h.trace.push([kind, snapshot ? 'snapshot' : 'root']); if (!snapshot) h.rootReads++; };
    return {
      aiBudgetPolicy: { findMany: async () => { note('summary-currencies'); return [{ moneyCurrency: 'USD' }]; } },
      aiTenantAiAllowance: { findMany: async ({ where }) => {
        note('summary-allowance'); assert.equal(where.tenantId, 'tenant');
        const rows = Array.from({ length: h.accountRows }, () => ({ tenantId: 'tenant', currency: 'USD',
          grantedAmount: new Prisma.Decimal(state.granted), revision: state.revision, allocationsJson: { workspace: state.allocated } }));
        h.onAccountRead?.(); return rows;
      } },
      aiTenantAiCreditRequest: { findMany: async ({ where }) => { note('summary-requests'); assert.equal(where.tenantId, 'tenant'); return []; } },
      businessWorkspace: { findMany: async ({ where }) => { note('summary-workspaces'); assert.equal(where.tenantId, 'tenant'); return [{ id: 'workspace', name: '空间一' }]; } },
      aiBudgetReservation: { groupBy: async ({ where }) => {
        note('summary-consumption'); assert.equal(where.tenantId, 'tenant'); assert.equal(where.moneyCurrency, 'USD');
        assert.deepEqual(where.billingMode, { in: ['platform_managed', 'legacy_unknown'] });
        return [{ status: 'settled', _count: { _all: 1, reservedMoney: 0, actualMoney: 1 },
          _sum: { reservedMoney: null, actualMoney: new Prisma.Decimal(state.spent) } },
        { status: 'pending_reconciliation', _count: { _all: 1, reservedMoney: 1, actualMoney: 0 },
          _sum: { reservedMoney: new Prisma.Decimal(state.held), actualMoney: null } }];
      } }
    };
  };
  Object.assign(db, delegates(h.live, false));
  db.$transaction = async (work, options) => {
    h.transactions++; h.trace.push(['transaction', options]);
    const result = await work(delegates({ ...h.live }, true));
    if (h.failRead) throw Error('private-database-url private-key private-SQL'); return result;
  };
  h.summary = () => h.controller.read({ headers: { authorization: 'Bearer synthetic' } }, {});
  return h;
}

test('tenant credit summary never mixes an old allowance with newly committed consumption', async () => {
  const h = creditSummaryHarness();
  h.onAccountRead = () => Object.assign(h.live, { granted: '20.000000', spent: '8.000000', held: '4.000000', allocated: '15.000000', revision: 4 });
  const result = await h.summary();
  assert.deepEqual(result.balances, [{ currency: 'USD', grantedAmount: '10.000000', spentAmount: '2.000001', heldAmount: '3.000002',
    availableAmount: '4.999997', revision: 3, allocations: [{ workspaceId: 'workspace', amount: '5.000000' }] }]);
  assert.deepEqual(result.currencies, ['USD']); assert.equal(result.requestHistoryComplete, true);
  assert.equal(h.transactions, 1); assert.equal(h.rootReads, 0);
  assert.deepEqual(h.trace.find(([kind]) => kind === 'transaction')[1], { isolationLevel: 'RepeatableRead', maxWait: 2500, timeout: 5000 });
});

test('tenant credit summary rechecks authority, bounds snapshots and sanitizes failed read acknowledgements', async () => {
  const revoked = creditSummaryHarness(); revoked.onAccountRead = () => { revoked.current.user.permissions = []; };
  await assert.rejects(revoked.summary(), callHistoryError('AI_ACCESS_DENIED'));
  assert.equal(revoked.transactions, 1);
  const over = creditSummaryHarness(); over.accountRows = 9;
  await assert.rejects(over.summary(), callHistoryError('AI_RESOURCE_UNAVAILABLE'));
  assert.equal(over.trace.filter(([kind]) => kind === 'summary-consumption').length, 0);
  const lost = creditSummaryHarness(); lost.failRead = true;
  await assert.rejects(lost.summary(), error => error.getResponse().code === 'AI_RESOURCE_UNAVAILABLE'
    && !JSON.stringify(error.getResponse()).includes('private-'));
  assert.equal(lost.transactions, 1); assert.equal(lost.rootReads, 0);
});

test('tenant call history uses original money/calls/tokens evidence and never discloses supplier or business content', async () => {
  const platform = callHistoryRow(), byok = callHistoryRow('call-002', 'tenant_managed', 'calls');
  const zero = callHistoryRow('call-003'); zero.accountingReceipts[0].inputTokens = 0n; zero.accountingReceipts[0].outputTokens = 0n;
  zero.accountingReceipts[0].usageDetails = null; zero.accountingReceipts[0].reservation.actualMoney = new Prisma.Decimal(0); refreshCallHistoryEvidence(zero);
  const tokens = callHistoryRow('call-004', 'tenant_managed', 'tokens');
  // Original completed usage survives admission expiry/revocation; reading
  // history must not require a fresh execution/admission grant.
  for (const row of [platform, byok, zero, tokens]) Object.assign(row.accountingReceipts[0].admission,
    { status: 'revoked', revokedAt: new Date('2026-10-05'), completedAt: new Date('2026-10-04'), expiresAt: new Date('2026-10-04') });
  const h = callHistoryHarness([platform, byok, zero, tokens]);
  const result = await h.read(), find = id => result.records.find(row => row.id === id);
  assert.equal(find(platform.id).amount, '0.123456'); assert.equal(find(platform.id).currency, 'USD');
  assert.equal(find(platform.id).modelLabel, 'Rental OS AI'); assert.equal(find(platform.id).cachedInputTokens, '4');
  assert.equal(find(byok.id).state, 'settled'); assert.equal(find(byok.id).amount, null); assert.equal(find(byok.id).currency, null);
  assert.equal(find(byok.id).modelLabel, 'private-model'); assert.equal(find(tokens.id).state, 'settled');
  assert.equal(find(zero.id).amount, '0.000000'); assert.equal(find(zero.id).inputTokens, '0'); assert.equal(find(zero.id).cachedInputTokens, null);
  assert.deepEqual(Object.keys(find(platform.id)).sort(), ['id', 'taskId', 'callId', 'createdAt', 'workspaceId', 'workspaceName', 'actorName',
    'sceneCode', 'mode', 'modelLabel', 'state', 'inputTokens', 'outputTokens', 'cachedInputTokens', 'amount', 'currency', 'operationKind', 'calls'].sort());
  const platformOutput = JSON.stringify(find(platform.id));
  for (const privateValue of ['private-provider', 'private-model', 'private-credential', 'private-dispatch-token', 'private-prompt', 'private-business'])
    assert.ok(!platformOutput.includes(privateValue), privateValue);
  assert.ok(!JSON.stringify(result).includes('private-credential'));
  assert.deepEqual(h.trace.find(([kind]) => kind === 'transaction')[1], { isolationLevel: 'RepeatableRead', maxWait: 2500, timeout: 5000 });
  assert.equal(h.transactions, 1); assert.equal(result.nextCursor, null);
  assert.ok(h.trace.every(([kind]) => ['auth', 'transaction', 'workspaces', 'scopes', 'calls', 'users', 'counts', 'count-reservations', 'count-receipts'].includes(kind)), 'read-only fixture has no write/config/provider port');
});

test('counted requests reach tenant call history without becoming Tokens or platform money', async () => {
  const schemas = require('../apps/api/src/contracts/ai-credit').AI_CREDIT_COMPONENT_SCHEMAS;
  const validators = require('./fixtures/ai-native/contract-consumer.cjs').validatorsFor(schemas, {});
  for (const mode of ['platform_managed', 'tenant_managed']) {
    const parent = callHistoryRow('model-counted', mode, mode === 'platform_managed' ? 'money' : 'calls');
    const h = callHistoryHarness([parent]), counted = callHistoryCount(parent); h.counts.push(counted);
    const result = await h.read(), counting = result.records.find(row => row.id === counted.claim.id), model = result.records.find(row => row.id === parent.id);
    assert.equal(validators.AiTenantCallRecords(result), true, JSON.stringify(validators.AiTenantCallRecords.errors));
    assert.equal(result.records.length, 2); assert.equal(model.operationKind, 'model'); assert.equal(model.calls, '1');
    assert.equal(counting.operationKind, 'input_counting'); assert.equal(counting.calls, '1'); assert.equal(counting.state, 'settled');
    assert.equal(counting.taskId, parent.taskId); assert.equal(counting.mode, mode); assert.equal(counting.actorName, '操作人');
    for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'amount', 'currency']) assert.equal(counting[field], null, field);
    assert.ok(!JSON.stringify(counting).includes('private-credential') && !JSON.stringify(counting).includes('private-business'));
    assert.equal(result.nextCursor, null);
    counted.receipt = null; counted.reservation.status = 'reserved'; counted.reservation.dispatchState = 'unknown';
    const pending = (await h.read()).records.find(row => row.id === counted.claim.id);
    assert.equal(pending.state, 'unknown'); assert.equal(pending.calls, null); assert.equal(pending.inputTokens, null);
    counted.reservation.tenantId = 'other-tenant';
    await assert.rejects(h.read(), callHistoryError('AI_RESOURCE_UNAVAILABLE'));
  }
});

test('mixed call history crosses both cursor sources at equal times and keeps mode filters bounded', async () => {
  const parents = Array.from({ length: 30 }, (_, index) => callHistoryRow(`model-${String(index).padStart(3, '0')}`));
  const h = callHistoryHarness(parents); h.counts.push(...parents.map(parent => callHistoryCount(parent)));
  const first = await h.read(); assert.equal(first.records.length, 50);
  assert.ok(first.records.slice(0, 30).every(row => row.operationKind === 'model'));
  assert.ok(first.records.slice(30).every(row => row.operationKind === 'input_counting'));
  const second = await h.read({ since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z', cursor: first.nextCursor });
  assert.equal(second.records.length, 10); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.records, ...second.records].map(row => row.id)).size, 60);
  const byok = callHistoryRow('byok-counted', 'tenant_managed', 'calls'); h.rows.push(byok); h.counts.push(callHistoryCount(byok));
  const filtered = await h.read({ since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z', mode: 'tenant_managed' });
  assert.equal(filtered.records.length, 2); assert.ok(filtered.records.every(row => row.mode === 'tenant_managed'));
  await assert.rejects(h.read({ since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z', mode: 'platform_managed',
    cursor: h.counts.at(-1).claim.id }), callHistoryError('AI_ACCESS_DENIED'));
});

test('completed model requests retain known calls independently of missing Token usage and pending money', async () => {
  for (const mode of ['platform_managed', 'tenant_managed']) {
    const row = callHistoryRow('completed-without-usage', mode, mode === 'platform_managed' ? 'money' : 'calls');
    const receipt = row.accountingReceipts[0], reservation = receipt.reservation;
    Object.assign(receipt, { inputTokens: null, outputTokens: null, usageHash: null, usageDetails: null });
    Object.assign(receipt.admission, { status: 'completed', completedAt: new Date('2026-10-04T12:01:00Z') });
    Object.assign(reservation, { status: 'pending_reconciliation', dispatchState: 'unknown' });
    const h = callHistoryHarness([row]), result = (await h.read()).records[0];
    assert.equal(result.calls, '1'); assert.equal(result.state, 'unknown');
    for (const field of ['inputTokens', 'outputTokens', 'cachedInputTokens', 'amount', 'currency']) assert.equal(result[field], null);
    assert.equal(reservation.status, 'pending_reconciliation'); assert.equal(h.transactions, 1);
    receipt.admission.completedAt = null;
    assert.equal((await h.read()).records[0].calls, null, 'No completion/usage evidence cannot become zero or a guessed call');
  }
});

test('call history retains unknown and missing usage instead of manufacturing settlement, cancellation or zero', async () => {
  const variants = [
    ['no ledger', row => { row.accountingReceipts[0].reservation.ledger = []; }],
    ['wrong ledger hash', row => { row.accountingReceipts[0].reservation.ledger[0].evidenceHash = 'a'.repeat(64); }],
    ['changed actual amount', row => { row.accountingReceipts[0].reservation.actualMoney = new Prisma.Decimal('0.123457'); }],
    ['changed price version', row => { row.accountingReceipts[0].reservation.priceVersion = 'new-current-price'; }],
    ['foreign ledger', row => { row.accountingReceipts[0].reservation.ledger[0].tenantId = 'other-tenant'; }],
    ['double terminal', row => { row.accountingReceipts[0].reservation.ledger.push(row.accountingReceipts[0].reservation.ledger[0]); }],
    ['wrong payer', row => { row.accountingReceipts[0].reservation.billingMode = 'tenant_managed'; }],
    ['wrong usage hash', row => { row.accountingReceipts[0].usageHash = 'b'.repeat(64); }],
    ['unsafe usage', row => { row.accountingReceipts[0].inputTokens = 9007199254740993n; }],
    ['missing usage', row => { row.accountingReceipts[0].inputTokens = null; row.accountingReceipts[0].outputTokens = null; row.accountingReceipts[0].usageHash = null; }],
    ['invalid cache dimensions', row => { row.accountingReceipts[0].usageDetails = false; }],
    ['pending original result', row => { row.accountingReceipts[0].reservation.status = 'pending_reconciliation'; }],
    ['unproved cancellation', row => { row.accountingReceipts[0].state = 'cancelled'; }],
    ['foreign configuration', row => { row.configuration.tenantId = 'other-tenant'; row.configurationHash = requestFingerprint(row.configuration);
      row.accountingReceipts[0].reservation.configurationHash = row.configurationHash; }],
    // Each existing usage/ledger hash remains intact. Missing or foreign
    // immutable provenance must not be replaced by those independent hashes.
    ['missing original admission', row => { row.accountingReceipts[0].admission = null; }],
    ['foreign original admission', row => { Object.assign(row.accountingReceipts[0].admission,
      { tenantId: 'other-tenant', workspaceId: 'other-workspace', actorId: 'other-actor', callId: 'other-call', profileId: 'other-profile' }); }],
    ['changed original dispatch', row => { row.accountingReceipts[0].admission.dispatchId = 'other-dispatch'; }],
    ['changed original request', row => { row.accountingReceipts[0].admission.requestHash = 'other-request'; }],
    ['changed original idempotency', row => { row.accountingReceipts[0].reservation.idempotencyKey = 'other-call'; }]
  ];
  for (const [name, mutate] of variants) {
    const row = callHistoryRow(); mutate(row); const result = (await callHistoryHarness([row]).read()).records[0];
    assert.equal(result.state, 'unknown', name); assert.equal(result.amount, null, name); assert.equal(result.currency, null, name);
    if (['wrong usage hash', 'unsafe usage', 'missing usage', 'invalid cache dimensions', 'unproved cancellation',
      'missing original admission', 'foreign original admission', 'changed original dispatch', 'changed original request', 'changed original idempotency'].includes(name)) {
      assert.equal(result.inputTokens, null, name); assert.equal(result.outputTokens, null, name);
    }
    if (name === 'foreign configuration') { assert.equal(result.mode, 'unknown'); assert.equal(result.modelLabel, '配置待核对'); }
  }
  const missing = callHistoryRow(); missing.accountingReceipts = [];
  const noReceipt = (await callHistoryHarness([missing]).read()).records[0]; assert.equal(noReceipt.state, 'registered'); assert.equal(noReceipt.inputTokens, null);
  const cancelled = callHistoryRow(), receipt = cancelled.accountingReceipts[0], reservation = receipt.reservation;
  Object.assign(receipt, { state: 'cancelled', inputTokens: null, outputTokens: null, usageHash: null, usageDetails: null });
  Object.assign(reservation, { status: 'released', dispatchState: 'not_dispatched', actualMoney: null });
  reservation.ledger = [{ ...reservation.ledger[0], kind: 'release', evidenceHash: null, moneyAmount: null, moneyCurrency: null }];
  assert.equal((await callHistoryHarness([cancelled]).read()).records[0].state, 'cancelled');
  reservation.actualMoney = new Prisma.Decimal('0.5'); assert.equal((await callHistoryHarness([cancelled]).read()).records[0].state, 'unknown');
  reservation.actualMoney = null; receipt.usageDetails = { cachedInputTokens: 1, cacheCreationInputTokens: 0 };
  assert.equal((await callHistoryHarness([cancelled]).read()).records[0].state, 'unknown');
  receipt.usageDetails = null; reservation.dispatchState = 'unknown'; assert.equal((await callHistoryHarness([cancelled]).read()).records[0].state, 'unknown');
});

test('call history pages stable timestamp/id tuples and rejects foreign or filtered-out anchors before querying a page', async () => {
  const rows = Array.from({ length: 52 }, (_, index) => { const row = callHistoryRow(`call-${String(index).padStart(3, '0')}`); row.accountingReceipts = []; return row; });
  const foreign = callHistoryRow('foreign'); foreign.scopeId = 'foreign-scope';
  const outside = callHistoryRow('outside'); outside.createdAt = new Date('2026-09-30T12:00:00Z');
  const byok = callHistoryRow('byok-anchor', 'tenant_managed', 'calls');
  const h = callHistoryHarness([...rows, foreign, outside, byok]);
  const query = { since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z', mode: 'platform_managed' };
  const first = await h.read(query); assert.equal(first.records.length, 50); assert.equal(first.nextCursor, first.records[49].id);
  assert.ok(first.records.every(row => row.id !== 'foreign' && row.id !== 'outside' && row.id !== 'byok-anchor'));
  const newer = callHistoryRow('newer'); newer.accountingReceipts = []; newer.createdAt = new Date('2026-10-05T12:00:00Z'); h.rows.push(newer);
  const second = await h.read({ ...query, cursor: first.nextCursor });
  assert.equal(second.records.length, 2); assert.equal(second.nextCursor, null);
  assert.equal(new Set([...first.records, ...second.records].map(row => row.id)).size, 52);
  assert.equal(h.queries[1].cursor, undefined); assert.equal(h.queries[1].skip, undefined);
  assert.deepEqual(h.queries[1].where.AND[1].OR, [{ createdAt: { lt: rows[0].createdAt } }, { createdAt: rows[0].createdAt, id: { lt: first.nextCursor } }]);
  for (const cursor of ['foreign', 'outside', 'byok-anchor', 'missing']) {
    const count = h.queries.length; await assert.rejects(h.read({ ...query, cursor }), callHistoryError('AI_ACCESS_DENIED'));
    assert.equal(h.queries.length, count, cursor);
  }
  await assert.rejects(h.read({ ...query, workspaceId: 'other-workspace' }), callHistoryError('AI_ACCESS_DENIED'));
});

test('call history freezes request filters before authentication and rechecks current tenant-manager authority after reading', async () => {
  const h = callHistoryHarness(), query = { since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z', mode: 'platform_managed' };
  h.onAuthorize = () => { query.mode = 'tenant_managed'; query.until = '2026-11-01T00:00:00Z'; };
  const result = await h.read(query); assert.equal(result.records.length, 1);
  assert.equal(h.queries[0].where.configuration.equals, 'platform_managed'); assert.equal(h.queries[0].where.createdAt.lt.toISOString(), '2026-10-08T00:00:00.000Z');
  h.onAuthorize = null; h.onList = () => { h.current.tenantUser.isPlatformAdmin = false; };
  await assert.rejects(h.read(), callHistoryError('AI_ACCESS_DENIED'));
  h.current.tenantUser.isPlatformAdmin = true; h.onList = () => { h.current.workspaceId = 'other-workspace'; };
  await assert.rejects(h.read(), callHistoryError('AI_ACCESS_DENIED'));
  h.onList = null; h.current.workspaceId = 'workspace'; h.current.user.isSaasAdmin = true;
  await assert.rejects(h.read(), callHistoryError('AI_ACCESS_DENIED'));
});

test('call history bounds input and sanitizes read/association failures without a retry or any new resource', async () => {
  const h = callHistoryHarness(), query = { since: '2026-10-01T00:00:00Z', until: '2026-10-08T00:00:00Z' };
  for (const input of [{ ...query, until: query.since }, { ...query, since: '2026-08-01T00:00:00Z' }, { ...query, tenantId: 'other' }, { ...query, cursor: '' }])
    await assert.rejects(h.read(input), callHistoryError('AI_INVALID_INPUT'));
  assert.equal(h.transactions, 0);
  h.failRead = true;
  await assert.rejects(h.read(query), error => { assert.deepEqual(error.getResponse(), { code: 'AI_RESOURCE_UNAVAILABLE', retryable: false }); return true; });
  assert.equal(h.transactions, 1, 'an ambiguous read does not become a mutation retry');
  h.failRead = false; h.rows[0].accountingReceipts[0].reservation.tenantId = 'other-tenant';
  await assert.rejects(h.read(query), callHistoryError('AI_RESOURCE_UNAVAILABLE'));
});
