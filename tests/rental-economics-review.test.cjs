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
  const originalCode = group.code;
  group.code = `${originalCode}_RENAMED`;
  const renamed = await business.createQuote(tenant, context, input);
  assert.equal(renamed.rateSnapshot[0].itemGroupCode, originalCode);
  assert.equal(renamed.chargeLines.find(row => row.type === 'rental').code, `rental:${group.code}`);
  // This consumer check replaces inventory transport only; it does not claim
  // that the seed's stock covers a future real booking.
  core.availability = async () => ({ available: true });
  const prepared = await runWithRequestIdentity({ tenantId: tenant, workspaceId: 'ws_tenant_002', userId: 'operator' }, () =>
    core.prepareOrder(tenant, { ...input, lines: renamed.request.lines }, 'Operator', renamed));
  assert.equal(prepared.lines[0].amount, renamed.rentalAmount);
  group.code = originalCode;
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
  const coupon = { id: 'frozen-scope-coupon', customerId: 'coupon-customer', templateId: 'scope-template', templateCode: 'SCOPE',
    templateName: 'Frozen scope', templateVersion: '1', discountType: 'percentage', discountValue: 10, minimumSpend: 0,
    appliesTo: 'rental', stackableWithDiscountPlans: true, applicableItemGroupIds: [group.id, 'eligible-future-replacement'],
    status: 'claimed', effectiveFrom: '2000-01-01T00:00:00Z', effectiveTo: '2100-01-01T00:00:00Z' };
  business.state(tenant, context).customerCoupons.push(coupon);
  const couponInput = { ...input, customerId: coupon.customerId, customerCouponId: coupon.id };
  const scopedQuote = await business.createQuote(tenant, context, couponInput);
  assert.deepEqual(scopedQuote.couponEvaluation.applicableItemGroupIds, [group.id, 'eligible-future-replacement']);
  coupon.applicableItemGroupIds.push('later-added-item');
  assert.deepEqual(scopedQuote.couponEvaluation.applicableItemGroupIds, [group.id, 'eligible-future-replacement'], 'original scope is copied, not a live list');
  coupon.applicableItemGroupIds = [];
  assert.deepEqual((await business.createQuote(tenant, context, couponInput)).couponEvaluation.applicableItemGroupIds, [], 'explicit all-items scope is distinct from legacy absence');
  const assignment = { id: 'member-assignment', customerId: coupon.customerId, planId: 'producer-member', planVersionId: 'producer-member-v1',
    source: 'manual', status: 'active', effectiveFrom: input.startAt, createdAt: input.startAt,
    snapshot: { planName: 'Original rental member', targetType: 'personal', benefits: [{ type: 'rental_discount', calculation: 'percentage', value: 10 }] } };
  business.memberships = { resolveBookingIdentity: async () => ({ bookingIdentity: 'personal', personalCustomerId: coupon.customerId,
    enterpriseContractAndPayer: false, benefitSource: 'personal', personalPlan: structuredClone(assignment), qualifications: [], resolvedAt: input.startAt }) };
  const joint = await business.createQuote(tenant, context, { ...couponInput, bookingIdentity: { bookingIdentity: 'personal' } });
  const { originalExchangeCoupon } = require('../apps/api/src/modules/rental-core/rental-exchange-coupon');
  const { originalExchangeMembership } = require('../apps/api/src/modules/rental-core/rental-exchange-membership');
  assert.equal(originalExchangeCoupon(joint).discountAmount, 10);
  const adoptedMember = originalExchangeMembership(joint, 'ws_tenant_002');
  assert.equal(adoptedMember.base, 90); assert.equal(adoptedMember.appliedAmount, 9); assert.equal(joint.payableAmount, 81);
  business.memberships = undefined;
  const originalPlan = { id: 'producer-plan', tenantId: tenant, categoryCode: profile.categoryCode, code: 'PRODUCER', name: 'Original producer plan',
    status: 'enabled', version: '1', discountType: 'percentage', discountValue: 10, minimumSpend: 0, appliesTo: 'rental', customerScope: 'all',
    applicableItemGroupIds: [group.id], applicablePricingGroupIds: [], applicableDayTypes: [], priority: 1,
    stackableWithOtherPlans: true, stackableWithCoupon: true, effectiveFrom: '2000-01-01T00:00:00Z' };
  business.state(tenant, context).discountPlans = [originalPlan];
  const planQuote = await business.createQuote(tenant, context, input);
  const { originalExchangeDiscount } = require('../apps/api/src/modules/rental-core/rental-exchange-discount');
  const adopted = originalExchangeDiscount(planQuote, 'ws_tenant_002');
  assert.equal(adopted.discountAmount, 10); assert.equal(adopted.planSnapshot.discountValue, 10);
  business.memberships = { resolveBookingIdentity: async () => ({ bookingIdentity: 'personal', personalCustomerId: coupon.customerId,
    enterpriseContractAndPayer: false, benefitSource: 'personal', personalPlan: structuredClone(assignment), qualifications: [], resolvedAt: input.startAt }) };
  const allLayers = await business.createQuote(tenant, context, { ...couponInput, bookingIdentity: { bookingIdentity: 'personal' } });
  assert.equal(originalExchangeDiscount(allLayers, 'ws_tenant_002').discountAmount, 10);
  assert.equal(originalExchangeCoupon(allLayers).runningBase, 90);
  assert.equal(originalExchangeCoupon(allLayers).discountAmount, 9);
  assert.equal(originalExchangeMembership(allLayers, 'ws_tenant_002').base, 81);
  assert.equal(originalExchangeMembership(allLayers, 'ws_tenant_002').appliedAmount, 8.1);
  assert.equal(allLayers.payableAmount, 72.9);
  business.memberships = undefined;
  originalPlan.discountValue = 99;
  assert.equal(originalExchangeDiscount(planQuote, 'ws_tenant_002').planSnapshot.discountValue, 10, 'current plan does not replace the producer-frozen rule');
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

test('early return counts identical shared-target rate snapshots once and retains target net discounts', () => {
  const business = Object.create(RentalBusinessService.prototype);
  const rate = { itemGroupId: 'g', itemGroupCode: 'G', pricingGroupId: 'p', pricingGroupCode: 'P', unit: 'day_24h', minimumUnits: 1 };
  const quote = { id: 'q', request: { startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-11T00:00:00Z',
    lines: [{ itemGroupId: 'a', pricingGroupId: 'p', quantity: 1, pricingUnit: 'day_24h' },
      { itemGroupId: 'b', pricingGroupId: 'p', quantity: 2, pricingUnit: 'day_24h' }] },
    rentalAmount: 300, rentalLineAmounts: { p: 300 }, rateSnapshot: [rate, structuredClone(rate)],
    chargeLines: [{ type: 'rental', code: 'rental:P', amount: 100 }, { type: 'rental', code: 'rental:P', amount: 200 }],
    ruleSnapshot: { earlyReturn: { mode: 'auto', minAdvanceHours: 0, refundPercent: 100, refundUndeliveredServices: false }, pricing: {} },
    discountEvaluations: [{ applied: true, appliesTo: 'rental', discountAmount: 30, rentalAllocations: { p: 30 } }],
    membershipBenefitEvaluations: [], serviceSnapshots: [] };
  const result = business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, quote,
    quote.request.endAt, '2026-11-06T00:00:00Z');
  assert.equal(result.rentalRefund, 135); assert.equal(result.amount, 135);
  assert.equal(result.requiresReview, false);
  quote.rateSnapshot[1].minimumUnits = 2;
  const ambiguous = business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, quote,
    quote.request.endAt, '2026-11-06T00:00:00Z');
  assert.equal(ambiguous.amount, null); assert.equal(ambiguous.rentalRefund, null);
  assert.equal(ambiguous.requiresReview, true); assert.equal(ambiguous.maximumAmount, 270);
  assert.match(ambiguous.basis.join(';'), /同一定价对象存在不同费率/);
});

test('mixed time and usage/package rental refunds only the frozen time-priced net', () => {
  const business = Object.create(RentalBusinessService.prototype);
  for (const unit of ['usage', 'package']) {
    const quote = { id: 'q', request: { startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-11T00:00:00Z',
      lines: [{ itemGroupId: 'a', quantity: 1, pricingUnit: 'day_24h' }, { itemGroupId: 'b', quantity: 1, pricingUnit: unit }] },
      rentalAmount: 800, rentalLineAmounts: { a: 100, b: 700 },
      rateSnapshot: [{ itemGroupId: 'a', itemGroupCode: 'A', unit: 'day_24h', minimumUnits: 1 },
        { itemGroupId: 'b', itemGroupCode: 'B', unit, minimumUnits: 1 }],
      chargeLines: [], ruleSnapshot: { earlyReturn: { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 }, pricing: {} },
      discountEvaluations: [{ applied: true, appliesTo: 'rental', discountAmount: 100, rentalAllocations: { b: 100 } }],
      membershipBenefitEvaluations: [], serviceSnapshots: [] };
    const result = business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, quote,
      quote.request.endAt, '2026-11-06T00:00:00Z');
    assert.equal(result.amount, 50); assert.equal(result.rentalRefund, 50);
    const shared = structuredClone(quote);
    shared.rateSnapshot[1].itemGroupId = 'a'; shared.request.lines[1].itemGroupId = 'a';
    shared.rentalLineAmounts = { a: 800 }; shared.discountEvaluations[0].rentalAllocations = { a: 100 };
    assert.equal(business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, shared,
      quote.request.endAt, '2026-11-06T00:00:00Z').amount, null, 'same target time/non-time totals are not a line allocation');
    delete quote.discountEvaluations[0].rentalAllocations;
    assert.equal(business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, quote,
      quote.request.endAt, '2026-11-06T00:00:00Z').amount, null);
  }
});

test('mixed-rate early return keeps missing original benefit allocations unknown instead of guessing their scope', () => {
  const business = Object.create(RentalBusinessService.prototype);
  const quote = { id: 'q', request: { startAt: '2026-11-01T00:00:00Z', endAt: '2026-11-08T00:00:00Z',
    lines: [{ itemGroupId: 'a', quantity: 1, pricingUnit: 'day_24h' }, { itemGroupId: 'b', quantity: 1, pricingUnit: 'week' }] },
    rentalAmount: 800, rentalLineAmounts: { a: 100, b: 700 },
    rateSnapshot: [{ itemGroupId: 'a', itemGroupCode: 'A', unit: 'day_24h', minimumUnits: 1 },
      { itemGroupId: 'b', itemGroupCode: 'B', unit: 'week', minimumUnits: 1 }],
    chargeLines: [], ruleSnapshot: { earlyReturn: { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 }, pricing: {} },
    discountEvaluations: [], membershipBenefitEvaluations: [], serviceSnapshots: [] };
  const calculate = value => business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, value,
    quote.request.endAt, '2026-11-04T00:00:00Z');
  for (const benefit of [
    { discountEvaluations: [{ applied: true, appliesTo: 'rental', discountAmount: 100 }] },
    { couponEvaluation: { appliesTo: 'rental', discountAmount: 100 } },
    { membershipBenefitEvaluations: [{ appliesTo: 'rental', appliedAmount: 100 }] },
    { discountEvaluations: [{ applied: true, appliesTo: 'rental', discountAmount: 100, rentalAllocations: { a: 20 } }] }
  ]) {
    const result = calculate({ ...structuredClone(quote), ...benefit });
    assert.equal(result.amount, null); assert.equal(result.requiresReview, true);
    assert.equal(result.maximumAmount, 700);
    assert.match(result.basis.join(';'), /分摊/);
  }
  const exact = calculate({ ...quote, discountEvaluations: [{ applied: true, appliesTo: 'rental', discountAmount: 100, rentalAllocations: { a: 100 } }] });
  assert.equal(exact.amount, 0, 'the fully discounted daily item cannot borrow weekly rental as its refund base');
  const extended = business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, quote,
    '2026-11-15T00:00:00Z', '2026-11-04T00:00:00Z', 200);
  assert.equal(extended.amount, null, 'aggregate incremental rental has no per-line amount/period allocation');
  assert.equal(extended.requiresReview, true); assert.equal(extended.maximumAmount, 1000);
});

test('partial physical return receipts preserve each batch quantity and time for final early-return net', () => {
  const business = Object.create(RentalBusinessService.prototype), service = Object.create(RentalCoreService.prototype);
  const start = '2026-11-01T00:00:00Z', end = '2026-11-11T00:00:00Z';
  const at = day => new Date(Date.parse(start) + day * 86400000).toISOString();
  const quote = { id: 'q', tenantId: 't', request: { startAt: start, endAt: end, lines: [{ itemGroupId: 'g', quantity: 3 }] },
    rentalAmount: 300, rentalLineAmounts: { g: 300 }, discountAmount: 30, couponAmount: 0,
    chargeLines: [{ type: 'rental', code: 'rental:G', amount: 300 }],
    rateSnapshot: [{ itemGroupId: 'g', itemGroupCode: 'G', unit: 'day_24h', minimumUnits: 1 }],
    pricingContext: { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false },
    discountEvaluations: [{ applied: true, appliesTo: 'rental', discountAmount: 30 }], membershipBenefitEvaluations: [], serviceSnapshots: [],
    ruleSnapshot: { pricing: {}, earlyReturn: { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 } } };
  const order = { id: 'o', tenantId: 't', ruleSnapshot: quote.ruleSnapshot, finalPayableAmount: 270, serviceSnapshots: [], chargeLines: [],
    lines: [{ id: 'line', itemGroupId: 'g', inventoryMode: 'quantity', quantity: 3, amount: 300 }],
    allocations: [{ id: 'returned-1', orderId: 'o', orderLineId: 'line', quantity: 1, status: 'returned' },
      { id: 'returned-2', orderId: 'o', orderLineId: 'line', quantity: 1, status: 'returned' }, { id: 'holding', orderId: 'o', orderLineId: 'line', quantity: 1, status: 'picked_up' }] };
  service.stampPartialReturnReceipts(order, [{ allocationId: 'holding', quantity: 1 }], new Map([['holding', 'returned-1']]), 'batch-1', at(2));
  service.stampPartialReturnReceipts(order, [{ allocationId: 'holding', quantity: 1 }], new Map([['holding', 'returned-2']]), 'batch-2', at(5));
  const calc = current => business.calculateEarlyReturnRefund('t', { settings: { calendar: { timeZone: 'UTC' } } }, quote, end, at(8), 0, undefined, current, []);
  assert.equal(calc(order).amount, 135, '90 net per piece: 72 at day2 +45 at day5 +18 at day8');
  assert.equal(calc(order).requiresReview, false);
  const rejected = { ...structuredClone(order), changes: [{ id: 'rejected-change', status: 'rejected', type: 'post_pickup_exchange' }] };
  assert.equal(calc(rejected).amount, 135, 'rejected changes have not altered the original batch pricing');
  const applied = { ...structuredClone(rejected), changes: [{ ...rejected.changes[0], status: 'applied' }] };
  assert.equal(calc(applied).amount, null, 'applied pricing changes still require their own complete segment receipts');
  const unknownChange = { ...structuredClone(rejected), changes: [{ ...rejected.changes[0], status: 'unknown' }] };
  assert.equal(calc(unknownChange).amount, null, 'an unknown change cannot be treated as a proven rejection');
  const missingCancellation = { ...structuredClone(order), changes: [{ status: 'applied', type: 'partial_line_cancel' }] };
  assert.equal(calc(missingCancellation).amount, null, 'a cancellation record without corresponding effective quantity cannot bypass the batch gate');
  const shuffled = structuredClone(order); shuffled.allocations.reverse();
  assert.equal(calc(shuffled).amount, 135, 'repository row order does not move net cent remainders');
  for (const mutate of [value => { value.discountEvaluations = []; },
    value => { value.couponAmount = 10; }, value => { value.discountAmount = 40; },
    value => { value.chargeLines[0].amount = 301; },
    value => { value.discountEvaluations[0].rentalAllocations = { foreign: 30 }; },
    value => { delete value.discountEvaluations[0].appliesTo; },
    value => { value.couponAmount = 10; value.couponEvaluation = { discountAmount: 10 }; }]) {
    const damagedQuote = structuredClone(quote); mutate(damagedQuote);
    assert.equal(business.calculateEarlyReturnRefund('t', {}, damagedQuote, end, at(8), 0, undefined, order, []).amount, null,
      'incomplete original gross/benefit facts stay unknown instead of inflating net rental');
  }
  const pennies = structuredClone(quote), pennyOrder = structuredClone(order);
  Object.assign(pennies, { rentalAmount: 0.03, rentalLineAmounts: { g: 0.03 }, discountAmount: 0, discountEvaluations: [] });
  pennies.chargeLines[0].amount = 0.03; pennyOrder.lines[0].amount = 0.03; pennyOrder.finalPayableAmount = 0.03;
  pennies.ruleSnapshot.earlyReturn.refundPercent = 50;
  pennyOrder.ruleSnapshot = pennies.ruleSnapshot;
  assert.equal(business.calculateEarlyReturnRefund('t', {}, pennies, end, at(8), 0, undefined, pennyOrder, []).amount, 0.01);
  for (const row of pennyOrder.allocations.filter(row => row.status === 'returned')) row.metadata.returnReceipt.returnedAt = at(1);
  assert.equal(business.calculateEarlyReturnRefund('t', {}, pennies, end, at(1), 0, undefined, pennyOrder, []).amount, 0.01,
    'three net cents times unused 9/10 times 50% round once to one cent, not zero per batch');
  pennies.rentalAmount = 0.09; pennies.rentalLineAmounts.g = 0.09; pennies.chargeLines[0].amount = 0.09;
  pennyOrder.lines[0].amount = 0.09; pennyOrder.finalPayableAmount = 0.09;
  assert.equal(business.calculateEarlyReturnRefund('t', {}, pennies, end, at(1), 0, undefined, pennyOrder, []).amount, 0.04,
    'each 0.0135 batch amount stays unrounded until the original whole-return charge is formed');
  const legacy = structuredClone(order); delete legacy.allocations[0].metadata.returnReceipt;
  assert.equal(calc(legacy).amount, null);
  const damaged = structuredClone(order); damaged.allocations[0].metadata.returnReceipt.quantity = 2;
  assert.equal(calc(damaged).amount, null);
  assert.throws(() => service.stampPartialReturnReceipts(order, [{ allocationId: 'holding', quantity: 1 }],
    new Map([['holding', 'returned-1']]), 'again', at(3)), /原分配来源/);
  order.ruleSnapshot.earlyReturn.maxRefundAmount = 100;
  assert.equal(calc(order).amount, 100, 'one order cap, not one per batch');
  order.ruleSnapshot.earlyReturn.mode = 'manual_review';
  assert.equal(calc(order).requiresReview, true);
  const foreign = structuredClone(order); foreign.allocations[0].orderId = 'another-order';
  assert.equal(calc(foreign).amount, null);
  const future = structuredClone(order); future.allocations[0].metadata.returnReceipt.returnedAt = at(9);
  assert.equal(calc(future).amount, null);
});

test('partial returns on distinct stable lines consume only each original target net and batch time', () => {
  const business = Object.create(RentalBusinessService.prototype);
  const start = '2026-11-01T00:00:00Z', end = '2026-11-11T00:00:00Z', returnedAt = '2026-11-09T00:00:00Z';
  const quote = { id: 'q', tenantId: 't', request: { startAt: start, endAt: end,
    lines: [{ itemGroupId: 'a', quantity: 2 }, { itemGroupId: 'b', quantity: 1 }] },
    rentalAmount: 300, rentalLineAmounts: { a: 200, b: 100 }, discountAmount: 60, couponAmount: 10,
    chargeLines: [{ type: 'rental', amount: 200 }, { type: 'rental', amount: 100 }],
    rateSnapshot: ['a', 'b'].map(itemGroupId => ({ itemGroupId, unit: 'day_24h', minimumUnits: 1 })),
    pricingContext: { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false },
    ruleSnapshot: { pricing: {}, earlyReturn: { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 } },
    discountEvaluations: [{ applied: true, appliesTo: 'rental', discountAmount: 50, rentalAllocations: { a: 40, b: 10 } }],
    membershipBenefitEvaluations: [{ appliesTo: 'rental', appliedAmount: 10, allocations: { a: 10 } }],
    couponEvaluation: { appliesTo: 'rental', discountAmount: 10, rentalAllocations: { b: 10 } }, serviceSnapshots: [] };
  const order = { id: 'o', tenantId: 't', ruleSnapshot: quote.ruleSnapshot, finalPayableAmount: 230, chargeLines: [], serviceSnapshots: [],
    lines: [{ id: 'line-b', itemGroupId: 'b', inventoryMode: 'quantity', quantity: 1, amount: 100 },
      { id: 'line-a', itemGroupId: 'a', inventoryMode: 'quantity', quantity: 2, amount: 200 }], allocations: [
      { id: 'old-a', orderId: 'o', orderLineId: 'line-a', quantity: 1, status: 'returned', metadata: { returnReceipt: {
        batchId: 'batch', returnedAt: '2026-11-03T00:00:00Z', sourceAllocationId: 'holding-a', orderLineId: 'line-a', quantity: 1 } } },
      { id: 'holding-a', orderId: 'o', orderLineId: 'line-a', quantity: 1, status: 'picked_up' },
      { id: 'holding-b', orderId: 'o', orderLineId: 'line-b', quantity: 1, status: 'picked_up' }] };
  const calc = value => business.calculateEarlyReturnRefund('t', {}, quote, end, returnedAt, 0, undefined, value, []);
  assert.equal(calc(order).rentalRefund, 91, 'A net150: 75*.8+75*.2=75; B net80: 80*.2=16');
  const sameTarget = structuredClone(order); sameTarget.lines[0].itemGroupId = 'a';
  assert.equal(calc(sameTarget).amount, null, 'target totals cannot prove distinct same-target stable-line benefits');
  const sourceLess = structuredClone(quote); delete sourceLess.membershipBenefitEvaluations[0].allocations;
  assert.equal(business.calculateEarlyReturnRefund('t', {}, sourceLess, end, returnedAt, 0, undefined, order, []).amount, null);
  const wrongScope = structuredClone(quote); wrongScope.discountEvaluations[0].rentalAllocations = { a: 40, other: 10 };
  assert.equal(business.calculateEarlyReturnRefund('t', {}, wrongScope, end, returnedAt, 0, undefined, order, []).amount, null);
  const pennies = structuredClone(quote), pennyOrder = structuredClone(order);
  Object.assign(pennies, { rentalAmount: 0.03, rentalLineAmounts: { a: 0.02, b: 0.01 }, discountAmount: 0, couponAmount: 0,
    discountEvaluations: [], membershipBenefitEvaluations: [], couponEvaluation: undefined });
  pennies.chargeLines[0].amount = 0.02; pennies.chargeLines[1].amount = 0.01;
  pennyOrder.lines.find(line => line.id === 'line-a').amount = 0.02;
  pennyOrder.lines.find(line => line.id === 'line-b').amount = 0.01;
  pennyOrder.finalPayableAmount = 0.03; pennyOrder.ruleSnapshot = pennies.ruleSnapshot;
  pennies.ruleSnapshot.earlyReturn.refundPercent = 50;
  assert.equal(business.calculateEarlyReturnRefund('t', {}, pennies, end, returnedAt, 0, undefined, pennyOrder, []).amount, 0.01,
    'line and batch intermediate values do not each round the original whole-return fee');
  const swapped = structuredClone(quote); swapped.rentalLineAmounts = { a: 100, b: 200 };
  assert.equal(business.calculateEarlyReturnRefund('t', {}, swapped, end, returnedAt, 0, undefined, order, []).amount, null,
    'an internally balanced target map still has to match each original request charge');
  const duplicate = structuredClone(order); duplicate.allocations[2].id = duplicate.allocations[1].id;
  assert.equal(calc(duplicate).amount, null, 'allocation identity is unique across the whole order, not only one line');
  order.ruleSnapshot.earlyReturn.maxRefundAmount = 80;
  assert.equal(calc(order).amount, 80, 'the whole-return cap is not applied per stable line');
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
  const partial = structuredClone(order);
  partial.tenantId = quote.tenantId = 't'; quote.pricingContext = { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false };
  partial.allocations = [{ id: 'first', orderId: 'o', orderLineId: 'line', quantity: 1, status: 'returned', metadata: { returnReceipt: {
    batchId: 'first-batch', returnedAt: '2026-11-03T00:00:00Z', sourceAllocationId: 'remaining', orderLineId: 'line', quantity: 1 } } },
    { id: 'remaining', orderId: 'o', orderLineId: 'line', quantity: 1, status: 'picked_up' }];
  partial.lines[0].inventoryMode = 'quantity'; partial.lines[0].amount = 300;
  assert.equal(calculate(partial).amount, 130, 'cancelled quantity is excluded; remaining two original net100 pieces use day2/day5 return times');
  const missingBatch = structuredClone(partial); delete missingBatch.allocations[0].metadata.returnReceipt;
  assert.equal(calculate(missingBatch).amount, null);
  partial.changes[0].diff.pricingSnapshot.recalculatedRentalAmount = 201;
  assert.equal(calculate(partial).amount, null, 'bad cancellation receipt cannot be replaced by original gross quote');
  const discounted = structuredClone(order);
  const pricing = discounted.changes[0].diff.pricingSnapshot;
  pricing.recalculatedDiscountAmount = 20;
  pricing.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 20, rentalAllocations: { g: 20 } }];
  pricing.recalculatedCouponAmount = 10;
  pricing.couponEvaluation = { appliesTo: 'rental', discountAmount: 10, rentalAllocations: { g: 10 } };
  discounted.finalPayableAmount = 170;
  assert.equal(calculate(discounted).rentalRefund, 85, 'remaining original discount/coupon basis survives quantity change');
  const discountedBatch = structuredClone(discounted);
  discountedBatch.tenantId = 't'; discountedBatch.allocations = structuredClone(partial.allocations);
  discountedBatch.lines[0].inventoryMode = 'quantity'; discountedBatch.lines[0].amount = 300;
  assert.equal(calculate(discountedBatch).amount, 110.5, 'remaining net170: each85 at day2/day5 contributes68/42.5');
  for (const mutate of [value => { delete value.couponEvaluation; },
    value => { delete value.couponEvaluation.rentalAllocations; },
    value => { value.couponEvaluation.rentalAllocations.g = 5; },
    value => { value.recalculatedCouponAmount = 0; },
    value => { value.fullChargeLines.push(structuredClone(value.fullChargeLines[0])); },
    value => { value.discountEvaluations[0].rentalAllocations.g = 5; },
    value => { value.recalculatedDiscountAmount = 30; },
    value => { value.membershipBenefitEvaluations = [{ appliesTo: 'rental', appliedAmount: 10, allocations: { g: 5 } }];
      value.recalculatedDiscountAmount = 30; }]) {
    const damaged = structuredClone(discounted); mutate(damaged.changes[0].diff.pricingSnapshot);
    const result = calculate(damaged);
    assert.equal(result.amount, null, 'missing cancellation net-allocation evidence stays unknown');
    assert.equal(result.requiresReview, true);
  }
  const member = structuredClone(discounted);
  member.changes[0].diff.pricingSnapshot.recalculatedDiscountAmount = 30;
  member.changes[0].diff.pricingSnapshot.membershipBenefitEvaluations = [{ appliesTo: 'rental', appliedAmount: 10, allocations: { g: 10 } }];
  member.finalPayableAmount = 160;
  assert.equal(calculate(member).rentalRefund, 80, 'membership uses the cancellation receipt allocation, not the original quote selection');
  const withService = structuredClone(member);
  withService.serviceSnapshots = [{ occurrenceId: 'performed', serviceId: 'setup', serviceName: 'Already performed',
    amount: 50, quantity: 1, executionStatus: 'completed', executedQuantity: 1, discountAllocatedAmount: 5, couponAllocatedAmount: 10 }];
  const servicePricing = withService.changes[0].diff.pricingSnapshot;
  servicePricing.recalculatedDiscountAmount = 35;
  servicePricing.discountEvaluations.push({ applied: true, appliesTo: 'service', discountAmount: 5 });
  servicePricing.recalculatedCouponAmount = 10;
  servicePricing.couponEvaluation = { appliesTo: 'service', discountAmount: 10, serviceAllocations: { setup: 10 } };
  withService.finalPayableAmount = 205;
  const serviceResult = calculate(withService);
  assert.equal(serviceResult.rentalRefund, 85, 'completed service benefits stay independent of remaining rental');
  assert.equal(serviceResult.serviceRefund, 0); assert.equal(serviceResult.amount, 85);
  const renamed = structuredClone(member);
  const renamedPricing = renamed.changes[0].diff.pricingSnapshot;
  renamedPricing.rentalLineAmounts = { g: 200 };
  renamedPricing.fullChargeLines[0].code = 'rental:RENAMED';
  assert.equal(calculate(renamed).rentalRefund, 80, 'frozen target amounts survive renamed display codes');
  for (const map of [null, [200], {}, { foreign: 200 }, { g: -1 }, { g: NaN }]) {
    const bad = structuredClone(renamed); bad.changes[0].diff.pricingSnapshot.rentalLineAmounts = map;
    assert.equal(calculate(bad).amount, null, 'malformed map remains an unknown review, not a crash or legacy fallback');
  }
  renamedPricing.rentalLineAmounts.g = 201;
  assert.equal(calculate(renamed).amount, null, 'invalid new map cannot fall back to legacy display-code matching');
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
  for (const changed of [
    { ...actual, changes: [{ id: 'exchange', type: 'post_pickup_exchange', status: 'applied' }] },
    { ...order, changes: [] }
  ]) {
    const replay = calculate({ ...changed, chargeLines: [{ type: 'early_return_refund', code: 'early_return_refund:o', amount: -50 }] });
    assert.equal(replay.amount, 0, 'manual pricing branches cannot reopen the original early-return reduction');
    assert.equal(replay.requiresReview, false);
  }
  assert.equal(calculate({ ...actual, chargeLines: [{ type: 'early_return_refund', code: 'early_return_refund:o:order', amount: -50 }] }).amount, 0,
    'approved whole-order charge code is also an original reduction receipt');
  const otherSource = calculate({ ...actual, feeReviews: [{ type: 'early_return_refund', sourceId: 'exchange-previous', status: 'approved' }],
    chargeLines: [{ type: 'early_return_refund', code: 'early_return_refund:o:exchange-previous', amount: -50 }] });
  assert.equal(otherSource.rentalRefund, 150, 'a separately approved exchange difference does not consume the final early-return source');
  assert.equal(quote.rentalAmount, 300); assert.equal(quote.request.lines[0].quantity, 3, 'history never rewritten');
});

test('Core whole-return reduction cannot reopen or double-charge an original automatic or approved receipt', () => {
  const service = Object.create(RentalCoreService.prototype);
  const reduction = { amount: 20, requiresReview: false, basis: ['original unused units'] };
  for (const prior of [
    { chargeLines: [{ code: 'early_return_refund:o', type: 'early_return_refund', amount: -50 }], feeReviews: [] },
    { chargeLines: [{ code: 'early_return_refund:o:order', type: 'early_return_refund', amount: -50 }], feeReviews: [] },
    { chargeLines: [], feeReviews: [{ id: 'original', type: 'early_return_refund', status: 'approved', decidedAmount: 50 }] }
  ]) {
    const order = { id: 'o', finalPayableAmount: 100, payableAmount: 150, adjustmentAmount: -50, ...structuredClone(prior) };
    const before = structuredClone(order);
    service.applyEarlyReturnRefundTo(order, reduction);
    assert.deepEqual(order, before);
    service.applyEarlyReturnRefundTo(order, { amount: null, maximumAmount: 100, requiresReview: true, basis: ['missing historic segment'] });
    assert.deepEqual(order, before, 'manual fallback must not create another pending whole-return review');
  }
  const different = { id: 'o', finalPayableAmount: 100, payableAmount: 150, adjustmentAmount: -50,
    chargeLines: [{ code: 'early_return_refund:o:exchange', type: 'early_return_refund', amount: -50 }],
    feeReviews: [{ type: 'early_return_refund', sourceId: 'exchange', status: 'approved' }] };
  service.applyEarlyReturnRefundTo(different, reduction);
  assert.equal(different.finalPayableAmount, 80);
  assert.equal(different.chargeLines.length, 2);
});

test('approving a stale whole-return review cannot double-reduce a prior automatic receipt', async () => {
  const service = Object.create(RentalCoreService.prototype);
  const order = { id: 'o', status: 'settling', finalPayableAmount: 100, payableAmount: 150, adjustmentAmount: -50,
    chargeLines: [{ code: 'early_return_refund:o', type: 'early_return_refund', amount: -50 }],
    feeReviews: [{ id: 'stale-review', type: 'early_return_refund', status: 'pending', suggestedAmount: 20, basis: ['old proposal'] }] };
  const before = structuredClone(order); let writes = 0;
  service.lockedOrder = async () => order; service.factStore = { saveOrderAggregate: async () => { writes++; } };
  await assert.rejects(service.reviewOrderFeeReview('t', 'o', 'stale-review', { decision: 'approved', reason: 'duplicate' }, 'operator', {}), /来源.*已.*核减/);
  assert.deepEqual(order, before); assert.equal(writes, 0);
  await service.reviewOrderFeeReview('t', 'o', 'stale-review', { decision: 'rejected', reason: 'original reduction exists' }, 'operator', {});
  assert.equal(order.finalPayableAmount, 100); assert.equal(order.feeReviews[0].status, 'rejected'); assert.equal(writes, 1);
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
