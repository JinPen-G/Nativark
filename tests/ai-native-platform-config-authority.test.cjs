'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', lib: ['es2022'], experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard, requiredPermissions } = require('../apps/api/src/common/api-auth.guard');
const { ExecutionContextHost } = require('@nestjs/core/helpers/execution-context-host');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
const { PlatformModelConfigurationAuthority } = require('../apps/api/src/modules/ai-native/platform-model-config.authority');
const { AiOrderRouteContextAuthority } = require('../apps/api/src/modules/ai-native/order-route-context.authority');
const { createAuthorizedPlatformModelConfiguration } = require('../apps/api/src/modules/ai-native/platform-model-config.composition');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const path = '/api/platform/ai/providers/synthetic-profile';
function setup() {
  const state = { user: user(), active: true, workspace: 'workspace-a', audience: 'operator' };
  state.user.isSaasAdmin = true; state.user.permissions = ['system:ai-provider:manage'];
  const auth = new AuthService({
    getAuthSession: async () => state.active ? { id: 'session-a', userId: state.user.id, audience: 'operator', currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.user, listUserWorkspaces: async () => []
  }, { get: name => name === 'AUTH_TOKEN_SECRET' ? 'synthetic-token-signing-only' : undefined });
  const credentials = { current: async () => ({ authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId,
    sid: 'session-a', wid: state.workspace, aud: 'operator', exp: Math.floor(Date.now() / 1000) + 60 })}`, requestId: 'synthetic-request', audience: state.audience }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => ({ id: 'order-a' }) } });
  const invocation = new AiOrderRouteContextAuthority(guard, credentials, 'order-a');
  const authority = new PlatformModelConfigurationAuthority(guard, credentials, 'synthetic-profile', invocation);
  const activate = async (method = 'PUT', route = path) => runWithRequestIdentity({}, async () => {
    const credential = await credentials.current();
    const request = { url: route, originalUrl: route, method, headers: { authorization: credential.authorization }, query: {} };
    return guard.canActivate(new ExecutionContextHost([request]));
  });
  return { state, auth, guard, credentials, activate, invocation, authority };
}
test('standard platform probe is inert and keeps current-authorized history when new execution is disabled', async () => {
  const { composeStandardPlatformProbe } = require('../apps/api/src/modules/ai-native/platform-capability-probe/platform-capability-standard.application');
  const { PlatformCapabilityProbeController } = require('../apps/api/src/modules/ai-native/platform-capability-probe/platform-capability-probe.controller');
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const h = setup(); h.state.user.permissions = ['system:ai-provider:view'];
  const scope = { id: 'platform-scope', ...aiPersistenceScopeColumns({ kind: 'platform' }) };
  const store = createTaskInputStore({ aiScope: [scope], aiTask: [], aiRun: [], aiStep: [], aiTaskActionInput: [],
    aiTaskOriginalRequest: [], aiTaskActionPolicy: [], aiTaskPlanPolicy: [], aiProviderProfile: [], aiPlatformModelConnection: [],
    aiBudgetPolicy: [], aiBudgetReservation: [], aiBudgetLedgerEntry: [], aiBudgetAllocation: [], aiGatewayInvocation: [],
    aiGatewayAccountingReceipt: [], aiInvocationAdmission: [], aiProviderCapability: [], aiProviderCapabilityEvidence: [], operationLog: [] });
  store.db.aiPlatformModelConnection.update = async () => { throw Error('history cannot update platform connection'); };
  const input = { db: store.db, guard: h.guard,
    secrets: { encrypt() { throw Error('history cannot encrypt'); }, decrypt() { throw Error('history cannot decrypt'); } } };
  const request = { headers: { authorization: (await h.credentials.current()).authorization } }, key = { requestKey: 'probe-not-created' };
  const settings = { enabled: false, platformProfileId: 'synthetic-profile', sceneVersion: '1', priceVersion: 'count-price',
    host: { holderId: 'probe-worker', leaseMs: 30000 } };
  const disabled = composeStandardPlatformProbe(input), before = store.trace.length;
  assert.throws(() => disabled.open(request), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const factory = composeStandardPlatformProbe(input, settings);
  assert.equal(store.trace.length, before);
  const controller = new PlatformCapabilityProbeController(factory);
  assert.deepEqual(await controller.readOriginal(request, key), { ...key, retryable: false, state: 'not_observed' });
  const opened = factory.open(request);
  for (const method of ['prepareOriginal', 'readExecutableOriginal', 'createTask', 'start', 'readCapabilityReceipt'])
    assert.throws(() => opened[method](key), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  opened.close();
  await assert.rejects(opened.readOriginal(key), e => e.code === 'AI_ACCESS_DENIED');
  await assert.rejects(controller.readOriginal(request, { ...key, actorId: 'forged' }), e => e.getStatus() === 400);
  h.state.active = false;
  await assert.rejects(controller.readOriginal(request, key), e => e.getStatus() === 403);
  assert.ok(store.trace.every(line => !/\.(create|update|upsert|createMany)$/u.test(line)));
  assert.throws(() => composeStandardPlatformProbe(input, { ...settings, enabled: true }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  assert.throws(() => composeStandardPlatformProbe(input, { ...settings, tenantId: 'forged' }), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
  const fs = require('node:fs'), source = fs.readFileSync(require('node:path').join(__dirname, '../apps/api/src/app.module.ts'), 'utf8');
  assert.match(source, /controllers:\s*\[[\s\S]*?\bPlatformCapabilityProbeController\b/u);
  assert.match(source, /providers:\s*\[[\s\S]*?\bAI_NATIVE_PLATFORM_PROBE_PROVIDER\b/u);
});

test('standard platform probe uses the default task audit without assembly IO or granting execution', async () => {
  const { composeStandardPlatformProbe } = require('../apps/api/src/modules/ai-native/platform-capability-probe/platform-capability-standard.application');
  const { PlatformCapabilityProbeController } = require('../apps/api/src/modules/ai-native/platform-capability-probe/platform-capability-probe.controller');
  const h = platformAuditHarness();
  h.state.user.permissions = ['system:ai-provider:view', 'system:ai-provider:manage'];
  h.store.db.aiPlatformModelConnection.update = async () => assert.fail('assembly cannot update platform connection');
  const input = { db: h.store.db, guard: h.guard,
    secrets: { encrypt() { assert.fail('missing original cannot encrypt'); }, decrypt() { assert.fail('missing original cannot decrypt'); } } };
  const settings = { enabled: true, platformProfileId: 'synthetic-profile', sceneVersion: '1', priceVersion: 'synthetic-price-version',
    host: { holderId: 'synthetic-holder', leaseMs: 30000 } };
  const factory = composeStandardPlatformProbe(input, settings);
  // Subsequent caller mutation cannot turn the server-frozen profile into a request choice.
  settings.platformProfileId = 'forged-profile'; settings.enabled = false;
  const request = { headers: { authorization: (await h.credentials.current()).authorization } };
  const opened = factory.open(request), controller = new PlatformCapabilityProbeController(factory), key = { requestKey: 'missing-original' };
  assert.equal(h.store.trace.length, 0);
  assert.equal(Object.hasOwn(opened, 'audit'), false);
  assert.equal(Object.hasOwn(opened, 'application'), false);
  // The existing executable-original reader preserves an explicit absence;
  // opening the standard host must not manufacture one or imply execution success.
  assert.deepEqual(await opened.readExecutableOriginal(key), { state: 'not_found' });
  assert.deepEqual(await controller.readOriginal(request, key), { ...key, retryable: false, state: 'not_observed' });
  h.state.user.permissions = ['system:ai-provider:view'];
  await assert.rejects(opened.readExecutableOriginal(key), { code: 'AI_ACCESS_DENIED' });
  h.state.active = false;
  await assert.rejects(controller.readOriginal(request, key), e => e.getStatus() === 403);
  opened.close();
  await assert.rejects(opened.readOriginal(key), { code: 'AI_ACCESS_DENIED' });
  assert.ok(h.store.trace.every(line => !/\.(create|update|upsert|createMany)$/u.test(line)));
  assert.equal(h.store.state.operationLog.length, 0);
  assert.equal(h.store.state.aiBudgetLedgerEntry.length, 0);
  assert.equal(h.store.state.aiTextCapabilityReceipt.length, 0);
});

test('standard platform probe refuses missing default audit storage and malformed explicit sinks without IO', () => {
  const { composeStandardPlatformProbe } = require('../apps/api/src/modules/ai-native/platform-capability-probe/platform-capability-standard.application');
  const h = platformAuditHarness(), settings = { enabled: true, platformProfileId: 'synthetic-profile', sceneVersion: '1',
    priceVersion: 'synthetic-price-version', host: { holderId: 'synthetic-holder', leaseMs: 30000 } };
  const input = { db: h.store.db, guard: h.guard, secrets: { decrypt() { assert.fail('assembly cannot decrypt'); } } };
  for (const db of [
    { ...h.store.db, user: undefined }, { ...h.store.db, user: {} }, { ...h.store.db, $transaction: undefined },
    { ...h.store.db, operationLog: undefined }, { ...h.store.db, operationLog: { findUnique: h.store.db.operationLog.findUnique } },
    { ...h.store.db, operationLog: { create: h.store.db.operationLog.create } }
  ]) assert.throws(() => composeStandardPlatformProbe({ ...input, db }, settings), { code: 'AI_RESOURCE_UNAVAILABLE' });
  for (const audit of [null, {}, { append: false }])
    assert.throws(() => composeStandardPlatformProbe({ ...input, audit }, settings), { code: 'AI_RESOURCE_UNAVAILABLE' });
  assert.throws(() => composeStandardPlatformProbe(input, { ...settings, audit: {} }), { code: 'AI_RESOURCE_UNAVAILABLE' });
  // An explicit server-owned sink remains an alternative, but is never called during assembly.
  assert.equal(typeof composeStandardPlatformProbe({ ...input, audit: { append: async () => assert.fail('assembly cannot audit') } }, settings).open, 'function');
  assert.equal(h.store.trace.length, 0);
});

test('explicit SaaS provider-management permission is recognized by the actual existing Guard', async () => {
  const h = setup(); assert.equal(await h.activate(), true);
  assert.deepEqual(requiredPermissions('PUT', '/platform/ai/providers/synthetic-profile'), ['system:ai-provider:manage']);
});

test('actual Guard fails closed for unknown suffix, methods, missing permission and forced password change', async () => {
  const h = setup();
  for (const [method, route] of [['DELETE', path], ['POST', path], ['PUT', path + '/secrets'], ['PUT', '/api/platform/ai/providers2/synthetic-profile']]) {
    await assert.rejects(h.activate(method, route));
  }
  h.state.user.permissions = []; await assert.rejects(h.activate());
  h.state.user.permissions = ['system:ai-provider:manage']; h.state.user.mustChangePassword = true;
  await assert.rejects(h.activate());
});

test('wildcard roles cannot authorize undefined platform-AI paths or unsupported actions', async () => {
  for (const saas of [true, false]) {
    const h = setup(); h.state.user.isSaasAdmin = saas; h.state.user.isPlatformAdmin = true; h.state.user.permissions = ['*'];
    for (const [method, route] of [['DELETE', path], ['POST', path], ['PUT', path + '/secrets'], ['PUT', '/api/platform/ai/unregistered']]) {
      await assert.rejects(h.activate(method, route));
    }
  }
});

test('view permission is not manage; management is not order access or a fabricated workspace', async () => {
  const h = setup(); h.state.user.permissions = ['system:ai-provider:view'];
  assert.equal(await h.activate('GET'), true); await assert.rejects(h.authority.manage('synthetic-profile'));
  h.state.user.permissions = ['system:ai-provider:manage'];
  const resolved = await h.authority.resolve();
  assert.deepEqual(resolved.scope, { kind: 'platform' }); assert.equal(resolved.actor.kind, 'saas_admin');
  assert.equal(Object.hasOwn(resolved.scope, 'workspaceId'), false);
  await assert.rejects(h.authority.invoke({ tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' }));
});

test('server-bound Profile, revoked current permission/session and staff audience are rechecked', async () => {
  const h = setup(); await h.authority.manage('synthetic-profile');
  await assert.rejects(h.authority.manage('other-profile'));
  h.state.user.permissions = []; await assert.rejects(h.authority.manage('synthetic-profile'));
  h.state.user.permissions = ['system:ai-provider:manage']; h.state.audience = 'staff';
  await assert.rejects(h.authority.resolve()); h.state.audience = 'operator'; h.state.active = false;
  await assert.rejects(h.authority.resolve());
});

test('workspace consumer invocation uses real current order authority, not platform management', async () => {
  const h = setup(); h.state.user.isSaasAdmin = false; h.state.user.permissions = ['rental-os:order:view'];
  const context = { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' };
  await h.authority.invoke(context);
  for (const field of ['tenantId', 'workspaceId', 'actorId']) await assert.rejects(h.authority.invoke({ ...context, [field]: 'forged' }));
  await assert.rejects(h.authority.manage('synthetic-profile'));
  h.state.workspace = 'workspace-b'; await assert.rejects(h.authority.invoke(context));
});

test('actual authorization, canonical scope and platform vault compose without enabling production', async () => {
  const h = setup(), clone = structuredClone;
  const scope = { id: 'synthetic-platform', ...aiPersistenceScopeColumns({ kind: 'platform' }) };
  const workspace = { id: 'synthetic-workspace', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' }) };
  let stored = { id: 'synthetic-profile', scopeId: scope.id, scopeKind: 'PLATFORM', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'platform_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic/model',
    credentialRef: 'unconfigured', configRevision: 1, enabled: false, disabledAt: null, allowedCapabilities: [] }, vault = null;
  const matches = (row, where) => row && Object.entries(where).every(([k, v]) => row[k] === v);
  const delegates = target => ({
    aiProviderProfile: { findFirst: async args => matches(target.profile, args.where) ? { ...clone(target.profile), ...(args.include ? { platformConnection: clone(target.vault) } : {}) } : null,
      updateMany: async args => { if (!matches(target.profile, args.where)) return { count: 0 }; Object.assign(target.profile, clone(args.data)); return { count: 1 }; } },
    aiPlatformModelConnection: { findUnique: async () => clone(target.vault),
      create: async args => { target.vault = clone(args.data); return clone(target.vault); }, update: async args => { Object.assign(target.vault, clone(args.data)); return clone(target.vault); } }
  });
  const db = { aiScope: { findFirst: async args => clone([scope, workspace].find(row => matches(row, args.where)) ?? null) },
    aiProviderProfile: { findFirst: async args => delegates({ profile: stored, vault }).aiProviderProfile.findFirst(args), updateMany: async () => { throw Error('outside transaction'); } },
    aiPlatformModelConnection: { findUnique: async () => clone(vault), create: async () => { throw Error('outside transaction'); }, update: async () => { throw Error('outside transaction'); } },
    $transaction: async operation => { const draft = { profile: clone(stored), vault: clone(vault) }; const result = await operation(delegates(draft)); stored = draft.profile; vault = draft.vault; return result; } };
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY'
    ? 'synthetic-only-0123456789abcdef-AES256-not-a-real-secret' : key === 'NODE_ENV' ? 'production' : undefined });
  const composed = createAuthorizedPlatformModelConfiguration({ db, guard: h.guard, credentials: h.credentials, invocation: h.invocation, profileId: stored.id, secrets });
  await composed.management.save({ profileId: stored.id, expectedRevision: 1, protocol: stored.protocol, model: stored.model,
    baseUrl: 'https://synthetic-model.example.test/v1', enabled: true, maxOutputTokens: 20, secretChange: { operation: 'replace', apiKey: 'synthetic-secret-only' } });
  assert.equal(stored.configRevision, 2); assert.equal(vault.configRevision, 2);
  h.state.user.isSaasAdmin = false; h.state.user.permissions = ['rental-os:order:view'];
  const context = { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' };
  assert.equal((await composed.invocation.resolve(context, clone(stored))).credential, 'synthetic-secret-only');
  await assert.rejects(composed.management.save({}), error => error.code === 'CONFIG_INVALID');
  h.state.active = false; await assert.rejects(composed.invocation.resolve(context, clone(stored)), error => error.code === 'FORBIDDEN');
});

test('composition refuses absent storage/actions; invalid Profile and time never become an authority', async () => {
  assert.throws(() => createAuthorizedPlatformModelConfiguration({}), error => error.code === 'CONFIG_INVALID');
  const h = setup();
  assert.throws(() => new PlatformModelConfigurationAuthority(h.guard, h.credentials, '../other', h.invocation), error => error.code === 'CONFIG_INVALID');
  const invalidTime = new PlatformModelConfigurationAuthority(h.guard, h.credentials, 'synthetic-profile', h.invocation, () => new Date(NaN));
  await assert.rejects(invalidTime.resolve(), error => error.code === 'FORBIDDEN');
});

test('separate current sessions preserve SaaS versus workspace scope even with a prior ALS identity', async () => {
  const platform = setup(), consumer = setup();
  consumer.state.user.isSaasAdmin = false; consumer.state.user.permissions = ['rental-os:order:view'];
  await runWithRequestIdentity({ isSaasAdmin: true, userId: 'forged', tenantId: 'other', workspaceId: 'other' }, async () => {
    await Promise.all([platform.authority.manage('synthetic-profile'), consumer.authority.invoke({ tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' })]);
    await assert.rejects(consumer.authority.manage('synthetic-profile'));
    assert.deepEqual((await platform.authority.resolve()).scope, { kind: 'platform' });
  });
});
test('tenant administrators and SaaS tenant-management permission cannot administer AI providers', async () => {
  for (const change of [h => { h.state.user.isSaasAdmin = false; h.state.user.isPlatformAdmin = true; },
    h => { h.state.user.permissions = ['system:tenant:edit']; }, h => { h.state.active = false; }]) {
    const h = setup(); change(h); await assert.rejects(h.activate());
  }
});

// Existing serialized storage double, actual Guard/scope/accounting readers.
// No MySQL or provider is contacted; reserved evidence is deliberately unknown.
function platformAuditHarness(mode = 'invoke') {
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const { AiScopeRepository } = require('../apps/api/src/modules/ai-native/ai-scope.repository');
  const { PrismaGatewayAccountingFacts } = require('../apps/api/src/modules/ai-native/budget/prisma-gateway-accounting-facts');
  const { PrismaPlatformGatewayAudit } = require('../apps/api/src/modules/ai-native/prisma-platform-gateway-audit');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { AI_TASK_DRAFT_VERSION } = require('@rental-os/shared');
  const h = setup(), actorId = h.state.user.id, expiresAt = new Date(Date.now() + 600000);
  const owner = { id: 'platform-scope', ...aiPersistenceScopeColumns({ kind: 'platform' }) };
  const profile = { id: 'synthetic-profile', scopeId: owner.id, scopeKind: 'PLATFORM', profileKey: 'default', role: 'DEFAULT',
    serviceMode: 'platform_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'synthetic-model',
    credentialRef: 'synthetic-vault-reference', configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: ['text'] };
  const configuration = require('../apps/api/src/modules/ai-native/text-capability-probe').textProbeConfiguration(profile, { kind: 'platform' });
  const common = { scopeId: owner.id, taskId: 'audit-task', actorId, callId: 'audit-call', runId: 'audit-run',
    stepId: 'audit-step', actionId: 'audit-action', sceneCode: 'ai.capability.text', priceVersion: 'synthetic-price-version' };
  const requestHash = 'a'.repeat(64), intentHash = 'b'.repeat(64), configurationHash = requestFingerprint(configuration);
  const invocation = { ...common, id: 'audit-invocation', mode, intentHash, configuration, configurationHash,
    registrationHash: 'c'.repeat(64), stepFingerprint: 'd'.repeat(64), maxOutputTokens: 32 };
  const attribution = { scopeKind: 'PLATFORM', tenantId: null, workspaceId: null };
  const admission = { id: 'audit-admission', ...attribution, actorId, callId: common.callId, platformDedupKey: common.callId,
    profileId: profile.id, dispatchId: 'synthetic-private-dispatch', requestHash, status: 'admitted', revokedAt: null,
    completedAt: null, expiresAt };
  const reservation = { ...common, ...attribution, id: 'audit-reservation', requestId: common.callId, idempotencyKey: common.callId,
    configRevision: profile.configRevision, configurationHash, status: 'reserved', dispatchState: 'not_dispatched' };
  const receipt = { ...attribution, id: 'audit-accounting', scopeId: owner.id, taskId: common.taskId, invocationId: invocation.id,
    admissionId: admission.id, reservationId: reservation.id, dispatchToken: admission.dispatchId, requestHash, state: 'reserved',
    usageHash: null, inputTokens: null, outputTokens: null };
  const store = createTaskInputStore({ user: [h.state.user], aiScope: [owner], aiTask: [{ id: common.taskId, scopeId: owner.id,
    scopeKind: 'PLATFORM', ownerKind: 'SAAS_ADMIN', ownerId: actorId, audience: 'OPERATOR', archivedAt: null,
    contractVersion: AI_TASK_DRAFT_VERSION }], aiRun: [], aiStep: [], aiGatewayInvocation: [invocation],
    aiInvocationAdmission: [admission], aiGatewayAccountingReceipt: [receipt], aiBudgetReservation: [reservation],
    aiBudgetAllocation: [], aiBudgetLedgerEntry: [], aiBudgetPolicy: [], aiProviderProfile: [profile],
    aiProviderCapabilityEvidence: [], aiTaskActionInput: [], aiTaskOriginalRequest: [], aiTaskActionPolicy: [],
    aiTaskPlanPolicy: [], aiTaskRunPlan: [], aiTaskExecutionBudget: [], aiTaskExecutionCharge: [], operationLog: [],
    aiPlatformModelConnection: [], aiTextCapabilityReceipt: [] });
  const scopes = new AiScopeRepository(store.db, { resolve: () => h.authority.resolve() });
  const context = { actorId }, association = { requestId: common.callId, idempotencyKey: common.callId,
    runId: common.runId, stepId: common.stepId, actionId: common.actionId, priceVersion: common.priceVersion,
    scope: { kind: 'platform' }, config: configuration };
  const bound = async actual => { assert.deepEqual(actual, context); return { association }; };
  const facts = new PrismaGatewayAccountingFacts(store.db, {
    resolveForReserve: async (actual, request) => { assert.equal(request.callId, common.callId); return bound(actual); },
    resolveForReservation: async (actual, id) => { assert.equal(id, reservation.id); return bound(actual); }
  }, scopes, { quantity: async () => assert.fail('audit must not price usage') });
  const audit = new PrismaPlatformGatewayAudit(store.db, scopes, facts, common.taskId);
  const preparation = { context, callId: common.callId, intentHash, requestHash, mode,
    profile, configurationHash: requestFingerprint(profile) };
  const entry = { callId: common.callId, tenantId: null, workspaceId: null, event: `ai.${mode}.admitted`, status: 'accepted' };
  const call = { context, binding: { id: admission.id, actorId, callId: common.callId, profileId: profile.id,
    requestHash, dispatchId: admission.dispatchId, scope: { id: owner.id, kind: 'PLATFORM' } },
    request: { callId: common.callId, model: profile.model, maxOutputTokens: 32, intentHash }, expiresAt };
  return { ...h, store, scopes, facts, audit, preparation, entry, call, common };
}

test('platform audit preserves null call attribution, original facts and idempotent invoke/stream observations', async () => {
  for (const mode of ['invoke', 'stream']) {
    const h = platformAuditHarness(mode);
    await h.audit.prepare(h.preparation); await h.audit.append(h.entry);
    await h.audit.prepare(h.preparation); await h.audit.append(h.entry);
    assert.equal(h.store.state.operationLog.length, 2);
    assert.equal(h.store.trace.filter(line => line === 'operationLog.create').length, 2);
    for (const row of h.store.state.operationLog) {
      assert.equal(row.tenantId, h.state.user.tenantId); assert.equal(row.workspaceId, null);
      assert.equal(row.userId, h.state.user.id);
      assert.deepEqual(row.detail.attribution, { scopeKind: 'PLATFORM', tenantId: null, workspaceId: null });
      assert.equal(row.detail.taskId, h.common.taskId); assert.equal(row.detail.mode, mode);
    }
    assert.deepEqual(h.store.state.operationLog.map(row => row.detail.observation),
      ['prepared_not_admitted_or_dispatched', 'admitted_not_dispatched']);
    assert.equal((await h.facts.readDispatch('audit-reservation')).state, 'unknown');
    assert.equal(h.store.state.aiBudgetReservation[0].dispatchState, 'not_dispatched');
    assert.equal(h.store.state.aiBudgetLedgerEntry.length, 0);
    const retained = JSON.stringify(h.store.state.operationLog);
    assert.equal(retained.includes('synthetic-private-dispatch'), false);
    assert.equal(retained.includes('synthetic-vault-reference'), false);
  }
});

test('platform audit refuses foreign attribution, task ownership, stale admission and source changes', async () => {
  const forged = platformAuditHarness();
  await assert.rejects(forged.audit.append({ ...forged.entry, tenantId: 'business-tenant' }), { code: 'INVALID_REQUEST' });
  assert.equal(forged.store.state.operationLog.length, 0);
  for (const mutate of [
    s => { s.user[0].isSaasAdmin = false; },
    s => { s.aiTask[0].ownerId = 'another-actor'; },
    s => { s.aiTask[0].scopeKind = 'WORKSPACE'; },
    s => { s.aiInvocationAdmission[0].platformDedupKey = 'another-call'; },
    s => { s.aiInvocationAdmission[0].expiresAt = new Date(0); },
    s => { s.aiGatewayAccountingReceipt[0].scopeId = 'another-scope'; },
    s => { s.aiBudgetReservation[0].dispatchState = 'dispatched'; }
  ]) {
    const h = platformAuditHarness(); mutate(h.store.state);
    await assert.rejects(h.audit.append(h.entry), { code: 'FORBIDDEN' });
    assert.equal(h.store.state.operationLog.length, 0);
  }
  const changed = platformAuditHarness();
  changed.store.control.beforeRead = (table, args, data) => {
    if (table === 'operationLog') { data.aiTask[0].ownerId = 'changed-during-read'; }
  };
  // Reauthorization must happen before the actual insert, not just before a read.
  await assert.rejects(changed.audit.prepare(changed.preparation), { code: 'FORBIDDEN' });
  assert.equal(changed.store.state.operationLog.length, 0);
});

test('platform budget-denial audit is not release evidence and refuses an existing ledger association', async () => {
  const h = platformAuditHarness();
  h.store.state.aiGatewayAccountingReceipt = []; h.store.state.aiBudgetReservation = [];
  await h.audit.budgetDenied({ call: h.call, code: 'BUDGET_UNAVAILABLE' });
  await h.audit.budgetDenied({ call: h.call, code: 'BUDGET_UNAVAILABLE' });
  assert.equal(h.store.state.operationLog.length, 1);
  assert.equal(h.store.state.operationLog[0].detail.observation, 'gate_rejected_not_release_evidence');
  assert.equal(h.store.state.aiBudgetLedgerEntry.length, 0);
  const occupied = platformAuditHarness();
  await assert.rejects(occupied.audit.budgetDenied({ call: occupied.call, code: 'BUDGET_UNAVAILABLE' }), { code: 'ACCOUNTING_PENDING' });
  assert.equal(occupied.store.state.operationLog.length, 0);
});

test('platform audit keeps lost COMMIT unknown, observes a unique winner once and sanitizes read failures', async () => {
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  const lost = platformAuditHarness();
  lost.store.control.beforeWrite = table => { if (table === 'operationLog') lost.store.control.loseReply = true; };
  await assert.rejects(lost.audit.prepare(lost.preparation), { code: 'ACCOUNTING_PENDING' });
  assert.equal(lost.store.state.operationLog.length, 1);
  assert.equal(lost.store.trace.filter(line => line === 'operationLog.create').length, 1);
  const winner = platformAuditHarness();
  winner.store.control.beforeWrite = (table, args) => {
    if (table !== 'operationLog') return;
    winner.store.state.operationLog.push(structuredClone(args.data));
    throw new Prisma.PrismaClientKnownRequestError('synthetic unique race', { code: 'P2002', clientVersion: '5.22.0' });
  };
  await winner.audit.prepare(winner.preparation);
  assert.equal(winner.store.state.operationLog.length, 1);
  assert.equal(winner.store.trace.filter(line => line === 'operationLog.create').length, 1);
  for (const operation of ['prepared', 'admitted', 'budget-denied']) {
    for (const outcome of ['revoked', 'source-changed', ...(operation === 'admitted' ? [] : ['cancelled'])]) {
      const h = platformAuditHarness(), controller = new AbortController();
      if (operation === 'budget-denied') { h.store.state.aiGatewayAccountingReceipt = []; h.store.state.aiBudgetReservation = []; }
      const finance = () => structuredClone({ receipts: h.store.state.aiGatewayAccountingReceipt,
        reservations: h.store.state.aiBudgetReservation, ledger: h.store.state.aiBudgetLedgerEntry, allocations: h.store.state.aiBudgetAllocation });
      const beforeFinance = finance();
      h.store.control.beforeWrite = (table, args) => {
        if (table !== 'operationLog') return;
        // Explicit competing-transaction double: its original row survives the
        // losing insert. No second write, synthetic SQL success or retry follows.
        h.store.state.operationLog.push(structuredClone(args.data));
        if (outcome === 'revoked') h.store.state.user[0].isActive = false;
        else if (outcome === 'source-changed') h.store.state.aiTask[0].ownerId = 'changed-winner-source';
        else controller.abort();
        throw new Prisma.PrismaClientKnownRequestError('synthetic unique race', { code: 'P2002', clientVersion: '5.22.0' });
      };
      const command = () => operation === 'prepared' ? h.audit.prepare(h.preparation, controller.signal)
        : operation === 'admitted' ? h.audit.append(h.entry)
          : h.audit.budgetDenied({ call: h.call, code: 'BUDGET_UNAVAILABLE' }, controller.signal);
      await assert.rejects(command(), { code: 'ACCOUNTING_PENDING' }, `${operation}/${outcome}`);
      assert.equal(h.store.state.operationLog.length, 1);
      assert.equal(h.store.trace.filter(line => line === 'operationLog.create').length, 1);
      assert.equal(h.store.state.operationLog[0].detail.attribution.tenantId, null);
      assert.equal(h.store.state.operationLog[0].detail.attribution.workspaceId, null);
      assert.deepEqual(finance(), beforeFinance);
    }
  }
  const read = platformAuditHarness();
  read.store.control.beforeRead = () => { throw Error('synthetic-sensitive-infrastructure-detail'); };
  await assert.rejects(read.audit.prepare(read.preparation), error => error.code === 'PROVIDER_UNAVAILABLE'
    && error.message === 'PROVIDER_UNAVAILABLE');
  assert.equal(read.store.state.operationLog.length, 0);
});

test('authorized platform composition binds its default audit to the original task and SAME accounting facts without IO', () => {
  const { composeAuthorizedPlatformCapabilityProbe } = require('../apps/api/src/modules/ai-native/platform-capability-probe/platform-capability-probe.composition');
  const { PrismaPlatformGatewayAudit } = require('../apps/api/src/modules/ai-native/prisma-platform-gateway-audit');
  const h = platformAuditHarness();
  // Required storage surface is present, but unused writes never fake success.
  h.store.db.aiPlatformModelConnection.update = async () => assert.fail('assembly cannot update platform connection');
  const composed = composeAuthorizedPlatformCapabilityProbe({ db: h.store.db, guard: h.guard, credentials: h.credentials,
    secrets: new SecretBox({ get: name => name === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-key' : 'production' }),
    platformProfileId: 'synthetic-profile', sceneVersion: '1', priceVersion: 'synthetic-price-version',
    host: { holderId: 'synthetic-holder', leaseMs: 30000 }, protocol: { post: async () => assert.fail('assembly cannot dispatch') } });
  const audit = composed.application.input.auditForTask(h.common.taskId, composed.application.accounting.facts);
  assert.ok(audit instanceof PrismaPlatformGatewayAudit);
  assert.equal(audit.taskId, h.common.taskId);
  assert.equal(audit.facts, composed.application.accounting.facts);
  assert.equal(h.store.trace.length, 0);
});

test('platform audit three commands retain original committed observations on late revocation identity change and cancellation', async () => {
  const { requestFingerprint: hash } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const command = (h, operation, signal) => operation === 'prepared' ? h.audit.prepare(h.preparation, signal)
    : operation === 'admitted' ? h.audit.append(h.entry)
      : h.audit.budgetDenied({ call: h.call, code: 'BUDGET_UNAVAILABLE' }, signal);
  const setupCommand = operation => {
    const h = platformAuditHarness();
    if (operation === 'budget-denied') { h.store.state.aiGatewayAccountingReceipt = []; h.store.state.aiBudgetReservation = []; }
    return h;
  };
  const writes = h => h.store.trace.filter(value => value === 'operationLog.create').length;
  const financial = h => hash({ receipts: h.store.state.aiGatewayAccountingReceipt,
    reservations: h.store.state.aiBudgetReservation, ledger: h.store.state.aiBudgetLedgerEntry, allocations: h.store.state.aiBudgetAllocation });
  for (const operation of ['prepared', 'admitted', 'budget-denied']) {
    const before = setupCommand(operation), beforeFinance = financial(before);
    before.store.state.user[0].isActive = false;
    await assert.rejects(command(before, operation, new AbortController().signal), { code: 'FORBIDDEN' });
    assert.equal(writes(before), 0); assert.equal(before.store.state.operationLog.length, 0); assert.equal(financial(before), beforeFinance);
    for (const outcome of ['revoked', 'journal-owner-changed', ...(operation === 'admitted' ? [] : ['cancelled'])]) {
      const h = setupCommand(operation), expectedFinance = financial(h), controller = new AbortController(), journalTenantId = h.state.user.tenantId;
      h.store.control.beforeCommit = draft => {
        if (!draft.operationLog.length) return;
        // Transaction/store and timing are explicit doubles. This is NOT MySQL
        // or line-level COMMIT loss evidence; the original audit code is retained.
        if (outcome === 'revoked') draft.user[0].isActive = false;
        else if (outcome === 'journal-owner-changed') draft.user[0].tenantId = 'another-journal-owner';
        else controller.abort();
      };
      await assert.rejects(command(h, operation, controller.signal), { code: 'ACCOUNTING_PENDING' });
      assert.equal(writes(h), 1); assert.equal(h.store.state.operationLog.length, 1);
      assert.equal(h.store.state.operationLog[0].tenantId, journalTenantId);
      assert.equal(h.store.state.operationLog[0].detail.attribution.tenantId, null);
      assert.equal(h.store.state.operationLog[0].detail.attribution.workspaceId, null);
      assert.equal(financial(h), expectedFinance, 'Audit acknowledgement cannot dispatch, settle, release or manufacture finance');
      assert.ok(h.store.trace.includes('transaction.commit'));
      // Inspect the original persisted double only. Do not retry the write just
      // because its canonical ID is known and the original row exists.
      assert.equal(writes(h), 1);
    }
  }
});
