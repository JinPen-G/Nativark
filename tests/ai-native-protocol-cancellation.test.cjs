'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
// Private protocol and Rental tool assertions use the selected compatibility package.
const { load } = require('./fixtures/ai-native/rental-compatibility-source.cjs');
const { ChatCompletionsAdapter } = load('@rental-os/ai-native-server/runtime/chat-completions.adapter');
const { ModelEgressTransport } = load('@rental-os/ai-native-server/runtime/model-egress.transport');
const { ModelGatewayService } = load('@rental-os/ai-native-server/runtime/model-gateway.service');
const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
const egress = require('./fixtures/ai-native/model-egress.cjs'), wire = require('./fixtures/ai-native/chat-protocol.cjs');
const connection = { baseUrl: 'https://synthetic.example.test/v1' }, secret = 'synthetic-secret';
const input = signal => ({ callId: 'cancel-1', model: 'model-1', messages: [{ role: 'user', content: 'Synthetic' }], maxOutputTokens: 20, signal });
const response = JSON.stringify({ choices: [{ message: { content: 'late success' }, finish_reason: 'stop' }] });

test('cancellation during uncooperative post cannot produce late protocol success', async () => {
  const controller = new AbortController(); let complete, calls = 0;
  const adapter = new ChatCompletionsAdapter({ post: () => { calls++; return new Promise(resolve => { complete = resolve; }); } });
  const promise = adapter.generate(input(controller.signal), secret, connection);
  assert.equal(calls, 1); controller.abort(); complete({ status: 200, body: response });
  await assert.rejects(promise, e => e.code === 'CANCELLED'); assert.equal(calls, 1);
});

test('cancellation after a validated coalesced chunk discards its buffered terminal result', async () => {
  const controller = new AbortController(), body = Buffer.from(wire.delta('first') + wire.delta('late', 'stop') + wire.done);
  const f = egress.harness({ chunks: [body] });
  const adapter = new ChatCompletionsAdapter(new ModelEgressTransport(f.dependencies));
  const iterator = adapter.stream(input(controller.signal), secret, connection)[Symbol.asyncIterator]();
  // The adapter validates and publishes one bounded network block at a time.
  // Cancelling after that delivery must still suppress its buffered terminal.
  assert.deepEqual((await iterator.next()).value, { kind: 'text_delta', delta: 'firstlate' }); controller.abort();
  await assert.rejects(iterator.next(), e => e.code === 'CANCELLED'); assert.equal(f.state.timers.size, 0);
});

for (const feature of ['tools', 'structuredOutput']) test(`legacy text gateway refuses ${feature} without silently settling a discarded result`, async () => {
  const events = [], ctx = { tenantId: 'tenant-1', workspaceId: 'space-1', actorId: 'actor-1' };
  const tool = { name: 'rental_order_explain', version: AI_TOOL_DRAFT_VERSION };
  const message = feature === 'tools' ? { content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: tool.name, arguments: '{"orderId":"order-1"}' } }] } : { content: '{"summary":"Synthetic"}' };
  const adapter = new ChatCompletionsAdapter({ post: async () => { events.push('post'); return { status: 200, body: JSON.stringify({ choices: [{ message, finish_reason: feature === 'tools' ? 'tool_calls' : 'stop' }] }) }; } }, feature === 'tools' ? { orderExplainTool: tool } : { structuredOutput: { name: 'summary', schema: { type: 'object', properties: { summary: { type: 'string', maxLength: 30 } }, required: ['summary'], additionalProperties: false } } });
  const ports = { authorize: async () => {}, profile: async () => ({ enabled: true, provider: adapter.provider, baseUrl: connection.baseUrl, allowedModels: ['model-1'], credentialRef: 'vault-1', timeoutMs: 1000, maxConcurrent: 1, maxOutputTokens: 100 }), credential: async () => secret, budget: { reserve: async () => { events.push('reserve'); return 'reservation-1'; }, settle: async () => { events.push('settle'); }, release: async () => { events.push('release'); }, reconcile: async () => { events.push('reconcile'); } } };
  const gateway = new ModelGatewayService(ports, [adapter]); const { signal, ...request } = input(new AbortController().signal);
  await assert.rejects(gateway.generate(ctx, { ...request, features: [feature] }), e => e.code === 'CAPABILITY_UNSUPPORTED');
  assert.deepEqual(events, ['reserve', 'post', 'reconcile']);
});

test('strict noEmit still compiles adapter, transport and legacy gateway together', () => {
  assert.deepEqual(compileConsumer('import { ChatCompletionsAdapter } from "@rental-os/ai-native-server/runtime/chat-completions.adapter"; import { ModelEgressTransport } from "@rental-os/ai-native-server/runtime/model-egress.transport"; import { ModelGatewayService } from "@rental-os/ai-native-server/runtime/model-gateway.service";', process.env.AI_NATIVE_TEST_SOURCE_ROOT), []);
});
