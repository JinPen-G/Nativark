'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup: orderSetup } = require('./fixtures/ai-native/order-facts.cjs');
const { setup: businessSetup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
async function setup() {
  const order = await orderSetup(), business = await businessSetup();
  const tools = composeAiAuthorizedBusinessTools({ core: order.core, guard: order.guard, credentials: order.credentials,
    business: business.business, reports: business.reports, memberships: business.memberships });
  return { ...order, service: tools.orderExplanationPreparation('order-a') };
}
test('actual order consumer produces immutable sourced facts and manual handoff with no model answer', async () => {
  const h = await setup(), out = await h.service.prepare({ modelAvailability: 'unavailable' });
  assert.equal(out.payload.facts.order.value.id, 'order-a');
  assert.equal(out.payload.status, 'facts_only'); assert.equal(out.payload.model.answer, 'not_generated');
  assert.equal(out.payload.facts.payments.coverage, 'unavailable');
  assert.equal(out.payload.handoff.resource.orderId, 'order-a');
  assert.equal(out.payload.handoff.operatorRouteKey, 'APP_ROUTES.orderDetail');
  assert.equal(out.payload.handoff.execution, 'not_attempted');
  assert.equal(out.payloadFingerprint, requestFingerprint(out.payload));
  assert.ok(Object.isFrozen(out.payload.facts.order.value));
  assert.throws(() => { out.payload.facts.order.value.id = 'other-order'; }, TypeError);
});
test('model-unavailable fallback never hides order revocation or version changes', async () => {
  const h = await setup(); h.state.user.permissions = [];
  await assert.rejects(h.service.prepare({ modelAvailability: 'unavailable' }));
  const changed = await setup(); let reads = 0;
  changed.state.afterRead = async () => { if (++reads === 4) changed.state.order.updatedAt = '2026-10-09T00:00:00Z'; };
  await assert.rejects(changed.service.prepare());
});
