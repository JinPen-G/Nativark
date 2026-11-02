const assert = require('node:assert/strict');
const { test } = require('node:test');
const { of, lastValueFrom } = require('rxjs');
const { PaymentRuntimeService, PaymentProviderUnknownError, PaymentProviderDefinitiveError } = require('../apps/api/dist/modules/integrations/payment.runtime.service.js');
const { PaymentWebhookController } = require('../apps/api/dist/modules/integrations/payment-webhook.controller.js');
const { RequestIdInterceptor } = require('../apps/api/dist/common/request-id.interceptor.js');

const originalIntent = () => ({ id: 'i', tenantId: 't', workspaceId: 'w', orderId: 'o', provider: 'stripe', method: 'stripe',
  merchantOrderNo: 'RO-original', currency: 'USD', amount: 10, status: 'pending', expiresAt: new Date(0),
  responseJson: { sessionId: 'cs_original' }, createdAt: new Date(), updatedAt: new Date() });
const config = { provider: 'stripe', capability: 'payment', settings: {}, credentials: {} };
const integrations = { runtimeConfig: async () => config };

function paymentFixture() {
  const intent = originalIntent(), writes = [];
  const prisma = { rentalPaymentIntent: {
    findUnique: async () => null,
    findFirst: async () => intent,
    findMany: async () => [intent],
    updateMany: async ({ where, data }) => {
      if (where.status !== intent.status) return { count: 0 };
      writes.push(data); Object.assign(intent, data); return { count: 1 };
    }
  }, $transaction: async () => ({ intent, orderNo: 'ORDER', amount: 10, replayed: false }) };
  const service = new PaymentRuntimeService(prisma, integrations, {});
  service.log = async () => undefined;
  return { service, intent, writes };
}

test('successful provider create followed by local log failure retains original pending receipt', async () => {
  const { service, intent } = paymentFixture();
  service.createStripeIntent = async () => ({ checkoutUrl: 'https://example.invalid/checkout', responseJson: { sessionId: 'cs_original' }, responseCode: '200' });
  service.log = async () => { throw Error('log unavailable'); };
  await assert.rejects(service.createPaymentIntent('t', 'w', 'o', { method: 'stripe', instrument: 'rental', idempotencyKey: 'k' }), PaymentProviderUnknownError);
  assert.equal(intent.status, 'pending');
  assert.equal(intent.responseJson.sessionId, 'cs_original');
  assert.ok(intent.checkoutUrl);
});

test('expiry retains pending on close failure, and callback success wins the close CAS', async () => {
  const f = paymentFixture();
  f.service.queryStripeIntent = async () => ({ paid: false, closed: false, state: 'open' });
  f.service.closeStripeIntent = async () => { throw new Error('HTTP 400: already completed'); };
  const failed = await f.service.expireStalePaymentIntents('t', 'w');
  assert.equal(failed.closed, 0); assert.equal(failed.errors.length, 1);
  assert.equal(f.intent.status, 'pending'); assert.deepEqual(f.writes, []);
  f.service.closeStripeIntent = async () => { f.intent.status = 'paid'; };
  const raced = await f.service.expireStalePaymentIntents('t', 'w');
  assert.equal(raced.closed, 0); assert.equal(f.intent.status, 'paid');
});

test('already verified or funding-failed payments cannot be closed', async () => {
  for (const status of ['paid', 'verified_pending_funding', 'funding_failed']) {
    const f = paymentFixture(); f.intent.status = status;
    f.service.closeStripeIntent = async () => { throw Error('must not call provider'); };
    await assert.rejects(f.service.closePaymentIntent('t', 'w', 'o', 'i'), error => error.status === 409);
    assert.equal(f.intent.status, status); assert.deepEqual(f.writes, []);
  }
});

test('Stripe close requires an exact live expired original session and propagates rejection', async () => {
  const f = paymentFixture();
  for (const response of [{}, { id: 'other', livemode: true, status: 'expired' },
    { id: 'cs_original', livemode: false, status: 'expired' },
    { id: 'cs_original', livemode: true, status: 'complete', payment_status: 'paid' }]) {
    f.service.stripeRequest = async () => response;
    await assert.rejects(f.service.closeStripeIntent(config, f.intent), PaymentProviderUnknownError);
  }
  f.service.stripeRequest = async () => { throw Error('HTTP 404'); };
  await assert.rejects(f.service.closeStripeIntent(config, f.intent), /HTTP 404/);
  f.service.stripeRequest = async () => ({ id: 'cs_original', livemode: true, status: 'expired', payment_status: 'unpaid' });
  await f.service.closeStripeIntent(config, f.intent);
  await assert.rejects(f.service.closeStripeIntent(config, { ...f.intent, responseJson: {} }), PaymentProviderUnknownError);
});

test('refund query errors never become definitive submission failure or release occupied refund', async () => {
  for (const error of [new Error('HTTP 401'), new Error('HTTP 404'),
    new PaymentProviderDefinitiveError('REFUND_NOT_FOUND', 'old classification')]) {
    const refund = { id: 'r', tenantId: 't', workspaceId: 'w', orderId: 'o', paymentIntentId: 'i', revision: 1,
      amount: 10, provider: 'stripe', method: 'stripe', currency: 'USD', status: 'accepted',
      merchantRefundNo: 'RR-original', createdAt: new Date(0), updatedAt: new Date(), fundedAt: null };
    const prisma = { rentalPaymentRefund: {
      findFirst: async () => refund,
      updateMany: async ({ where, data }) => {
        assert.deepEqual(where.status.in, ['pending', 'accepted']);
        Object.assign(refund, { ...data, revision: refund.revision + 1 }); return { count: 1 };
      }
    } };
    const service = new PaymentRuntimeService(prisma, integrations, {});
    service.requirePaymentIntent = async () => originalIntent();
    service.confirmedRefundTotal = async () => 0;
    service.queryProviderRefund = async () => { throw error; };
    service.log = async () => undefined;
    const result = await service.refreshPaymentRefund('t', 'w', 'o', 'i', 'r');
    assert.equal(result.status, 'pending'); assert.equal(refund.status, 'pending');
    assert.equal(refund.merchantRefundNo, 'RR-original');
  }
});

test('expired pending and verified funding-failed original payments block another operation before provider dispatch', async () => {
  for (const status of ['pending', 'verified_pending_funding', 'funding_failed']) {
    const intent = { ...originalIntent(), status }, trace = [];
    const prisma = { rentalPaymentIntent: {
      findUnique: async () => null,
      findFirst: async ({ where }) => { assert.ok(where.status.in.includes(status)); assert.equal(where.expiresAt, undefined); return intent; },
      create: async () => { assert.fail('must not create another local payment'); }
    }, $queryRaw: async () => [{ id: 'o', orderNo: 'ORDER', currency: 'USD', finalPayableAmount: 10 }] };
    prisma.$transaction = async work => work(prisma);
    const service = new PaymentRuntimeService(prisma, { runtimeConfig: async () => config,
      assertEnabledInTransaction: async () => { trace.push('current-config'); } }, {
      listEvents: async () => ({ rental: { balance: 10, pendingExtensionAmount: 0 } })
    });
    service.createStripeIntent = async () => { assert.fail('must not dispatch another provider payment'); };
    await assert.rejects(service.createPaymentIntent('t', 'w', 'o', {
      method: 'stripe', instrument: 'rental', idempotencyKey: 'different-operation'
    }), error => error.status === 409 && /待核对或待入账/.test(error.message));
    assert.deepEqual(trace, ['current-config']); assert.equal(intent.status, status);
  }
});

test('webhook response survives the actual global interceptor without an API envelope', async () => {
  const interceptor = new RequestIdInterceptor();
  for (const [name, value] of [['alipay', 'success'], ['alipayRefund', 'success'],
    ['wechatPay', { code: 'SUCCESS', message: '成功' }], ['wechatRefund', { code: 'SUCCESS', message: '成功' }], ['stripe', { received: true }]]) {
    const headers = {}, request = { url: `/api/payments/webhooks/${name}`, headers: {} };
    const context = { getHandler: () => PaymentWebhookController.prototype[name], switchToHttp: () => ({
      getRequest: () => request, getResponse: () => ({ setHeader: (k, v) => { headers[k] = v; } })
    }) };
    assert.deepEqual(await lastValueFrom(interceptor.intercept(context, { handle: () => of(value) })), value);
    assert.ok(headers['x-request-id']);
  }
  const request = { url: '/api/normal', headers: {} };
  const context = { getHandler: () => function ordinary() {}, switchToHttp: () => ({ getRequest: () => request,
    getResponse: () => ({ setHeader: () => undefined }) }) };
  assert.equal((await lastValueFrom(interceptor.intercept(context, { handle: () => of('success') }))).data, 'success');
});
