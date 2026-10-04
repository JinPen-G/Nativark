'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { prepareGatewayTextIntent: prepare } = require('../apps/api/src/modules/ai-native/gateway-intent');
const policy = { sceneCode: 'order.explain', maxOutputTokens: 128 };
const intent = () => ({ draftVersion: 'ain-c03-draft-2', requestId: 'request-1', sceneCode: 'order.explain', messages: [{ role: 'user', content: [{ kind: 'text', text: 'first' }, { kind: 'text', text: ' second' }] }], requiredFeatures: ['text'], optionalFeatures: [], maxOutputTokens: 64 });
const reject = (code, body) => assert.throws(body, e => e.code === code);
test('text normalization preserves order without adding a provider, model or address', () => {
  const input = intent(), out = prepare(input, policy, 'invoke');
  assert.deepEqual(out.request, { callId: 'request-1', messages: [{ role: 'user', content: 'first second' }], maxOutputTokens: 64 });
  assert.deepEqual(out.requiredCapabilities, ['text']); assert.equal(out.sceneCode, policy.sceneCode);
  input.messages[0].content[0].text = 'changed'; assert.equal(out.request.messages[0].content, 'first second');
});
for (const field of ['model','provider','baseUrl','config','context','credentialRef','authorizedToolRequests']) test(`caller cannot inject ${field}`, () => {
  reject('INVALID_REQUEST', () => prepare({ ...intent(), [field]: 'injected' }, policy, 'invoke'));
});
for (const capability of ['tools','structured_output','image','audio','embedding','reasoning','streaming']) test(`unsupported required ${capability} fails closed`, () => {
  reject('CAPABILITY_UNSUPPORTED', () => prepare({ ...intent(), requiredFeatures: [capability] }, policy, 'invoke'));
});
test('optional capabilities are reported as omitted, never promoted to supported', () => {
  const out = prepare({ ...intent(), optionalFeatures: ['image','tools','reasoning'] }, policy, 'invoke');
  assert.deepEqual(out.omittedOptionalFeatures, ['image','tools','reasoning']); assert.deepEqual(out.requiredCapabilities, ['text']);
});
test('stream mode requires streaming even when the caller did not request it explicitly', () => {
  const out = prepare(intent(), policy, 'stream'); assert.deepEqual(out.requiredCapabilities, ['text','streaming']); assert.deepEqual(out.request.features, ['streaming']);
});
for (const kind of ['image','audio']) test(`${kind} payload is never silently dropped as an optional capability`, () => {
  const input = intent(); input.optionalFeatures = [kind]; input.messages[0].content.push({ kind, attachmentId: 'attachment-1', attachmentRevision: 1 });
  reject('CAPABILITY_UNSUPPORTED', () => prepare(input, policy, 'invoke'));
});
for (const change of [i => { i.requiredFeatures.push('text'); }, i => { i.optionalFeatures = ['text']; }, i => { i.optionalFeatures = ['tools','tools']; }, i => { i.draftVersion = 'wrong'; }, i => { i.messages[0].role = 'tool'; }, i => { i.messages[0].content = []; }, i => { i.messages[0].content[0].url = 'https://example.com'; }]) test('malformed or ambiguous public input is rejected', () => {
  const input = intent(); change(input); reject('INVALID_REQUEST', () => prepare(input, policy, 'invoke'));
});
test('server scene and token ceiling cannot be selected or raised by the caller', () => {
  reject('FORBIDDEN', () => prepare({ ...intent(), sceneCode: 'another.scene' }, policy, 'invoke'));
  reject('INVALID_REQUEST', () => prepare({ ...intent(), maxOutputTokens: 129 }, policy, 'invoke'));
});
test('combined text size is checked after concatenation', () => {
  const input = intent(); input.messages[0].content = [{ kind: 'text', text: 'a'.repeat(20000) }, { kind: 'text', text: 'b'.repeat(20000) }];
  reject('INVALID_REQUEST', () => prepare(input, policy, 'invoke'));
});
test('invalid server policy and invocation mode never produce a prepared request', () => {
  reject('CONFIG_INVALID', () => prepare(intent(), { ...policy, maxOutputTokens: 0 }, 'invoke'));
  reject('CONFIG_INVALID', () => prepare(intent(), policy, 'other'));
});
