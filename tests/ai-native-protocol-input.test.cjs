'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ChatCompletionsAdapter } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
const connection = { baseUrl: 'https://synthetic.example.test/v1' }, credential = 'synthetic-key';
const input = () => ({ callId: 'input-1', model: 'model-1', messages: [{ role: 'user', content: 'Synthetic' }], maxOutputTokens: 20, signal: new AbortController().signal });
function harness(options = {}) {
  const sent = [];
  const adapter = new ChatCompletionsAdapter({ post: async request => { sent.push(request); return { status: 200, body: JSON.stringify({ choices: [{ message: { content: 'answer' }, finish_reason: 'stop' }] }) }; }, postStream: async function* (request) { sent.push(request); yield { kind: 'headers', status: 200 }; yield { kind: 'chunk', bytes: Buffer.from('data: {"choices":[{"index":0,"delta":{"content":"answer"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n') }; } }, options);
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
test('bounded media protocol is opt-in and never opens text-only Gateway ingress', async () => {
  const { createHash } = require('node:crypto');
  const { modelRequestSchema } = require('../apps/api/src/modules/ai-native/model-gateway.ports');
  const { prepareGatewayTextIntent } = require('../apps/api/src/modules/ai-native/gateway-intent');
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZioAAAAASUVORK5CYII=', 'base64');
  const wav = Buffer.alloc(46);
  wav.write('RIFF'); wav.writeUInt32LE(38, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(8000, 24); wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(2, 40);
  const f = harness({ mediaInput: ['image', 'audio'] });
  for (const [kind, mediaType, bytes] of [['image', 'image/png', png], ['audio', 'audio/wav', wav]]) {
    const part = { kind, mediaType, attachmentId: `synthetic-${kind}`, attachmentRevision: 1,
      contentHash: createHash('sha256').update(bytes).digest('hex'), data: bytes.toString('base64') };
    const value = { ...input(), features: [kind], messages: [{ role: 'user', content: [{ kind: 'text', text: 'Candidate only' }, part] }] };
    const { signal, ...request } = value;
    assert.equal(modelRequestSchema.safeParse(request).success, false);
    const result = await f.adapter.generate(value, credential, connection);
    assert.equal(result.text, 'answer'); assert.equal(result.usage, undefined);
    const wire = JSON.parse(f.sent.at(-1).body);
    assert.deepEqual(wire.messages[0].content[1], kind === 'image'
      ? { type: 'image_url', image_url: { url: `data:image/png;base64,${part.data}` } }
      : { type: 'input_audio', input_audio: { data: part.data, format: 'wav' } });
    assert.ok(!f.sent.at(-1).body.includes(part.attachmentId)); assert.ok(!f.sent.at(-1).body.includes(part.contentHash));
    const disabled = harness();
    await assert.rejects(disabled.adapter.generate(value, credential, connection), e => e.code === 'CAPABILITY_UNSUPPORTED');
    assert.equal(disabled.sent.length, 0);
    const before = f.sent.length;
    for (const patch of [{ contentHash: '0'.repeat(64) }, { url: 'https://untrusted.invalid/file' }, { attachmentRevision: 0 }, { data: Buffer.alloc(524289).toString('base64') }]) {
      await assert.rejects(f.adapter.generate({ ...value, messages: [{ role: 'user', content: [{ ...part, ...patch }] }] }, credential, connection), e => e.code === 'INVALID_REQUEST');
    }
    await assert.rejects(f.adapter.generate({ ...value, features: [] }, credential, connection), e => e.code === 'INVALID_REQUEST');
    assert.equal(f.sent.length, before);
    if (kind === 'image') assert.equal((await collect(f.adapter.stream(value, credential, connection))).at(-1).result.text, 'answer');
    else await assert.rejects(collect(f.adapter.stream(value, credential, connection)), e => e.code === 'CAPABILITY_UNSUPPORTED');
    assert.throws(() => prepareGatewayTextIntent({ draftVersion: 'ain-c03-draft-2', requestId: 'media-1', sceneCode: 'inspection',
      messages: [{ role: 'user', content: [{ kind, attachmentId: part.attachmentId, attachmentRevision: 1 }] }],
      requiredFeatures: ['text', kind], optionalFeatures: [], maxOutputTokens: 20 }, { sceneCode: 'inspection', maxOutputTokens: 20 }, 'invoke'), e => e.code === 'CAPABILITY_UNSUPPORTED');
  }
});
