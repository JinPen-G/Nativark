'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup: orderSetup } = require('./fixtures/ai-native/order-facts.cjs');
const { setup: businessSetup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
const { AiBusinessScenesModule, AI_BUSINESS_SCENES } = require('../apps/api/src/modules/ai-native/scenes/business-scenes.module');
async function setup() {
  const order = await orderSetup(), business = await businessSetup();
  return { order, business, tools: composeAiAuthorizedBusinessTools({ core: order.core, guard: order.guard,
    credentials: order.credentials, business: business.business, reports: business.reports, memberships: business.memberships }) };
}
test('scene request collects actual authorized minimal order material, without inventing a persisted request/task', async () => {
  const h = await setup();
  const input = { requestKey: 'original-1', orderId: 'order-a', question: 'status' };
  const result = await h.tools.scenes.prepareOrderExplanation(input);
  assert.equal(result.payload.status, 'prepared_not_persisted');
  assert.equal(result.payload.materials.payload.orderId, 'order-a');
  assert.equal(result.payload.materials.payload.facts.payments, undefined);
  assert.equal(result.payload.request.ownerId, h.order.state.user.id);
  assert.equal(result.payload.request.scope.workspaceId, 'workspace-a');
  assert.equal(result.payload.request.inputRef, undefined);
  assert.equal(result.payload.task.status, 'unavailable');
  assert.equal(result.payload.execution, 'not_attempted');
  assert.ok(Object.isFrozen(result.payload.request.body));
  const hash = result.payload.request.contentHash;
  input.question = 'payments';
  assert.equal(result.payload.request.body.question, 'status');
  assert.equal((await h.tools.scenes.prepareOrderExplanation({ ...input, question: 'status' })).payload.request.contentHash, hash);
});
test('request schema rejects caller authority and revocation cannot degrade to old facts', async () => {
  const h = await setup();
  await assert.rejects(() => h.tools.scenes.prepareOrderExplanation({ requestKey: 'r', orderId: 'order-a', question: 'status', creationAllowed: true }), e => e.code === 'INVALID_REQUEST');
  h.order.state.session = false;
  await assert.rejects(() => h.tools.scenes.prepareOrderExplanation({ requestKey: 'r', orderId: 'order-a', question: 'status' }), e => e.code === 'AI_ACCESS_DENIED');
});
test('opening request binds explicit sections and does not emit unselected configuration', async () => {
  const h = await businessSetup();
  const result = await h.tools.scenes.prepareOpeningDiagnosis({ requestKey: 'opening-1', sections: ['item_groups'] });
  assert.equal(result.payload.status, 'prepared_not_persisted');
  assert.deepEqual(result.payload.materials.sections.map(row => row.key), ['item_groups']);
  assert.equal(result.payload.materials.configuration.pricing, undefined);
  assert.equal(result.payload.materials.configuration.fulfillment, undefined);
  assert.equal(result.payload.materials.configuration.products.rows.length > 0, true);
  assert.equal(result.payload.task.status, 'unavailable');
  await assert.rejects(() => h.tools.scenes.prepareOpeningDiagnosis({ requestKey: 'r', sections: ['arbitrary.path'] }), e => e.code === 'INVALID_REQUEST');
  await assert.rejects(() => h.tools.scenes.prepareOpeningDiagnosis({ requestKey: 'r', sections: ['item_groups', 'item_groups'] }), e => e.code === 'INVALID_REQUEST');
});
test('quote scene consumes actual clarification without creating a quote or treating IDs as approval', async () => {
  const h = await businessSetup();
  h.business.createQuote = () => { throw Error('preparation must not save a quote'); };
  const result = await h.tools.scenes.prepareQuoteClarification({ requestKey: 'quote-original-1', candidate: { customerType: 'personal' } });
  assert.equal(result.payload.materials.payload.facts.status, 'missing_input');
  assert.equal(result.payload.humanSelection, 'not_attested');
  assert.equal(result.payload.quotation, 'not_created');
  assert.equal(result.payload.orderApproval, 'not_granted');
  await assert.rejects(() => h.tools.scenes.prepareQuoteClarification({ requestKey: 'r', candidate: { customerType: 'personal', payableAmount: 0 } }), e => e.code === 'INVALID_REQUEST');
});
test('opt-in module provider composes actual services but import/registration performs no read or action', async () => {
  const order = await orderSetup(), business = await businessSetup();
  let calls = 0;
  const guard = { canActivate: async () => { calls++; throw Error('unavailable current authority'); } };
  const module = AiBusinessScenesModule.register({ core: order.core, guard, credentials: order.credentials,
    business: business.business, reports: business.reports, memberships: business.memberships });
  const provider = module.providers.find(row => row.provide === AI_BUSINESS_SCENES);
  const application = provider.useFactory();
  assert.equal(calls, 0); assert.deepEqual(order.state.reads, []);
  assert.equal(application.orderActions.availability, 'unavailable');
  await assert.rejects(() => application.scenes.prepareOrderExplanation({ requestKey: 'r', orderId: 'order-a', question: 'status' }), e => e.code === 'AI_ACCESS_DENIED');
  assert.equal(calls, 1); assert.deepEqual(order.state.reads, []);
  assert.equal(module.controllers, undefined);
});
