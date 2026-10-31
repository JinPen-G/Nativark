const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalCoreController } = require('../apps/api/src/modules/rental-core/rental-core.controller');
const { RentalFundingService } = require('../apps/api/src/modules/rental-core/rental-funding.service');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
const { AiQuotePreviewService } = require('../apps/api/src/modules/ai-native/quote-preview.service');
const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const stores = require('./helpers/absorbing-config-store.cjs');
const { extensionPaymentRequired } = require('../apps/api/src/modules/rental-core/rental-extension-lifecycle');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const inScope = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, work);

function extensionFixture(mode = 'immediate') {
  const order = { id: 'o', tenantId: 't', currency: 'CNY', status: 'renting', endAt: '2099-01-01T00:00:00Z',
    lines: [], allocations: [], reservations: [], serviceSnapshots: [], chargeLines: [],
    payableAmount: 100, finalPayableAmount: 100, adjustmentAmount: 0,
    ruleSnapshot: { extension: { enabled: true, pricingMode: 'incremental' } } };
  const priced = { orderId: 'o', currency: 'CNY', originalEndAt: order.endAt, newEndAt: '2099-01-02T00:00:00Z',
    payableAmount: 0, rentalAmount: 0, serviceAmount: 0, depositDelta: 0, preAuthDelta: 0,
    ruleSnapshot: order.ruleSnapshot, rateSnapshot: [], settlementMode: mode };
  const captured = { inserted: [], effective: 0, saved: 0, funding: 0, credit: 0 };
  const service = Object.create(RentalCoreService.prototype);
  service.state = () => ({ profile: { terminology: { pickupLabel: '领取' } } });
  service.lockedOrder = async () => order;
  service.resolveWorkspaceId = () => 'w';
  service.assertOrderQualification = async () => undefined;
  service.assertOrderExtensionAvailable = async () => undefined;
  service.factStore = { listExtensions: async () => captured.inserted, cancelExtensions: async () => undefined,
    insertExtension: async row => { captured.inserted.push(row); }, markExtensionEffective: async (_t, id, effectiveAt, paidAt) => {
      captured.effective++;
      Object.assign(captured.inserted.find(row => row.id === id), { status: 'effective', effectiveAt, paidAt });
    },
    saveOrderAggregate: async () => { captured.saved++; } };
  service.funding = { assertReadyForExtension: async (_t, _w, _o, _ext, _tx, options) => { captured.funding++; captured.options = options; } };
  service.corporateSettlement = { allowsExtensionCredit: async () => true,
    reserveExtensionCredit: async (_t, _o, id, amount) => { captured.credit++; captured.creditAmount = amount; captured.creditId = id; } };
  return { service, order, priced, captured };
}

test('monthly extension with security increase stays pending and becomes effective only after funding and credit checks', async () => inScope(async () => {
  assert.equal(extensionPaymentRequired({ settlementMode: 'monthly', payableAmount: 100, depositDelta: 100, preAuthDelta: 0 }), true);
  assert.equal(extensionPaymentRequired({ settlementMode: 'monthly', payableAmount: 100, depositDelta: 0, preAuthDelta: 0 }), false);
  const { service, order, priced, captured } = extensionFixture('monthly');
  Object.assign(priced, { payableAmount: 100, rentalAmount: 60, serviceAmount: 40, depositDelta: 100 });
  const result = await service.requestOrderExtension('t', 'o', priced, { idempotencyKey: 'original', operator: 'Operator' }, {});
  assert.equal(result.extension.status, 'pending_payment');
  assert.equal(order.effectiveEndAt, undefined); assert.equal(captured.credit, 0);
  service.funding.assertReadyForExtension = async () => { throw Error('original deposit still unpaid'); };
  await assert.rejects(service.payOrderExtension('t', 'o', result.extension.id, {}), /unpaid/);
  assert.equal(captured.effective, 0); assert.equal(order.effectiveEndAt, undefined);
  service.funding.assertReadyForExtension = async (_t, _w, _o, _e, _tx, options) => { assert.equal(options.skipRentalPayment, true); };
  await service.payOrderExtension('t', 'o', result.extension.id, {});
  assert.equal(captured.credit, 1); assert.equal(captured.creditAmount, 100);
  assert.equal(order.effectiveEndAt, priced.newEndAt);
  assert.deepEqual(order.chargeLines.map(row => [row.type, row.amount]), [['extension', 60], ['service', 40]]);
  assert.ok(order.chargeLines.every(row => row.sourceId === result.extension.id));
  assert.equal(order.finalPayableAmount, 200);
}));

test('zero-difference extension cannot bypass original funding or fabricate a credit exemption', async () => inScope(async () => {
  const { service, priced, captured } = extensionFixture();
  service.funding.assertReadyForExtension = async (_t, _w, _o, _e, _tx, options) => {
    assert.equal(options.skipRentalPayment, false); throw Error('original funds missing');
  };
  await assert.rejects(service.requestOrderExtension('t', 'o', priced, { idempotencyKey: 'k', operator: 'Operator' }, {}), /funds missing/);
  assert.equal(captured.inserted.length, 0); assert.equal(captured.saved, 0);
  priced.settlementMode = 'monthly'; service.corporateSettlement.allowsExtensionCredit = async () => false;
  await assert.rejects(service.requestOrderExtension('t', 'o', priced, { idempotencyKey: 'k', operator: 'Operator' }, {}), /原订单依据不一致/);
  assert.equal(captured.inserted.length, 0);
}));

test('extension acceptance and payment reject missing or mismatched original currency before side effects', async () => inScope(async () => {
  for (const currency of [undefined, null, '', 'USD', 'XYZ']) {
    const f = extensionFixture(); f.priced.currency = currency;
    const before = structuredClone(f.order);
    await assert.rejects(f.service.requestOrderExtension('t', 'o', f.priced,
      { idempotencyKey: 'bad-currency', operator: 'Operator' }, {}), error => error.status === 409);
    assert.deepEqual(f.order, before);
    assert.deepEqual(f.captured, { inserted: [], effective: 0, saved: 0, funding: 0, credit: 0 });
  }
  const missingOrder = extensionFixture(); delete missingOrder.order.currency;
  await assert.rejects(missingOrder.service.requestOrderExtension('t', 'o', missingOrder.priced,
    { idempotencyKey: 'missing-order-currency', operator: 'Operator' }, {}), error => error.status === 409);
  assert.equal(missingOrder.captured.inserted.length, 0);
  const f = extensionFixture(); Object.assign(f.priced, { payableAmount: 20, rentalAmount: 20 });
  const accepted = await f.service.requestOrderExtension('t', 'o', f.priced,
    { idempotencyKey: 'original-currency', operator: 'Operator' }, {});
  assert.equal(accepted.extension.status, 'pending_payment');
  const original = structuredClone(accepted.extension), order = structuredClone(f.order);
  for (const currency of [undefined, null, '', 'USD', 'XYZ']) {
    f.captured.inserted[0] = { ...structuredClone(original), currency };
    await assert.rejects(f.service.payOrderExtension('t', 'o', original.id, {}), error => error.status === 409);
    assert.deepEqual(f.order, order); assert.equal(f.captured.effective, 0);
    assert.equal(f.captured.funding, 0); assert.equal(f.captured.credit, 0);
    assert.equal(f.captured.saved, 1);
  }
  f.captured.inserted[0] = original;
  await f.service.payOrderExtension('t', 'o', original.id, {});
  assert.equal(f.order.currency, 'CNY'); assert.equal(f.order.finalPayableAmount, 120);
  assert.equal(f.captured.funding, 1); assert.equal(f.captured.effective, 1);
  const writes = structuredClone(f.captured);
  await f.service.payOrderExtension('t', 'o', original.id, {});
  assert.deepEqual(f.captured, writes, 'effective replay only reads the original receipt');
}));

test('funding gate retains security requirements even when the trusted credit path skips rental payment', async () => {
  const funding = new RentalFundingService({});
  funding.lockedOrderScope = async () => ({ depositAmount: 100, preAuthAmount: 200, payable: 300 });
  let events = [], rentalChecked = 0;
  funding.loadBalanceContext = async () => ({ accountingEvents: events });
  funding.assertPaid = async (_t, _w, _o, _tx, payable) => { rentalChecked++; assert.equal(payable, 400); };
  const extension = { payableAmount: 100, depositDelta: 50, preAuthDelta: 20 };
  await assert.rejects(funding.assertReadyForExtension('t', 'w', 'o', extension, {}, { skipRentalPayment: true }), /保证金不足/);
  events = [{ instrument: 'deposit', action: 'initiate', amount: 150 }, { instrument: 'preauthorization', action: 'initiate', amount: 220 }];
  await funding.assertReadyForExtension('t', 'w', 'o', extension, {}, { skipRentalPayment: true });
  assert.equal(rentalChecked, 0);
  await funding.assertReadyForExtension('t', 'w', 'o', extension, {}); assert.equal(rentalChecked, 1);
});

test('partial cancellation releases only held excess after the remaining guarantee requirement', async () => {
  for (const [held, expected] of [[0, 0], [40, 0], [80, 20], [100, 40], [130, 40]]) {
    const controller = Object.create(RentalCoreController.prototype), writes = [];
    controller.service = { resolveWorkspaceId: () => 'w' };
    controller.funding = { listEvents: async () => ({ deposit: { requiredAmount: 100, balance: held },
      preauthorization: { requiredAmount: 100, balance: held } }), recordEvent: async (_t, _w, _o, event) => { writes.push(event); } };
    await controller.releaseLineCancellationSecurity('t', 'o', { depositDelta: -40, preAuthDelta: -40 }, 'original', 'Operator', {});
    assert.deepEqual(writes.map(row => row.amount), expected ? [expected, expected] : []);
  }
});

test('whole bundle cancellation releases every frozen component and leaves other order lines untouched', async () => inScope(async () => {
  const { service, order, captured } = extensionFixture();
  Object.assign(order, { status: 'reserved', orderNo: 'ORDER', startAt: '2098-12-30T00:00:00Z', updatedAt: 'revision',
    depositAmount: 0, preAuthAmount: 0,
    lines: [{ id: 'kit', quantity: 1, inventoryMode: 'bundle' }, { id: 'other', quantity: 1, inventoryMode: 'quantity' }],
    reservations: [{ id: 'r-a', orderLineId: 'kit', quantity: 1, releasedQuantity: 0, status: 'confirmed' },
      { id: 'r-b', orderLineId: 'kit', quantity: 2, releasedQuantity: 0, status: 'confirmed' },
      { id: 'r-other', orderLineId: 'other', quantity: 1, releasedQuantity: 0, status: 'confirmed' }],
    allocations: [{ id: 'a', orderLineId: 'kit', quantity: 1, status: 'locked', assetId: 'asset-a' },
      { id: 'b', orderLineId: 'kit', quantity: 2, status: 'locked' }, { id: 'other', orderLineId: 'other', quantity: 1, status: 'locked' }] });
  service.assertCarrierOrderResourcesMutable = async () => undefined;
  Object.assign(service.factStore, { listOrderChanges: async () => [], listAssets: async () => [],
    allocatedAssetIds: async () => new Set(), insertOrderChange: async () => undefined });
  const priced = { orderId: 'o', newEndAt: order.endAt, payableAmount: -20, depositDelta: 0, preAuthDelta: 0 };
  order.membershipSnapshot = { enterpriseContractAndPayer: true };
  let reduced;
  service.corporateSettlement.releaseReducedOrderCredit = async (tenant, workspace, id, source, tx) => {
    assert.equal(tenant, 't'); assert.equal(workspace, 'w'); assert.equal(id, 'o'); assert.deepEqual(tx, {});
    assert.equal(order.finalPayableAmount, 80); assert.equal(captured.saved, 1);
    reduced = source;
  };
  const result = await service.applyPartialLineCancellation('t', 'o', priced, { type: 'partial_line_cancel', items: [{ lineId: 'kit', quantity: 1 }],
    reason: 'customer cancels kit', customerConfirmed: true, expectedUpdatedAt: 'revision' }, 'original', 'Operator', {});
  assert.deepEqual(result.order.reservations.map(row => [row.releasedQuantity, row.status]), [[1, 'released'], [2, 'released'], [0, 'confirmed']]);
  assert.deepEqual(result.order.allocations.map(row => row.status), ['released', 'released', 'locked']);
  assert.equal(result.order.lines[0].cancelledQuantity, 1); assert.equal(result.order.lines[1].cancelledQuantity, undefined);
  assert.deepEqual(reduced, { kind: 'change', id: result.change.id });
}));

test('pending monthly extension exposes only guarantee top-up, not a rental cash demand', async () => {
  const db = { rentalOrder: { findFirst: async () => ({ workspaceId: 'w', depositAmount: 100, preAuthAmount: 0 }),
    findFirstOrThrow: async () => ({ status: 'RENTING', depositAmount: 100, preAuthAmount: 0, finalPayableAmount: 300 }) },
    rentalOrderExtension: { findMany: async () => [{ status: 'pending_payment', settlementMode: 'monthly', payableAmount: 100, depositDelta: 50, preAuthDelta: 0 }] } };
  const funding = new RentalFundingService(db);
  funding.loadBalanceContext = async () => ({ events: [], accountingEvents: [], balanceBasis: 'real', simulationAllowed: false });
  const result = await funding.listEvents('t', 'w', 'o');
  assert.equal(result.rental.pendingExtensionAmount, 0); assert.equal(result.rental.due, 300);
  assert.equal(result.deposit.pendingExtensionAmount, 50); assert.equal(result.deposit.requiredAmount, 150);
});

test('quote selects and freezes configured default unit instead of the first rate', async () => {
  const tenant = 'tenant_002';
  const core = new RentalCoreService(stores.createAbsorbingConfigStore(), stores.createAbsorbingFactStore());
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), stores.createAbsorbingConfigStore());
  await core.onApplicationBootstrap(); await business.onApplicationBootstrap();
  const profile = core.getProfile(tenant), context = { profile, category: core.listCategories().find(row => row.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenant), groups: core.listItemGroups(tenant), pricingGroups: core.listPricingGroups(tenant),
    locations: core.listLocations(tenant), couponTemplates: core.listCouponTemplates(tenant), operators: core.listOperators(tenant) };
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenant, 'ws_tenant_002', context);
  const group = context.groups.find(row => row.status === 'enabled' && row.inventoryMode === 'quantity');
  const location = context.locations.find(row => row.status === 'enabled');
  const plan = business.listPricingPlans(tenant, context).find(row => row.rates.some(rate => rate.itemGroupId === group.id));
  const base = plan.rates.find(rate => rate.itemGroupId === group.id);
  const rates = [{ ...base, unit: 'hour', baseAmount: 10 }, { ...base, unit: 'day_24h', baseAmount: 100 }];
  business.resolveSpaceRates = async () => ({ rates });
  context.settings.pricing.defaultUnit = 'day_24h';
  const input = { customerType: 'personal', customerName: 'Default test', fulfillmentMode: 'store_pickup_return',
    fulfillmentLocationId: location.id, startAt: '2099-01-01T00:00:00Z', endAt: '2099-01-01T02:00:00Z',
    lines: [{ itemGroupId: group.id, quantity: 1 }] };
  const quote = await business.createQuote(tenant, context, input);
  assert.equal(quote.request.lines[0].pricingUnit, 'day_24h'); assert.equal(quote.rateSnapshot[0].unit, 'day_24h');
  assert.equal(quote.rentalAmount, 100);
  const explicit = await business.createQuote(tenant, context, { ...input, lines: [{ ...input.lines[0], pricingUnit: 'hour' }] });
  assert.equal(explicit.rateSnapshot[0].unit, 'hour'); assert.equal(explicit.rentalAmount, 20);
  const normalized = business.normalizeQuoteInput(input, context), original = { key: 'a'.repeat(64), inputHash: requestFingerprint(normalized) };
  assert.equal(input.lines[0].pricingUnit, undefined);
  let stored, saved = 0;
  const repository = Object.create(RentalBusinessFactRepository.prototype);
  repository.persistQuote = async (snapshot, _binding, proof) => {
    assert.deepEqual(proof, original); stored = structuredClone(snapshot); saved++; return stored;
  };
  business.factStore.findQuoteForOriginalOperation = async (_tenant, proof) => {
    if (!stored) return undefined;
    assert.equal(proof.inputHash, requestFingerprint(stored.request)); return structuredClone(stored);
  };
  business.factStore.saveQuoteForOriginalOperation = repository.saveQuoteForOriginalOperation.bind(repository);
  const bound = await business.createQuoteForOriginalOperation(tenant, context, normalized, original);
  assert.equal(bound.request.lines[0].pricingUnit, 'day_24h'); assert.equal(saved, 1);
  await assert.rejects(repository.saveQuoteForOriginalOperation(bound, { ...original, inputHash: requestFingerprint(input) }), /输入冲突/);
  stored = undefined;
  await assert.rejects(business.createQuoteForOriginalOperation(tenant, context, input,
    { key: 'b'.repeat(64), inputHash: requestFingerprint(input) }), /尚未规范化/);
  assert.equal(saved, 1, 'an unnormalized proof never reaches quote persistence');
  stored = bound; context.settings.pricing.defaultUnit = 'hour';
  assert.deepEqual(await business.createQuoteForOriginalOperation(tenant, context, normalized, original), bound);
  assert.equal(saved, 1, 'the original row is returned without re-pricing or another save');
  context.settings.pricing.defaultUnit = 'day_24h';
  business.resolveSpaceRates = async () => ({ rates: [rates[0]] });
  await assert.rejects(business.createQuote(tenant, context, input), /未配置计价单位 day_24h/);
});

test('AI quote accepts only producer-owned defaults and retains explicit units and original request binding', async () => {
  const context = { settings: { pricing: { defaultUnit: 'day_24h' } }, pricingGroups: [{ id: 'pg', defaultPricingUnit: 'hour' }] };
  const producer = Object.create(RentalBusinessService.prototype);
  producer.memberships = {};
  const normalizeQuoteInput = producer.normalizeQuoteInput.bind(producer);
  const execution = { scope: { kind: 'workspace', tenantId: 't', workspaceId: 'w' },
    actor: { kind: 'user', userId: 'operator' }, audience: 'operator', requestId: 'request' };
  const request = { customerType: 'personal', customerId: 'c', fulfillmentMode: 'store_pickup_return',
    fulfillmentLocationId: 'loc', startAt: '2099-01-01T00:00:00Z', endAt: '2099-01-02T00:00:00Z',
    lines: [{ itemGroupId: 'g', quantity: 1 }] };
  const snapshot = input => ({ id: 'quote', tenantId: 't', quoteNo: 'RQ', request: structuredClone(input),
    chargeLines: [{ code: 'rental:g', name: 'Rental', type: 'rental', amount: 100 }], rentalAmount: 100,
    discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0,
    payableAmount: 100, receivableAmount: 100, currency: 'CNY', pricingPlanVersion: '1', ruleVersion: '1',
    createdAt: '2026-10-30T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z' });
  let writes = 0, stored;
  const repository = Object.create(RentalBusinessFactRepository.prototype);
  repository.persistQuote = async quote => { stored = structuredClone(quote); writes++; return stored; };
  const port = { normalizeQuoteInput, createQuote: async (_tenant, _context, input) => { writes++; return snapshot(input); },
    createQuoteForOriginalOperation: async (_tenant, _context, input, proof) => repository.saveQuoteForOriginalOperation(snapshot(input), proof),
    readQuoteForOriginalOperation: async () => stored,
    readQuoteForOriginalReference: async () => stored };
  let mutation = input => input;
  const resolver = { resolvePricingGroupQuoteRequest: async (_tenant, input) => mutation({ ...input, lines: input.lines.map(row => ({
    ...row, itemGroupId: row.itemGroupId ?? 'g', pricingUnit: row.pricingUnit ?? (row.pricingGroupId ? 'hour' : 'day_24h'),
    reservationPrecision: row.itemGroupId ? 'exact_model' : 'group' })) }) };
  const service = new AiQuotePreviewService(port, { current: async () => context },
    { withQuote: async (_input, work) => work(execution) }, () => new Date('2026-10-30T01:00:00Z'), resolver);
  for (const [line, unit] of [[{ itemGroupId: 'g', quantity: 1 }, 'day_24h'],
    [{ pricingGroupId: 'pg', quantity: 1 }, 'hour'], [{ pricingGroupId: 'pg', itemGroupId: 'g', quantity: 1, pricingUnit: 'day_24h' }, 'day_24h']]) {
    const result = await service.preview({ ...request, lines: [line] });
    assert.equal(result.status, 'quoted'); assert.equal(result.quote.lineUnits[0].pricingUnit, unit);
  }
  const before = writes;
  for (const tamper of [input => ({ ...input, lines: [{ ...input.lines[0], pricingUnit: 'hour' }] }),
    input => ({ ...input, lines: [{ ...input.lines[0], quantity: 2 }] }),
    input => ({ ...input, lines: [{ ...input.lines[0], itemGroupId: 'another' }] }),
    input => ({ ...input, customerId: 'another' }), input => ({ ...input, endAt: '2099-01-03T00:00:00Z' })]) {
    mutation = tamper;
    await assert.rejects(service.preview(request), error => error.code === 'INVALID_RESPONSE');
  }
  mutation = input => ({ ...input, lines: [{ ...input.lines[0], pricingUnit: 'day_24h' }] });
  await assert.rejects(service.preview({ ...request, lines: [{ ...request.lines[0], pricingUnit: 'hour' }] }), error => error.code === 'INVALID_RESPONSE');
  assert.equal(writes, before);
  mutation = input => input;
  const { requestId: _requestId, ...originalIdentity } = execution;
  assert.equal((await service.previewOriginal(request, { reference: 'original', expectedIdentityHash: requestFingerprint(originalIdentity) })).status, 'quoted');
  assert.equal(stored.request.lines[0].pricingUnit, 'day_24h');
  assert.deepEqual(stored.request.bookingIdentity, { bookingIdentity: 'personal' });
  const saved = writes;
  context.settings.pricing.defaultUnit = 'hour';
  port.normalizeQuoteInput = () => { throw Error('historical recovery must not normalize'); };
  const recovered = await service.recoverOriginal('original', execution);
  assert.equal(recovered.status, 'quoted'); assert.equal(recovered.quote.lineUnits[0].pricingUnit, 'day_24h'); assert.equal(writes, saved);
  assert.equal(request.lines[0].pricingUnit, undefined);
});

test('early return uses original partial-cancellation pricing and current service facts without repeating reductions', () => {
  const business = Object.create(RentalBusinessService.prototype);
  const quote = { id: 'early-original', request: { startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-11T00:00:00Z',
    lines: [{ itemGroupId: 'g', quantity: 3, pricingUnit: 'day_24h' }] }, rentalAmount: 300, rentalLineAmounts: { g: 300 },
    chargeLines: [{ type: 'rental', code: 'rental:G', amount: 300 }], rateSnapshot: [{ itemGroupId: 'g', itemGroupCode: 'G', unit: 'day_24h', minimumUnits: 1 }],
    ruleSnapshot: { earlyReturn: { mode: 'auto', minAdvanceHours: 0, refundPercent: 100, refundUndeliveredServices: true }, pricing: {} },
    discountEvaluations: [], membershipBenefitEvaluations: [], serviceSnapshots: [] };
  const order = { id: 'o', ruleSnapshot: quote.ruleSnapshot, lines: [{ id: 'line', itemGroupId: 'g', quantity: 3, cancelledQuantity: 1 }],
    serviceSnapshots: [], chargeLines: [{ type: 'order_change', amount: -100, code: 'order-change:1' }], finalPayableAmount: 200,
    changes: [{ orderId: 'o', sequence: 1, status: 'applied', type: 'partial_line_cancel', diff: { pricingSnapshot: {
      recalculatedRentalAmount: 200, recalculatedDiscountAmount: 0, recalculatedCouponAmount: 0,
      discountEvaluations: [], fullChargeLines: [{ type: 'rental', code: 'rental:G', amount: 200 }] } } }] };
  const calculate = snapshot => business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, quote,
    quote.request.endAt, '2026-11-06T00:00:00Z', 0, undefined, snapshot);
  assert.equal(calculate(order).rentalRefund, 100, 'only remaining two units participate, not original three');
  const discounted = structuredClone(order);
  const pricing = discounted.changes[0].diff.pricingSnapshot;
  pricing.recalculatedDiscountAmount = 20;
  pricing.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 20, rentalAllocations: { g: 20 } }];
  pricing.recalculatedCouponAmount = 10;
  pricing.couponEvaluation = { appliesTo: 'rental', discountAmount: 10, rentalAllocations: { g: 10 } };
  discounted.finalPayableAmount = 170;
  assert.equal(calculate(discounted).rentalRefund, 85, 'remaining original discount/coupon basis survives quantity change');
  const missing = calculate({ ...order, changes: [] });
  assert.equal(missing.amount, null); assert.equal(missing.requiresReview, true); assert.equal(missing.maximumAmount, 200);
  const service = { occurrenceId: 's-original', serviceId: 's', serviceName: 'Service', quantity: 1, amount: 80,
    executionStatus: 'completed', executedQuantity: 1, scheduledStartAt: '2026-11-09T00:00:00Z' };
  const actual = { ...order, lines: [], changes: [], chargeLines: [], serviceSnapshots: [service], finalPayableAmount: 380 };
  assert.equal(calculate(actual).serviceRefund, 0, 'future planned service already actually completed cannot refund');
  for (const refundStatus of ['included_in_order_change', 'approved_pending_refund', 'refunded', 'pending_review']) {
    assert.equal(calculate({ ...actual, serviceSnapshots: [{ ...service, executionStatus: 'cancelled', executedQuantity: 0, refundStatus }] }).serviceRefund, 0);
  }
  assert.equal(calculate({ ...actual, serviceSnapshots: [{ ...service, executionStatus: 'cancelled', executedQuantity: 0, refundStatus: 'none' }],
    feeReviews: [{ type: 'service_refund', sourceId: service.occurrenceId, status: 'approved' }] }).serviceRefund, 0);
  const prior = calculate({ ...actual, chargeLines: [{ type: 'early_return_refund', code: 'early_return_refund:o', amount: -150 }] });
  assert.equal(prior.amount, 0, 'existing early-return source is not recreated under another key');
  assert.equal(quote.rentalAmount, 300); assert.equal(quote.request.lines[0].quantity, 3, 'history never rewritten');
});

test('early-return rental basis recovers old mixed extension from its original rental component', async () => {
  for (const code of ['extension:1', 'extension:1:rental']) {
    const controller = Object.create(RentalCoreController.prototype);
    const order = { id: 'o', quoteId: 'q', endAt: '2099-01-01T00:00:00Z',
      ruleSnapshot: {}, lines: [], allocations: [], chargeLines: [{ code, sourceId: 'ext', type: 'extension', amount: code === 'extension:1' ? 200 : 100 }] };
    let rentalBasis;
    controller.service = { lockOrderForUpdate: async () => order, listOrderChanges: async () => [],
      listOrderExtensions: async () => [{ id: 'ext', sequence: 1, status: 'effective', rentalAmount: 100, serviceAmount: 100 }] };
    controller.business = { loadQuote: async () => ({}), calculateOverdueCharge: () => 0,
      calculateEarlyReturnRefund: (_t, _ctx, _q, _due, _at, amount) => { rentalBasis = amount; return {}; } };
    await controller.returnCharges('t', {}, 'o', '2098-12-31T00:00:00Z', {});
    assert.equal(rentalBasis, 100);
    if (code === 'extension:1') {
      controller.service.listOrderExtensions = async () => [];
      await assert.rejects(controller.returnCharges('t', {}, 'o', '2098-12-31T00:00:00Z', {}), /依据缺失/);
    }
  }
});
