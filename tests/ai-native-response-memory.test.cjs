'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ModelResponseBuffer } = require('../apps/api/src/modules/ai-native/model-response-limits');
const { ModelEgressTransport } = require('../apps/api/src/modules/ai-native/model-egress.transport');
const { harness } = require('./fixtures/ai-native/model-egress.cjs');
const collect = async iterator => { const events = []; for await (const event of iterator) events.push(event); return events; };
test('oversized chunk is rejected BEFORE creating an additional Buffer copy', () => {
  const buffer = new ModelResponseBuffer(2), chunk = Buffer.from('large'), original = Buffer.from; let copied = false;
  Buffer.from = function (value, ...rest) { if (value === chunk) copied = true; return original(value, ...rest); };
  try { assert.throws(() => buffer.append(chunk), e => e.code === 'INVALID_RESPONSE'); assert.equal(copied, false); } finally { Buffer.from = original; }
});
test('stream validates UTF8 incrementally without calling full-body buffer join/decode', async () => {
  const original = ModelResponseBuffer.prototype.text; ModelResponseBuffer.prototype.text = () => { throw new Error('full body accumulation not allowed'); };
  try {
    const bytes = Buffer.from('你好'), f = harness({ chunks: [...bytes].map(byte => Uint8Array.of(byte)) });
    const result = await collect(new ModelEgressTransport(f.dependencies).postStream(f.input));
    assert.equal(result.filter(e => e.kind === 'chunk').length, bytes.length); assert.equal(f.state.timers.size, 0);
  } finally { ModelResponseBuffer.prototype.text = original; }
});
test('ordinary JSON post still returns a complete validated body', async () => {
  const f = harness({ chunks: [Buffer.from('{"text":"你好"}')] });
  assert.equal((await new ModelEgressTransport(f.dependencies).post(f.input)).body, '{"text":"你好"}');
});
for (const [label, chunks] of [['malformed', [Uint8Array.of(0xff)]], ['unfinished', [Uint8Array.of(0xe4, 0xbd)]], ['overlimit', [Buffer.from('12345')]]]) test(`stream rejects ${label} bytes and clears resources`, async () => {
  const f = harness({ chunks }); if (label === 'overlimit') f.input.maxResponseBytes = 4;
  await assert.rejects(collect(new ModelEgressTransport(f.dependencies).postStream(f.input)), e => e.code === 'INVALID_RESPONSE'); assert.equal(f.state.timers.size, 0); assert.equal(f.state.responses[0].destroyed, true);
});
test('strict noEmit checks bounded transport and response validation implementation', () => {
  assert.deepEqual(compileConsumer('import { ModelEgressTransport } from "../apps/api/src/modules/ai-native/model-egress.transport"; import { ModelResponseBuffer } from "../apps/api/src/modules/ai-native/model-response-limits";'), []);
});
