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
  const h = await setup(), out = await h.service.prepare({ question: 'payments', modelAvailability: 'unavailable' });
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
  changed.state.afterRead = async () => { if (++reads === 2) changed.state.order.updatedAt = '2026-10-09T00:00:00Z'; };
  await assert.rejects(changed.service.prepare());
});

test('limited questions avoid unused history and finance; exact claims cannot overwrite facts', async () => {
  const h = await orderSetup(); let historyReads = 0, paymentReads = 0;
  const history = h.reader.readHistoricalBasis.bind(h.reader);
  h.reader.readHistoricalBasis = (...args) => { historyReads++; return history(...args); };
  const { AiOrderExplanationFactsService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-facts.service');
  const { AiOrderExplanationPreparationService } = require('../apps/api/src/modules/ai-native/tools/order-explanation-preparation.service');
  const { AiOrderNextStepsService } = require('../apps/api/src/modules/ai-native/tools/order-next-steps.service');
  const facts = new AiOrderExplanationFactsService(h.authority, h.reader, { read: async () => { paymentReads++; throw Error('not configured'); } });
  const service = new AiOrderExplanationPreparationService(h.authority, facts, new AiOrderNextStepsService(h.authority, facts));
  const status = await service.prepare();
  assert.equal(status.payload.question, 'status'); assert.equal(status.payload.facts.amounts, undefined);
  assert.equal(status.payload.facts.payments, undefined); assert.equal(historyReads, 0); assert.equal(paymentReads, 0);
  await service.prepare({ question: 'fees' }); assert.equal(historyReads, 1); assert.equal(paymentReads, 0);
  await service.prepare({ question: 'payments' }); assert.equal(paymentReads, 1);
  const valid = await service.validateGenerated({ question: 'status', text: 'Untrusted prose, not approval',
    claims: [{ field: 'order.status', sourceId: 'order-a', value: status.payload.facts.order.value.status }] });
  assert.equal(valid.valid, true); assert.equal(valid.executionAllowed, false);
  const forged = await service.validateGenerated({ question: 'fees', text: 'Paid!',
    claims: [{ field: 'amounts.finalPayable', sourceId: 'other-order', value: 0 }] });
  assert.equal(forged.valid, false);
  await assert.rejects(service.prepare({ question: 'arbitrary_sql' }));
});
