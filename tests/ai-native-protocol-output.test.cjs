'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { blockNetwork, compileConsumer, validatorsFor } = require('./fixtures/ai-native/contract-consumer.cjs'); blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { ChatCompletionsAdapter, ChatProtocolPolicy } = require('../apps/api/src/modules/ai-native/chat-completions.adapter');
const { ModelEgressTransport } = require('../apps/api/src/modules/ai-native/model-egress.transport');
const egress = require('./fixtures/ai-native/model-egress.cjs');
const { AI_NATIVE_COMPONENT_SCHEMAS: schema } = require('../apps/api/src/contracts/ai-native-schemas');
const { AI_TOOL_DRAFT_VERSION } = require('./fixtures/ai-native/local-shared.cjs');
const validators = validatorsFor({ AiOrderExplainRequestDraft: schema.AiOrderExplainRequestDraft }, schema);
const tool = { name: 'rental_order_explain_v1', version: AI_TOOL_DRAFT_VERSION };
const output = { name: 'answer', schema: { type: 'object', properties: { summary: { type: 'string', maxLength: 200 } }, required: ['summary'], additionalProperties: false } };
const request = features => ({ callId: 'test-1', model: 'synthetic', messages: [{ role: 'user', content: 'Synthetic only' }], maxOutputTokens: 20, features, signal: new AbortController().signal });
const connection = { baseUrl: 'https://synthetic.example.test/v1' }, secret = 'synthetic-secret';
const call = overrides => ({ id: 'call_1', type: 'function', function: { name: tool.name, arguments: '{"orderId":"order-1"}' }, ...overrides });
const response = (calls, text = null) => JSON.stringify({ choices: [{ message: { content: text, ...(calls ? { tool_calls: calls } : {}) }, finish_reason: calls?.length ? 'tool_calls' : 'stop' }] });
function harness(body, options = {}) {
  const sent = [];
  const transport = { post: async value => { sent.push(JSON.parse(value.body)); return { status: 200, body }; },
    postStream: async function* () { yield { kind: 'headers', status: 200 }; for (const chunk of body) yield { kind: 'chunk', bytes: Buffer.from(chunk) }; } };
  return { adapter: new ChatCompletionsAdapter(transport, options), sent };
}
const frame = (tools, finish = null) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { ...(tools ? { tool_calls: tools } : {}) }, finish_reason: finish }] }) + '\n\n';
const text = (content, finish = null) => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content }, finish_reason: finish }] }) + '\n\n';
const done = 'data: [DONE]\n\n';
async function stream(f, features) { const out = []; for await (const value of f.adapter.stream(request(features), secret, connection)) out.push(value); return out; }
test('registered C02 tool produces a schema-valid candidate request, never executes a handler', async () => {
  const f = harness(response([call()]), { orderExplainTool: tool });
  const result = await f.adapter.generate(request(['tools']), secret, connection);
  assert.equal(result.text, ''); assert.equal(result.toolRequests.length, 1);
  assert.equal(validators.AiOrderExplainRequestDraft(result.toolRequests[0]), true); assert.equal(result.toolRequests[0].input.orderId, 'order-1');
  assert.deepEqual(f.sent[0].tools[0].function.parameters, schema.AiOrderExplainInput); assert.equal(f.sent[0].parallel_tool_calls, false);
});
test('registered tool schema never enters a text-only request and unsolicited tools are rejected', async () => {
  const f = harness(response([call()]), { orderExplainTool: tool });
  await assert.rejects(f.adapter.generate(request([]), secret, connection), e => e.code === 'CAPABILITY_UNSUPPORTED'); assert.equal('tools' in f.sent[0], false);
});
for (const invalid of [call({ function: { name: 'unknown_tool', arguments: '{}' } }), call({ function: { name: tool.name, arguments: '{invalid' } }), call({ function: { name: tool.name, arguments: '{"orderId":"order-1","tenantId":"forged"}' } }), call({ function: { name: tool.name, arguments: '{"orderId":1}' } }), call({ function: { name: tool.name, arguments: 'x'.repeat(16001) } }), call({ id: 'https://evil.invalid' })]) test('unknown name, invalid JSON/schema/bounds/ID reject rather than inventing a tool DTO', async () => {
  const f = harness(response([invalid]), { orderExplainTool: tool }); await assert.rejects(f.adapter.generate(request(['tools']), secret, connection), e => e.code === 'INVALID_RESPONSE');
});
test('duplicate call IDs and too many requests cannot produce a candidate batch', async () => {
  for (const calls of [[call(), call()], Array(9).fill(call())]) {
    const f = harness(response(calls), { orderExplainTool: tool }); await assert.rejects(f.adapter.generate(request(['tools']), secret, connection), e => e.code === 'INVALID_RESPONSE');
  }
});
test('versions/names and arbitrary schema refs are not silently accepted at registration', () => {
  for (const options of [{ orderExplainTool: { ...tool, version: 'future' } }, { orderExplainTool: { ...tool, name: 'rental.order.explain' } }, { structuredOutput: { ...output, schema: { $ref: 'https://invalid.test/schema' } } }, { structuredOutput: { ...output, schema: { type: 'array', items: { type: 'string', maxLength: 100 } } } }, { structuredOutput: { ...output, schema: { type: 'object', properties: {}, additionalProperties: true } } }]) assert.throws(() => new ChatProtocolPolicy(options), e => e.code === 'CONFIG_INVALID');
});
test('structured output must pass the registered closed schema, no coercion or extra field removal', async () => {
  const f = harness(response(null, '{"summary":"Synthetic answer"}'), { structuredOutput: output });
  const result = await f.adapter.generate(request(['structuredOutput']), secret, connection);
  assert.deepEqual(result.structuredOutput, { summary: 'Synthetic answer' }); assert.equal(f.sent[0].response_format.json_schema.strict, true);
  for (const value of ['{"summary":5}', '{"summary":"x","approved":true}', '{bad', JSON.stringify({ summary: 'x'.repeat(201) })]) {
    const bad = harness(response(null, value), { structuredOutput: output }); await assert.rejects(bad.adapter.generate(request(['structuredOutput']), secret, connection), e => e.code === 'INVALID_RESPONSE');
  }
});
test('schema/body derived from a copied server policy, not later config mutation', async () => {
  const options = structuredClone({ orderExplainTool: tool }); const f = harness(response([call()]), options); options.orderExplainTool.name = 'evil';
  assert.equal((await f.adapter.generate(request(['tools']), secret, connection)).toolRequests[0].toolCode, 'rental.order.explain');
});
test('corrupt server schema registration is a redacted config error, not a native serialization error', () => {
  const cyclic = { type: 'object', properties: {}, additionalProperties: false }; cyclic.properties.self = cyclic;
  for (const options of [null, { structuredOutput: { name: 'bad', schema: undefined } }, { structuredOutput: { name: 'bad', schema: cyclic } }, { structuredOutput: { name: 'bad', schema: { type: 'number', const: 1n } } }, { structuredOutput: { name: 'bad', schema: { type: 'string', maxLength: 20, const: () => 'invalid' } } }]) {
    assert.throws(() => new ChatProtocolPolicy(options), e => e.code === 'CONFIG_INVALID' && e.message === 'CONFIG_INVALID');
  }
});
test('tool name and arguments fragmented across SSE frames are assembled only at valid termination', async () => {
  const chunks = [frame([{ index: 0, id: 'call_1', type: 'function', function: { name: 'rental_order_', arguments: '{"order' } }]), frame([{ index: 0, function: { name: 'explain_v1', arguments: 'Id":"order-1"}' } }]), frame(null, 'tool_calls'), done];
  const f = harness(chunks, { orderExplainTool: tool }), events = await stream(f, ['tools']);
  assert.equal(events.length, 1); assert.equal(events[0].kind, 'result'); assert.equal(validators.AiOrderExplainRequestDraft(events[0].result.toolRequests[0]), true);
});
for (const chunks of [
  [frame([{ index: 0, id: 'call_1', type: 'function', function: { name: tool.name, arguments: '{' } }]), frame(null, 'tool_calls'), done],
  [frame([{ index: 0, id: 'call_1', type: 'function', function: { name: tool.name, arguments: '{"orderId":"order-1"}' } }]), frame([{ index: 0, id: 'call_1' }]), frame(null, 'tool_calls'), done],
  [frame([{ index: 1, id: 'call_1', type: 'function', function: { name: tool.name, arguments: '{"orderId":"order-1"}' } }]), frame(null, 'tool_calls'), done],
  [frame([{ index: 0, id: 'call_1', type: 'function', function: { name: tool.name, arguments: '{"orderId":"order-1"}' } }]), frame(null, 'stop'), done],
]) test('truncated JSON, duplicate ID, sparse index and wrong terminal reject streamed tools', async () => {
  const f = harness(chunks, { orderExplainTool: tool }); await assert.rejects(stream(f, ['tools']), e => e.code === 'INVALID_RESPONSE');
});
test('stream structured fragments do not reach consumers before schema validation', async () => {
  const f = harness([text('{"summary":'), text('"Synthetic"}', 'stop'), done], { structuredOutput: output }), events = await stream(f, ['structuredOutput']);
  assert.deepEqual(events.map(e => e.kind), ['result']); assert.deepEqual(events[0].result.structuredOutput, { summary: 'Synthetic' });
});
test('actual pinned transport feeds tool fragments into the real Adapter candidate validator', async () => {
  const body = frame([{ index: 0, id: 'call_1', type: 'function', function: { name: tool.name, arguments: '{"orderId":' } }]) + frame([{ index: 0, function: { arguments: '"order-1"}' } }]) + frame(null, 'tool_calls') + done;
  const peer = egress.harness({ chunks: [Buffer.from(body.slice(0, 70)), Buffer.from(body.slice(70))] });
  const f = { adapter: new ChatCompletionsAdapter(new ModelEgressTransport(peer.dependencies), { orderExplainTool: tool }) };
  const events = await stream(f, ['tools']); assert.equal(events[0].result.toolRequests[0].input.orderId, 'order-1');
  assert.equal(peer.state.options[0].rejectUnauthorized, true); assert.equal(peer.state.timers.size, 0);
});
test('schema output and tool definitions cannot be supplied through forged model/request properties', async () => {
  const f = harness(response([call()]), { orderExplainTool: tool });
  const result = await f.adapter.generate({ ...request(['tools']), tools: [{ name: 'evil', endpoint: 'https://invalid.test' }], response_format: { type: 'text' } }, secret, connection);
  assert.equal(result.toolRequests[0].toolCode, 'rental.order.explain'); assert.equal(f.sent[0].tools[0].function.name, tool.name); assert.equal('response_format' in f.sent[0], false);
});
test('JSON-escaped credential echo in decoded arguments/output is rejected', async () => {
  const escaped = 'synthetic-\\u0073ecret';
  const f = harness(response([call({ function: { name: tool.name, arguments: '{"orderId":"' + escaped + '"}' } })]), { orderExplainTool: tool });
  await assert.rejects(f.adapter.generate(request(['tools']), secret, connection), e => e.code === 'INVALID_RESPONSE');
  const s = harness([text('{"summary":"' + escaped + '"}', 'stop'), done], { structuredOutput: output });
  await assert.rejects(stream(s, ['structuredOutput']), e => e.code === 'INVALID_RESPONSE');
});
test('multiple choices/refusal/truncation are never reported as a chosen successful response', async () => {
  for (const body of [JSON.stringify({ choices: [{ message: { content: 'one' }, finish_reason: 'stop' }, { message: { content: 'two' }, finish_reason: 'stop' }] }), JSON.stringify({ choices: [{ message: { content: 'no', refusal: 'refused' }, finish_reason: 'stop' }] })]) {
    const f = harness(body); await assert.rejects(f.adapter.generate(request([]), secret, connection), e => e.code === 'INVALID_RESPONSE');
  }
});
test('noEmit checks actual Adapter/decoder and public candidate type, no new shared DTO', () => {
  assert.deepEqual(compileConsumer('import { ChatCompletionsAdapter, ChatProtocolPolicy } from "../apps/api/src/modules/ai-native/chat-completions.adapter"; import type { AdapterResult } from "../apps/api/src/modules/ai-native/model-gateway.ports"; declare const result: AdapterResult; result.toolRequests?.[0].input.orderId; new ChatProtocolPolicy();'), []);
});
