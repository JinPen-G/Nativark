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
  const secrets = new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-encryption-only' : 'production' });
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
