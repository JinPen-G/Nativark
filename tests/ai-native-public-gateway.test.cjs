'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const base = require('./fixtures/ai-native/contract-consumer.cjs'); base.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true } });
require('./fixtures/ai-native/local-shared.cjs');
const { PublicAiGatewayService, PublicAiGatewayModule } = require('../apps/api/src/modules/ai-native/public-ai-gateway.service');
const { ModelGatewayError } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
const { isGatewayResult, isGatewayEvent } = require('../apps/api/src/modules/ai-native/gateway-contract-validation');
const intent = () => ({ draftVersion: 'ain-c03-draft-2', requestId: 'request-1', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'explain' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 10 });
const scenes = [{ sceneCode: 'order.explain', routeScene: 'chat', maxOutputTokens: 100 }];
function setup(mode = 'platform_managed', timeout = 10000) {
  const context = structuredClone(base.contexts[0]), events = [];
  const scope = { id: 'consumer', kind: 'WORKSPACE', tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId };
  const owner = mode === 'platform_managed' ? { id: 'owner-platform', kind: 'PLATFORM' } : { id: 'owner-tenant', kind: 'TENANT', tenantId: context.scope.tenantId };
  const state = { active: true, verified: true, context, result: { text: 'done', usage: { inputTokens: 1, outputTokens: 2 } }, fail: null };
  const profile = { id: 'profile-1', configRevision: 1, credentialRef: 'vault:reference', protocol: 'openai_chat_completions', provider: 'synthetic', model: 'model', serviceMode: mode, scopeId: owner.id, scopeKind: owner.kind };
  const ports = require('./fixtures/ai-native/unified-dispatch.cjs')({
    routing: { resolve: async (_ctx, required) => ({ context: structuredClone(state.context), consumerScope: scope, route: { profile, scope: owner, role: 'DEFAULT', preflight: { allowed: true, required, missing: [], stale: [] } }, selection: { mode, revision: 1 }, scene: 'chat', requiredCapabilities: required }),
      assertCurrent: async () => { if (!state.active) throw new ModelGatewayError('FORBIDDEN'); } },
    admission: { admit: async input => { events.push('admit'); return { id: 'admission-1', ...input }; }, transition: async (_s,_c,_from,to) => { events.push(to); } },
    usage: { reserve: async () => { events.push('reserve'); return { id: 'usage-1' }; }, settle: async () => { events.push('settle'); }, markUnknown: async () => { events.push('unknown-usage'); } },
    audit: { append: async () => {} }, transport: {
      invoke: async () => { events.push('transport'); if (state.fail) throw state.fail; return state.result; },
      stream: async function* () { events.push('transport'); yield { kind: 'text_delta', delta: 'part' }; if (state.fail) throw state.fail; yield { kind: 'result', result: state.result }; }
    }
  });
  const runtime = { ports, evidence: 'mock', verifyEvidence: async () => state.verified };
  return { state, ports, runtime, events, context, service: new PublicAiGatewayService(runtime, scenes, timeout) };
}
for (const mode of ['platform_managed', 'tenant_managed']) test(`${mode}: public invoke returns schema-valid actual routing, not model-selected metadata`, async () => {
  const f = setup(mode), result = await f.service.invoke(f.context, intent());
  assert.equal(isGatewayResult(result), true); assert.equal(result.status, 'completed'); assert.equal(result.evidence, 'mock');
  assert.equal(result.actual.configId, 'profile-1'); assert.equal(result.actual.serviceMode, mode);
  assert.equal(result.actual.configurationScope.kind, mode === 'platform_managed' ? 'platform' : 'tenant');
  assert.equal(result.requestId, 'request-1'); assert.deepEqual(result.usage, { kind: 'reported', inputTokens: 1, outputTokens: 2 });
});
test('public stream emits started, delta and terminal with positive consecutive sequences', async () => {
  const f = setup(), out = []; for await (const event of f.service.stream(f.context, intent())) { assert.equal(isGatewayEvent(event), true); out.push(event); }
  assert.deepEqual(out.map(event => event.kind), ['started', 'text_delta', 'terminal']); assert.deepEqual(out.map(event => event.sequence), [1,2,3]);
  assert.equal(out[2].result.status, 'completed'); assert.ok(f.events.includes('settle'));
});
for (const mode of ['invoke', 'stream']) test(`${mode}: dispatched failure has retryable false and mandatory reconciliation`, async () => {
  const f = setup(); f.state.fail = Error('private credential dump must not leak');
  let result;
  if (mode === 'invoke') result = await f.service.invoke(f.context, intent());
  else { const out = []; for await (const event of f.service.stream(f.context, intent())) out.push(event); result = out.at(-1).result; }
  assert.equal(isGatewayResult(result), true); assert.equal(result.status, 'unknown'); assert.equal(result.error.retryable, false);
  assert.equal(result.error.nextAction, 'reconcile'); assert.equal(JSON.stringify(result).includes('credential dump'), false);
});
test('undispatched budget refusal is failed rather than a fabricated success', async () => {
  const f = setup(); f.ports.usage.reserve = async () => { throw new ModelGatewayError('BUDGET_UNAVAILABLE'); };
  const result = await f.service.invoke(f.context, intent()); assert.equal(result.status, 'failed'); assert.equal(isGatewayResult(result), true);
  assert.equal(f.events.includes('transport'), false);
});
for (const changed of [c => { c.actor.userId = 'other'; }, c => { c.scope.workspaceId = 'other'; }, c => { c.scope.tenantId = 'other'; }, c => { c.audience = 'staff'; }]) test('caller context cannot replace the authority-resolved identity', async () => {
  const f = setup(), forged = structuredClone(f.context); changed(forged);
  await assert.rejects(f.service.invoke(forged, intent()), e => e.code === 'FORBIDDEN'); assert.deepEqual(f.events, []);
});
for (const context of [base.contexts[2], base.contexts[3], base.contexts[4]]) test('non-workspace user context is refused without inventing a tenant', async () => {
  const f = setup(); await assert.rejects(f.service.invoke(context, intent()), e => e.code === 'FORBIDDEN'); assert.deepEqual(f.events, []);
});
for (const verified of [false, 'true', 1]) test('a metadata mode label is not a substitute for verified evidence', async () => {
  const f = setup(); f.state.verified = verified;
  await assert.rejects(f.service.invoke(f.context, intent()), e => e.code === 'CONFIG_INVALID'); assert.deepEqual(f.events, []);
});
test('revocation between started and delta suppresses all later public output', async () => {
  const f = setup(), stream = f.service.stream(f.context, intent()); assert.equal((await stream.next()).value.kind, 'started');
  f.state.active = false; await assert.rejects(stream.next(), e => e.code === 'FORBIDDEN'); assert.equal(f.events.includes('completed'), false);
});
test('missing usage is returned as unknown usage, never invented as zero', async () => {
  const f = setup(); f.state.result = { text: 'done' }; const result = await f.service.invoke(f.context, intent());
  assert.equal(result.status, 'completed'); assert.deepEqual(result.usage, { kind: 'unknown', reason: 'not_returned', nextAction: 'reconcile' });
});
test('public schema bounds are enforced before any admission', async () => {
  const f = setup(), value = intent(); value.messages[0].content = Array.from({ length: 17 }, () => ({ kind: 'text', text: 'x' }));
  await assert.rejects(f.service.invoke(f.context, value), e => e.code === 'INVALID_REQUEST'); assert.deepEqual(f.events, []);
});
test('concurrent public invocations retain separate request/result envelopes', async () => {
  const f = setup(); let release, entered;
  const ready = new Promise(r => { entered = r; });
  f.ports.transport.invoke = async (_context, request) => {
    if (request.callId === 'request-1') await new Promise(r => { release = r; entered(); });
    return { text: request.callId, usage: { inputTokens: 1, outputTokens: 2 } };
  };
  const first = f.service.invoke(f.context, intent()); await ready;
  const second = await f.service.invoke(f.context, { ...intent(), requestId: 'request-2' }); release();
  const one = await first; assert.equal(one.requestId, 'request-1'); assert.equal(one.text, 'request-1');
  assert.equal(second.requestId, 'request-2'); assert.equal(second.text, 'request-2');
});
test('consumer return after started closes the owned invocation without a false terminal', async () => {
  const f = setup(), stream = f.service.stream(f.context, intent());
  assert.equal((await stream.next()).value.kind, 'started'); await stream.return();
  assert.ok(f.events.includes('unknown')); assert.equal(f.events.includes('completed'), false);
});
test('live label without a verifier cannot construct a production gateway', () => {
  const f = setup(); assert.throws(() => new PublicAiGatewayService({ ports: f.ports, evidence: 'live' }, scenes), e => e.code === 'CONFIG_INVALID');
});
test('uncooperative evidence verification obeys the overall deadline before any reserve', async () => {
  const f = setup(), gateway = new PublicAiGatewayService({ ...f.runtime, verifyEvidence: () => new Promise(() => {}) }, scenes, 30);
  await assert.rejects(gateway.invoke(f.context, intent()), e => e.code === 'TIMEOUT'); assert.deepEqual(f.events, []);
});
test('oversize public stream delta produces only a valid unknown terminal, not an invalid event', async () => {
  const f = setup(); f.ports.transport.stream = async function* () { yield { kind: 'text_delta', delta: 'x'.repeat(16001) }; };
  const out = []; for await (const event of f.service.stream(f.context, intent())) { assert.equal(isGatewayEvent(event), true); out.push(event); }
  assert.deepEqual(out.map(event => event.kind), ['started', 'terminal']); assert.equal(out[1].result.status, 'unknown');
});
test('a malformed actual config is rejected before admission rather than repaired with placeholders', async () => {
  const f = setup(), resolve = f.ports.routing.resolve;
  f.ports.routing.resolve = async (...args) => { const result = await resolve(...args); result.route.profile.credentialRef = 'invalid secret ref spaces'; return result; };
  await assert.rejects(f.service.invoke(f.context, intent()), e => e.code === 'CONFIG_INVALID'); assert.deepEqual(f.events, []);
});

test('unknown scenes and missing wiring do not activate a gateway', async () => {
  const f = setup(); await assert.rejects(f.service.invoke(f.context, { ...intent(), sceneCode: 'unknown' }), e => e.code === 'CAPABILITY_UNSUPPORTED');
  assert.throws(() => new PublicAiGatewayService({ ...f.runtime, verifyEvidence: undefined }, scenes));
  assert.throws(() => PublicAiGatewayModule.register({ ...f.runtime, ports: {} }, scenes));
  assert.equal(PublicAiGatewayModule.register(f.runtime, scenes).exports[0], PublicAiGatewayService);
});
