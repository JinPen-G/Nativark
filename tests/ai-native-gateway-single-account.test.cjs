'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const { PublicAiGatewayService } = require('../apps/api/src/modules/ai-native/public-ai-gateway.service');
const context = { tenantId: 'tenant-1', workspaceId: 'workspace-1', actorId: 'actor-1' };
const scope = { id: 'scope-1', kind: 'WORKSPACE', tenantId: context.tenantId, workspaceId: context.workspaceId };
const intent = { draftVersion: 'ain-c03-draft-2', requestId: 'call-1', sceneCode: 'rental.order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'Explain my order.' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 32 };
const scene = { sceneCode: intent.sceneCode, routeScene: 'chat', maxOutputTokens: 32 };
function harness() {
  const events = [], calls = [], tokens = new Map(); let reserveGate, dispatchGate;
  const ports = {
    routing: require('./fixtures/ai-native/unified-routing.cjs')(async () => ({ profile: { id: 'profile-1', model: 'model-1' } }), scope),
    admission: { admit: async value => ({ ...value, id: 'admission-1' }) },
    dispatch: { claim: async binding => { if (tokens.size) throw Error('already claimed'); tokens.set(binding.dispatchId, structuredClone(binding)); events.push('claim'); }, finish: async (binding, status) => { assert.deepEqual(tokens.get(binding.dispatchId), binding); events.push(`finish:${status}`); } },
    usage: { reserve: async () => { events.push('legacy'); throw Error('legacy ledger forbidden'); }, settle: async () => { throw Error('legacy ledger forbidden'); }, markUnknown: async () => {} },
    budget: {
      reserve: async call => { calls.push(structuredClone(call)); events.push('reserve'); if (reserveGate) await reserveGate; return { id: 'budget-1' }; },
      dispatch: async (call, id) => { assert.equal(id, 'budget-1'); assert.deepEqual(call, calls[0]); events.push('budget:dispatch'); if (dispatchGate) await dispatchGate; },
      settle: async (call, id, key, usage) => { assert.equal(id, 'budget-1'); assert.deepEqual(call, calls[0]); assert.ok(key.includes('call-1')); assert.deepEqual(usage, { inputTokens: 1, outputTokens: 2 }); events.push('settle'); },
      abandon: async (call, id, reason) => { assert.equal(id, 'budget-1'); assert.deepEqual(call, calls[0]); events.push(`abandon:${reason}`); }
    },
    audit: { append: async () => { events.push('audit'); } },
    transport: { invoke: async () => { events.push('transport'); return { text: 'ok', usage: { inputTokens: 1, outputTokens: 2 } }; }, stream: async function* () { events.push('transport'); yield { kind: 'text_delta', delta: 'ok' }; yield { kind: 'result', result: { text: 'ok', usage: { inputTokens: 1, outputTokens: 2 } } }; } }
  };
  const service = () => new UnifiedAiGatewayService(ports, 1000, scene);
  const run = async (mode, signal) => mode === 'invoke' ? service().invokeTextIntent(context, intent, signal) : (async () => { const out = []; for await (const event of service().streamTextIntent(context, intent, signal)) out.push(event); return out; })();
  return { ports, events, calls, service, run, setReserveGate: gate => { reserveGate = gate; }, setDispatchGate: gate => { dispatchGate = gate; } };
}
for (const mode of ['invoke', 'stream']) test(`${mode} uses one budget account with claim-bound reserve, dispatch and settlement`, async () => {
  const h = harness(); await h.run(mode);
  assert.deepEqual(h.events, ['claim', 'reserve', 'audit', 'budget:dispatch', 'transport', 'settle', 'finish:completed']);
  const call = h.calls[0]; assert.equal(call.binding.id, 'admission-1'); assert.equal(call.request.callId, intent.requestId); assert.equal(call.request.model, 'model-1');
  assert.match(call.request.intentHash, /^[a-f0-9]{64}$/); assert.equal(call.binding.actorId, context.actorId);
});
test('legacy usage-only configuration cannot create a callable unified gateway', async () => {
  const h = harness(); delete h.ports.budget;
  await assert.rejects(async () => h.run('invoke'), error => error.code === 'CONFIG_INVALID');
  assert.equal(h.events.includes('legacy'), false); assert.equal(h.events.includes('transport'), false);
});
test('public gateway rejects legacy usage-only composition at construction', () => {
  const h = harness(); delete h.ports.budget;
  assert.throws(() => new PublicAiGatewayService({ ports: h.ports, evidence: 'mock', verifyEvidence: async () => true }, [scene]), error => error.code === 'CONFIG_INVALID');
});
for (const mode of ['invoke', 'stream']) test(`${mode} budget dispatch failure cannot reach the transport`, async () => {
  const h = harness(); h.ports.budget.dispatch = async () => { h.events.push('budget:dispatch'); throw Error('budget transition unacknowledged'); };
  await assert.rejects(h.run(mode)); assert.equal(h.events.includes('transport'), false); assert.ok(h.events.some(e => e.startsWith('abandon:')));
});
test('revocation during budget dispatch is rechecked before transport', async () => {
  const h = harness(); let revoked = false;
  h.ports.budget.dispatch = async () => { h.events.push('budget:dispatch'); revoked = true; };
  h.ports.routing.assertCurrent = async () => { if (revoked) throw Error('revoked'); };
  await assert.rejects(h.run('invoke')); assert.equal(h.events.includes('transport'), false);
});
test('missing provider usage remains a retained budget outcome, not a zero-cost settlement', async () => {
  const h = harness(); h.ports.transport.invoke = async () => ({ text: 'ok' });
  const result = await h.run('invoke'); assert.equal(result.usageState, 'reconciliation_required');
  assert.ok(h.events.includes('abandon:USAGE_UNAVAILABLE')); assert.equal(h.events.includes('settle'), false);
});
test('consumer cancellation abandons the persistent budget without a second reserve', async () => {
  const h = harness(), stream = h.service().streamTextIntent(context, intent);
  assert.equal((await stream.next()).value.kind, 'text_delta'); await stream.return();
  assert.equal(h.events.filter(e => e === 'reserve').length, 1); assert.ok(h.events.includes('abandon:CONSUMER_STOPPED'));
});
