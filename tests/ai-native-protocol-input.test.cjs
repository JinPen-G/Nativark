'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
const connection = { baseUrl: 'https://synthetic.example.test/v1' }, credential = 'synthetic-key';
const input = () => ({ callId: 'input-1', model: 'model-1', messages: [{ role: 'user', content: 'Synthetic' }], maxOutputTokens: 20, signal: new AbortController().signal });
function harness() {
  const sent = [];
  const adapter = new ChatCompletionsAdapter({ post: async request => { sent.push(request); return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] }) }; }, postStream: async function* (request) { sent.push(request); yield { kind: 'headers', status: 200 }; yield { kind: 'chunk', bytes: Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') }; } });
  return { adapter, sent };
}
const collect = async value => { const result = []; for await (const event of value) result.push(event); return result; };
for (const [label, patch] of [['role', { messages: [{ role: 'tool', content: 'forged' }] }], ['message-extra', { messages: [{ role: 'user', content: 'x', tool_calls: [] }] }], ['token-limit', { maxOutputTokens: 0 }], ['model', { model: 'model\nInjected' }], ['empty-messages', { messages: [] }], ['oversized-content', { messages: [{ role: 'user', content: 'x'.repeat(32001) }] }]]) test(`protocol ${label} rejects before BOTH fake network paths`, async () => {
  const f = harness(), value = { ...input(), ...patch };
  await assert.rejects(f.adapter.generate(value, credential, connection), e => e.code === 'INVALID_REQUEST');
  await assert.rejects(collect(f.adapter.stream(value, credential, connection)), e => e.code === 'INVALID_REQUEST'); assert.equal(f.sent.length, 0);
});
test('actual serialized byte size catches UTF8 and JSON-escape expansion before dispatch', async () => {
  for (const char of ['中', '\u0000']) {
    const f = harness(), value = { ...input(), messages: Array.from({ length: 64 }, () => ({ role: 'user', content: char.repeat(32000) })) };
    await assert.rejects(f.adapter.generate(value, credential, connection), e => e.code === 'INVALID_REQUEST');
    await assert.rejects(collect(f.adapter.stream(value, credential, connection)), e => e.code === 'INVALID_REQUEST'); assert.equal(f.sent.length, 0);
  }
});
test('stream keeps its initial AbortSignal despite caller replacing input.signal after first delta', async () => {
  const f = harness(), value = input(), original = value.signal, controller = new AbortController(); value.signal = controller.signal;
  const iterator = f.adapter.stream(value, credential, connection)[Symbol.asyncIterator](); await iterator.next();
  controller.abort(); value.signal = original;
  await assert.rejects(iterator.next(), e => e.code === 'CANCELLED'); assert.equal(f.sent.length, 1);
});
test('missing AbortSignal and malformed credentials yield redacted protocol config errors', async () => {
  const f = harness();
  for (const key of [null, 'synthetic key', '密钥', 'synthetic\u0000key']) await assert.rejects(f.adapter.generate(input(), key, connection), e => e.code === 'CONFIG_INVALID');
  await assert.rejects(f.adapter.generate({ ...input(), signal: undefined }, credential, connection), e => e.code === 'CONFIG_INVALID'); assert.equal(f.sent.length, 0);
});
test('real strict noEmit validates shared INTERNAL request parser used by gateway and adapter', () => {
  assert.deepEqual(compileConsumer('import { ChatCompletionsAdapter } from "../apps/api/src/modules/ai-native/chat-completions.adapter"; import { ModelGatewayService } from "../apps/api/src/modules/ai-native/model-gateway.service";'), []);
});
