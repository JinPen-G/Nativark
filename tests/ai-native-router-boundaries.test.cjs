'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ProviderRouterService } = require('../apps/api/src/modules/ai-native/provider-router.service');
const platform = { id: 'platform-id', kind: 'PLATFORM' }, scope = { id: 'tenant-id', kind: 'TENANT', tenantId: 'tenant-1' };
const request = () => ({ consumerScope: { ...scope }, configurationScope: { ...scope }, mode: 'tenant_managed', scene: 'chat', requiredCapabilities: ['text'] });
const profile = (key = 'default', role = 'DEFAULT') => ({ id: 'profile-' + key, profileKey: key, scopeId: scope.id, scopeKind: scope.kind,
  role, serviceMode: 'tenant_managed', protocol: 'openai_chat_completions', provider: 'synthetic', model: key, credentialRef: 'vault:key',
  configRevision: 1, enabled: true, disabledAt: null, allowedCapabilities: ['text','tools'] });
function setup(rows = [profile()]) {
  const state = { rows, calls: [], check: null, listing: null };
  const ports = { profiles: { list: async s => { state.calls.push(['list',s]); if (state.listing) await state.listing(s); return state.rows; } },
    capabilities: { preflight: async (p,r) => { state.calls.push(['check',p,r]); return state.check ? state.check(p,r) : { allowed: true, required: r, missing: [], stale: [] }; } } };
  return { state, router: new ProviderRouterService(ports) };
}
for (const patch of [{ scene: 'invented' }, { mode: 'invented' }, { requiredCapabilities: [] }, { requiredCapabilities: ['text','text'] },
  { requiredCapabilities: ['imaginary'] }, { consumerScope: { id: 'x', kind: 'TENANT' } },
  { consumerScope: { id: 'x', kind: 'WORKSPACE', tenantId: 't' } }, { consumerScope: platform }, { arbitraryUrl: 'https://invalid.test' }]) test('malformed route input fails before ports', async () => {
  const f = setup(); await assert.rejects(f.router.resolve({ ...request(), ...patch }), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.calls.length, 0);
});
test('knowledge answer never selects an embedding-only role', async () => {
  const f = setup([profile('embed','EMBEDDING'), profile('answer','DEFAULT')]);
  const out = await f.router.resolve({ ...request(), scene: 'knowledge' }); assert.equal(out.profile.profileKey, 'answer');
  assert.deepEqual(f.state.calls.filter(c => c[0] === 'check').map(c => c[1].role), ['DEFAULT']);
});
test('configured role priority and stable profile key order are deterministic', async () => {
  for (const rows of [[profile('z'),profile('a'),profile('r','REASONING')], [profile('r','REASONING'),profile('a'),profile('z')]]) {
    const f = setup(rows); assert.equal((await f.router.resolve(request())).profile.profileKey, 'a');
    assert.equal((await f.router.resolve({ ...request(), scene: 'reasoning' })).profile.profileKey, 'r');
  }
});
test('configuration capabilities intersect with evidence, never evidence alone', async () => {
  const f = setup(); f.state.rows[0].allowedCapabilities = ['text'];
  await assert.rejects(f.router.resolve({ ...request(), requiredCapabilities: ['tools'] }), e => e.code === 'CAPABILITY_UNSUPPORTED');
  assert.equal(f.state.calls.some(c => c[0] === 'check'), false);
});
for (const check of [
  { allowed: true, required: [], missing: [], stale: [] }, { allowed: true, required: ['text'], missing: ['text'], stale: [] },
  { allowed: true, required: ['text'], missing: [], stale: ['text'] }, { allowed: true, required: ['text'], missing: [], stale: ['tools'] },
  { allowed: 'yes', required: ['text'], missing: [], stale: [] }, { allowed: true, required: ['text'], missing: [], stale: [], override: true }
]) test('inconsistent preflight is not accepted as a route', async () => {
  const f = setup(); f.state.check = () => check; await assert.rejects(f.router.resolve(request()), e => e.code === 'CONFIG_INVALID');
});
test('caller mutation during async list cannot switch scope, scene or requirements', async () => {
  const f = setup(), value = request();
  f.state.listing = s => { value.mode = 'platform_managed'; value.consumerScope.id = 'other'; value.requiredCapabilities = ['tools']; s.id = 'other'; };
  const out = await f.router.resolve(value); assert.equal(out.scope.id, scope.id); assert.deepEqual(out.preflight.required, ['text']);
});
test('capability port cannot rewrite the selected route by mutating its arguments', async () => {
  const f = setup(); f.state.check = (p,r) => { p.model = 'mutated'; p.credentialRef = 'vault:mutated'; return { allowed: true, required: r, missing: [], stale: [] }; };
  const out = await f.router.resolve(request()); assert.equal(out.profile.model, 'default'); assert.equal(out.profile.credentialRef, 'vault:key');
});
for (const mutate of [p => { p.enabled = false; }, p => { p.disabledAt = new Date(); }, p => { p.scopeId = 'other'; }, p => { p.serviceMode = 'platform_managed'; }]) test('disabled or foreign profile cannot become fallback', async () => {
  const f = setup(); mutate(f.state.rows[0]); await assert.rejects(f.router.resolve(request()), e => e.code === 'PROVIDER_UNAVAILABLE');
});
test('platform route uses only explicitly provided platform owner', async () => {
  const p = { ...profile(), scopeId: platform.id, scopeKind: 'PLATFORM', serviceMode: 'platform_managed' };
  const f = setup([p]); const out = await f.router.resolve({ ...request(), configurationScope: platform, mode: 'platform_managed' });
  assert.equal(out.scope.id, platform.id); assert.deepEqual(f.state.calls[0][1], platform);
});
test('malformed or duplicate profile list is rejected without guessing', async () => {
  for (const rows of [[{ ...profile(), configRevision: 0 }], [profile(),profile()], Array(101).fill(profile())]) {
    const f = setup(rows); await assert.rejects(f.router.resolve(request()), e => e.code === 'CONFIG_INVALID');
  }
});
test('port exceptions are sanitized and never trigger a cross-mode retry', async () => {
  const f = setup(); f.state.check = () => { throw Error('private-provider-detail'); };
  await assert.rejects(f.router.resolve(request()), e => e.code === 'CONFIG_INVALID' && e.message === e.code);
  assert.equal(f.state.calls.filter(c => c[0] === 'list').length, 1);
});
test('absent required ports fail at construction', () => {
  for (const ports of [null, {}, { profiles: { list: async () => [] } }]) assert.throws(() => new ProviderRouterService(ports), e => e.code === 'CONFIG_INVALID');
});
test('legacy invoke and stream propagate all required features including text', async () => {
  const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
  for (const mode of ['invoke','stream']) {
    let received;
    const gateway = new UnifiedAiGatewayService({ routing: { resolve: async (_context, required) => { received = required; throw Error('stop after routing input'); } } });
    const args = [{ tenantId: 't', workspaceId: 'w', actorId: 'a' }, { callId: 'c', model: 'm', messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 10, features: ['tools','structuredOutput'] }];
    const operation = mode === 'invoke' ? gateway.invoke(...args) : gateway.stream(...args).next();
    await assert.rejects(operation);
    assert.deepEqual(received, mode === 'invoke' ? ['text','tools','structured_output'] : ['text','streaming','tools','structured_output']);
  }
});
