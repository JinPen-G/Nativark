'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ModelEgressTransport } = require('../apps/api/src/modules/ai-native/model-egress.transport');
const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
const { ChatCompletionsStream } = require('../apps/api/src/modules/ai-native/chat-completions-stream');
const fixture = require('./fixtures/ai-native/model-egress.cjs'), wire = require('./fixtures/ai-native/chat-protocol.cjs');
const input = signal => ({ callId: 'stream-1', model: 'model-1', messages: [{ role: 'user', content: 'Synthetic only' }], maxOutputTokens: 20, signal: signal ?? new AbortController().signal });
const connection = { baseUrl: 'https://synthetic.example.test/v1' };
function setup(options = {}) {
  const f = fixture.harness(options), transport = new ModelEgressTransport(f.dependencies, 1000);
  return { ...f, transport, adapter: new ChatCompletionsAdapter(transport) };
}
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events; };
test('actual adapter -> pinned HTTPS transport -> incremental UTF8/SSE -> terminal usage', async () => {
  const body = Buffer.from(wire.delta('你好', 'stop') + wire.usage + wire.done);
  const chunks = []; for (let i = 0; i < body.length; i += 3) chunks.push(body.subarray(i, i + 3));
  const f = setup({ chunks }); const events = await collect(f.adapter.stream(input(), 'synthetic-secret', connection));
  assert.deepEqual(events, [{ kind: 'text_delta', delta: '你好' }, { kind: 'result', result: { text: '你好', usage: { inputTokens: 1, outputTokens: 2 } } }]);
  assert.deepEqual(f.adapter.features, ['streaming']); const bodySent = JSON.parse(f.state.requests[0].body);
  assert.equal(bodySent.stream, true); assert.deepEqual(bodySent.stream_options, { include_usage: true });
  assert.equal(f.state.options[0].rejectUnauthorized, true); assert.equal(f.state.options[0].agent, false); assert.equal(f.state.timers.size, 0);
});
test('first delta arrives BEFORE body end, not replayed from a buffered successful response', async () => {
  const f = setup({ chunks: [Buffer.from(wire.delta('first'))], noEnd: true });
  const iterator = f.adapter.stream(input(), 'synthetic-secret', connection)[Symbol.asyncIterator]();
  assert.deepEqual((await iterator.next()).value, { kind: 'text_delta', delta: 'first' });
  assert.equal(f.state.timers.size, 1); const response = f.state.responses[0];
  response.emit('data', Buffer.from(wire.delta(' second', 'stop') + wire.done)); response.emit('end');
  assert.deepEqual((await iterator.next()).value, { kind: 'text_delta', delta: ' second' });
  assert.equal((await iterator.next()).value.result.text, 'first second'); assert.equal((await iterator.next()).done, true);
});
test('missing usage remains absent rather than estimated/reported zero', async () => {
  const f = setup({ chunks: [Buffer.from(wire.delta('full', 'stop') + wire.done)] });
  assert.equal((await collect(f.adapter.stream(input(), 'synthetic-secret', connection))).at(-1).result.usage, undefined);
});
for (const [status, code] of [[401, 'AUTHENTICATION_FAILED'], [403, 'AUTHENTICATION_FAILED'], [429, 'RATE_LIMITED'], [500, 'PROVIDER_FAILED'], [302, 'INVALID_RESPONSE']]) test(`stream HTTP ${status} never produces a terminal result`, async () => {
  const f = setup({ status }); await assert.rejects(collect(f.adapter.stream(input(), 'synthetic-secret', connection)), e => e.code === code && e.message === code);
  assert.equal(f.state.requests.length, 1); assert.equal(f.state.timers.size, 0);
});
for (const body of [wire.delta('partial'), wire.delta('cut', 'length') + wire.done, wire.done, wire.delta('full', 'stop') + wire.done + wire.done, 'data: invalid-json\n\n']) test('invalid/truncated/duplicate/unterminated stream is not completion', async () => {
  const f = setup({ chunks: [Buffer.from(body)] }); await assert.rejects(collect(f.adapter.stream(input(), 'synthetic-secret', connection)), e => e.code === 'INVALID_RESPONSE');
});
test('consumer stops early: request/body and transport timer are cleaned', async () => {
  const f = setup({ chunks: [Buffer.from(wire.delta('first'))], noEnd: true });
  const iterator = f.adapter.stream(input(), 'synthetic-secret', connection)[Symbol.asyncIterator](); await iterator.next(); await iterator.return();
  assert.equal(f.state.requests[0].destroyed, true); assert.equal(f.state.responses[0].destroyed, true); assert.equal(f.state.timers.size, 0);
});
test('cancellation after first chunk discards late chunks and never produces a terminal result', async () => {
  const f = setup({ chunks: [Buffer.from(wire.delta('first'))], noEnd: true }), controller = new AbortController();
  const iterator = f.adapter.stream(input(controller.signal), 'synthetic-secret', connection)[Symbol.asyncIterator](); await iterator.next(); controller.abort();
  f.state.responses[0].emit('data', Buffer.from(wire.delta('late', 'stop') + wire.done));
  await assert.rejects(iterator.next(), e => e.code === 'CANCELLED'); assert.equal(f.state.timers.size, 0);
});
test('stalled DNS stream respects transport deadline and late DNS never connects', async () => {
  let release; const f = setup({ dependencies: { resolve: () => new Promise(resolve => { release = resolve; }) } });
  const result = collect(f.adapter.stream(input(), 'synthetic-secret', connection)); await new Promise(resolve => setImmediate(resolve));
  f.state.now = 1000; [...f.state.timers.values()][0].callback();
  await assert.rejects(result, e => e.code === 'TIMEOUT'); release([{ address: '8.8.8.8', family: 4 }]); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.state.requests.length, 0);
});
test('mixed/private DNS remains rejected on incremental path before request', async () => {
  const f = setup({ addresses: [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }] });
  await assert.rejects(collect(f.adapter.stream(input(), 'synthetic-secret', connection)), e => e.code === 'CONFIG_INVALID'); assert.equal(f.state.requests.length, 0);
});
test('bounded chunk queue rejects a flood even below byte limit, no unbounded event array', async () => {
  const f = setup({ chunks: Array(300).fill(Buffer.from(': heartbeat\n\n')) });
  await assert.rejects(collect(f.adapter.stream(input(), 'synthetic-secret', connection)), e => e.code === 'INVALID_RESPONSE');
  assert.equal(f.state.responses[0].destroyed, true);
});
test('credential fragment is withheld; complete credential never enters returned deltas', () => {
  const decoder = new ChatCompletionsStream('synthetic-secret');
  assert.deepEqual(decoder.push(Buffer.from(wire.delta('ordinary syn'))), ['ordinary ']);
  assert.throws(() => decoder.push(Buffer.from(wire.delta('thetic-secret'))), e => e.code === 'INVALID_RESPONSE');
  const safe = new ChatCompletionsStream('synthetic-secret'); assert.deepEqual(safe.push(Buffer.from(wire.delta('syn'))), []);
  assert.deepEqual(safe.push(Buffer.from(wire.delta('opsis', 'stop') + wire.done)), ['synopsis']); assert.equal(safe.finish().text, 'synopsis');
});
test('unimplemented tools/structured output remain unavailable on actual stream path', async () => {
  const f = setup(); for (const feature of ['tools', 'structuredOutput']) await assert.rejects(collect(f.adapter.stream({ ...input(), features: [feature] }, 'synthetic-secret', connection)), e => e.code === 'CAPABILITY_UNSUPPORTED');
  assert.equal(f.state.requests.length, 0);
  const adapter = new ChatCompletionsAdapter({ post: async () => { throw new Error('not called'); } }); assert.deepEqual(adapter.features, []);
  await assert.rejects(collect(adapter.stream(input(), 'synthetic-secret', connection)), e => e.code === 'CAPABILITY_UNSUPPORTED');
});
test('strict TypeScript noEmit compiles actual stream adapter and transport', () => {
  assert.deepEqual(compileConsumer('import { ModelEgressTransport } from "../apps/api/src/modules/ai-native/model-egress.transport"; import { ChatCompletionsAdapter } from "../apps/api/src/modules/ai-native/chat-completions.adapter"; declare const transport: ModelEgressTransport; const adapter = new ChatCompletionsAdapter(transport); adapter.features;'), []);
});
