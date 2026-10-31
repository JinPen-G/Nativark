const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { RentalBusinessController } = require('../apps/api/src/modules/rental-core/rental-business.controller');
const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { currentQuoteSource, assertQuoteReadAccess } = require('../apps/api/src/modules/rental-core/rental-quote-access');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const stores = require('./helpers/absorbing-config-store.cjs');
const scope = { tenantId: 't', workspaceId: 'w', userId: 'operator', isSaasAdmin: false, audience: 'operator', dataScope: 'all' };
const quote = () => ({ id: 'q', tenantId: 't', quoteNo: 'RQ', categoryCode: 'camera',
  sourceSnapshot: { version: 'rental-quote-source-1', tenantId: 't', workspaceId: 'w', actor: { kind: 'user', id: 'operator' }, audience: 'operator' },
  request: { customerId: 'c', fulfillmentLocationId: 'pickup', returnLocationId: 'return', startAt: '2099-01-01T00:00:00Z', endAt: '2099-01-02T00:00:00Z', lines: [] },
  deliveryAddressSnapshot: { recipient: 'Fixture', phone: '13800000000', phoneMasked: '138****0000', detail: 'Fixture only' },
  rentalLineAmounts: { group: 100 }, chargeLines: [], rentalAmount: 100, discountAmount: 0, couponAmount: 0, serviceAmount: 0,
  fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0, payableAmount: 100, receivableAmount: 100,
  ruleVersion: '1', pricingPlanVersion: '1', createdAt: '2026-10-30T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' });

test('durable quote read recovers the exact original snapshot on another instance and ignores a stale cache', async () => {
  let saved = quote(), reads = 0;
  const factStore = { ...stores.createAbsorbingBusinessFactStore(), findQuote: async (tenant, id, tx) => {
    reads++; assert.equal(tenant, 't'); assert.equal(id, 'q'); if (tx) assert.equal(tx, transaction); return saved && structuredClone(saved);
  } };
  const transaction = {};
  const a = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), factStore, stores.createAbsorbingConfigStore());
  const b = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), factStore, stores.createAbsorbingConfigStore());
  for (const service of [a, b]) service.state = () => service.cache ??= { quotes: [] };
  await runWithRequestIdentity(scope, async () => {
    const original = await a.loadQuote('t', {}, 'q');
    assert.equal(b.cache, undefined);
    assert.deepEqual(await b.loadQuote('t', {}, 'q'), original);
    saved.consumedAt = '2026-10-30T01:00:00Z'; saved.consumedOrderId = 'order';
    assert.equal((await a.loadQuote('t', {}, 'q', transaction)).consumedOrderId, 'order');
    assert.equal(a.cache.quotes[0].consumedAt, undefined, 'transaction-local reads do not publish uncommitted cache');
    assert.equal((await a.loadQuote('t', {}, 'q')).consumedOrderId, 'order');
    saved = undefined;
    await assert.rejects(a.loadQuote('t', {}, 'q'), error => error.status === 404);
    assert.equal(reads, 5);
  });
});

test('quote detail and consumption policy enforce current owner, audience and every fulfillment location', async () => {
  const q = quote(), owner = { ...scope, dataScope: 'own' };
  await runWithRequestIdentity(owner, async () => {
    assertQuoteReadAccess(q);
    await assert.rejects(async () => assertQuoteReadAccess({ ...q, sourceSnapshot: undefined }), error => error.status === 403);
    await assert.rejects(async () => assertQuoteReadAccess({ ...q, sourceSnapshot: { ...q.sourceSnapshot, actor: { kind: 'user', id: 'other' } } }), error => error.status === 403);
  });
  await runWithRequestIdentity({ ...scope, dataScope: 'store', locationScope: { mode: 'selected', locationIds: ['pickup'] } }, async () =>
    assert.rejects(async () => assertQuoteReadAccess(q), error => error.status === 403));
  await runWithRequestIdentity({ ...scope, dataScope: 'store', locationScope: { mode: 'selected', locationIds: ['pickup', 'return'] } }, async () => {
    assertQuoteReadAccess(q);
    await assert.rejects(async () => assertQuoteReadAccess({ ...q, serviceSnapshots: [{ serviceLocationId: 'other' }] }), error => error.status === 403);
  });
  await runWithRequestIdentity({ ...scope, userId: 'c', audience: 'client', dataScope: undefined }, () => assertQuoteReadAccess(q));
  await runWithRequestIdentity({ ...scope, userId: 'other-customer', audience: 'client' }, async () =>
    assert.rejects(async () => assertQuoteReadAccess(q), error => error.status === 403));
  await runWithRequestIdentity({ ...scope, workspaceId: 'other' }, async () =>
    assert.rejects(async () => assertQuoteReadAccess(q), error => error.status === 403));
  const controller = Object.create(RentalBusinessController.prototype);
  controller.context = async () => ({}); controller.business = { loadQuote: async () => q };
  await runWithRequestIdentity(scope, async () => {
    const result = await controller.quoteDetail({ user: { tenantId: 't' } }, 'q');
    assert.equal(result.deliveryAddressSnapshot.phone, undefined); assert.equal(q.deliveryAddressSnapshot.phone, '13800000000');
  });
});

test('quote source is authenticated provenance, never a customer or model-supplied creator', async () => {
  await runWithRequestIdentity(scope, () => assert.deepEqual(currentQuoteSource('t'), quote().sourceSnapshot));
  await runWithRequestIdentity({ ...scope, audience: 'client', userId: 'c' }, () =>
    assert.deepEqual(currentQuoteSource('t').actor, { kind: 'customer', id: 'c' }));
  await runWithRequestIdentity({ ...scope, audience: undefined }, async () =>
    assert.rejects(async () => currentQuoteSource('t'), error => error.status === 403));
  await runWithRequestIdentity({}, () => assert.equal(currentQuoteSource('t'), undefined));
});

test('manual order creation uses durable quote before any prepare/write and rejects consumed or unauthorized facts', async () => {
  const service = Object.create(RentalOrderConfirmationService.prototype);
  service.normalizeOrderInput = value => value;
  service.idempotency = { find: async () => undefined };
  service.core = { resolveWorkspaceId: () => 'w', prepareOrder: async () => { throw Error('should not prepare'); } };
  let q = quote(), reads = 0;
  service.businessFacts = { findQuote: async () => { reads++; return q; } };
  service.business = { consumeQuote: () => { throw Error('cache must not be used'); } };
  await runWithRequestIdentity(scope, async () => {
    q.consumedOrderId = 'already';
    await assert.rejects(service.createOrder('t', { quoteId: 'q' }, 'Operator', {}), /已过期或被使用/);
    q = quote(); service.assertOrderMatchesQuote = (_input, actual) => { assert.deepEqual(actual, q); throw Error('durable precheck reached'); };
    await assert.rejects(service.createOrder('t', { quoteId: 'q' }, 'Operator', {}), /durable precheck reached/);
  });
  await runWithRequestIdentity({ ...scope, dataScope: 'own', userId: 'other' }, async () =>
    assert.rejects(service.createOrder('t', { quoteId: 'q' }, 'Other', {}), error => error.status === 403));
  assert.equal(reads, 3);
});

test('actual quote repository round-trips source/address/rental allocation and refuses provenance changes', async () => {
  let row;
  const db = { businessWorkspace: { findFirst: async ({ where }) => { assert.equal(where.tenantId, 't'); return { id: 'w' }; } },
    rentalQuote: { findFirst: async () => row ?? null, findUnique: async () => row ?? null,
      create: async ({ data }) => { row = { ...data }; }, update: async () => { throw Error('must reject before update'); } } };
  const admission = require('./helpers/fulfillment-admission-fixture.cjs').fulfillmentAdmissionFixture('t', 'w', {
    locations: ['pickup', 'return'].map(id => ({ id, name: id, operatorId: 'op', status: 'enabled', capabilities: ['pickup', 'return'] })),
    operators: [{ id: 'op', status: 'enabled', type: 'self_operated' }]
  });
  db.$queryRaw = admission.tx.$queryRaw;
  db.$transaction = async work => work(db);
  const repo = new RentalBusinessFactRepository(db);
  const q = { ...quote(), inspectionTemplateSnapshots: [], appliedDiscountPlanIds: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [], ruleSnapshot: {} };
  await runWithRequestIdentity(scope, async () => {
    // Decimal values must retain the real class; only JSON is serialized by the DB.
    await repo.upsertQuote(q);
    const restored = await repo.findQuote('t', 'q');
    assert.deepEqual(restored.sourceSnapshot, q.sourceSnapshot);
    assert.deepEqual(restored.deliveryAddressSnapshot, q.deliveryAddressSnapshot);
    assert.deepEqual(restored.rentalLineAmounts, q.rentalLineAmounts);
    await assert.rejects(repo.upsertQuote({ ...q, sourceSnapshot: { ...q.sourceSnapshot, actor: { kind: 'user', id: 'other' } } }), /不可改写/);
    await assert.rejects(repo.upsertQuote({ ...q, sourceSnapshot: undefined }), /不可改写/);
    await assert.rejects(repo.upsertQuote({ ...q, deliveryAddressSnapshot: { ...q.deliveryAddressSnapshot, detail: 'changed' } }), /不可改写/);
    await assert.rejects(repo.upsertQuote({ ...q, rentalLineAmounts: { group: 200 } }), /不可改写/);
    row.sourceSnapshot = null;
    await assert.rejects(repo.upsertQuote(q), /不可改写或补造/);
  });
});
