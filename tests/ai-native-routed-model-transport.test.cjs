'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const base = require('./fixtures/ai-native/contract-consumer.cjs'); base.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
const { RoutedModelTransport, TenantModelConnectionResolver } = require('../apps/api/src/modules/ai-native/routed-model-transport');
const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
const { TenantModelConfigService } = require('../apps/api/src/modules/ai-native/tenant-model-config.service');
const { SecretBox } = require('../apps/api/src/common/secret-box');
const { PublicAiGatewayModule } = require('../apps/api/src/modules/ai-native/public-ai-gateway.service');
const { capabilityProfileFingerprint } = require('../apps/api/src/modules/ai-native/capability-verification');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
const context = { tenantId: 'tenant-test', workspaceId: 'space-test', actorId: 'actor-test' };
const request = () => ({ callId: 'call-test', model: 'selected-model', messages: [{ role: 'user', content: 'hello' }], maxOutputTokens: 10 });
function setup(mode = 'tenant_managed') {
  const owner = mode === 'tenant_managed' ? { id: 'owner-tenant', kind: 'TENANT', tenantId: context.tenantId } : { id: 'owner-platform', kind: 'PLATFORM' };
  const profile = { id: 'profile-1', scopeId: owner.id, scopeKind: owner.kind, profileKey: 'default', role: 'DEFAULT', serviceMode: mode,
    protocol: 'openai_chat_completions', provider: 'synthetic-provider', model: 'selected-model', credentialRef: 'vault:1', configRevision: 1,
    enabled: true, disabledAt: null, allowedCapabilities: ['text','streaming'] };
  const state = { resolves: [], wire: [], connection: { profileFingerprint: capabilityProfileFingerprint(profile), baseUrl: 'https://provider.invalid/v1', credential: 'synthetic-secret', maxOutputTokens: 100 }, afterResolve: null, afterWire: null };
  const resolver = kind => ({ resolve: async () => { state.resolves.push(kind); if (state.afterResolve) await state.afterResolve(); return structuredClone(state.connection); } });
  const http = { post: async value => { state.wire.push(value); if (state.afterWire) await state.afterWire(); return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 2, completion_tokens: 3 } }) }; },
    postStream: async function* (value) { state.wire.push(value); yield { kind: 'headers', status: 200 }; yield { kind: 'chunk', bytes: Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":null}]}\n\ndata: {"choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') }; } };
  const connections = { platform: resolver('platform'), tenant: resolver('tenant') }, adapter = new ChatCompletionsAdapter(http);
  return { state, profile, connections, adapter, route: { profile, scope: owner, role: 'DEFAULT', preflight: { allowed: true, required: ['text'], missing: [], stale: [] } },
    transport: new RoutedModelTransport(connections, [adapter]) };
}
for (const mode of ['platform_managed','tenant_managed']) test(`${mode} resolves only its owner and calls the real protocol adapter`, async () => {
  const f = setup(mode), result = await f.transport.invoke(context, request(), f.route, new AbortController().signal);
  assert.equal(result.text, 'answer'); assert.deepEqual(f.state.resolves, Array(3).fill(mode === 'tenant_managed' ? 'tenant' : 'platform'));
  assert.equal(f.state.wire[0].url, 'https://provider.invalid/v1/chat/completions');
  assert.equal(f.state.wire[0].headers.Authorization, 'Bearer synthetic-secret'); assert.equal(JSON.parse(f.state.wire[0].body).model, 'selected-model');
  assert.equal(JSON.stringify(result).includes('synthetic-secret'), false);
});
test('real protocol streaming is passed through with ordered complete output', async () => {
  const f = setup(), out = [];
  for await (const event of f.transport.stream(context, { ...request(), features: ['streaming'] }, f.route, new AbortController().signal)) out.push(event);
  assert.equal(out.filter(e => e.kind === 'text_delta').map(e => e.delta).join(''), 'answer'); assert.equal(out.at(-1).kind, 'result');
  assert.equal(out.at(-1).result.text, 'answer');
});
for (const change of [f => { f.route.scope.tenantId = 'other'; }, f => { f.profile.scopeId = 'other'; }, f => { f.profile.model = 'other'; }, f => { f.profile.enabled = false; }, f => { f.route.preflight.allowed = false; }]) test('invalid routed owner or model never reaches the vault or wire', async () => {
  const f = setup(); change(f); await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal)); assert.deepEqual(f.state.resolves, []); assert.deepEqual(f.state.wire, []);
});
for (const change of [f => { f.state.connection.profileFingerprint = '0'.repeat(64); }, f => { f.state.connection.baseUrl = 'http://127.0.0.1/'; }, f => { f.state.connection.credential = 'bad\nkey'; }]) test('invalid bound credentials or destination never reach the adapter', async () => {
  const f = setup(); change(f); await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal)); assert.equal(f.state.wire.length, 0);
});
test('credential rotation during final pre-wire resolution blocks dispatch', async () => {
  const f = setup(); f.state.afterResolve = () => { if (f.state.resolves.length === 2) f.state.connection.credential = 'rotated'; };
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'CONFIG_INVALID'); assert.equal(f.state.wire.length, 0);
});
test('credential rotation after dispatch suppresses result publication', async () => {
  const f = setup(); f.state.afterWire = () => { f.state.connection.credential = 'rotated'; };
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'CONFIG_INVALID'); assert.equal(f.state.wire.length, 1);
});
test('absent protocols never fall back to another adapter or owner', async () => {
  const f = setup(); f.profile.protocol = 'unavailable'; f.state.connection.profileFingerprint = capabilityProfileFingerprint(f.profile);
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'PROVIDER_UNAVAILABLE'); assert.equal(f.state.resolves.length, 0);
});
test('cancelled vault wait never reaches the adapter', async () => {
  const f = setup(), abort = new AbortController(); f.state.afterResolve = () => abort.abort();
  await assert.rejects(f.transport.invoke(context, request(), f.route, abort.signal), e => e.code === 'CANCELLED'); assert.equal(f.state.wire.length, 0);
});
test('a credential split over adapter events is withheld before its prefix is published', async () => {
  const f = setup(), adapter = { provider: f.profile.protocol, features: ['streaming'], generate: async () => ({ text: 'unused' }), stream: async function* () {
    yield { kind: 'text_delta', delta: 'synthetic-' }; yield { kind: 'text_delta', delta: 'secret' }; yield { kind: 'result', result: { text: 'safe' } };
  } };
  const transport = new RoutedModelTransport(f.connections, [adapter]), out = [];
  await assert.rejects(async () => { for await (const event of transport.stream(context, request(), f.route, new AbortController().signal)) out.push(event); }, e => e.code === 'INVALID_RESPONSE');
  assert.deepEqual(out, []);
});
test('credential characters escaped by JSON cannot bypass result scanning in text, keys or nested values', async () => {
  for (const credential of ['synthetic-"secret', 'synthetic-\\secret']) {
    for (const result of [{ text: credential }, { text: 'safe', structured: { [credential]: 'value' } },
      { text: 'safe', structured: { nested: [credential] } }]) {
      const f = setup(); f.state.connection.credential = credential;
      const adapter = { provider: f.profile.protocol, features: [], generate: async () => result };
      await assert.rejects(new RoutedModelTransport(f.connections, [adapter]).invoke(context, request(), f.route,
        new AbortController().signal), error => error.code === 'INVALID_RESPONSE');
    }
  }
});
test('native decoded Messages and Responses reject credentials containing quotes or backslashes', async () => {
  const { AnthropicMessagesAdapter, ResponsesAdapter } = require('../apps/api/src/modules/ai-native/native-messages.adapter');
  for (const credential of ['synthetic-"secret', 'synthetic-\\secret']) {
    for (const [Adapter, raw] of [[AnthropicMessagesAdapter, { type: 'message', role: 'assistant', stop_reason: 'end_turn', content: [{ type: 'text', text: credential }] }],
      [ResponsesAdapter, { status: 'completed', output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: credential }] }] }]]) {
      const adapter = new Adapter({ post: async () => ({ status: 200, body: JSON.stringify(raw) }) });
      await assert.rejects(adapter.generate({ ...request(), signal: new AbortController().signal }, credential,
        { baseUrl: 'https://provider.invalid/v1' }), error => error.code === 'INVALID_RESPONSE');
    }
  }
});
test('adapter errors are sanitized rather than carrying credential messages', async () => {
  const f = setup(), adapter = { provider: f.profile.protocol, features: [], generate: async () => { throw Error('synthetic-secret'); } };
  await assert.rejects(new RoutedModelTransport(f.connections, [adapter]).invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'PROVIDER_FAILED' && e.message === 'PROVIDER_FAILED');
});
test('BYOK resolver consumes actual encrypted config service and reauthorizes invoke', async () => {
  const f = setup(); let record = null; const actions = [];
  const config = new TenantModelConfigService({ authorize: async (_c, action) => { actions.push(action); }, repository: {
    read: async () => structuredClone(record), compareAndSwap: async (_t, revision, next) => { if ((record?.revision ?? 0) !== revision) return false; record = structuredClone(next); return true; }
  } }, new SecretBox({ get: key => key === 'INTEGRATION_ENCRYPTION_KEY' ? 'synthetic-encryption-only-32-characters' : key === 'NODE_ENV' ? 'production' : undefined }));
  await config.save(context, { expectedRevision: 0, enabled: true, protocol: 'openai_chat_completions', baseUrl: 'https://provider.invalid/v1', model: 'selected-model', apiKey: 'synthetic-secret' });
  const selected = await config.profile(context); f.profile.credentialRef = selected.credentialRef;
  const resolver = new TenantModelConnectionResolver(config), resolved = await resolver.resolve(context, f.profile);
  assert.equal(resolved.credential, 'synthetic-secret'); assert.equal(resolved.profileFingerprint, capabilityProfileFingerprint(f.profile));
  assert.ok(actions.includes('invoke')); assert.equal(record.credentialsEncrypted.includes('synthetic-secret'), false);
  await assert.rejects(resolver.resolve({ ...context, tenantId: 'other' }, f.profile));
});
test('profile output ceiling is enforced before the protocol call', async () => {
  const f = setup(); f.state.connection.maxOutputTokens = 5;
  await assert.rejects(f.transport.invoke(context, request(), f.route, new AbortController().signal), e => e.code === 'INVALID_REQUEST'); assert.equal(f.state.wire.length, 0);
});
test('duplicate protocol registration is refused instead of choosing by array order', () => {
  const f = setup(); assert.throws(() => new RoutedModelTransport(f.connections, [f.adapter, f.adapter]), e => e.code === 'CONFIG_INVALID');
});
test('public module composes real protocol transport with public C03 and existing lifecycle', async () => {
  const f = setup('platform_managed'), current = structuredClone(base.contexts[0]);
  current.actor = { kind: 'user', userId: context.actorId }; current.scope = { kind: 'workspace', tenantId: context.tenantId, workspaceId: context.workspaceId };
  const consumerScope = { id: 'consumer', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
  const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
    routing: { resolve: async (_c, required) => ({ context: current, consumerScope, route: f.route, selection: { mode: 'platform_managed', revision: 1 }, scene: 'chat', requiredCapabilities: required }), assertCurrent: async () => {} },
    admission: { admit: async input => ({ ...input, id: 'admission-1' }), transition: async () => {} },
    usage: { reserve: async () => ({ id: 'usage-1' }), settle: async () => {}, markUnknown: async () => {} }, audit: { append: async () => {} }
  });
  const module = PublicAiGatewayModule.registerProtocols({ ports, evidence: 'mock', verifyEvidence: async () => true }, f.connections, [f.adapter], [{ sceneCode: 'order.explain', routeScene: 'chat', maxOutputTokens: 100 }]);
  const service = module.providers[0].useValue;
  const result = await service.invoke(current, { draftVersion: 'ain-c03-draft-2', requestId: 'request-1', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'hello' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 10 });
  assert.equal(result.status, 'completed'); assert.equal(result.text, 'answer'); assert.equal(result.actual.model, 'selected-model'); assert.equal(result.evidence, 'mock'); assert.equal(f.state.wire.length, 1);
});
