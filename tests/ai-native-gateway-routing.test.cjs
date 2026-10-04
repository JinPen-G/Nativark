'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const base = require('./fixtures/ai-native/contract-consumer.cjs'); base.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { AiOrderRouteContextAuthority } = require('../apps/api/src/modules/ai-native/order-route-context.authority');
const { AiScopeRepository } = require('../apps/api/src/modules/ai-native/ai-scope.repository');
const { aiPersistenceScopeColumns } = require('../apps/api/src/modules/ai-native/persistence-scope');
const { TenantModelConfigService } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { ProviderRouterService } = require('../apps/api/src/modules/ai-native/provider-router.service');
const { ProviderCapabilityService } = require('../apps/api/src/modules/ai-native/provider-capability.service');
const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
const { AiGatewayRoutingService } = require('../apps/api/src/modules/ai-native/gateway-routing.service');
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const { user } = require('./fixtures/ai-native/authorization-baseline.cjs');
const ctx = { tenantId: 'tenant-a', workspaceId: 'workspace-a', actorId: 'operator-a' };
const request = { callId: 'route-call', model: 'caller-cannot-pin-this', messages: [{ role: 'user', content: 'synthetic' }], maxOutputTokens: 10 };
const legacy = () => ({ tenantId: ctx.tenantId, revision: 1, credentialsEncrypted: 'synthetic-not-a-vault-read', settings: {
  enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://synthetic.example.test/v1', model: 'tenant/model', timeoutMs: 30000, maxConcurrent: 2, maxOutputTokens: 100
} });
function setup(audience = 'operator') {
  const now = new Date(), state = { user: user(), workspace: ctx.workspaceId, active: true, invokeAllowed: true, record: null,
    queries: [], configReads: [], actions: [], profileReads: [], evidenceAllowed: true, afterEvidence: null };
  const auth = new AuthService({ getAuthSession: async () => state.active ? { id: 'session-a', userId: state.user.id, audience, currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.user, listUserWorkspaces: async () => [] },
    { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-auth-test-only' : undefined });
  const credentials = { current: async () => ({ authorization: `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId, sid: 'session-a', aud: audience, exp: Math.floor(Date.now() / 1000) + 600 })}`, requestId: 'request-a', audience }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, { rentalOrder: { findFirst: async () => ({ id: 'order-a' }) } });
  const authority = new AiOrderRouteContextAuthority(guard, credentials, 'order-a');
  const rows = [
    { id: 'consumer-workspace', ...aiPersistenceScopeColumns({ kind: 'workspace', tenantId: ctx.tenantId, workspaceId: ctx.workspaceId }) },
    { id: 'owner-tenant', ...aiPersistenceScopeColumns({ kind: 'tenant', tenantId: ctx.tenantId }) },
    { id: 'owner-platform', ...aiPersistenceScopeColumns({ kind: 'platform' }) }
  ];
  const db = { aiScope: { findFirst: async args => { state.queries.push(structuredClone(args)); return structuredClone(rows.find(row => row.scopeKey === args.where.scopeKey) ?? null); } } };
  const scopes = new AiScopeRepository(db, authority);
  const configuration = new TenantModelConfigService({ authorize: async (value, action) => {
    state.actions.push(action); const current = await authority.resolve();
    if (!state.invokeAllowed && action === 'invoke') throw Error('private-permission-error');
    assert.equal(value.tenantId, current.scope.tenantId); assert.equal(value.workspaceId, current.scope.workspaceId); assert.equal(value.actorId, current.actor.userId);
  }, repository: { read: async tenantId => { state.configReads.push(tenantId); return structuredClone(state.record); }, compareAndSwap: async () => { throw Error('must not write'); } } },
  new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-encryption-test-only' : 'production' }));
  const profiles = rows.map(row => ({ id: 'profile-' + row.kind.toLowerCase(), scopeId: row.id, scopeKind: row.kind, profileKey: 'default', role: 'DEFAULT',
    serviceMode: row.kind === 'PLATFORM' ? 'platform_managed' : 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: row.kind.toLowerCase() + '/model',
    credentialRef: 'vault:' + row.kind.toLowerCase(), configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: ['text','streaming'] }));
  const capabilities = new ProviderCapabilityService({ list: async profile => {
    const evidence = profile.allowedCapabilities.map(capability => ({ id: 'e-' + capability, profileId: profile.id, scope: { id: profile.scopeId, kind: profile.scopeKind }, capability,
      status: state.evidenceAllowed ? 'supported' : 'unverified', source: 'connection_test', observedRevision: profile.configRevision, evidenceHash: 'synthetic-evidence', checkedAt: now,
      expiresAt: new Date(now.getTime() + 600000), details: { verification: { evidence: 'mock', methodVersion: 'synthetic-only-1', capability, profileFingerprint: capabilityProfileFingerprint(profile) } } }));
    if (state.afterEvidence) await state.afterEvidence(); return evidence;
  }, upsert: async () => { throw Error('must not write'); } }, { allowMock: true });
  const router = new ProviderRouterService({ profiles: { list: async scope => {
    state.profileReads.push(structuredClone(scope)); return structuredClone(profiles.filter(p => p.scopeId === scope.id && p.scopeKind === scope.kind));
  } }, capabilities });
  const routing = new AiGatewayRoutingService(scopes, configuration, router, 'knowledge');
  return { state, rows, profiles, scopes, configuration, router, routing, authority };
}
const denied = e => ['FORBIDDEN','CONFIG_INVALID','CAPABILITY_UNSUPPORTED','PROVIDER_UNAVAILABLE'].includes(e.code) && e.message === e.code;
for (const audience of ['operator','staff']) test(`actual ${audience} Guard, config selection, scope and capability services select the platform owner`, async () => {
  const f = setup(audience), out = await f.routing.resolve(ctx, ['text']);
  assert.equal(out.context.audience, audience); assert.equal(out.consumerScope.id, 'consumer-workspace');
  assert.deepEqual(out.route.scope, { id: 'owner-platform', kind: 'PLATFORM' }); assert.equal(out.route.profile.model, 'platform/model');
  assert.deepEqual(out.selection, { mode: 'platform_managed', revision: 0 }); assert.equal(out.scene, 'knowledge');
  assert.ok(f.state.actions.every(action => action === 'invoke')); assert.ok(f.state.configReads.every(id => id === ctx.tenantId));
  assert.equal(JSON.stringify(out).includes('Bearer'), false); assert.equal(JSON.stringify(out).includes('synthetic-encryption'), false);
});
test('legacy tenant settings route to the tenant owner, not a workspace profile', async () => {
  const f = setup(); f.state.record = legacy(); const out = await f.routing.resolve(ctx, ['text']);
  assert.equal(out.selection.mode, 'tenant_managed'); assert.equal(out.route.scope.id, 'owner-tenant'); assert.equal(out.route.profile.model, 'tenant/model');
  assert.equal(out.consumerScope.id, 'consumer-workspace'); assert.deepEqual(f.state.profileReads.map(s => s.id), ['owner-tenant']);
});
test('explicit platform selection preserves but does not route through legacy credentials', async () => {
  const f = setup(); f.state.record = { ...legacy(), mode: 'platform_managed', revision: 2 };
  const before = structuredClone(f.state.record), out = await f.routing.resolve(ctx, ['text']);
  assert.equal(out.route.scope.kind, 'PLATFORM'); assert.deepEqual(f.state.record, before);
});
for (const patch of [{ actorId: 'forged' }, { workspaceId: 'forged' }, { tenantId: 'forged' }]) test('caller identity hints cannot choose the consumer or config owner', async () => {
  const f = setup(); await assert.rejects(f.routing.resolve({ ...ctx, ...patch }, ['text']), denied);
  assert.equal(f.state.configReads.length, 0); assert.equal(f.state.profileReads.length, 0);
});
test('configuration read access alone is not model invocation permission', async () => {
  const f = setup(); f.state.invokeAllowed = false;
  assert.equal((await f.configuration.selection(ctx)).mode, 'platform_managed');
  await assert.rejects(f.routing.resolve(ctx, ['text']), denied); assert.equal(f.state.profileReads.length, 0);
});
test('the platform configuration facade preserves the distinct invocation authority', async () => {
  const { PlatformModelConfigService } = require('../apps/api/src/modules/ai-native/platform-model-config.service');
  const actions = [], facade = new PlatformModelConfigService({ authorize: async (_context, action) => { actions.push(action); if (action === 'invoke') throw Error('invoke denied'); },
    repository: { read: async () => null, compareAndSwap: async () => false } }, new SecretBox({ get: () => 'synthetic-only' }));
  assert.equal((await facade.selection(ctx)).mode, 'platform_managed');
  await assert.rejects(facade.selectionForInvocation(ctx), e => e.code === 'FORBIDDEN');
  assert.deepEqual(actions, ['read','read','invoke']);
});
test('a read-only selection dependency cannot be wired as invocation routing', () => {
  const f = setup(); assert.throws(() => new AiGatewayRoutingService(f.scopes, { selection: f.configuration.selection.bind(f.configuration) }, f.router, 'chat'), e => e.code === 'CONFIG_INVALID');
});
for (const mode of ['platform_managed','tenant_managed']) test(`missing ${mode} owner fails without fabricating one or falling back`, async () => {
  const f = setup(); if (mode === 'tenant_managed') f.state.record = legacy();
  const kind = mode === 'tenant_managed' ? 'TENANT' : 'PLATFORM'; f.rows.splice(f.rows.findIndex(r => r.kind === kind), 1);
  await assert.rejects(f.routing.resolve(ctx, ['text']), denied); assert.equal(f.state.profileReads.length, 0);
});
for (const field of ['id','kind','tenantId','workspaceId','scopeKey']) test(`SQL owner ${field} must match the exact canonical scope`, async () => {
  const f = setup(), owner = f.rows.find(r => r.kind === 'TENANT'); f.state.record = legacy();
  owner[field] = field === 'id' ? '' : 'WRONG';
  await assert.rejects(f.routing.resolve(ctx, ['text']), denied); assert.equal(f.state.profileReads.length, 0);
});
for (const change of [f => { f.state.active = false; }, f => { f.state.user.permissions = []; }, f => { f.state.workspace = 'workspace-b'; }]) test('revocation during capability lookup discards the buffered route', async () => {
  const f = setup(); f.state.afterEvidence = () => change(f);
  await assert.rejects(f.routing.resolve(ctx, ['text']), denied);
});
for (const change of [f => { f.state.record = { tenantId: ctx.tenantId, revision: 1, mode: 'platform_managed' }; }, f => { f.state.record = legacy(); },
  f => { f.rows.find(r => r.kind === 'PLATFORM').id = 'replacement-owner'; }]) test('mode revision or canonical owner changing during lookup invalidates routing', async () => {
  const f = setup(); f.state.afterEvidence = () => change(f); await assert.rejects(f.routing.resolve(ctx, ['text']), denied);
});
test('capability failure never falls back to another owner or mode', async () => {
  const f = setup(); f.state.evidenceAllowed = false;
  await assert.rejects(f.routing.resolve(ctx, ['text']), e => e.code === 'CAPABILITY_UNSUPPORTED');
  assert.deepEqual(f.state.profileReads.map(s => s.id), ['owner-platform']);
});
test('dispatch revalidation detects a different profile at the same owner', async () => {
  const f = setup(), bound = await f.routing.resolve(ctx, ['text']);
  f.profiles.find(p => p.scopeKind === 'PLATFORM').model = 'rotated/model';
  await assert.rejects(f.routing.assertCurrent(ctx, bound), denied);
});
test('fresh request metadata does not invalidate unchanged routing', async () => {
  const f = setup(), bound = await f.routing.resolve(ctx, ['text']); await f.routing.assertCurrent(ctx, bound);
});
for (const context of [base.contexts[2], base.contexts[3], base.contexts[4]]) test('workspace bridge rejects customer, platform and automation rather than inventing a workspace', async () => {
  let reads = 0;
  const routing = new AiGatewayRoutingService({ resolveCurrent: async () => ({ context, scope: {} }), resolveRoutingScopes: async () => { throw Error('not reached'); } },
    { selectionForInvocation: async () => { reads++; } }, { resolve: async () => { reads++; } }, 'chat');
  await assert.rejects(routing.resolve(ctx, ['text']), denied); assert.equal(reads, 0);
});
test('required capabilities and scope hints are snapshotted before async work', async () => {
  const f = setup(), value = { ...ctx }, required = ['text'];
  const pending = f.routing.resolve(value, required); value.tenantId = 'changed'; required.push('vision');
  const out = await pending; assert.deepEqual(out.requiredCapabilities, ['text']); assert.equal(out.consumerScope.tenantId, ctx.tenantId);
});
function gateway(f) {
  const events = [], dispatched = [], reservations = [];
  const ports = { routing: f.routing,
    admission: { admit: async input => { events.push('admitted'); return { ...input, id: 'admission', status: 'admitted' }; }, transition: async (_s,_c,_f,to) => { events.push(to); } },
    usage: { reserve: async input => { reservations.push(structuredClone(input)); if (f.beforeDispatch) await f.beforeDispatch(); return { id: 'usage', scope: input.scope }; },
      settle: async () => { events.push('settled'); }, markUnknown: async (_s,_id,reason) => { events.push(reason); } }, audit: { append: async () => {} },
    transport: { invoke: async (context, input, route) => { dispatched.push({ context, input, route }); if (f.afterDispatch) await f.afterDispatch(); return { text: 'ok', usage: { inputTokens: 1, outputTokens: 2 } }; },
      stream: async function* (context, input, route) { dispatched.push({ context, input, route }); yield { kind: 'text_delta', delta: 'visible' }; if (f.afterDelta) await f.afterDelta();
        yield { kind: 'text_delta', delta: 'buffered' }; yield { kind: 'result', result: { text: 'ok', usage: { inputTokens: 1, outputTokens: 2 } } }; } }
  };
  return { ports, events, dispatched, reservations, service: new UnifiedAiGatewayService(require('./fixtures/ai-native/unified-dispatch.cjs')(ports), 10000) };
}
for (const mode of ['platform_managed','tenant_managed']) test(`real routing is consumed by invoke with ${mode} model and actual billing scope`, async () => {
  const f = setup(); if (mode === 'tenant_managed') f.state.record = legacy(); const g = gateway(f);
  assert.equal((await g.service.invoke(ctx, request)).text, 'ok'); assert.equal(g.dispatched.length, 1);
  assert.equal(g.dispatched[0].input.model, mode === 'tenant_managed' ? 'tenant/model' : 'platform/model');
  assert.equal(g.reservations[0].scope.id, 'consumer-workspace'); assert.deepEqual(g.events, ['admitted','settled','completed']);
});
for (const change of [f => { f.state.active = false; }, f => { f.state.record = legacy(); }, f => { f.profiles.find(p => p.scopeKind === 'PLATFORM').configRevision++; }]) test('identity/config changes while waiting for budget prevent transport dispatch', async () => {
  const f = setup(), g = gateway(f); f.beforeDispatch = () => change(f);
  await assert.rejects(g.service.invoke(ctx, request), denied); assert.equal(g.dispatched.length, 0);
  assert.deepEqual(g.events, ['admitted','DISPATCH_NOT_STARTED','cancelled']);
});
test('revoked result is withheld without rewriting completed accounting as unknown', async () => {
  const f = setup(), g = gateway(f); f.afterDispatch = () => { f.state.active = false; };
  await assert.rejects(g.service.invoke(ctx, request), denied); assert.deepEqual(g.events, ['admitted','settled','completed']);
});
test('stream checks current access before each buffered delta', async () => {
  const f = setup(), g = gateway(f), received = []; f.afterDelta = () => { f.state.active = false; };
  await assert.rejects(async () => { for await (const event of g.service.stream(ctx, request)) received.push(event); }, denied);
  assert.deepEqual(received, [{ kind: 'text_delta', delta: 'visible' }]); assert.deepEqual(g.events, ['admitted','DISPATCH_UNKNOWN','unknown']);
});
test('adapter input mutation cannot replace the protected route or accounting request', async () => {
  const f = setup(), g = gateway(f); g.ports.transport.invoke = async (context, input, route) => {
    context.tenantId = 'evil'; input.callId = 'evil'; route.profile.model = 'evil'; return { text: 'ok', usage: { inputTokens: 1, outputTokens: 2 } };
  };
  assert.equal((await g.service.invoke(ctx, request)).text, 'ok'); assert.equal(g.reservations[0].callId, request.callId);
});
for (const context of base.contexts) for (const mode of ['platform_managed','tenant_managed']) test(`canonical owner resolution for ${context.audience}/${mode}`, async () => {
  const queries = [], scopes = new AiScopeRepository({ aiScope: { findFirst: async ({ where }) => { queries.push(where); return { id: 'db-' + where.kind.toLowerCase(), ...where }; } } },
    { resolve: async () => context }, () => new Date('2026-10-03T12:00:00Z'));
  if (context.scope.kind === 'platform' && mode === 'tenant_managed') {
    await assert.rejects(scopes.resolveRoutingScopes(mode), e => e.code === 'AI_ACCESS_DENIED'); assert.equal(queries.length, 0); return;
  }
  const out = await scopes.resolveRoutingScopes(mode);
  assert.equal(out.consumerScope.kind, context.scope.kind.toUpperCase());
  assert.equal(out.configurationScope.kind, mode === 'platform_managed' ? 'PLATFORM' : 'TENANT');
  assert.equal('workspaceId' in out.configurationScope, false);
  if (mode === 'platform_managed') assert.equal('tenantId' in out.configurationScope, false);
  else assert.equal(out.configurationScope.tenantId, context.scope.tenantId);
  assert.ok(queries.every(q => q.scopeKey === aiPersistenceScopeColumns(q.kind === 'PLATFORM' ? { kind: 'platform' } : q.kind === 'TENANT' ? { kind: 'tenant', tenantId: q.tenantId } : { kind: 'workspace', tenantId: q.tenantId, workspaceId: q.workspaceId }).scopeKey));
});
for (const owner of [{ id: 'foreign', kind: 'TENANT', tenantId: 'another' }, { id: 'same-workspace', kind: 'WORKSPACE', tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
  { id: 'wrong-kind', kind: 'PLATFORM' }, undefined]) test('tenant routing refuses a missing, workspace or foreign-tenant owner before profile access', async () => {
  const f = setup(); await assert.rejects(f.router.resolve({ consumerScope: { id: 'consumer', kind: 'WORKSPACE', tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    configurationScope: owner, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: ['text'] }), e => e.code === 'INVALID_REQUEST');
  assert.equal(f.state.profileReads.length, 0);
});
test('a failed final stream authorization does not rewrite a committed terminal state', async () => {
  const f = setup(), g = gateway(f), received = [];
  g.ports.admission.transition = async (_s,_c,_f,to) => { g.events.push(to); if (to === 'completed') f.state.active = false; };
  await assert.rejects(async () => { for await (const event of g.service.stream(ctx, request)) received.push(event); }, denied);
  assert.equal(received.some(e => e.kind === 'result'), false); assert.deepEqual(g.events, ['admitted','settled','completed']);
});
