'use strict';
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RentalCoreController } = require('../apps/api/src/modules/rental-core/rental-core.controller');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { returnPricingSlices } = require('../apps/api/src/modules/rental-core/rental-return-pricing');
const start = '2026-10-01T00:00:00Z', due = '2026-10-11T00:00:00Z';
const rate = (id, baseAmount = 240) => ({ itemGroupId: id, itemGroupCode: id.toUpperCase(), unit: 'day_24h',
  baseAmount, minimumUnits: 1, weekendMultiplier: 1, holidayMultiplier: 1, tiers: [] });
function fixture(priceBasis = 'replacement_current_price') {
  const rule = { pricing: {}, overdue: { graceMinutes: 0, feeMode: 'hourly', feeMultiplier: 1 }, earlyReturn: { mode: 'none' } };
  const quote = { id: 'q', tenantId: 't', rentalAmount: 7200, rateSnapshot: [rate('a')],
    rentalLineAmounts: { a: 7200 }, request: { startAt: start, endAt: due, lines: [{ itemGroupId: 'a', quantity: 3, pricingUnit: 'day_24h' }] },
    ruleSnapshot: rule, chargeLines: [{ code: 'rental:A', type: 'rental', amount: 7200 }],
    pricingContext: { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, dayRates: [rate('a')] } };
  const before = { id: 'line', itemGroupId: 'a', itemGroupCode: 'A', itemGroupName: 'A', quantity: 3, amount: 7200 };
  const line = { ...before, itemGroupId: 'b', itemGroupCode: 'B', itemGroupName: 'B', amount: priceBasis === 'original_order_price' ? 7200 : 14400 };
  const order = { id: 'o', tenantId: 't', quoteId: 'q', endAt: due, startAt: start, lines: [line], ruleSnapshot: rule,
    allocations: [{ id: 'old', orderId: 'o', orderLineId: 'line', itemGroupId: 'a', quantity: 3, status: 'returned' },
      { id: 'new', orderId: 'o', orderLineId: 'line', itemGroupId: 'b', quantity: 3, status: 'locked', metadata: { exchangeId: 'e1' } }], chargeLines: [] };
  const changes = [{ id: 'e1', tenantId: 't', workspaceId: 'w', orderId: 'o', type: 'post_pickup_exchange', status: 'applied',
    appliedAt: '2026-10-06T00:00:00Z', beforeSnapshot: { line: before }, diff: { exchange: { orderLineId: 'line', originalItemGroupId: 'a',
      replacementItemGroupId: 'b', replacementAmount: line.amount, executionBasis: { priceBasis, effectiveFrom: '2026-10-06T00:00:00Z',
        rateSnapshot: [priceBasis === 'original_order_price' ? rate('a') : rate('b', 480)], ruleSnapshot: rule,
        pricingSnapshot: { context: { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false,
          dayRates: [priceBasis === 'original_order_price' ? rate('a') : rate('b', 480)] } } } } } }];
  const context = { settings: { calendar: { timeZone: 'UTC' } }, groups: ['a', 'b', 'c'].map(id => ({ id, code: id.toUpperCase(), name: id.toUpperCase() })), pricingGroups: [] };
  const business = Object.create(RentalBusinessService.prototype);
  const controller = Object.create(RentalCoreController.prototype);
  controller.service = { lockOrderForUpdate: async () => structuredClone(order), resolveWorkspaceId: () => 'w',
    listOrderExtensions: async () => [], listOrderChanges: async () => structuredClone(changes) };
  business.loadQuote = async () => structuredClone(quote);
  controller.business = business;
  const charges = (items, at = '2026-10-11T01:00:00Z') => controller.returnCharges('t', context, 'o', at, {}, items, 'batch', false);
  return { order, quote, changes, rule, context, business, controller, charges };
}

test('replacement target overdue uses its original exchange price with stable allocation quantities', async () => {
  for (const basis of ['original_order_price', 'replacement_current_price']) {
    const f = fixture(basis), before = structuredClone({ quote: f.quote, order: f.order, changes: f.changes });
    const perItem = basis === 'original_order_price' ? 10 : 20;
    assert.equal((await f.charges()).overdue.amount, perItem * 3);
    assert.equal((await f.charges([{ allocationId: 'new', quantity: 1 }])).overdue.amount, perItem);
    assert.deepEqual(f.quote, before.quote); assert.deepEqual(f.order, before.order); assert.deepEqual(f.changes, before.changes);
  }
});

test('split return ignores retired allocations and does not charge the previously returned quantity again', async () => {
  const f = fixture();
  f.order.allocations[1].quantity = 2;
  f.order.allocations.push({ ...f.order.allocations[1], id: 'already-returned', quantity: 1, status: 'returned' });
  assert.equal((await f.charges()).overdue.amount, 40);
  assert.equal((await f.charges([{ allocationId: 'new', quantity: 1 }])).overdue.amount, 20);
  await assert.rejects(f.charges([{ allocationId: 'already-returned', quantity: 1 }]), /实际分配/);
  await assert.rejects(f.charges([{ allocationId: 'new', quantity: 1 }, { allocationId: 'new', quantity: 1 }]), /不可重复/);
  const original = { id: 'line-original', itemGroupId: 'a', itemGroupCode: 'A', itemGroupName: 'A', quantity: 1, amount: 2400 };
  f.order.lines.push(original);
  f.order.allocations.push({ id: 'original', orderId: 'o', orderLineId: original.id, itemGroupId: 'a', quantity: 1, status: 'picked_up' });
  f.order.effectiveEndAt = '2026-10-12T00:00:00Z';
  assert.equal((await f.charges([{ allocationId: 'original', quantity: 1 }], '2026-10-12T01:00:00Z')).overdue.amount, 10,
    'an unrelated exchanged line missing an extension source must not block this original return batch');
  await assert.rejects(f.charges(undefined, '2026-10-12T01:00:00Z'), /旧换货后续租缺少稳定行计价来源/);
});

test('second exchange reads only the currently held allocation original receipt, not the first price or current config', async () => {
  const f = fixture();
  const before = structuredClone(f.order.lines[0]);
  Object.assign(f.order.lines[0], { itemGroupId: 'c', itemGroupCode: 'C', itemGroupName: 'C', amount: 21600 });
  f.order.allocations[1].status = 'returned';
  f.order.allocations.push({ id: 'third', orderId: 'o', orderLineId: 'line', itemGroupId: 'c', quantity: 3, status: 'locked', metadata: { exchangeId: 'e2' } });
  f.changes.push({ ...structuredClone(f.changes[0]), id: 'e2', appliedAt: '2026-10-08T00:00:00Z', beforeSnapshot: { line: before },
    diff: { exchange: { orderLineId: 'line', originalItemGroupId: 'b', replacementItemGroupId: 'c', replacementAmount: 21600,
      executionBasis: { priceBasis: 'replacement_current_price', effectiveFrom: '2026-10-08T00:00:00Z', rateSnapshot: [rate('c', 720)],
        pricingSnapshot: { context: { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false, dayRates: [rate('c', 720)] } } } } } });
  assert.equal((await f.charges()).overdue.amount, 90);
  f.context.groups[2].status = 'disabled';
  assert.equal((await f.charges([{ allocationId: 'third', quantity: 1 }])).overdue.amount, 30);
  f.changes.pop(); await assert.rejects(f.charges(), /原计价收据/);
});

test('frozen daily price is used for hourly-to-daily and the order cap is not multiplied by source count', async () => {
  const f = fixture();
  f.rule.overdue = { graceMinutes: 0, feeMode: 'hourly_to_daily', hourlyRatePercent: 10, dailyAfterHours: 6, feeMultiplier: 1, maximumFee: 60 };
  const original = { id: 'line-original', itemGroupId: 'a', itemGroupCode: 'A', itemGroupName: 'A', quantity: 1, amount: 2400 };
  f.order.lines.push(original);
  f.order.allocations.push({ id: 'original', orderId: 'o', orderLineId: original.id, itemGroupId: 'a', quantity: 1, status: 'picked_up' });
  assert.equal((await f.charges()).overdue.amount, 60);
  assert.equal((await f.charges([{ allocationId: 'new', quantity: 1 }])).overdue.amount, 48);
  f.changes[0].diff.exchange.executionBasis.pricingSnapshot.context.dayRates = [];
  assert.equal((await f.charges([{ allocationId: 'new', quantity: 1 }])).overdue.amount, 48,
    'the frozen primary day rate remains valid without a duplicate dayRates row');
  f.changes[0].diff.exchange.executionBasis.rateSnapshot[0].unit = 'hour';
  await assert.rejects(f.charges([{ allocationId: 'new', quantity: 1 }]), /日价快照/);
});

test('wrong tenant/space/order/line/quantity and missing frozen price refuse instead of dropping overdue to zero', () => {
  for (const mutate of [
    f => { f.changes[0].workspaceId = 'foreign'; }, f => { f.changes[0].orderId = 'foreign'; },
    f => { f.changes[0].tenantId = 'foreign'; }, f => { f.changes[0].diff.exchange.orderLineId = 'foreign'; },
    f => { f.changes[0].diff.exchange.executionBasis.rateSnapshot = []; },
    f => { f.changes[0].beforeSnapshot.line.quantity = 2; }, f => { f.changes[0].diff.exchange.replacementAmount = undefined; }
  ]) {
    const f = fixture(); mutate(f);
    assert.throws(() => returnPricingSlices('t', 'w', f.quote, f.order, f.changes), error => error.status === 409);
  }
});
