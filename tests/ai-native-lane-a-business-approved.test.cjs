'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { composeAiBusinessOrderApplication } = require('../apps/api/src/modules/ai-native/scenes/business-order-application');
const { businessApprovedHarness } = require('./fixtures/ai-native/lane-a-business-approved.cjs');
test('business scene consumes actual persisted approval/Core transaction and projects only its committed resource', async () => {
  const h = await businessApprovedHarness(), application = composeAiBusinessOrderApplication(h.deps);
  const pending = await application.prepare(h.prepareCommand);
  assert.equal(h.state.records.aiApproval.length, 0); assert.equal(h.state.records.rentalOrder.length, 0);
  const command = await h.approve(pending);
  const first = await application.submit(command);
  assert.equal(first.status, 'committed'); assert.equal(first.payment, 'not_inferred'); assert.equal(first.fulfillment, 'not_inferred');
  assert.deepEqual(Object.keys(first.order).sort(), ['id', 'quoteId', 'status']);
  const replay = await application.reconcile(command);
  assert.equal(replay.status, 'committed'); assert.equal(replay.replayed, true); assert.equal(replay.order.id, first.order.id);
  assert.equal(h.state.records.rentalOrder.length, 1);
});
test('missing dependencies cannot prepare, submit or reconcile a business operation', async () => {
  const application = composeAiBusinessOrderApplication();
  assert.equal(application.availability, 'unavailable');
  for (const method of ['prepare', 'submit', 'reconcile']) await assert.rejects(async () => application[method]({}), e => e.code === 'AI_RESOURCE_UNAVAILABLE');
});
test('unknown commit remains reconcile-only and is never automatically resubmitted', async () => {
  const h = await businessApprovedHarness(), application = composeAiBusinessOrderApplication(h.deps);
  const command = await h.approve(await application.prepare(h.prepareCommand));
  h.state.failAt = 'core.inventory';
  const result = await application.submit(command);
  assert.equal(result.status, 'unknown'); assert.equal(result.retryable, false); assert.equal(result.nextAction, 'reconcile');
  assert.equal(result.order, undefined); assert.equal(h.state.records.rentalOrder.length, 0);
});
