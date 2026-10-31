'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const { Prisma } = require('@prisma/client');
const { receivableFixture } = require('./helpers/order-receivable-fixture.cjs');
const { PaymentRuntimeService } = require('../apps/api/src/modules/integrations/payment.runtime.service');
const { RentalFundingService } = require('../apps/api/src/modules/rental-core/rental-funding.service');
const { StaffOfflinePaymentService } = require('../apps/api/src/modules/rental-core/staff-offline-payment.service');
const { renderRentalDocument } = require('../apps/api/src/modules/rental-core/rental-document-renderer');
const balance = f => f.funding.listEvents(f.tenantId, f.workspaceId, f.orderId, f.db, { realOnly: true });
const refund = (f, amount, key) => f.funding.recordEvent(f.tenantId, f.workspaceId, f.orderId, f.cashInput(amount, key, 'refund'));
const runtime = f => new PaymentRuntimeService(f.db, {
  runtimeConfig: async () => ({ provider: 'alipay', capability: 'payment', revision: 1, settings: {}, credentials: {} }),
  assertEnabledInTransaction: async () => undefined
}, f.funding);

test('settled debt consumes late cash atomically, without a second corporate income or replay allocation', async () => {
  const f = receivableFixture(); await f.seedDebt();
  const original = await f.payCash(100), rowCount = f.db.rows.length;
  assert.equal(f.debt(), 0);
  assert.equal((await balance(f)).rental.collected, 100);
  assert.equal((await balance(f)).rental.corporatePaid, 0);
  assert.equal((await balance(f)).rental.due, 0);
  assert.equal(f.db.rows.filter(row => row.entryType === 'payment').length, 0);
  const adjustment = f.db.rows.find(row => row.idempotencyKey.startsWith('order.cash.reconcile:'));
  assert.equal(Number(adjustment.receivableDelta), -100); assert.equal(Number(adjustment.reservedDelta), 0);
  const replay = await f.payCash(100);
  assert.equal(replay.id, original.id); assert.equal(f.db.events.length, 1); assert.equal(f.db.rows.length, rowCount);
  await assert.rejects(f.payCash(101), /不同金额/);
  await f.inScope(() => assert.rejects(f.corporate.recordPayment(f.tenantId, f.customerId,
    { amount: 100, reason: 'duplicate collection', idempotencyKey: 'new-corporate' }), /不能超过企业当前应收/));
});

test('corporate repayment clears funding due and blocks new online/offline/guarantee collections', async () => {
  const f = receivableFixture(); await f.seedDebt(); await f.payCorporate(100);
  const result = await balance(f);
  assert.equal(result.rental.collected, 0); assert.equal(result.rental.corporatePaid, 100);
  assert.equal(result.rental.balance, 0); assert.equal(result.rental.due, 0);
  assert.equal(f.db.rows.filter(row => row.entryType === 'payment').reduce((sum, row) => sum + Number(row.amount), 0), 100);
  await f.funding.assertPaid(f.tenantId, f.workspaceId, f.orderId, f.db);
  await f.funding.assertReadyToClose(f.tenantId, f.workspaceId, f.orderId, f.db, { skipRentalPayment: true });
  const service = runtime(f); let dispatched = 0;
  service.createAlipayIntent = async () => { dispatched++; throw Error('must not dispatch'); };
  await assert.rejects(service.createPaymentIntent(f.tenantId, f.workspaceId, f.orderId,
    { method: 'alipay', instrument: 'rental', idempotencyKey: 'new-online' }), /没有待支付/);
  assert.equal(dispatched, 0); assert.equal(f.db.intents.length, 0);
  const staff = new StaffOfflinePaymentService(f.db, f.funding, { resolveOfflinePaymentMethod: (_tenant, method) => method });
  const query = f.db.$queryRaw;
  f.db.$queryRaw = async (sql, ...values) => query(Array.isArray(sql) ? Prisma.sql(sql, ...values) : sql);
  await assert.rejects(staff.register(f.tenantId, f.workspaceId, 'operator', 'Operator', { orderId: f.orderId,
    instrument: 'rental', amount: 1, paymentMethod: 'offline_cash', idempotencyKey: 'new-registration', reason: 'additional payment' },
    { mode: 'all', locationIds: [] }), /超过当前可收金额/);
  assert.equal(f.db.registrations.length, 0);
  f.db.registrations.push({ id: 'registration', tenantId: f.tenantId, workspaceId: f.workspaceId, orderId: f.orderId,
    status: 'pending', instrument: 'rental', amount: f.money(1), paymentMethod: 'offline_cash' });
  await assert.rejects(f.funding.recordEvent(f.tenantId, f.workspaceId, f.orderId, { instrument: 'rental', action: 'initiate',
    amount: 1, provider: 'offline', offlineRegistrationId: 'registration', allowPartialInitiate: true,
    paymentMethod: 'offline_cash', idempotencyKey: 'staff-offline:registration', reason: 'original registration' }, 'operator', f.db), /超过订单/);
  f.db.events.push({ id: 'held', tenantId: f.tenantId, workspaceId: f.workspaceId, orderId: f.orderId,
    instrument: 'deposit', action: 'initiate', amount: f.money(100), balanceAfter: f.money(100), provider: 'alipay',
    idempotencyKey: 'original-held', reason: 'held', at: new Date(), createdAt: new Date() });
  const context = f.funding.loadBalanceContext.bind(f.funding);
  // Isolate the arithmetic veto from the (also enforced) no-mock-with-real-
  // repayment veto; this does not prove a real capture adapter exists.
  f.funding.loadBalanceContext = async (...args) => ({ ...await context(...args), simulationAllowed: true });
  await assert.rejects(f.funding.recordEvent(f.tenantId, f.workspaceId, f.orderId, { instrument: 'deposit', action: 'capture',
    amount: 1, provider: 'mock', idempotencyKey: 'capture', reason: 'simulation gate only' }), /不能超过尚未支付/);
  assert.equal(f.db.events.length, 1);
});

test('partial cash and corporate allocations reconcile in both arrival orders; verified refunds restore only unpaid debt', async () => {
  for (const corporateFirst of [false, true]) {
    const f = receivableFixture(); await f.seedDebt();
    if (corporateFirst) { await f.payCorporate(60); await f.payCash(40); }
    else { await f.payCash(40); await f.payCorporate(60); }
    assert.equal(f.debt(), 0);
    let current = await balance(f);
    assert.equal(current.rental.collected, 40); assert.equal(current.rental.corporatePaid, 60); assert.equal(current.rental.balance, 0);
    await refund(f, 20, 'original-refund');
    assert.equal(f.debt(), 20);
    current = await balance(f); assert.equal(current.rental.refunded, 20); assert.equal(current.rental.due, 20);
    const count = f.db.rows.length;
    await refund(f, 20, 'original-refund'); assert.equal(f.db.rows.length, count); assert.equal(f.debt(), 20);
    await f.payCorporate(20); assert.equal(f.debt(), 0); assert.equal((await balance(f)).rental.due, 0);
  }
});

test('corporate-paid then late cash remains visible as overpayment, blocks credit close, and refunds only original cash', async () => {
  const f = receivableFixture(); await f.seedDebt(); await f.payCorporate(100); await f.payCash(100);
  assert.equal(f.debt(), 0); assert.equal((await balance(f)).rental.balance, -100);
  await assert.rejects(f.funding.assertReadyToClose(f.tenantId, f.workspaceId, f.orderId, f.db, { skipRentalPayment: true }), /尚有退款 100/);
  await refund(f, 100, 'return-late-cash');
  assert.equal(f.debt(), 0); assert.equal((await balance(f)).rental.balance, 0);
  await f.funding.assertReadyToClose(f.tenantId, f.workspaceId, f.orderId, f.db, { skipRentalPayment: true });
  f.order.finalPayableAmount = f.money(50);
  const held = await f.funding.computeHeldFunds(f.tenantId, f.workspaceId, f.orderId, f.db, 50);
  assert.equal(held.rentalOverpaid, -50, 'corporate overpayment is still an unresolved obligation, not pretend cash');
  f.db.intents.push({ id: 'paid-intent', tenantId: f.tenantId, workspaceId: f.workspaceId, orderId: f.orderId,
    status: 'paid', externalTransactionId: 'transaction-original', provider: 'alipay', method: 'alipay', amount: f.money(100), currency: 'CNY' });
  const service = runtime(f); let dispatched = 0;
  service.submitProviderRefund = async () => { dispatched++; throw Error('must not refund corporate money through cash rail'); };
  await assert.rejects(service.createPaymentRefund(f.tenantId, f.workspaceId, f.orderId, 'paid-intent',
    { amount: 50, reason: 'corporate surplus', idempotencyKey: 'wrong-rail' }), /最多可退.*0\.00/);
  assert.equal(dispatched, 0); assert.equal(f.db.refunds.length, 0);
});

test('cash before original final settlement creates no early debt and refunds cannot invent credit reservation', async () => {
  const f = receivableFixture();
  await f.corporate.reserveOrderCredit(f.tenantId, f.orderId, f.db);
  await f.payCash(60); await refund(f, 20, 'before-settlement-refund');
  assert.equal(f.debt(), 0);
  assert.equal(f.db.rows.reduce((sum, row) => sum + Number(row.reservedDelta), 0), 100);
  assert.ok(f.db.rows.filter(row => row.entryType === 'adjust').every(row => Number(row.receivableDelta) === 0));
  await f.corporate.settleOrderCredit(f.tenantId, f.orderId, f.db);
  assert.equal(f.debt(), 60); assert.equal(f.db.rows.reduce((sum, row) => sum + Number(row.reservedDelta), 0), 0);
});

test('cash/credit commit failure rolls back both facts; original provider receipt stays funding_failed and recovers by its key', async () => {
  const f = receivableFixture(); await f.seedDebt();
  f.db.intents.push({ id: 'original-intent', tenantId: f.tenantId, workspaceId: f.workspaceId, orderId: f.orderId,
    provider: 'alipay', method: 'alipay', status: 'pending', amount: f.money(100) });
  const service = runtime(f), input = { tenantId: f.tenantId, provider: 'alipay', eventId: 'original-event',
    externalTransactionId: 'original-transaction', intentId: 'original-intent', amount: 100, payloadHash: 'original-hash' };
  f.db.failLedgerCreate = true;
  await assert.rejects(service.settleVerifiedPayment(input), /credit ledger unavailable/);
  assert.equal(f.db.events.length, 0); assert.equal(f.debt(), 100); assert.equal(f.db.webhooks.length, 0);
  assert.equal(f.db.intents[0].status, 'funding_failed');
  f.db.failLedgerCreate = false;
  await service.settleVerifiedPayment(input);
  assert.equal(f.db.events.length, 1); assert.equal(f.db.events[0].idempotencyKey, 'payment:original-intent');
  assert.equal(f.debt(), 0); assert.equal(f.db.intents[0].status, 'paid');
  const count = f.db.rows.length; await service.settleVerifiedPayment(input);
  assert.equal(f.db.events.length, 1); assert.equal(f.db.rows.length, count);
});

test('original allocation basis rejects missing parents, altered scopes/currency, malformed confirmed payer and historical discrepancy', async () => {
  for (const alter of [
    f => { f.db.rows = f.db.rows.filter(row => row.entryType !== 'payment'); },
    f => { f.db.rows.find(row => row.entryType === 'payment_allocation').workspaceId = 'foreign'; },
    f => { f.db.rows.find(row => row.entryType === 'payment_allocation').currency = 'USD'; },
    f => { f.db.rows.find(row => row.entryType === 'payment').amount = f.money(101); },
    f => { f.order.membershipSnapshot.settlement.payerCustomerId = 'other'; },
    f => { f.order.contractSubjectCustomerId = 'other'; }
  ]) {
    const f = receivableFixture(); await f.seedDebt(); await f.payCorporate(100); alter(f);
    await assert.rejects(balance(f), error => error.status === 409);
    const count = f.db.rows.length;
    await assert.rejects(f.payCash(100), error => error.status === 409);
    assert.equal(f.db.events.length, 0); assert.equal(f.db.rows.length, count);
  }
  const f = receivableFixture(); await f.seedDebt();
  f.db.rows.find(row => row.entryType === 'settle').receivableDelta = f.money(90);
  await assert.rejects(f.payCash(100), /结算收据|到账前实收/); assert.equal(f.db.events.length, 0);
  const unavailable = new RentalFundingService(f.db);
  await assert.rejects(unavailable.listEvents(f.tenantId, f.workspaceId, f.orderId), /应收投影不可用/);
});

test('multi-order payment validates all aggregate legs, locks stable original orders, and replay ignores newly added debt orders', async () => {
  const f = receivableFixture(); await f.seedDebt();
  const other = { ...f.order, id: 'order-z' }; f.db.orders.set(other.id, other);
  f.db.rows.push({ ...f.db.rows.find(row => row.entryType === 'settle'), id: 'other-debt', orderId: other.id,
    amount: f.money(50), reservedDelta: f.money(0), receivableDelta: f.money(50), idempotencyKey: 'other-debt' });
  await f.payCorporate(130);
  assert.equal((await balance(f)).rental.corporatePaid, 100);
  const firstLocks = f.db.trace.filter(row => row.sql.includes('SELECT id FROM rental_orders')).map(row => row.values[2]);
  assert.deepEqual(firstLocks, ['order', 'order-z']);
  const parent = f.db.rows.find(row => row.entryType === 'payment');
  const otherLeg = f.db.rows.find(row => row.idempotencyKey === `payment.allocation:${createHash('sha256').update(`${parent.idempotencyKey}:order-z`).digest('hex')}`);
  otherLeg.amount = f.money(29);
  await assert.rejects(balance(f), /全部核销金额不一致/); otherLeg.amount = f.money(30);
  // Later debt is not reallocated by replaying the already committed payment.
  f.db.rows.push({ ...f.db.rows.find(row => row.entryType === 'settle'), id: 'later', orderId: 'later-missing-order',
    amount: f.money(5), receivableDelta: f.money(5), reservedDelta: f.money(0), idempotencyKey: 'later' });
  f.db.trace = []; const count = f.db.rows.length;
  await f.inScope(() => f.corporate.recordPayment(f.tenantId, f.customerId,
    { amount: 130, reason: parent.reason, idempotencyKey: parent.idempotencyKey }));
  assert.equal(f.db.rows.length, count);
  assert.ok(!f.db.trace.some(row => row.sql.includes('FROM rental_orders')));
});

test('cash readers use current facts after order lock even when a caller established an older repeatable-read snapshot', async () => {
  const f = receivableFixture(); await f.seedDebt(); await f.payCash(40);
  f.db.rentalFundingEvent.findMany = async () => []; // Explicit stale ordinary read.
  assert.equal(await f.funding.netCashPaid(f.tenantId, f.workspaceId, f.orderId, f.db), 40);
  assert.equal((await balance(f)).rental.due, 60);
  await f.payCash(60, 'second-cash'); assert.equal(f.debt(), 0);
  await f.funding.assertPaid(f.tenantId, f.workspaceId, f.orderId, f.db);
  assert.equal(f.db.events.length, 2);
  assert.ok(f.db.trace.some(row => row.sql.includes('FROM rental_funding_events') && row.sql.includes('LOCK IN SHARE MODE')));
});

test('real corporate allocations disable simulated cash and guarantees in development, and original cash replay stays independent of later damaged credit', async () => {
  const f = receivableFixture(); await f.seedDebt(); await f.payCorporate(100);
  f.db.businessWorkspace.findFirst = async () => ({ id: f.workspaceId, runMode: 'development' });
  const originalQuery = f.db.$queryRaw;
  f.db.$queryRaw = async query => query.sql.includes('FROM business_workspaces') ? [{ runMode: 'development' }] : originalQuery(query);
  f.db.events.push({ id: 'simulated-security', tenantId: f.tenantId, workspaceId: f.workspaceId, orderId: f.orderId,
    instrument: 'deposit', action: 'initiate', amount: f.money(100), balanceAfter: f.money(100), provider: 'mock',
    idempotencyKey: 'demo-security', reason: 'simulation', at: new Date(), createdAt: new Date() });
  f.order.depositAmount = f.money(100);
  const current = await f.funding.listEvents(f.tenantId, f.workspaceId, f.orderId);
  assert.equal(current.simulationAllowed, false); assert.equal(current.balanceBasis, 'real');
  assert.equal(current.deposit.balance, 0); assert.equal(current.rental.corporatePaid, 100);
  await assert.rejects(f.funding.assertReadyForPickup(f.tenantId, f.workspaceId, f.orderId, f.db, { skipRentalPayment: true }), /足额收取押金/);
  await assert.rejects(f.funding.recordEvent(f.tenantId, f.workspaceId, f.orderId,
    { instrument: 'deposit', action: 'refund', amount: 100, provider: 'mock', idempotencyKey: 'demo-refund', reason: 'simulation' }), /模拟资金仅限/);
  const paid = receivableFixture(); await paid.seedDebt(); const receipt = await paid.payCash(100);
  paid.order.membershipSnapshot.settlement.payerCustomerId = 'changed-payer';
  const replay = await paid.payCash(100);
  assert.equal(replay.id, receipt.id); assert.equal(paid.db.events.length, 1);
  await assert.rejects(balance(paid), error => error.status === 409);
});

test('legacy offline cash requires its original confirmation; missing or stale evidence cannot become unpaid corporate debt', async () => {
  const f = receivableFixture(); await f.seedDebt();
  f.db.events.push({ id: 'legacy-offline', tenantId: f.tenantId, workspaceId: f.workspaceId, orderId: f.orderId,
    instrument: 'rental', action: 'initiate', amount: f.money(40), balanceAfter: f.money(40), provider: 'mock',
    idempotencyKey: 'staff-offline:legacy-registration', paymentMethod: 'offline_cash', reason: 'original receipt', at: new Date(), createdAt: new Date() });
  f.db.registrations.push({ id: 'legacy-registration', tenantId: f.tenantId, workspaceId: f.workspaceId, orderId: f.orderId,
    instrument: 'rental', status: 'confirmed', fundingEventId: 'legacy-offline', amount: f.money(40), paymentMethod: 'offline_cash',
    confirmedBy: 'operator', confirmedAt: new Date() });
  assert.equal(await f.funding.netCashPaid(f.tenantId, f.workspaceId, f.orderId, f.db), 40);
  assert.equal((await balance(f)).rental.collected, 40);
  assert.equal(f.db.events[0].provider, 'mock', 'old cash source is projected, never rewritten');
  f.db.rentalOfflinePaymentRegistration.findMany = async () => [];
  await assert.rejects(f.funding.netCashPaid(f.tenantId, f.workspaceId, f.orderId, f.db), /原线下资金确认依据不可核实/);
  await assert.rejects(balance(f), /不能当作未付款/);
  f.db.rentalOfflinePaymentRegistration.findMany = async () => f.db.registrations;
  f.db.registrations[0].confirmedAt = null;
  await assert.rejects(f.funding.netCashPaid(f.tenantId, f.workspaceId, f.orderId, f.db), /原线下资金确认依据不可核实/);
  const simulated = receivableFixture(); await simulated.seedDebt();
  await assert.rejects(simulated.funding.recordEvent(simulated.tenantId, simulated.workspaceId, simulated.orderId,
    { instrument: 'rental', action: 'append', amount: 100, provider: 'mock', idempotencyKey: 'fake-paid', reason: 'simulation' }), /模拟资金仅限/);
  assert.equal(simulated.debt(), 100);
});

test('a new debt order appearing before the credit lock aborts repayment without partial allocations', async () => {
  const f = receivableFixture(); await f.seedDebt();
  let introduced = false;
  f.db.beforeQuery = async query => {
    if (!introduced && query.sql.includes('FROM customer_corporate_credits')) {
      introduced = true;
      f.db.rows.push({ ...f.db.rows.find(row => row.entryType === 'settle'), id: 'concurrent-debt', orderId: 'concurrent-order',
        amount: f.money(10), receivableDelta: f.money(10), reservedDelta: f.money(0), idempotencyKey: 'concurrent-debt' });
    }
  };
  await assert.rejects(f.payCorporate(50), /核销期间有新的企业债权/);
  assert.equal(f.db.rows.filter(row => row.entryType === 'payment' || row.entryType === 'payment_allocation').length, 0);
  assert.equal(f.debt(), 100);
});

test('per-order enterprise cash keeps its original currency and requires no invented credit account', async () => {
  const f = receivableFixture(); f.db.credit = null; f.order.currency = 'USD';
  Object.assign(f.order.membershipSnapshot.settlement, { mode: 'per_order', billingCycle: 'per_order', currency: 'USD' });
  const input = { ...f.cashInput(100, 'original-stripe'), provider: 'stripe' };
  await f.funding.recordEvent(f.tenantId, f.workspaceId, f.orderId, input);
  assert.equal(f.db.rows.length, 0); assert.equal((await balance(f)).rental.due, 0);
  assert.equal((await balance(f)).rental.corporatePaid, 0);
});

test('funding public output matches named OpenAPI fields and preserves optional legacy corporate totals', async () => {
  const { OPENAPI_COMPONENT_SCHEMAS: schemas, API_CONTRACT_OPERATIONS } = require('../apps/api/src/contracts/openapi-document');
  const f = receivableFixture(); await f.seedDebt(); await f.payCorporate(100);
  const result = await balance(f), schema = schemas.RentalFundingBalance;
  assert.equal(API_CONTRACT_OPERATIONS.find(row => row.operationId === 'listRentalOrderFundingEventsV1').responseSchema, 'RentalFundingBalance');
  assert.equal(schema.properties.rental.properties.corporatePaid.type, 'number');
  assert.ok(!schema.properties.rental.required.includes('corporatePaid'));
  for (const key of schema.required) assert.ok(key in result);
  for (const key of schema.properties.rental.required) assert.ok(key in result.rental);
  assert.deepEqual(Object.keys(result.rental).sort(), Object.keys(schema.properties.rental.properties).sort());
  assert.ok(!schemas.RentalFundingEvent.properties.provider.enum.includes('corporate'));
});

test('server settlement document retains corporate allocations separately from cash in its snapshot and HTML', async () => {
  const f = receivableFixture(); await f.seedDebt(); await f.payCorporate(100);
  const result = renderRentalDocument({ documentType: 'settlement', order: { ...f.order,
    startAt: '2026-10-01T00:00:00Z', endAt: '2026-10-02T00:00:00Z', customerName: 'Corporate',
    fulfillmentLocationName: 'Warehouse', chargeLines: [], adjustmentAmount: 0 },
    inspections: [], templates: [], funding: await balance(f), snapshotAt: '2026-10-31T00:00:00Z' });
  assert.equal(result.snapshot.financial.rental.collected, 0);
  assert.equal(result.snapshot.financial.rental.corporatePaid, 100);
  assert.match(result.html, /企业回款已核销/);
});
