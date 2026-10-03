'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const h = require('./fixtures/ai-native/contract-consumer.cjs'); h.blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const shared = require('./fixtures/ai-native/local-shared.cjs');
const { AI_NATIVE_COMPONENT_SCHEMAS: base } = require('../apps/api/src/contracts/ai-native-schemas');
const { AI_LEAF_COMPONENT_SCHEMAS: published } = require('../apps/api/src/contracts/ai-leaf-components');
const { aiLeafToOpenApi30: convert } = require('../apps/api/src/contracts/ai-leaf-openapi');
const { OPENAPI_DOCUMENT, API_CONTRACT_OPERATIONS } = require('../apps/api/src/contracts/openapi-document');
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const raw = h.validatorsFor(shared.AI_ORDER_FACTS_DRAFT_SCHEMAS, base).AiOrderReadFactsDraft;
const wire = h.validatorsFor({ AiOrderReadFactsDraft: published.AiOrderReadFactsDraft }, base).AiOrderReadFactsDraft;
let output;
test.before(async () => { const f = await setup(); delete f.state.order.depositAmount; output = await f.reader.read(); });
test('actual guarded Core projection validates against both shared and OpenAPI schemas', () => {
  assert.equal(output.draftVersion, shared.AI_ORDER_FACTS_DRAFT_VERSION);
  assert.equal(raw(output), true, JSON.stringify(raw.errors)); assert.equal(wire(output), true, JSON.stringify(wire.errors));
  assert.equal(output.order.amounts.deposit, null); assert.deepEqual(published.AiOrderReadFactsDraft, OPENAPI_DOCUMENT.components.schemas.AiOrderReadFactsDraft);
  assert.ok(API_CONTRACT_OPERATIONS.every(r => !/\/ai(?:-native)?\//u.test(r.path)));
});
for (const change of [
  v => { v.draftVersion = 'future'; }, v => { v.audience = 'client'; }, v => { v.scope = { kind: 'platform' }; },
  v => { v.paymentEvidence = 'paid'; }, v => { v.historicalFeeEvidence = 'verified'; }, v => { v.order.effectiveEndBasis = 'guessed'; },
  v => { v.order.amounts.deposit = -1; }, v => { v.order.amounts.deposit = Infinity; }, v => { v.order.amounts.deposit = Number.MAX_SAFE_INTEGER + 1; },
  v => { delete v.order.amounts.deposit; }, v => { v.order.customerName = 'private'; }, v => { v.rawPrompt = 'private'; },
  v => { v.sources = []; }, v => { v.sources.push(v.sources[0]); }, v => { v.sources[0].basis = { kind: 'snapshot', version: 'invented' }; }
]) test('facts cannot invent evidence, widen audience or leak undeclared fields', () => {
  const v = structuredClone(output); change(v); assert.equal(raw(v), false); assert.equal(wire(v), false);
});
test('nullable amount preserves zero and finite Core values without conversion', () => {
  for (const value of [null, 0, 12.34, Number.MAX_SAFE_INTEGER]) {
    const v = structuredClone(output); v.order.amounts.deposit = value;
    assert.equal(raw(v), true); assert.equal(wire(v), true); assert.equal(v.order.amounts.deposit, value);
  }
});
test('nullable JSON Schema translates losslessly to OpenAPI without widening other unions', () => {
  const schema = { type: ['number', 'null'], minimum: 0, maximum: 100 }, before = JSON.stringify(schema);
  assert.deepEqual(convert(schema), { type: 'number', nullable: true, minimum: 0, maximum: 100 }); assert.equal(JSON.stringify(schema), before);
  for (const types of [['number','string'], ['null'], ['null','null'], ['number','null','string']]) assert.throws(() => convert({ type: types }));
});
test('shared entry supplies the one facts type and enforces incomplete evidence', () => {
  assert.deepEqual(h.compileConsumer(`import type { AiOrderReadFactsDraft } from '../packages/shared/src';
    declare const facts: AiOrderReadFactsDraft;
    facts.order.amounts.deposit = null;
    const audience: 'operator' | 'staff' = facts.audience;
    // @ts-expect-error this projection has not read payment evidence
    facts.paymentEvidence = 'paid';
    // @ts-expect-error full customer record is not exposed
    facts.order.customerName;
    // @ts-expect-error scope is workspace-only for this reader
    facts.scope = { kind: 'platform' };`), []);
});
