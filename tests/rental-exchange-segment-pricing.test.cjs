'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalCoreController } = require('../apps/api/src/modules/rental-core/rental-core.controller');
const { returnPricingSlices } = require('../apps/api/src/modules/rental-core/rental-return-pricing');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const start = '2026-10-01T00:00:00.000Z';
const at = days => new Date(Date.parse(start) + days * 86400000).toISOString();
const clone = structuredClone;
function fixture({ unit = 'day_24h', days = 10, old = 10, next = 20, minimum = 1, tiers = [], cap, quantity = 1 } = {}) {
  const rate = (id, amount) => ({ itemGroupId: id, itemGroupCode: id.toUpperCase(), unit, baseAmount: amount,
    minimumUnits: minimum, weekendMultiplier: 1, holidayMultiplier: 1, tiers: clone(tiers), maxAmount: cap });
  const rates = [rate('a', old), rate('b', next), rate('c', 30)];
  const context = { profile: { categoryCode: 'camera' }, category: { code: 'camera' },
    settings: { calendar: { timeZone: 'UTC' }, pricing: { holidayPricingEnabled: false, currency: 'CNY' } },
    groups: ['a', 'b', 'c'].map(id => ({ id, code: id.toUpperCase(), name: id.toUpperCase(), status: 'enabled', inventoryMode: 'quantity', attributes: {} })),
    pricingGroups: [] };
  const pricingContext = { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, dayRates: rates.filter(row => row.unit === 'day_24h') };
  const rule = { pricing: {}, payment: { depositMode: 'none' }, overdue: { graceMinutes: 0, feeMode: 'hourly', feeMultiplier: 1 },
    earlyReturn: { mode: 'none' }, qualification: { required: false }, fulfillment: { pickupBufferMinutes: 15, returnBufferMinutes: 30 } };
  const business = Object.create(RentalBusinessService.prototype);
  business.workspaceOf = () => 'w'; business.calendarsForDateRange = () => [];
  business.resolveSpaceRates = async () => ({ versionId: 'price-next', version: '2', rates: clone(rates) });
  business.coreConfigStore = { listInspectionTemplates: async () => [{ id: 'return', tenantId: 't', categoryCode: 'camera', stage: 'return', enabled: true, fields: [] }] };
  const original = business.priceRentalLine({ group: context.groups[0], quantity, rate: rates[0], startAt: start, endAt: at(days),
    timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, planId: 'price-original', planVersion: '1', codePrefix: 'rental', chargeType: 'rental' });
  const quote = { id: 'q', tenantId: 't', categoryCode: 'camera', currency: 'CNY', priceVersionId: 'price-original', priceVersion: '1', pricingPlanVersion: '1', ruleVersion: 'r1',
    request: { startAt: start, endAt: at(days), lines: [{ itemGroupId: 'a', quantity, pricingUnit: unit }] },
    rentalAmount: original.amount, rentalLineAmounts: { a: original.amount }, payableAmount: original.amount,
    serviceAmount: 0, fulfillmentAmount: 0, discountAmount: 0, couponAmount: 0,
    depositAmount: 0, preAuthAmount: 0, discountEvaluations: [], chargeLines: [original.chargeLine],
    rateSnapshot: [clone(rates[0])], calendarSnapshot: original.calendarRows, pricingContext, ruleSnapshot: rule };
  business.loadQuote = async (tenant, _context, id, tx) => {
    assert.equal(tenant, 't'); assert.equal(id, 'q'); return clone(quote);
  };
  const order = { id: 'o', tenantId: 't', quoteId: 'q', currency: quote.currency, status: 'renting', categoryCode: 'camera', updatedAt: 'revision', startAt: start, endAt: at(days),
    fulfillmentLocationId: 'loc', returnLocationId: 'loc', fulfillmentMode: 'store_pickup_return', customerType: 'personal',
    depositAmount: 0, preAuthAmount: 0, finalPayableAmount: original.amount, payableAmount: original.amount, adjustmentAmount: 0,
    lines: [{ id: 'line', itemGroupId: 'a', itemGroupCode: 'A', itemGroupName: 'A', inventoryMode: 'quantity', quantity,
      amount: original.amount, unitPrice: original.amount / quantity }], allocations: [{ id: 'allocation', orderId: 'o', orderLineId: 'line', itemGroupId: 'a', status: 'picked_up', quantity }],
    reservations: [{ id: 'reservation', orderId: 'o', orderLineId: 'line', itemGroupId: 'a', locationId: 'loc', status: 'fulfilled', quantity, releasedQuantity: 0 }],
    inspectionTemplateSnapshots: [{ id: 'return', code: 'RETURN', version: '1', stage: 'return', enabled: true, fields: [] }],
    ruleSnapshot: rule, serviceSnapshots: [], chargeLines: clone(quote.chargeLines) };
  const changes = [], extensions = [];
  const quoteExchange = (point = at(5), priceBasis = 'replacement_current_price', replacementItemGroupId = 'b') =>
    business.quotePostPickupExchange('t', context, { order, previousChanges: changes, previousExtensions: extensions,
      orderLineId: 'line', replacementItemGroupId, priceBasis, appliedAt: point,
      fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal', tx: { original: true } });
  const core = Object.create(RentalCoreService.prototype);
  core.factContext = async () => ({ profile: { categoryCode: 'camera' }, itemGroups: context.groups, pricingGroups: [] });
  core.lockedOrder = async () => order; core.resolveWorkspaceId = () => 'w';
  core.assertOrderQualification = async () => undefined; core.assertOrderFulfillmentAdmission = async () => undefined;
  core.loadInventorySnapshot = async () => ({ assets: [], reservations: [], stockBalances: [] });
  core.availableQuantity = () => 100; core.validateAllocationEquipment = async () => undefined;
  core.listInspectionTemplates = async () => clone(order.inspectionTemplateSnapshots);
  core.recordReturnDispositions = async () => undefined; core.quarantinedReturnQuantities = () => [];
  core.factStore = { lockInventoryTargets: async () => undefined, insertInspection: async () => undefined, upsertWorkOrder: async () => undefined,
    listOrderChanges: async () => clone(changes), saveOrderAggregate: async () => undefined,
    insertOrderChange: async row => changes.push(clone(row)) };
  const apply = async (point = at(5), priceBasis = 'replacement_current_price', replacementItemGroupId = 'b') => {
    const result = await quoteExchange(point, priceBasis, replacementItemGroupId);
    const basis = await business.captureExchangeExecutionBasis('t', context, priceBasis, point, result.priced);
    const allocation = order.allocations.find(row => row.orderLineId === 'line' && ['picked_up', 'locked'].includes(row.status));
    assert.equal(allocation.status, 'picked_up', 'Core must preserve actual handover status for another formal exchange');
    const input = { type: 'post_pickup_exchange', orderLineId: 'line', allocationId: allocation.id, replacementItemGroupId,
      priceBasis, originalDisposition: 'return_to_warehouse', reason: 'fault', customerConfirmed: true,
      expectedUpdatedAt: order.updatedAt, inspectionSnapshot: { customerConfirmed: true } };
    const preview = { ...result.priced, differenceAmount: result.priced.pricingSnapshot.differenceAmount, exchange: {
      ...input, originalItemGroupId: order.lines[0].itemGroupId, originalAmount: result.originalAmount,
      replacementAmount: result.replacementAmount, executionBasis: basis } };
    const applied = await runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, () =>
      core.applyPostPickupExchange('t', 'o', preview, input, `exchange-${changes.length}`, 'Operator', {}));
    return { ...result, applied };
  };
  const controller = Object.create(RentalCoreController.prototype);
  controller.business = business; controller.service = { lockOrderForUpdate: async () => clone(order), resolveWorkspaceId: () => 'w',
    listOrderChanges: async () => clone(changes), listOrderExtensions: async () => clone(extensions) };
  const overdue = items => controller.returnCharges('t', context, 'o', new Date(Date.parse(order.effectiveEndAt ?? order.endAt) + 3600000).toISOString(), {}, items, 'batch', false);
  return { business, core, controller, context, order, quote, rates, changes, extensions, quoteExchange, apply, overdue };
}

test('actual quote -> Core exchange -> return uses performed 50 and remaining 100, not whole-period 200', async () => {
  const f = fixture(); const before = clone(f.quote);
  const result = await f.apply();
  assert.equal(result.originalAmount, 100); assert.equal(result.replacementAmount, 150);
  assert.equal(result.priced.pricingSnapshot.differenceAmount, 50);
  assert.equal(f.order.finalPayableAmount, 150); assert.equal(f.order.lines[0].amount, 150);
  assert.deepEqual(result.priced.linePricing.segments.map(row => row.amount), [50, 100]);
  assert.equal(result.priced.linePricing.overdueBasis.billableUnits, 5);
  assert.equal(result.priced.linePricing.overdueBasis.billedHours, 120);
  assert.equal((await f.overdue()).overdue.amount, 0.83);
  assert.equal(f.changes[0].appliedAt, f.changes[0].diff.exchange.executionBasis.effectiveFrom);
  assert.equal(f.order.allocations.at(-1).metadata.assignedAt, f.changes[0].appliedAt);
  assert.deepEqual(f.quote, before);
});

test('original price keeps exact prepaid units and no price difference through a second exchange', async () => {
  const f = fixture({ days: 2, minimum: 3 });
  assert.equal((await f.apply(at(1), 'original_order_price')).priced.pricingSnapshot.differenceAmount, 0);
  assert.equal(f.order.finalPayableAmount, 30);
  assert.equal(f.changes[0].diff.exchange.executionBasis.linePricing.overdueBasis.billableUnits, 3);
  assert.equal((await f.apply(at(1.5), 'original_order_price', 'c')).priced.pricingSnapshot.differenceAmount, 0);
  assert.equal(f.order.lines[0].itemGroupId, 'c'); assert.equal(f.order.finalPayableAmount, 30);
  assert.equal((await f.overdue()).overdue.amount, 0.42);
});

test('A -> B -> C prices only each remaining segment; partial return uses actual held quantity', async () => {
  const f = fixture({ quantity: 3 });
  await f.apply();
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.originalAmount, 450); assert.equal(second.replacementAmount, 540);
  assert.equal(second.priced.pricingSnapshot.differenceAmount, 90); assert.equal(f.order.finalPayableAmount, 540);
  assert.deepEqual(second.priced.linePricing.segments.map(row => row.amount), [150, 120, 270]);
  assert.equal((await f.overdue([{ allocationId: f.order.allocations.at(-1).id, quantity: 1 }])).overdue.amount, 1.25);
  f.rates[2].baseAmount = 9999;
  assert.equal((await f.overdue()).overdue.amount, 3.75);
});

test('selected old tier is not recomputed for used time; remaining cap includes performed rental', async () => {
  const tier = fixture({ tiers: [{ minUnits: 7, unitAmount: 8 }] });
  const t = await tier.quoteExchange();
  assert.equal(t.originalAmount, 80); assert.deepEqual(t.priced.linePricing.segments.map(row => row.amount), [40, 100]);
  assert.equal(t.priced.pricingSnapshot.differenceAmount, 60);
  const capped = fixture({ cap: 120 }); const c = await capped.quoteExchange();
  assert.deepEqual(c.priced.linePricing.segments.map(row => row.amount), [50, 70]);
  assert.equal(c.replacementAmount, 120); assert.equal(c.priced.pricingSnapshot.differenceAmount, 20);
});

test('week, month and calendar-day split with the original strategy rather than daily prorating', async () => {
  for (const [unit, days, point, original, expected] of [['week', 14, 7, 10, 30], ['month', 60, 30, 10, 30],
    ['calendar_day', 10, 5, 10, 150], ['night', 10, 5, 10, 120], ['shift', 2, 1, 10, 90]]) {
    const f = fixture({ unit, days, old: original });
    const result = await f.quoteExchange(at(point));
    assert.equal(result.replacementAmount, expected, unit);
    assert.equal(result.priced.linePricing.segments[0].rate.unit, unit);
  }
});

test('frozen old calendar and current remaining calendar are separate; hourly-to-daily preserves billed coverage', async () => {
  const f = fixture();
  f.quote.rateSnapshot[0].dayTypePrices = { workday: 2 };
  f.quote.rentalAmount = f.quote.payableAmount = f.quote.chargeLines[0].amount = f.quote.rentalLineAmounts.a = 200;
  f.order.lines[0].amount = f.order.finalPayableAmount = 200;
  const result = await f.quoteExchange();
  assert.deepEqual(result.priced.linePricing.segments.map(row => row.amount), [100, 100]);
  const h = fixture({ unit: 'hour', days: 1, old: 10, next: 20 });
  h.quote.ruleSnapshot.pricing = { hourToDayEnabled: true, hourToDayThresholdHours: 6 };
  h.quote.pricingContext.dayRates = [{ ...h.rates[0], unit: 'day_24h', baseAmount: 100 }];
  h.rates.push({ ...h.rates[1], unit: 'day_24h', baseAmount: 150 });
  h.quote.rentalAmount = h.quote.payableAmount = h.quote.chargeLines[0].amount = h.quote.rentalLineAmounts.a = 100;
  h.order.lines[0].amount = h.order.finalPayableAmount = 100;
  const short = await h.quoteExchange(at(0.02));
  assert.equal(short.priced.linePricing.segments[0].amount, 10, 'a frozen day price cannot become the hourly rate for the used prefix');
  assert.equal(short.replacementAmount, 160);
  const hr = await h.apply(at(0.5));
  assert.equal(hr.replacementAmount, 250);
  assert.equal(hr.priced.linePricing.overdueBasis.billedHours, 24);
  assert.equal((await h.overdue()).overdue.amount, 6.25);
});

test('original-price carried blocks split cumulatively; new prices after another exchange do not double consumed units', async () => {
  const f = fixture({ days: 4, minimum: 1 });
  await f.apply(at(0.5), 'original_order_price');
  const second = await f.apply(at(1.2), 'replacement_current_price', 'c');
  assert.deepEqual(second.priced.linePricing.segments.map(row => row.amount), [10, 10, 90]);
  assert.equal(second.replacementAmount, 110);
});

test('a completed original-total extension is a frozen source and a later early return remains manual', async () => {
  const f = fixture();
  const full = f.business.priceRentalLine({ group: f.context.groups[0], quantity: 1, rate: f.rates[0], startAt: start, endAt: at(12),
    timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, planId: 'price-original', planVersion: '1', codePrefix: 'rental', chargeType: 'rental' });
  f.extensions.push({ id: 'ext', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective', originalEndAt: at(10), newEndAt: at(12),
    rateSnapshot: [clone(f.rates[0])], ruleSnapshot: clone(f.quote.ruleSnapshot), executionBasis: { pricingMode: 'original_total' },
    pricingSnapshot: { context: clone(f.quote.pricingContext), fullChargeLines: [full.chargeLine], recalculatedDiscountAmount: 0, recalculatedCouponAmount: 0 } });
  f.order.effectiveEndAt = at(12); f.order.finalPayableAmount = 120; f.order.adjustmentAmount = 20;
  f.order.chargeLines.push({ code: 'extension:1', name: '已生效续租', type: 'extension', amount: 20 });
  const result = await f.apply(at(5));
  assert.equal(result.originalAmount, 120); assert.equal(result.replacementAmount, 190);
  assert.equal(f.order.finalPayableAmount, 190);
  f.order.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100 };
  const early = f.business.calculateEarlyReturnRefund('t', f.context, f.quote, at(12), at(8), 0, undefined, { ...f.order, changes: f.changes });
  assert.equal(early.amount, null); assert.equal(early.requiresReview, true); assert.equal(early.maximumAmount, 190);
  f.extensions[0].pricingSnapshot.refundReview = { status: 'pending', amount: 20 };
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /原续租负差额尚未完整核减/);
});

test('new incremental extension persists its exact billed context through request/payment and later exchange', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental', forceImmediateWhenOverdue: true };
  f.rates[0].baseAmount = 40;
  const state = { pricingPlans: [{ id: 'current-plan', code: 'CURRENT', name: 'Current', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], quotes: [], calendars: [], ruleVersions: [] };
  f.business.state = () => state;
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  f.core.state = () => ({ profile: { categoryCode: 'camera', terminology: { pickupLabel: '领取' } }, itemGroups: f.context.groups });
  f.core.assertOrderExtensionAvailable = async () => undefined;
  let fundingChecks = 0;
  f.core.funding = { assertReadyForExtension: async () => { fundingChecks++; } };
  f.core.factStore.listExtensions = async () => clone(f.extensions);
  f.core.factStore.insertExtension = async row => f.extensions.push(clone(row));
  f.core.factStore.markExtensionEffective = async (_tenant, id, effectiveAt, paidAt) => {
    const row = f.extensions.find(item => item.id === id); assert.ok(row); Object.assign(row, { status: 'effective', effectiveAt, paidAt });
  };
  const twoLines = [...f.order.lines, { ...clone(f.order.lines[0]), id: 'line-2' }];
  const multiple = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: twoLines,
    newEndAt: at(12), appliedAt: at(5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(multiple.rentalAmount, 160); assert.equal(multiple.rateSnapshot.length, 1);
  assert.deepEqual(multiple.executionBasis.incrementalPricing.lines.map(row => row.orderLineId), ['line', 'line-2']);
  require('../apps/api/src/modules/rental-core/rental-exchange-pricing-source').assertIncrementalPricingSnapshot(
    multiple.executionBasis.incrementalPricing, 160, 4, { tenantId: 't', startAt: at(10), endAt: at(12), lines: twoLines, rates: multiple.rateSnapshot });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: [], lines: f.order.lines,
    newEndAt: at(12), appliedAt: at(5), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 80); assert.equal(priced.pricingSnapshot, undefined, 'incremental pricing must not enter original-total settlement');
  const saved = clone(priced.executionBasis.incrementalPricing);
  assert.equal(saved.lines[0].orderLineId, 'line'); assert.equal(saved.lines[0].billableUnits, 2); assert.equal(saved.lines[0].billedHours, 48);
  const scoped = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, work);
  const calendar = { tenantId: 't', year: 2026, version: 'calendar-original', days: [] };
  const beforeRequest = clone(f.order);
  for (const mutate of [value => { value.executionBasis.incrementalPricing = null; },
    value => { value.executionBasis.incrementalPricing.lines[0] = null; },
    value => { value.executionBasis.incrementalPricing.lines[0].amount++; },
    value => { value.executionBasis.incrementalPricing.lines[0].billableUnits++; },
    value => { value.executionBasis.incrementalPricing.startAt = at(9); },
    value => { value.executionBasis.incrementalPricing.endAt = at(13); },
    value => { delete value.executionBasis.incrementalPricing.lines[0].orderLineId; },
    value => { value.executionBasis.incrementalPricing.lines[0].orderLineId = 'another-line'; },
    value => { value.executionBasis.incrementalPricing.lines[0].itemGroupId = 'another-group'; },
    value => { value.executionBasis.incrementalPricing.lines[0].quantity++; },
    value => { value.executionBasis.incrementalPricing.context.calendars = [{ ...calendar, tenantId: 'other' }]; },
    value => { value.executionBasis.incrementalPricing.context.timeZone = 'not-a-time-zone'; },
    value => { value.rateSnapshot = []; },
    value => { value.rateSnapshot.push(clone(value.rateSnapshot[0])); },
    value => { value.rateSnapshot[0].unit = 'hour'; },
    value => { value.orderId = 'another-order'; },
    value => { value.pricingSnapshot = {}; }]) {
    const invalid = clone(priced); mutate(invalid);
    await assert.rejects(scoped(() => f.core.requestOrderExtension('t', 'o', invalid,
      { idempotencyKey: 'invalid-source', operator: 'Operator' }, {})), error => error.status === 409);
    assert.equal(f.extensions.length, 0); assert.deepEqual(f.order, beforeRequest); assert.equal(fundingChecks, 0);
  }
  const requested = await scoped(() => f.core.requestOrderExtension('t', 'o', priced, { idempotencyKey: 'extension-original', operator: 'Operator' }, {}));
  assert.equal(requested.extension.status, 'pending_payment'); assert.equal(f.order.effectiveEndAt, undefined);
  assert.deepEqual(f.extensions[0].executionBasis.incrementalPricing, saved);
  const pending = clone(f.extensions[0]);
  for (const mutate of [value => { value.executionBasis.incrementalPricing = null; },
    value => { value.executionBasis.incrementalPricing.lines[0].amount++; },
    value => { value.executionBasis.incrementalPricing.lines[0].orderLineId = 'another-line'; },
    value => { value.executionBasis.incrementalPricing.lines[0].billedHours = 0; },
    value => { value.newEndAt = at(13); },
    value => { value.executionBasis.incrementalPricing.endAt = at(13); },
    value => { value.executionBasis.incrementalPricing.context.calendars = [{ ...calendar, tenantId: 'other' }]; },
    value => { value.workspaceId = 'other'; }, value => { value.orderId = 'other'; },
    value => { value.pricingSnapshot = {}; }]) {
    const invalid = clone(pending); mutate(invalid); f.extensions[0] = invalid;
    await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), error => error.status === 409);
    assert.equal(f.extensions[0].status, 'pending_payment'); assert.deepEqual(f.order, beforeRequest); assert.equal(fundingChecks, 0);
  }
  f.extensions[0] = { ...clone(pending), newEndAt: pending.originalEndAt };
  await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), error => error.status === 400);
  assert.equal(f.extensions[0].status, 'pending_payment'); assert.deepEqual(f.order, beforeRequest); assert.equal(fundingChecks, 0);
  f.extensions[0] = pending;
  await scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {}));
  assert.equal(f.order.effectiveEndAt, at(12)); assert.equal(f.order.finalPayableAmount, 180); assert.equal(fundingChecks, 1);
  f.context.settings.calendar.timeZone = 'Asia/Shanghai'; f.rates[0].baseAmount = 999;
  const effective = clone(f.extensions[0]), beforeExchange = clone(f.order);
  // Corrupt the original extension before any exchange/negative review exists:
  // each assertion must reach the receipt gate, not the unrelated refund gate.
  for (const [mutate, message] of [[value => { value.executionBasis.incrementalPricing.lines[0].amount++; }, /逐行金额/],
    [value => { value.executionBasis.incrementalPricing.lines[0] = null; }, /逐行金额/],
    [value => { value.executionBasis.incrementalPricing.lines[0].billableUnits++; }, /逐行金额/],
    [value => { value.executionBasis.incrementalPricing.lines[0].billedHours++; }, /已计单位无法复算/],
    [value => { value.executionBasis.incrementalPricing.lines[0].pricingUnit = 'hour'; }, /唯一稳定行来源/],
    [value => { value.executionBasis.incrementalPricing.context.calendars = [{ ...calendar, tenantId: 'other' }]; }, /本租户计价上下文/],
    [value => { delete value.priceVersion; }, /原价格版本/],
    [value => { value.executionBasis.incrementalPricing.startAt = at(9); }, /本租户计价上下文/],
    [value => { value.executionBasis.incrementalPricing.endAt = at(13); }, /本租户计价上下文/],
    [value => { delete value.executionBasis.incrementalPricing; }, /逐行计价日历/]]) {
    const invalid = clone(effective); mutate(invalid); f.extensions[0] = invalid;
    await assert.rejects(f.quoteExchange(at(11)), message);
    assert.equal(f.changes.length, 0); assert.deepEqual(f.order, beforeExchange);
  }
  f.extensions[0] = effective;
  const changed = await f.apply(at(11));
  assert.equal(changed.originalAmount, 180); assert.equal(changed.replacementAmount, 160);
  assert.deepEqual(changed.priced.linePricing.segments.map(row => row.amount), [100, 40, 20]);
  assert.equal(changed.priced.linePricing.previousSegments[1].context.timeZone, 'UTC');
  assert.equal(changed.priced.linePricing.previousSegments[1].source.id, requested.extension.id);
  assert.equal((await f.overdue()).overdue.amount, 0.83, 'return after the effective extension and exchange uses the last billed 20/24-hour source');
  await assert.rejects(f.quoteExchange(at(11.5), 'replacement_current_price', 'c'), /此前换货负差额尚未完整核减/);
});

test('exchange -> incremental extension -> return -> exchange retains old sources and prices only the new period', async () => {
  const f = fixture({ quantity: 3 });
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental', forceImmediateWhenOverdue: true };
  await f.apply(at(5));
  assert.equal(f.order.finalPayableAmount, 450);
  f.rates[1].baseAmount = 40;
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], services: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  f.core.state = () => ({ profile: { categoryCode: 'camera', terminology: { pickupLabel: '领取' } }, itemGroups: f.context.groups });
  f.core.assertOrderExtensionAvailable = async () => undefined;
  f.core.funding = { assertReadyForExtension: async () => undefined };
  f.core.factStore.listExtensions = async () => clone(f.extensions);
  f.core.factStore.insertExtension = async row => f.extensions.push(clone(row));
  f.core.factStore.markExtensionEffective = async (_tenant, id, effectiveAt, paidAt) => {
    Object.assign(f.extensions.find(row => row.id === id), { status: 'effective', effectiveAt, paidAt });
  };
  const pricing = () => f.business.quoteOrderExtension('t', f.context, { order: f.order, previousExtensions: f.extensions,
    previousChanges: f.changes, tx: { original: true }, lines: f.order.lines, newEndAt: at(12), appliedAt: at(7),
    settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  const changeBefore = clone(f.changes[0]);
  const versioned = f.business.resolveSpaceRates;
  f.business.resolveSpaceRates = async () => ({ rates: f.rates });
  await assert.rejects(pricing(), /已发布价格版本/);
  f.business.resolveSpaceRates = versioned;
  f.context.settings.pricing.currency = 'USD';
  await assert.rejects(pricing(), /币种不一致/);
  f.context.settings.pricing.currency = 'CNY';
  f.controller.context = async () => f.context;
  f.controller.service.getOrder = async () => clone(f.order);
  f.controller.service.assertOrderExtensionAvailable = async () => undefined;
  const tx = { original: true };
  const originalLoader = f.business.loadQuote;
  f.business.loadQuote = async (tenant, context, id, receivedTx) => {
    assert.equal(receivedTx, tx, 'Controller must keep original quote reads in its transaction');
    return originalLoader(tenant, context, id, receivedTx);
  };
  const originalRates = f.business.resolveSpaceRates;
  f.business.resolveSpaceRates = async (tenant, context, at, receivedTx) => {
    assert.equal(receivedTx, tx, 'new price-version reads use the same transaction');
    return originalRates(tenant, context, at, receivedTx);
  };
  const { priced } = await f.controller.priceExtension('t', 'o', { newEndAt: at(12) }, tx);
  f.business.loadQuote = originalLoader; f.business.resolveSpaceRates = originalRates;
  assert.equal((await pricing()).rentalAmount, priced.rentalAmount);
  assert.equal(priced.rentalAmount, 240); assert.equal(priced.pricingSnapshot, undefined);
  assert.equal(priced.executionBasis.incrementalPricing.lines[0].itemGroupId, 'b');
  assert.equal(priced.executionBasis.incrementalPricing.lines[0].pricingUnit, 'day_24h');
  assert.equal(priced.executionBasis.incrementalPricing.lines[0].exchangeId, f.changes[0].id);
  const scoped = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, work);
  const oldPriced = clone(priced); delete oldPriced.executionBasis.incrementalPricing;
  await assert.rejects(scoped(() => f.core.requestOrderExtension('t', 'o', oldPriced,
    { idempotencyKey: 'extension-without-source', operator: 'Operator' }, {})), /缺少原稳定行计价收据/);
  assert.equal(f.extensions.length, 0);
  const requested = await scoped(() => f.core.requestOrderExtension('t', 'o', priced,
    { idempotencyKey: 'extension-after-exchange', operator: 'Operator' }, {}));
  assert.equal(f.order.effectiveEndAt, undefined); assert.equal(f.order.finalPayableAmount, 450);
  const pending = clone(f.extensions[0]); delete f.extensions[0].executionBasis.incrementalPricing;
  await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), /缺少原稳定行计价收据/);
  f.extensions[0] = pending;
  const held = f.order.allocations.at(-1), originalId = held.metadata.exchangeId;
  held.metadata.exchangeId = 'another-confirmed-exchange';
  await assert.rejects(scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {})), /换货来源已变化/);
  assert.equal(f.order.effectiveEndAt, undefined); assert.equal(f.extensions[0].status, 'pending_payment');
  held.metadata.exchangeId = originalId;
  await scoped(() => f.core.payOrderExtension('t', 'o', requested.extension.id, {}));
  assert.equal(f.order.effectiveEndAt, at(12)); assert.equal(f.order.finalPayableAmount, 690);
  assert.equal(f.order.lines[0].amount, 450, 'new extension does not overwrite the prior exchange billed base');
  assert.deepEqual(f.changes[0], changeBefore);
  f.rates[1].baseAmount = 999;
  assert.equal((await f.overdue()).overdue.amount, 5);
  assert.equal((await f.overdue([{ allocationId: f.order.allocations.at(-1).id, quantity: 1 }])).overdue.amount, 1.67);
  const receipt = clone(f.extensions[0]);
  for (const mutate of [row => { row.executionBasis.incrementalPricing.lines[0].amount++; },
    row => { row.executionBasis.incrementalPricing.context.timeZone = 'invalid-zone'; },
    row => { row.executionBasis.incrementalPricing.lines[0].exchangeId = 'other'; },
    row => { row.workspaceId = 'other'; }]) {
    f.extensions[0] = clone(receipt); mutate(f.extensions[0]);
    await assert.rejects(f.overdue(), error => error.status === 409);
  }
  f.extensions[0] = receipt;
  const second = await f.apply(at(11), 'replacement_current_price', 'c');
  assert.equal(second.originalAmount, 690); assert.equal(second.replacementAmount, 660);
  assert.equal(second.priced.pricingSnapshot.differenceAmount, -30);
  assert.deepEqual(second.priced.linePricing.segments.map(row => row.amount), [150, 300, 120, 90]);
  assert.equal((await f.overdue()).overdue.amount, 3.75, 'pending reduction does not prevent real return pricing');
});

test('original-price exchange after incremental extension uses the latest billed overdue source', async () => {
  const f = fixture();
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  await f.apply(at(5));
  const firstChange = clone(f.changes[0]);
  f.rates[1].baseAmount = 40;
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '2',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: f.rates }], services: [], calendars: [], ruleVersions: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, lines: f.order.lines,
    previousChanges: f.changes, previousExtensions: [], newEndAt: at(12), appliedAt: at(7), settlementMode: 'immediate',
    fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 80);
  f.extensions.push({ ...clone(priced), id: 'new-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective' });
  f.order.effectiveEndAt = at(12); f.order.finalPayableAmount = 230; f.order.adjustmentAmount = 130;
  f.order.chargeLines.push({ code: 'extension:1', name: '已生效续租', type: 'extension', amount: 80 });
  assert.equal((await f.overdue()).overdue.amount, 1.67);
  const result = await f.apply(at(11), 'original_order_price', 'c');
  assert.equal(result.originalAmount, 230); assert.equal(result.replacementAmount, 230);
  assert.equal(result.priced.pricingSnapshot.differenceAmount, 0);
  assert.deepEqual(result.priced.linePricing.segments.map(row => row.amount), [50, 100, 40, 40]);
  assert.equal(result.priced.linePricing.overdueBasis.source.id, 'new-extension');
  assert.equal(result.priced.linePricing.overdueBasis.amount, 80);
  assert.equal(result.priced.linePricing.overdueBasis.billableUnits, 2);
  assert.equal(result.priced.linePricing.overdueBasis.billedHours, 48);
  assert.equal((await f.overdue()).overdue.amount, 1.67, 'same prepaid period/rate after original-price exchange');
  assert.deepEqual(f.changes[0], firstChange);
  f.rates[1].baseAmount = 9999;
  assert.equal((await f.overdue()).overdue.amount, 1.67, 'later current prices cannot change original overdue');
  const again = await f.apply(at(11.5), 'original_order_price', 'b');
  assert.equal(again.priced.pricingSnapshot.differenceAmount, 0);
  assert.equal(again.priced.linePricing.segments.at(-1).amount, 0, 'already purchased units are not billed again');
  assert.equal(again.priced.linePricing.overdueBasis.amount, 80);
  assert.equal(again.priced.linePricing.overdueBasis.billedHours, 48);
  assert.equal((await f.overdue()).overdue.amount, 1.67, 'a later zero tail cannot replace purchased coverage');
});

test('extended hourly return never borrows the earlier exchange daily price when its own source lacks it', async () => {
  const f = fixture({ unit: 'hour', days: 1, old: 10, next: 20 });
  f.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental' };
  f.quote.ruleSnapshot.overdue = { graceMinutes: 0, feeMode: 'hourly_to_daily', hourlyRatePercent: 10, dailyAfterHours: 6, feeMultiplier: 1 };
  f.rates.push({ ...clone(f.rates[1]), unit: 'day_24h', baseAmount: 100 });
  await f.apply(at(0.5));
  const current = { ...clone(f.rates[1]), baseAmount: 5 };
  f.business.state = () => ({ pricingPlans: [{ id: 'current-plan', code: 'CURRENT', status: 'enabled', version: '3',
    effectiveFrom: '2020-01-01T00:00:00Z', rates: [current] }], services: [], calendars: [] });
  f.business.currentRule = () => ({ config: clone(f.quote.ruleSnapshot), version: 'rule-2' });
  f.business.resolveSpaceRates = async () => ({ versionId: 'new-price', version: '3', rates: [current] });
  const priced = await f.business.quoteOrderExtension('t', f.context, { order: f.order, lines: f.order.lines,
    previousChanges: f.changes, previousExtensions: [], newEndAt: at(2), appliedAt: at(0.7), settlementMode: 'immediate',
    fulfillmentMode: 'store_pickup_return', locationIds: ['loc'], customerType: 'personal' });
  assert.equal(priced.rentalAmount, 120);
  f.extensions.push({ ...clone(priced), id: 'new-extension', tenantId: 't', workspaceId: 'w', orderId: 'o', sequence: 1, status: 'effective' });
  f.order.effectiveEndAt = at(2);
  const original = clone(f.extensions[0]);
  await assert.rejects(f.overdue(), /原订单缺少对应日价快照/);
  f.extensions[0].executionBasis.incrementalPricing.context.dayRates.push({ ...clone(current), unit: 'day_24h', baseAmount: 200 });
  assert.equal((await f.overdue()).overdue.amount, 20, 'new extension daily source, not old exchange daily 100');
  assert.deepEqual(original.executionBasis.incrementalPricing.context.dayRates, []);
});

test('incremental receipt binding keeps same-target stable lines and consumed/usage boundaries distinct', () => {
  const { assertIncrementalPricingSnapshot } = require('../apps/api/src/modules/rental-core/rental-exchange-pricing-source');
  const f = fixture(), source = { version: 1, startAt: at(10), endAt: at(12), context: clone(f.quote.pricingContext),
    lines: [{ orderLineId: 'line', itemGroupId: 'a', quantity: 1, pricingUnit: 'day_24h', amount: 20,
      billableUnits: 2, billedHours: 48, selectedUnitAmount: 10 }] };
  const second = { ...clone(f.order.lines[0]), id: 'line-2' }, consumed = { ...clone(second), id: 'consumed', inventoryMode: 'consumable' };
  const binding = { tenantId: 't', startAt: at(10), endAt: at(12), lines: [...f.order.lines, second, consumed], rates: [f.rates[0]] };
  source.lines.push({ ...clone(source.lines[0]), orderLineId: 'line-2' });
  assert.doesNotThrow(() => assertIncrementalPricingSnapshot(source, 40, 4, binding));
  for (const mutate of [value => { value.lines[1].orderLineId = 'line'; },
    value => { value.lines[1].orderLineId = 'consumed'; }, value => { value.lines[1].pricingGroupId = 'other'; }]) {
    const invalid = clone(source); mutate(invalid);
    assert.throws(() => assertIncrementalPricingSnapshot(invalid, 40, 4, binding), error => error.status === 409);
  }
  const usage = { ...clone(source), lines: [{ ...clone(source.lines[0]), pricingUnit: 'usage', billedHours: 0 }] };
  const usageBinding = { ...binding, lines: f.order.lines, rates: [{ ...f.rates[0], unit: 'usage' }] };
  assert.doesNotThrow(() => assertIncrementalPricingSnapshot(usage, 20, 2, usageBinding), 'usage has no invented time denominator');
  usage.lines[0].billedHours = 48;
  assert.throws(() => assertIncrementalPricingSnapshot(usage, 20, 2, usageBinding), error => error.status === 409);
});

test('approved negative difference is read from the original review; missing or partial approval cannot be reused', async () => {
  const f = fixture({ next: 5 }); await f.apply();
  assert.equal(f.order.finalPayableAmount, 100); assert.equal(f.changes[0].refundAmount, 25);
  f.order.feeReviews[0].status = 'approved'; f.order.feeReviews[0].decidedAmount = 10;
  await assert.rejects(f.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  f.order.feeReviews[0].decidedAmount = 25;
  f.order.chargeLines.push({ code: `early_return_refund:o:${f.changes[0].id}`, name: '原换货核减', type: 'early_return_refund', amount: -25 });
  f.order.adjustmentAmount = -25; f.order.finalPayableAmount = 75;
  const second = await f.apply(at(7), 'replacement_current_price', 'c');
  assert.equal(second.originalAmount, 75); assert.equal(second.replacementAmount, 150);
  assert.equal(second.priced.pricingSnapshot.differenceAmount, 75); assert.equal(f.order.finalPayableAmount, 150);
});

test('named public schemas keep new billed-period fields optional for historical records and expose original price sources', () => {
  const { OPENAPI_COMPONENT_SCHEMAS: schemas, API_CONTRACT_OPERATIONS: operations } = require('../apps/api/src/contracts/openapi-document');
  const source = schemas.RentalExchangePricingSegment;
  for (const key of ['orderLineId', 'quantity', 'startAt', 'endAt', 'billableUnits', 'billedHours', 'amount', 'source', 'splitBasis']) {
    assert.ok(source.properties[key], key);
  }
  assert.deepEqual(source.properties.source.properties.kind.enum, ['quote', 'extension', 'price_version']);
  assert.equal(schemas.RentalExchangeExecutionBasis.required.includes('linePricing'), false, 'old read records remain representable');
  assert.equal(schemas.RentalExchangeExecutionBasis.properties.linePricing.properties.overdueBasis.$ref, '#/components/schemas/RentalExchangePricingSegment');
  assert.equal(operations.find(row => row.operationId === 'previewRentalOrderPostPickupExchange').responseSchema, 'RentalPostPickupExchangePreview');
  const { AI_EXTENSION_PREVIEW_HTTP_SCHEMAS } = require('@rental-os/shared');
  const pricing = AI_EXTENSION_PREVIEW_HTTP_SCHEMAS.AiExtensionPricingSnapshotDraft;
  assert.deepEqual(pricing.properties.scope.enum, ['order', 'exchange_line']);
  assert.equal(pricing.required.includes('scope'), false);
  const execution = AI_EXTENSION_PREVIEW_HTTP_SCHEMAS.AiExtensionExecutionBasisDraft;
  assert.equal(execution.required.includes('incrementalPricing'), false);
  assert.deepEqual(execution.properties.incrementalPricing.required, ['version', 'startAt', 'endAt', 'context', 'lines']);
  assert.deepEqual(schemas.AiExtensionExecutionBasisDraft, execution, 'OpenAPI uses the original shared closed schema');
});

test('current-price exchange cannot relabel currency and Core rejects unbound currency before resource writes', async () => {
  const changed = fixture(); changed.context.settings.pricing.currency = 'USD';
  await assert.rejects(changed.quoteExchange(), error => error.status === 409 && /币种/.test(error.message));
  const retained = await changed.quoteExchange(at(5), 'original_order_price');
  assert.equal(retained.priced.currency, 'CNY'); assert.equal(retained.replacementAmount, 100);
  for (const currency of [undefined, null, '', 'USD', 'XYZ']) {
    const f = fixture(), result = await f.quoteExchange();
    const input = { type: 'post_pickup_exchange', orderLineId: 'line', allocationId: 'allocation', replacementItemGroupId: 'b',
      priceBasis: 'replacement_current_price', originalDisposition: 'return_to_warehouse', reason: 'fault', customerConfirmed: true,
      expectedUpdatedAt: f.order.updatedAt, inspectionSnapshot: { customerConfirmed: true } };
    const basis = await f.business.captureExchangeExecutionBasis('t', f.context, input.priceBasis, at(5), result.priced);
    const preview = { ...result.priced, currency, differenceAmount: result.priced.pricingSnapshot.differenceAmount, exchange: {
      ...input, originalItemGroupId: 'a', originalAmount: result.originalAmount, replacementAmount: result.replacementAmount, executionBasis: basis } };
    let resources = 0;
    f.core.assertOrderQualification = async () => { resources++; };
    const before = clone(f.order);
    await assert.rejects(runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, () =>
      f.core.applyPostPickupExchange('t', 'o', preview, input, 'bad-currency', 'Operator', {})), error => error.status === 409);
    assert.deepEqual(f.order, before); assert.equal(f.changes.length, 0); assert.equal(resources, 0);
  }
});

test('missing/ambiguous original history, unsupported usage, pending reduction and invalid time fail closed', async () => {
  for (const mutate of [f => { f.quote.pricingContext = undefined; }, f => { f.quote.chargeLines[0].amount++; },
    f => { f.quote.request.lines.push(clone(f.quote.request.lines[0])); },
    f => { f.quote.discountEvaluations = [{ applied: true, discountAmount: 10 }]; },
    f => { f.quote.currency = undefined; },
    f => { f.order.lines[0].amount++; },
    f => { f.order.effectiveEndAt = at(12); },
    f => { f.order.allocations[0].metadata = { exchangeId: 'missing' }; }]) {
    const f = fixture(); mutate(f);
    await assert.rejects(f.quoteExchange(), error => error.status === 409);
    assert.equal(f.changes.length, 0); assert.equal(f.order.allocations.length, 1);
  }
  const invalid = fixture();
  for (const point of [at(-1), at(10), at(11), 'bad-time']) await assert.rejects(invalid.quoteExchange(point), /确认必须/);
  const lowered = fixture({ next: 5 }); await lowered.apply();
  await assert.rejects(lowered.quoteExchange(at(7), 'replacement_current_price', 'c'), /尚未完整核减/);
  const missing = fixture(); await missing.apply(); delete missing.changes[0].diff.exchange.executionBasis.linePricing;
  await assert.rejects(missing.quoteExchange(at(7), 'replacement_current_price', 'c'), /稳定行计价收据/);
  const unsupported = fixture(); unsupported.quote.rateSnapshot[0].unit = 'usage'; unsupported.quote.request.lines[0].pricingUnit = 'usage';
  await assert.rejects(unsupported.quoteExchange(), /使用量和包段/);
  const unversioned = fixture(); unversioned.business.resolveSpaceRates = async () => ({ rates: unversioned.rates });
  await assert.rejects(unversioned.quoteExchange(), /已发布价格版本/);
  const oldWhole = fixture();
  await assert.rejects(oldWhole.business.quoteOrderExtension('t', oldWhole.context, { order: oldWhole.order, lines: oldWhole.order.lines,
    newEndAt: oldWhole.order.endAt, mode: 'post_pickup_exchange' }), /稳定行剩余计价入口/);
  const backward = fixture(); await backward.apply();
  await assert.rejects(backward.quoteExchange(at(4), 'replacement_current_price', 'c'), /确认必须/);
  backward.business.state = () => ({ });
  backward.quote.ruleSnapshot.extension = { enabled: true, pricingMode: 'original_total' };
  await assert.rejects(backward.business.quoteOrderExtension('t', backward.context, { order: backward.order,
    newEndAt: at(12) }), /换货后全租期重算/);
  await assert.rejects(backward.business.quoteOrderExtension('t', backward.context, { order: backward.order,
    newEndAt: at(12), mode: 'carrier_return_repricing' }), /换货后全租期或承运重算/);
  const damaged = fixture(); await damaged.apply(); damaged.changes[0].diff.exchange.executionBasis.linePricing.overdueBasis.billedHours = -1;
  assert.throws(() => returnPricingSlices('t', 'w', damaged.quote, damaged.order, damaged.changes), /计价段/);
});
