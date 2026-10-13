'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { setup } = require('./fixtures/ai-native/order-facts.cjs');
const { PaymentRuntimeService } = require('../apps/api/src/modules/integrations/payment.runtime.service');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiOrderPaymentFactsService } = require('../apps/api/src/modules/ai-native/tools/order-payment-facts.service');
async function create() {
  const h = await setup(), queries = [], at = new Date('2026-10-07T00:00:00Z');
  h.state.user.permissions.push('rental-os:finance:view');
  const db = {
    rentalPaymentIntent: {
      findMany: async query => { queries.push(query); return [{ id: 'intent-a', instrument: 'rental', provider: 'stripe', method: 'stripe', amount: 0, currency: 'CNY', status: 'paid', expiresAt: at, paidAt: at, checkoutUrl: 'https://do-not-project.invalid', failureReason: 'internal' }]; },
      findFirst: async query => { queries.push(query); return { id: 'intent-a' }; }
    },
    rentalPaymentRefund: { findMany: async query => { queries.push(query); return ['accepted', 'funding_pending', 'succeeded', 'failed'].map((status, index) => ({ id: `refund-${index}`, paymentIntentId: 'intent-a', orderId: 'order-a', amount: 0, currency: 'CNY', status, createdAt: at, updatedAt: at, reason: 'private customer reason', externalRefundId: 'private-provider-id', failureReason: 'raw error' })); } }
  };
  const payments = new PaymentRuntimeService(db, {}, {});
  const routes = new AiBusinessReadRouteAuthority(h.guard, h.credentials);
  return { ...h, queries, payments, service: new AiOrderPaymentFactsService(payments, h.core, h.authority, routes) };
}
test('actual payment local read preserves paid/accepted/funding_pending/succeeded/failed and strips sensitive fields', async () => {
  const h = await create(), result = await h.service.read();
  assert.equal(result.intents[0].amount, 0); assert.equal(result.intents[0].status, 'paid');
  assert.deepEqual(result.refunds.map(row => row.status), ['accepted', 'funding_pending', 'succeeded', 'failed']);
  assert.equal(result.fundingLedger, 'not_loaded'); assert.equal(result.totals, 'not_computed');
  const text = JSON.stringify(result); for (const secret of ['checkoutUrl', 'failureReason', 'private customer reason', 'private-provider-id']) assert.equal(text.includes(secret), false);
  for (const query of h.queries) { assert.equal(query.where.tenantId, 'tenant-a'); assert.equal(query.where.workspaceId, 'workspace-a'); assert.equal(query.where.orderId, 'order-a'); }
  assert.deepEqual(h.queries.filter(query => query.take !== undefined).map(query => query.take), [21, 51]);
  for (const name of ['listPaymentIntentsPage', 'listPaymentRefundsPage']) {
    const unavailable = await create(); unavailable.payments[name] = undefined;
    // The original order authority deliberately masks dependency details.
    await assert.rejects(unavailable.service.read(), error => error.message === 'AI_ACCESS_DENIED');
    assert.equal(unavailable.queries.length, 0, 'no legacy query when either bounded capability is missing');
  }
});
test('ordinary order access does not grant finance read and cannot read any payment record', async () => {
  const h = await create(); h.state.user.permissions = ['rental-os:order:view'];
  await assert.rejects(h.service.read()); assert.equal(h.queries.length, 0);
});
