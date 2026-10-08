'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { UnifiedAiGatewayService } = require('../apps/api/src/modules/ai-native/unified-ai-gateway.service');
const { GatewayDeadline } = require('../apps/api/src/modules/ai-native/gateway-deadline');
const never = () => new Promise(() => {}), tick = () => new Promise(r => setImmediate(r));
const ctx = { tenantId: 't', workspaceId: 'w', actorId: 'a' };
const request = { callId: 'c', model: 'm', messages: [{ role: 'user', content: 'test' }], maxOutputTokens: 4 };
function setup(ms = 50) {
  const events = [], controller = new AbortController();
  const ports = {
    routing: require('./fixtures/ai-native/unified-routing.cjs')(async () => { events.push('route'); return { profile: { id: 'p' } }; }),
    admission: { admit: async input => { events.push('admit'); return { id: 'a', scope: input.scope }; }, transition: async (_s,_c,_f,to) => { events.push('admission:' + to); } },
    usage: { reserve: async () => { events.push('reserve'); return { id: 'u' }; }, settle: async () => { events.push('settle'); }, markUnknown: async (_s,_id,reason) => { events.push('usage:' + reason); } },
    audit: { append: async () => { events.push('audit'); } },
    transport: { invoke: async () => { events.push('invoke'); return { text: 'ok', usage: { inputTokens: 1, outputTokens: 2 } }; }, stream: async function* () { events.push('stream'); yield { kind: 'result', result: { text: 'ok', usage: { inputTokens: 1, outputTokens: 2 } } }; } }
  };
  const service = new UnifiedAiGatewayService(require('./fixtures/ai-native/unified-dispatch.cjs')(ports), ms);
  return { events, ports, controller, service, invoke: () => service.invoke(ctx, request, controller.signal), stream: async () => { const out = []; for await (const e of service.stream(ctx, request, controller.signal)) out.push(e); return out; } };
}
for (const mode of ['invoke', 'stream']) for (const stage of ['route','admit','claim','reserve','audit','revalidate','transport','settle','complete']) test(`${mode} deadline bounds uncooperative ${stage}`, { timeout: 2000 }, async () => {
  const f = setup();
  if (stage === 'route') f.ports.routing.resolve = never;
  if (stage === 'revalidate') f.ports.routing.assertCurrent = never;
  if (stage === 'claim') f.ports.dispatch.claim = never;
  if (stage === 'admit') f.ports.admission.admit = never;
  if (stage === 'reserve') f.ports.usage.reserve = never;
  if (stage === 'audit') f.ports.audit.append = never;
  if (stage === 'transport') { f.ports.transport.invoke = never; f.ports.transport.stream = () => ({ [Symbol.asyncIterator]() { return { next: never }; } }); }
  if (stage === 'settle') f.ports.usage.settle = never;
  if (stage === 'complete') f.ports.admission.transition = async (_s,_c,_f,to) => { if (to === 'completed') await never(); };
  await assert.rejects(f[mode](), e => e.code === 'TIMEOUT');
  if (['route','admit','claim','reserve','audit','revalidate'].includes(stage)) assert.equal(f.events.some(e => e === 'invoke' || e === 'stream'), false);
});
test('cancellation stops waiting for router with no dispatch', { timeout: 2000 }, async () => {
  const f = setup(10000); let entered = false;
  f.ports.routing.resolve = () => { entered = true; return never(); };
  const pending = assert.rejects(f.invoke(), e => e.code === 'CANCELLED');
  while (!entered) await tick(); f.controller.abort(); await pending; assert.equal(f.events.includes('invoke'), false);
});
test('first cancellation reason is not overwritten by later deadline', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const cancel = new AbortController(), life = new GatewayDeadline(100, cancel.signal);
  cancel.abort(); t.mock.timers.tick(101); assert.equal(life.reason(), 'CANCELLED'); life.close();
});
test('late reservation after timeout is retained for reconciliation, never dispatched', { timeout: 2000 }, async () => {
  const f = setup(); let complete;
  f.ports.usage.reserve = () => new Promise(r => { complete = r; });
  await assert.rejects(f.invoke(), e => e.code === 'TIMEOUT');
  assert.equal(typeof complete, 'function'); complete({ id: 'late-u' }); await tick(); await tick();
  assert.ok(f.events.includes('usage:LATE_RESERVATION')); assert.equal(f.events.includes('invoke'), false);
});
test('late unclaimed admission is left untouched without reserving usage', { timeout: 2000 }, async () => {
  const f = setup(); let complete;
  f.ports.admission.admit = () => new Promise(r => { complete = r; });
  await assert.rejects(f.invoke(), e => e.code === 'TIMEOUT'); complete({ id: 'late-a' }); await tick(); await tick();
  assert.equal(f.events.includes('admission:cancelled'), false); assert.equal(f.events.includes('reserve'), false);
});
test('uncooperative iterator next and return cannot keep caller waiting indefinitely', { timeout: 2000 }, async () => {
  const f = setup(); let returned = false;
  f.ports.transport.stream = () => ({ [Symbol.asyncIterator]() { return { next: never, return() { returned = true; return never(); } }; } });
  await assert.rejects(f.stream(), e => e.code === 'TIMEOUT'); assert.equal(returned, true);
});
test('hung cleanup is bounded after transport failure', { timeout: 2000 }, async () => {
  const f = setup(); f.ports.transport.invoke = async () => { throw Error('private'); }; f.ports.usage.markUnknown = never;
  await assert.rejects(f.invoke(), e => e.code === 'PROVIDER_FAILED');
});
test('cleanup uses one shared time allowance, not a new allowance per operation', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] }); let time = 0; t.mock.method(performance, 'now', () => time);
  const life = new GatewayDeadline(1000, undefined, 25);
  const first = assert.rejects(life.cleanup(never), e => e.code === 'ACCOUNTING_PENDING');
  await tick(); time = 26; t.mock.timers.tick(26); await first;
  let ran = false; await assert.rejects(life.cleanup(() => { ran = true; }), e => e.code === 'ACCOUNTING_PENDING'); assert.equal(ran, false); life.close();
});
