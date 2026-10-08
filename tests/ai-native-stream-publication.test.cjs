'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const ctx = { tenantId: 'tenant-1', workspaceId: 'space-1', actorId: 'actor-1' };
const request = { callId: 'call-1', model: 'synthetic', messages: [{ role: 'user', content: 'synthetic' }], maxOutputTokens: 10 };
const result = () => ({ kind: 'result', result: { text: 'done', usage: { inputTokens: 1, outputTokens: 2 } } });
function setup() {
  const state = { events: [], wire: [{ kind: 'text_delta', delta: 'part' }, result()], signal: null };
  const ports = {
    routing: require('./fixtures/ai-native/unified-routing.cjs')(async () => ({ profile: { id: 'profile-1' } })),
    admission: { admit: async input => ({ id: 'admission-1', scope: input.scope }), transition: async (_s,_c,_f,to) => { state.events.push(to); } },
    usage: { reserve: async () => ({ id: 'usage-1' }), settle: async () => { state.events.push('settle'); }, markUnknown: async () => { state.events.push('unknown-usage'); } },
    audit: { append: async () => {} }, transport: { stream: async function* (_c,_r,_route,signal) { state.signal = signal; for (const event of state.wire) yield event; if (state.afterWire) await state.afterWire(); } }
  };
  const service = new UnifiedAiGatewayService(require('./fixtures/ai-native/unified-dispatch.cjs')(ports), 10000);
  return { state, ports, service };
}
async function collect(f, signal) { const received = []; let error; try { for await (const e of f.service.stream(ctx, request, signal)) received.push(e); } catch (e) { error = e; } return { received, error }; }
test('terminal result appears only after usage and admission complete', async () => {
  const f = setup(), stream = f.service.stream(ctx, request);
  assert.equal((await stream.next()).value.kind, 'text_delta');
  const terminal = await stream.next(); assert.equal(terminal.value.kind, 'result');
  assert.deepEqual(f.state.events, ['settle','completed']); assert.equal((await stream.next()).done, true);
});
for (const stage of ['settle','completed']) test(`failure at ${stage} publishes no terminal result`, async () => {
  const f = setup();
  if (stage === 'settle') f.ports.usage.settle = async () => { throw Error('private'); };
  else f.ports.admission.transition = async (_s,_c,_f,to) => { if (to === 'completed') throw Error('private'); };
  const out = await collect(f); assert.ok(out.error); assert.deepEqual(out.received.map(e => e.kind), ['text_delta']);
});
for (const extra of [result(), { kind: 'text_delta', delta: 'late' }, { kind: 'invalid' }]) test('duplicate or post-terminal data rejects before publishing result', async () => {
  const f = setup(); f.state.wire.push(extra); const out = await collect(f);
  assert.equal(out.error?.code, 'INVALID_RESPONSE'); assert.deepEqual(out.received.map(e => e.kind), ['text_delta']);
  assert.equal(f.state.events.includes('settle'), false);
});
test('source failure after a result candidate does not become successful completion', async () => {
  const f = setup(); f.state.afterWire = async () => { throw Error('late failure'); };
  const out = await collect(f); assert.ok(out.error); assert.equal(out.received.some(e => e.kind === 'result'), false);
});
test('cancellation between result candidate and source end suppresses terminal output', async () => {
  const f = setup(), cancel = new AbortController(); f.state.afterWire = async () => cancel.abort();
  const out = await collect(f, cancel.signal); assert.equal(out.error?.code, 'CANCELLED'); assert.equal(out.received.some(e => e.kind === 'result'), false);
});
test('consumer stopping at a text delta leaves outcome unknown and aborts transport signal', async () => {
  const f = setup(), stream = f.service.stream(ctx, request); await stream.next(); await stream.return();
  assert.deepEqual(f.state.events, ['unknown-usage','unknown']); assert.equal(f.state.signal.aborted, true);
});
test('consumer stopping after final result cannot change completed to unknown', async () => {
  const f = setup(), stream = f.service.stream(ctx, request); await stream.next(); await stream.next(); await stream.return();
  assert.deepEqual(f.state.events, ['settle','completed']);
});
test('missing terminal result remains failure, not a successful empty stream', async () => {
  const f = setup(); f.state.wire = []; const out = await collect(f); assert.ok(out.error); assert.equal(out.received.length, 0);
});
test('candidate is snapshotted before the source can mutate it', async () => {
  const f = setup(); let charged;
  f.ports.usage.settle = async (_s,_id,_event,input,output) => { charged = [input,output]; };
  f.state.afterWire = async () => { f.state.wire[1].result.text = 'mutated'; f.state.wire[1].result.usage.inputTokens = 999; };
  const out = await collect(f); assert.equal(out.error, undefined); assert.equal(out.received.at(-1).result.text, 'done'); assert.deepEqual(charged, [1,2]);
});
for (const stage of ['settle','completed']) test(`cancellation during ${stage} suppresses final publication`, async () => {
  const f = setup(), cancel = new AbortController();
  if (stage === 'settle') f.ports.usage.settle = async () => cancel.abort();
  else f.ports.admission.transition = async (_s,_c,_f,to) => { if (to === 'completed') cancel.abort(); };
  const out = await collect(f, cancel.signal); assert.equal(out.error?.code, 'CANCELLED'); assert.equal(out.received.some(e => e.kind === 'result'), false);
});
test('missing usage is recorded unknown before result publication', async () => {
  const f = setup(); delete f.state.wire[1].result.usage;
  const out = await collect(f); assert.equal(out.error, undefined); assert.deepEqual(f.state.events, ['unknown-usage','completed']);
});
test('settlement failure cannot leak a final result even when reconciliation also fails', async () => {
  const f = setup(); f.ports.usage.settle = async () => { throw Error('failed'); }; f.ports.usage.markUnknown = async () => { throw Error('also failed'); };
  const out = await collect(f); assert.ok(out.error); assert.equal(out.received.some(e => e.kind === 'result'), false);
});
