'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
test('actual order pack produces inventory candidates, never execution permission or guessed navigation', async () => {
  const h = await setup(), facts = new AiOrderExplanationFactsService(h.authority, h.reader);
  const out = await new AiOrderNextStepsService(h.authority, facts).read();
  assert.equal(out.allowedActions, 'unavailable'); assert.ok(out.candidates.some(row => row.code === 'rental.order.explain'));
  assert.ok(out.candidates.every(row => row.executable === false)); assert.equal(out.manual.orderId, 'order-a');
  assert.equal('url' in out.manual, false); assert.equal(out.candidates.some(row => row.code.includes('refund')), false);
});
test('revoked order reader cannot obtain next-step candidates or manual reference', async () => {
  const h = await setup(); h.state.user.permissions = [];
  await assert.rejects(new AiOrderNextStepsService(h.authority, new AiOrderExplanationFactsService(h.authority, h.reader)).read());
});
