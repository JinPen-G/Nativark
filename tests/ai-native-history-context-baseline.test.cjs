"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const stores = require("./helpers/absorbing-config-store.cjs");
const f = require("./fixtures/ai-native/history-context-baseline.cjs");
const attempts = [], connect = net.Socket.prototype.connect, fetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("S04 forbids sockets"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("S04 forbids fetch"); };
});
test.after(() => { net.Socket.prototype.connect = connect; global.fetch = fetch; assert.deepEqual(attempts, []); });

async function harness(unit = "calendar_day") {
  const config = stores.createAbsorbingConfigStore(), facts = stores.createAbsorbingFactStore();
  const core = new RentalCoreService(config, facts);
  const businessConfig = stores.createAbsorbingBusinessConfigStore(), businessFacts = stores.createAbsorbingBusinessFactStore();
  const business = new RentalBusinessService(businessConfig, businessFacts, config);
  await core.onApplicationBootstrap(); await business.onApplicationBootstrap();
  const context = { profile: core.getProfile(f.TENANT), category: RENTAL_CATEGORY_DEFINITIONS.find(x => x.code === "camera"),
    settings: structuredClone(core.getBusinessSettings(f.TENANT)), groups: core.listItemGroups(f.TENANT),
    pricingGroups: [], locations: core.listLocations(f.TENANT), operators: core.listOperators(f.TENANT), couponTemplates: [] };
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], f.TENANT,
    (await config.listWorkspaces()).find(row => row.tenantId === f.TENANT).id, context);
  context.settings.calendar.timeZone = "Asia/Shanghai";
  context.settings.pricing.holidayPricingEnabled = true;
  const group = context.groups[0], state = business.state(f.TENANT, context);
  // Seed state is a controlled in-memory input, not a reimplementation of plan/calendar selection.
  state.pricingPlans = [f.plan([f.rate(group, unit)])];
  state.calendars = [f.calendar("1.0")];
  state.discountPlans = [];
  const quote = await business.createQuote(f.TENANT, context, { customerType: "personal", fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: context.locations[0].id, startAt: f.START, endAt: f.END,
    lines: [{ itemGroupId: group.id, quantity: 1, pricingUnit: unit }] });
  // These tests deliberately mutate their original snapshot; expose that exact
  // fixture through the required persisted-read port, not a production fallback.
  businessFacts.findQuote = async (tenant, id) => tenant === f.TENANT && id === quote.id ? structuredClone(quote) : undefined;
  quote.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode: "original_total" };
  quote.ruleSnapshot.pricing = { ...quote.ruleSnapshot.pricing, hourToDayEnabled: false };
  const args = f.extension(quote, group);
  const writes = () => [...config.writes, ...facts.writes, ...businessConfig.writes, ...businessFacts.writes];
  function current() {
    context.settings.calendar.timeZone = "UTC";
    context.settings.pricing.holidayPricingEnabled = false;
    state.calendars = [f.calendar("2.0", "workday")];
    state.pricingPlans = [f.plan([f.rate(group, unit, 777)], "2.0")];
    state.ruleVersions[0].version = "2.0";
  }
  async function preview(changes = {}) {
    const beforeQuote = structuredClone(quote), beforeOrder = structuredClone(args.order), beforeWrites = structuredClone(writes());
    try { return await business.quoteOrderExtension(f.TENANT, context, { ...args, ...changes }); }
    finally { assert.deepEqual(quote, beforeQuote); assert.deepEqual(args.order, beforeOrder); assert.deepEqual(writes(), beforeWrites); }
  }
  const effective = (priced, sequence = 1) => ({ ...structuredClone(priced), tenantId: f.TENANT,
    workspaceId: business.workspaceOf(f.TENANT), orderId: args.order.id, id: `history-extension-${sequence}`, status: 'effective', sequence });
  return { core, business, context, group, state, quote, args, writes, current, preview, effective };
}

test("complete saved context wins over changed current timezone/calendar/rates", async () => {
  const h = await harness(); h.current();
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.timeZone, "Asia/Shanghai");
  assert.equal(result.pricingSnapshot.context.legacyDayTypeMultipliers, true);
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "1.0");
  assert.equal(result.rateSnapshot[0].baseAmount, 100);
  assert.ok(result.calendarSnapshot.every(x => x.calendarVersion === "1.0" && x.multiplier === 2));
  assert.equal(result.executionBasis.policySource, "original_quote");
  assert.equal(result.ruleVersion, "1.0");
});

test("absent saved context refuses current timezone/calendar substitution without writes", async () => {
  const h = await harness(); delete h.quote.pricingContext; h.current();
  await assert.rejects(h.preview(), /原计价时区或日历上下文缺失/);
});

test("missing historical timezone or multiplier switch refuses each fallback separately", async () => {
  for (const key of ['timeZone', 'legacyDayTypeMultipliers']) {
    const h = await harness(); delete h.quote.pricingContext[key]; h.current();
    await assert.rejects(h.preview(), /原计价时区或日历上下文缺失/);
  }
});

test("absent saved calendars uses referenced historical version when available", async () => {
  const h = await harness(); h.quote.pricingContext.calendars = []; h.current();
  h.state.calendars.push({ ...f.calendar("1.0"), status: "superseded" });
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "1.0");
  assert.ok(result.calendarSnapshot.every(x => x.calendarVersion === "1.0"));
});

for (const reference of ["missing", "draft", undefined]) {
  test(`saved calendars absent and ${reference ?? "absent"} reference refuse current calendar`, async () => {
    const h = await harness(); h.quote.pricingContext.calendars = []; h.current();
    for (const row of h.quote.calendarSnapshot) row.calendarVersion = reference;
    await assert.rejects(h.preview(), /历史日历引用|历史版本不可用/);
  });
}

test("missing original calendar price reference refuses silently downgrading to base price", async () => {
  const h = await harness(); h.current();
  for (const day of h.quote.pricingContext.calendars[0].days) day.pricingOverrideRef = "missing-old-price-reference";
  h.quote.pricingContext.legacyDayTypeMultipliers = false;
  await assert.rejects(h.preview(), /价格覆盖引用无法匹配原价格版本/);
});

test("historical calendar override resolves historical rate reference despite changed current configuration", async () => {
  const h = await harness(); h.current();
  for (const day of h.quote.pricingContext.calendars[0].days) day.pricingOverrideRef = "old-price-reference";
  h.quote.rateSnapshot[0].datetimeOverrides = [{ id: "old-price-reference", start: "2027-01-01T00:00:00.000Z",
    end: "2027-01-06T00:00:00.000Z", multiplier: 3 }];
  const result = await h.preview();
  assert.ok(result.calendarSnapshot.every(x => x.calendarVersion === "1.0" && x.hitLayer === "date_override" && x.multiplier === 3));
});

test("invalid historical timezone is a domain refusal, not a native RangeError", async () => {
  const h = await harness(); h.quote.pricingContext.timeZone = "Synthetic/Invalid"; h.current();
  await assert.rejects(h.preview(), error => error.getStatus() === 409 && /原计价时区或日历上下文缺失/.test(error.message));
});

test("latest effective extension saved context wins over original quote context", async () => {
  const h = await harness(); h.current();
  const previous = h.effective(await h.preview());
  previous.pricingSnapshot.context = { ...structuredClone(h.quote.pricingContext), timeZone: "UTC", calendars: [f.calendar("3.0", "workday")] };
  const result = await h.preview({ order: { ...h.args.order, effectiveEndAt: previous.newEndAt }, previousExtensions: [previous],
    newEndAt: new Date(Date.parse(previous.newEndAt) + 86400000).toISOString() });
  assert.equal(result.pricingSnapshot.context.timeZone, "UTC");
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "3.0");
});

test("partial latest extension context refuses mixing current or earlier context fields", async () => {
  const h = await harness(); h.current();
  const previous = h.effective(await h.preview());
  previous.pricingSnapshot.context = { calendars: [f.calendar("3.0", "workday")] };
  await assert.rejects(h.preview({ order: { ...h.args.order, effectiveEndAt: previous.newEndAt }, previousExtensions: [previous],
    newEndAt: new Date(Date.parse(previous.newEndAt) + 86400000).toISOString() }), /原计价时区或日历上下文缺失/);
});

test("missing saved and referenced calendar refuses generating a current weekly draft", async () => {
  const h = await harness(); h.current(); h.state.calendars = [];
  h.quote.pricingContext.calendars = []; h.quote.calendarSnapshot = [];
  await assert.rejects(h.preview(), /历史日历引用/);
});

test("historical calendars reject foreign/duplicate/missing-day sources and unbound version recovery", async () => {
  for (const mutate of [h => { h.quote.pricingContext.calendars[0].tenantId = 'other'; },
    h => { h.quote.pricingContext.calendars.push(structuredClone(h.quote.pricingContext.calendars[0])); },
    h => { h.quote.pricingContext.calendars[0].days = []; },
    h => { h.quote.pricingContext.calendars[0].days.push(structuredClone(h.quote.pricingContext.calendars[0].days[1])); },
    h => { h.quote.pricingContext.calendars = []; h.state.calendars.push({ ...f.calendar('1.0'), tenantId: 'other' }); },
    h => { h.quote.pricingContext.calendars = []; h.state.calendars.push(f.calendar('1.0'), f.calendar('1.0')); }]) {
    const h = await harness(); h.current(); mutate(h);
    await assert.rejects(h.preview(), error => error.getStatus() === 409);
  }
});

test("malformed historical day fields and source arrays refuse without pricing fallbacks or writes", async () => {
  for (const mutate of [h => { delete h.quote.pricingContext.calendars[0].days[1].dayType; },
    h => { h.quote.pricingContext.calendars[0].days[1].dayType = 'unknown'; },
    h => { h.quote.pricingContext.calendars[0].days[1].source = 'unknown'; },
    h => { h.quote.pricingContext.calendars[0].days[1].pricingMultiplier = NaN; },
    h => { h.quote.pricingContext.calendars[0].days[1].pricingMultiplier = -1; },
    h => { h.quote.pricingContext.calendars[0].days[1].closed = 'false'; },
    h => { h.quote.pricingContext.calendars[0].days[1].businessStatus = 'unknown'; },
    h => { h.quote.pricingContext.calendars[0].days[1].pricingOverrideRef = ''; },
    h => { h.quote.calendarSnapshot = [null]; },
    h => { h.quote.rateSnapshot = [null]; },
    h => { h.state.calendars.push(null); }]) {
    const h = await harness(); h.current(); mutate(h);
    await assert.rejects(h.preview(), error => error.getStatus() === 409);
  }
});

test("carrier repricing retains historical context for both shifted start and shorter actual return", async () => {
  const h = await harness(); h.current();
  const actualStartAt = new Date(Date.parse(f.START) + 3600000).toISOString();
  const shifted = await h.preview({ mode: 'carrier_repricing', fulfillmentMode: 'carrier_shipping', actualStartAt });
  assert.equal(shifted.pricingSnapshot.context.timeZone, 'Asia/Shanghai');
  assert.equal(shifted.pricingSnapshot.context.calendars[0].version, '1.0');
  assert.equal(shifted.rateSnapshot[0].baseAmount, 100);
  const actualEndAt = new Date(Date.parse(f.END) - 3600000).toISOString();
  const returned = await h.preview({ mode: 'carrier_return_repricing', fulfillmentMode: 'carrier_shipping',
    actualStartAt, newEndAt: actualEndAt });
  assert.equal(returned.originalEndAt, f.END);
  assert.equal(returned.newEndAt, actualEndAt);
  assert.equal(returned.pricingSnapshot.context.timeZone, 'Asia/Shanghai');
  assert.ok(returned.calendarSnapshot.every(row => row.calendarVersion === '1.0'));
  assert.equal(returned.rateSnapshot[0].baseAmount, 100);
  const delayedStart = new Date(Date.parse(f.END) + 3600000).toISOString();
  const delayed = await h.preview({ mode: 'carrier_repricing', fulfillmentMode: 'carrier_shipping',
    actualStartAt: delayedStart, newEndAt: f.EXTENDED });
  assert.equal(delayed.pricingSnapshot.context.timeZone, 'Asia/Shanghai');
  assert.ok(delayed.calendarSnapshot.every(row => row.calendarVersion === '1.0'));
  assert.equal(delayed.rateSnapshot[0].baseAmount, 100);
});

test("a frozen weekly template remains usable; only newly reached years can acquire their first calendar", async () => {
  const h = await harness(); h.quote.pricingContext.calendars[0].status = 'draft'; h.current();
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.calendars[0].status, 'draft');
  assert.equal(result.pricingSnapshot.context.calendars[0].version, '1.0');
  assert.ok(result.calendarSnapshot.every(row => row.calendarVersion === 'draft' && row.multiplier === 2));
  const { restoreRentalRepricingContext } = require('../apps/api/src/modules/rental-core/rental-repricing-context');
  const original = structuredClone(h.quote.pricingContext), next = { ...f.calendar('next-year', 'workday'), year: 2028,
    days: [1, 2, 3, 4, 5].map(day => ({ ...f.calendar('unused', 'workday').days[0], date: `2028-01-0${day}` })) };
  let calls = 0;
  const args = { context: original, startAt: '2027-12-31T20:00:00Z', endAt: '2028-01-03T20:00:00Z',
    billedEndAt: '2028-01-01T00:00:00Z', references: [], historicalCalendars: [], rates: h.quote.rateSnapshot,
    newYearCalendar: year => { calls++; assert.equal(year, 2028); return next; } };
  // The previous billed end already lies in 2028 in the original time zone;
  // a callback is not allowed to repair that missing original year's source.
  assert.throws(() => restoreRentalRepricingContext(f.TENANT, args), /历史日历引用/);
  assert.equal(calls, 0);
  args.startAt = '2027-12-30T20:00:00Z'; args.billedEndAt = '2027-12-31T12:00:00Z';
  const oldDay = { ...f.calendar('unused').days[0], date: '2027-12-31' };
  original.calendars[0].days.push(oldDay);
  const restored = restoreRentalRepricingContext(f.TENANT, args);
  assert.equal(calls, 1); assert.equal(restored.calendars[1].version, 'next-year');
  next.days[0].dayType = 'tenant_special';
  assert.equal(restored.calendars[1].days[0].dayType, 'workday', 'new year is frozen, not a mutable current reference');
});

test("original-total cross-year extension freezes only the first new-year source and reuses it on later repricing", async () => {
  const h = await harness(); h.current();
  const startAt = '2027-12-30T20:00:00Z', endAt = '2027-12-31T12:00:00Z', nextEnd = '2028-01-02T20:00:00Z';
  h.quote.request.startAt = startAt; h.quote.request.endAt = endAt;
  h.quote.pricingContext.calendars[0].days = [{ ...f.calendar('old').days[0], date: '2027-12-31' }];
  h.quote.calendarSnapshot = h.quote.calendarSnapshot.map(row => ({ ...row, date: '2027-12-31', year: 2027 }));
  const next = { ...f.calendar('new-year', 'workday'), year: 2028,
    days: [1, 2, 3, 4, 5].map(day => ({ ...f.calendar('unused', 'workday').days[0], date: `2028-01-0${day}` })) };
  h.state.calendars.push(next);
  const order = { ...h.args.order, startAt, endAt };
  h.state.calendars.push({ ...structuredClone(next), version: 'second-published' });
  await assert.rejects(h.preview({ order, newEndAt: nextEnd, appliedAt: endAt }), /多个已发布日历/);
  h.state.calendars.pop();
  next.tenantId = 'other';
  await assert.rejects(h.preview({ order, newEndAt: nextEnd, appliedAt: endAt }), /新增续租年度日历来源无效/);
  next.tenantId = f.TENANT;
  h.state.calendars = h.state.calendars.filter(row => row.year !== 2028);
  const weekly = await h.preview({ order, newEndAt: nextEnd, appliedAt: endAt });
  assert.equal(weekly.pricingSnapshot.context.calendars[1].status, 'draft');
  assert.ok(weekly.pricingSnapshot.context.calendars[1].days.every(row => row.source === 'week_rule'));
  assert.equal(weekly.pricingSnapshot.context.timeZone, 'Asia/Shanghai');
  assert.equal(weekly.rateSnapshot[0].baseAmount, 100);
  h.state.calendars.push(next);
  const first = await h.preview({ order, newEndAt: nextEnd, appliedAt: endAt });
  assert.deepEqual(first.pricingSnapshot.context.calendars.map(row => row.version), ['1.0', 'new-year']);
  assert.equal(first.pricingSnapshot.context.timeZone, 'Asia/Shanghai');
  assert.equal(first.rateSnapshot[0].baseAmount, 100, 'new calendar does not select new price');
  next.version = 'changed-current'; next.days.forEach(row => { row.dayType = 'tenant_special'; });
  const effective = { ...h.effective(first), id: 'cross-year-extension' };
  const later = await h.preview({ order: { ...order, effectiveEndAt: nextEnd }, previousExtensions: [effective],
    newEndAt: '2028-01-03T20:00:00Z', appliedAt: endAt });
  assert.equal(later.pricingSnapshot.context.calendars[1].version, 'new-year');
  assert.equal(later.pricingSnapshot.context.calendars[1].days[0].dayType, 'workday');
  const broken = structuredClone(effective); broken.pricingSnapshot.context.calendars = broken.pricingSnapshot.context.calendars.filter(row => row.year !== 2028);
  broken.calendarSnapshot = [];
  await assert.rejects(h.preview({ order: { ...order, effectiveEndAt: nextEnd }, previousExtensions: [broken],
    newEndAt: '2028-01-03T20:00:00Z', appliedAt: endAt }), /历史日历引用/);
});

test("absent latest original-total context and original currency cannot borrow earlier/current values", async () => {
  const h = await harness(); h.current();
  const previous = h.effective(await h.preview()); previous.pricingSnapshot.context = undefined;
  await assert.rejects(h.preview({ order: { ...h.args.order, effectiveEndAt: previous.newEndAt }, previousExtensions: [previous],
    newEndAt: new Date(Date.parse(previous.newEndAt) + 86400000).toISOString() }), /原计价时区或日历上下文缺失/);
  delete h.quote.currency;
  await assert.rejects(h.preview(), /原报价缺少币种/);
});

test("original-total successor refuses missing or foreign receipts, mixed mode, gaps and line-only snapshots", async () => {
  const h = await harness(); h.current();
  const original = h.effective(await h.preview());
  const changes = { order: { ...h.args.order, effectiveEndAt: original.newEndAt },
    newEndAt: new Date(Date.parse(original.newEndAt) + 86400000).toISOString() };
  for (const mutate of [row => { delete row.pricingSnapshot; }, row => { row.pricingSnapshot = null; },
    row => { row.pricingSnapshot.scope = 'exchange_line'; }, row => { row.pricingSnapshot.method = 'other'; },
    row => { row.orderId = 'other'; }, row => { row.tenantId = 'other'; }, row => { row.workspaceId = 'other'; },
    row => { row.id = ''; }, row => { row.sequence = 0; }, row => { row.originalEndAt = f.START; },
    row => { row.newEndAt = f.END; }, row => { row.currency = 'USD'; },
    row => { row.executionBasis.pricingMode = 'incremental'; }]) {
    const row = structuredClone(original); mutate(row);
    await assert.rejects(h.preview({ ...changes, previousExtensions: [row] }), error => error.getStatus() === 409);
  }
  await assert.rejects(h.preview({ ...changes, previousExtensions: [original, structuredClone(original)] }), error => error.getStatus() === 409);
  const ignored = { ...structuredClone(original), id: 'ignored-pending', status: 'pending_payment', tenantId: 'other' };
  const result = await h.preview({ ...changes, previousExtensions: [ignored, original] });
  assert.equal(result.pricingSnapshot.context.calendars[0].version, '1.0');
  const before = structuredClone(original);
  await h.preview({ ...changes, previousExtensions: [original] });
  assert.deepEqual(original, before, 'successor reads, never rewrites the original effective receipt');
  const legacy = structuredClone(original); delete legacy.executionBasis; delete legacy.pricingSnapshot.scope;
  delete legacy.pricingSnapshot.rentalLineAmounts;
  const old = await h.preview({ ...changes, previousExtensions: [legacy] });
  assert.equal(old.pricingSnapshot.context.calendars[0].version, '1.0', 'complete historical whole-order snapshot needs no invented new marker');
  const sequenceGap = { ...structuredClone(original), sequence: 3 };
  const cancelled = { ...structuredClone(original), id: 'cancelled', sequence: 2, status: 'cancelled' };
  assert.equal((await h.preview({ ...changes, previousExtensions: [cancelled, sequenceGap] })).newEndAt, changes.newEndAt,
    'cancelled attempts may leave gaps in original receipt sequences');
});

test("original-total successor rejects broken receipt amounts instead of calculating from corrupted balances", async () => {
  const h = await harness(); h.current();
  const original = h.effective(await h.preview());
  const changes = { order: { ...h.args.order, effectiveEndAt: original.newEndAt },
    newEndAt: new Date(Date.parse(original.newEndAt) + 86400000).toISOString() };
  for (const mutate of [row => { row.payableAmount++; }, row => { row.rentalAmount++; },
    row => { row.serviceAmount = NaN; }, row => { row.depositDelta = -1; }, row => { row.preAuthDelta = Infinity; },
    row => { row.pricingSnapshot.differenceAmount++; }, row => { row.pricingSnapshot.previousPayableAmount++; },
    row => { row.pricingSnapshot.recalculatedRentalAmount++; }, row => { row.pricingSnapshot.recalculatedServiceAmount++; },
    row => { row.pricingSnapshot.recalculatedDiscountAmount = NaN; }, row => { row.pricingSnapshot.recalculatedCouponAmount = -1; },
    row => { row.pricingSnapshot.totalBillableUnits = Infinity; }, row => { row.pricingSnapshot.chargeLines[0].amount++; },
    row => { row.pricingSnapshot.fullChargeLines[0].amount++; },
    row => { const target = Object.keys(row.pricingSnapshot.rentalLineAmounts)[0]; row.pricingSnapshot.rentalLineAmounts[target]++; },
    row => { row.pricingSnapshot.rentalLineAmounts = {}; },
    row => { row.pricingSnapshot.rentalLineAmounts = { foreign: row.pricingSnapshot.recalculatedRentalAmount }; },
    row => { const target = Object.keys(row.pricingSnapshot.rentalLineAmounts)[0]; row.pricingSnapshot.rentalLineAmounts[target] = NaN; },
    row => { const target = Object.keys(row.pricingSnapshot.rentalLineAmounts)[0]; row.pricingSnapshot.rentalLineAmounts[target] = -1; },
    row => { row.pricingSnapshot.rentalLineAmounts = null; },
    row => { row.pricingSnapshot.rentalLineAmounts = [row.pricingSnapshot.recalculatedRentalAmount]; },
    row => { row.pricingSnapshot.refundReview = { amount: 1, status: 'approved' }; },
    row => {
      row.pricingSnapshot.previousPayableAmount++;
      row.pricingSnapshot.differenceAmount--;
      row.payableAmount = Math.max(0, row.pricingSnapshot.differenceAmount);
      row.pricingSnapshot.chargeLines.push({ code: 'counterfeit-balance', type: 'extension', amount: -1 });
    }]) {
    const row = structuredClone(original); mutate(row);
    await assert.rejects(h.preview({ ...changes, previousExtensions: [row] }), error => error.getStatus() === 409);
  }
  assert.deepEqual(original, h.effective(await h.preview()), 'failed reuse cannot rewrite the original amounts');
});

test("incremental extension uses current rate/rule/calendar/timezone despite absent historical context", async () => {
  const h = await harness(); h.current(); delete h.quote.pricingContext;
  h.quote.ruleSnapshot.extension.pricingMode = "incremental";
  const result = await h.preview();
  assert.equal(result.rateSnapshot[0].baseAmount, 777);
  assert.equal(result.executionBasis.policySource, "current_workspace");
  assert.ok(result.calendarSnapshot.every(x => x.calendarVersion === "2.0" && x.multiplier === 1));
  assert.equal(result.ruleVersion, h.business.currentRule(f.TENANT, h.context, h.args.appliedAt).version);
  assert.equal(result.ruleVersion, "2.0");
  assert.equal(result.calendarSnapshot[0].date, "2027-01-02");
});

test("incremental extension cannot relabel current prices into the original order currency", async () => {
  const h = await harness(); h.current();
  h.quote.ruleSnapshot.extension.pricingMode = 'incremental';
  const valid = await h.preview();
  assert.equal(valid.currency, 'CNY'); assert.equal(valid.rateSnapshot[0].baseAmount, 777);
  for (const currency of [undefined, null, '', 'USD', 'XYZ']) {
    h.context.settings.pricing.currency = currency;
    await assert.rejects(h.preview(), error => error.getStatus() === 409 && /币种/.test(error.message));
  }
  h.context.settings.pricing.currency = 'CNY';
  for (const currency of [undefined, null, '', 'XYZ']) {
    h.quote.currency = currency;
    await assert.rejects(h.preview(), error => error.getStatus() === 409 && /币种/.test(error.message));
  }
  h.quote.currency = 'CNY'; h.context.settings.pricing.currency = 'USD';
  h.quote.ruleSnapshot.extension.pricingMode = 'original_total';
  const historical = await h.preview();
  assert.equal(historical.currency, 'CNY'); assert.equal(historical.rateSnapshot[0].baseAmount, 100);
});

test("hour-to-day original-total missing saved day rate rejects even though current day rate exists", async () => {
  const h = await harness("hour"); h.current();
  h.quote.ruleSnapshot.pricing = { ...h.quote.ruleSnapshot.pricing, hourToDayEnabled: true, hourToDayThresholdHours: 8 };
  h.quote.pricingContext.dayRates = [];
  h.state.pricingPlans[0].rates.push(f.rate(h.group, "day_24h", 222));
  await assert.rejects(() => h.preview(), /同一价格版本的24小时日价/u);
});

test("saved day rate remains original-total conversion source after current rate changes", async () => {
  const h = await harness("hour"); h.current();
  h.quote.ruleSnapshot.pricing = { ...h.quote.ruleSnapshot.pricing, hourToDayEnabled: true, hourToDayThresholdHours: 8 };
  h.quote.pricingContext.dayRates = [f.rate(h.group, "day_24h", 123)];
  h.state.pricingPlans[0].rates.push(f.rate(h.group, "day_24h", 999));
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.dayRates[0].baseAmount, 123);
  assert.ok(result.pricingSnapshot.fullChargeLines[0].detail.includes("123"));
});

test("incremental hour-to-day uses current day rate and rejects missing current day rate even if historical day exists", async () => {
  const h = await harness("hour"); h.current();
  h.quote.ruleSnapshot.extension.pricingMode = "incremental";
  h.quote.pricingContext.dayRates = [f.rate(h.group, "day_24h", 123)];
  const currentRule = h.business.currentRule(f.TENANT, h.context, h.args.appliedAt);
  currentRule.config.pricing = { ...currentRule.config.pricing, hourToDayEnabled: true, hourToDayThresholdHours: 8 };
  await assert.rejects(() => h.preview(), /同一价格版本的24小时日价/u);
  h.state.pricingPlans[0].rates.push(f.rate(h.group, "day_24h", 222));
  const result = await h.preview();
  assert.ok(result.chargeLines.some(x => x.detail?.includes("222")));
  assert.equal(result.executionBasis.policySource, "current_workspace");
});

for (const priceBasis of ["original_order_price", "replacement_current_price"]) {
  test(`exchange ${priceBasis} distinguishes rate source from historical timezone and rule`, async () => {
    const h = await harness(); h.current();
    const replacement = { ...structuredClone(h.group), id: "synthetic-replacement", code: "S04-REPLACEMENT", status: "enabled" };
    h.context.groups = [...h.context.groups, replacement];
    h.state.pricingPlans[0].rates.push(f.rate(replacement, "calendar_day", 888));
    h.business.resolveSpaceRates = async () => ({ versionId: 'synthetic-price-2', version: '2.0',
      effectiveFrom: h.args.appliedAt, rates: structuredClone(h.state.pricingPlans[0].rates) });
    const order = { ...h.args.order, serviceSnapshots: [], lines: [{ ...h.args.lines[0], itemGroupCode: h.group.code, itemGroupName: h.group.name, amount: h.quote.rentalAmount }] };
    const quoteBefore = structuredClone(h.quote), orderBefore = structuredClone(order), writesBefore = structuredClone(h.writes());
    const result = await h.business.quotePostPickupExchange(f.TENANT, h.context, { order, orderLineId: "synthetic-line",
      replacementItemGroupId: replacement.id, priceBasis, appliedAt: h.args.appliedAt,
      fulfillmentMode: h.args.fulfillmentMode, locationIds: h.args.locationIds, customerType: "personal" });
    assert.equal(result.priced.rateSnapshot[0].baseAmount, priceBasis === "original_order_price" ? 100 : 888);
    assert.equal(Boolean(result.currentVersion), priceBasis === "replacement_current_price");
    assert.equal(result.priced.ruleVersion, h.quote.ruleVersion);
    assert.equal(result.priced.pricingSnapshot.context.timeZone, "Asia/Shanghai");
    const actualVersions = [...new Set(result.priced.calendarSnapshot.map(x => x.calendarVersion))];
    assert.deepEqual(actualVersions, priceBasis === "original_order_price" ? ["1.0"] : ["1.0", "2.0"],
      "performed rental retains the original calendar; only the replacement tail uses the current one");
    assert.deepEqual(h.quote, quoteBefore); assert.deepEqual(order, orderBefore); assert.deepEqual(h.writes(), writesBefore);
  });
  test(`exchange ${priceBasis} missing full original context refuses current-calendar substitution`, async () => {
    const h = await harness(); h.current(); delete h.quote.pricingContext;
    const replacement = { ...structuredClone(h.group), id: "synthetic-replacement", code: "S04-REPLACEMENT", status: "enabled" };
    h.context.groups = [...h.context.groups, replacement];
    h.state.pricingPlans[0].rates.push(f.rate(replacement, "calendar_day", 888));
    const order = { ...h.args.order, serviceSnapshots: [], lines: [{ ...h.args.lines[0], itemGroupCode: h.group.code, itemGroupName: h.group.name, amount: h.quote.rentalAmount }] };
    const beforeQuote = structuredClone(h.quote), beforeOrder = structuredClone(order), beforeWrites = structuredClone(h.writes());
    await assert.rejects(h.business.quotePostPickupExchange(f.TENANT, h.context, { order, orderLineId: "synthetic-line",
      replacementItemGroupId: replacement.id, priceBasis, appliedAt: h.args.appliedAt,
      fulfillmentMode: h.args.fulfillmentMode, locationIds: h.args.locationIds, customerType: "personal" }), /日历或时区快照/u);
    assert.deepEqual(h.quote, beforeQuote); assert.deepEqual(order, beforeOrder); assert.deepEqual(h.writes(), beforeWrites);
  });
}

for (const priceBasis of ["original_order_price", "replacement_current_price"]) {
  test(`hour-to-day exchange ${priceBasis} separates original and replacement daily sources`, async () => {
    const h = await harness("hour"); h.current();
    const replacement = { ...structuredClone(h.group), id: "synthetic-replacement", code: "S04-REPLACEMENT", status: "enabled" };
    h.context.groups = [...h.context.groups, replacement];
    h.quote.ruleSnapshot.pricing = { ...h.quote.ruleSnapshot.pricing, hourToDayEnabled: true, hourToDayThresholdHours: 8 };
    h.quote.pricingContext.dayRates = [f.rate(h.group, "day_24h", 123)];
    h.quote.rateSnapshot.push(f.rate(h.group, "day_24h", 123));
    h.state.pricingPlans[0].rates.push(f.rate(replacement, "hour", 888), f.rate(replacement, "day_24h", 222));
    h.business.resolveSpaceRates = async () => ({ versionId: 'synthetic-price-2', version: '2.0',
      effectiveFrom: h.args.appliedAt, rates: structuredClone(h.state.pricingPlans[0].rates) });
    const original = h.business.priceRentalLine({ group: h.group, quantity: 1, rate: h.quote.rateSnapshot[0],
      dayRate: h.quote.pricingContext.dayRates[0], hourToDay: h.quote.ruleSnapshot.pricing,
      startAt: f.START, endAt: f.END, timeZone: h.quote.pricingContext.timeZone, calendars: h.quote.pricingContext.calendars,
      legacyDayTypeMultipliers: h.quote.pricingContext.legacyDayTypeMultipliers, planId: h.quote.id, planVersion: '1.0', codePrefix: 'rental', chargeType: 'rental' });
    h.quote.rentalAmount = h.quote.payableAmount = original.amount; h.quote.chargeLines = [original.chargeLine];
    h.quote.rentalLineAmounts = { [h.group.id]: original.amount };
    const order = { ...h.args.order, serviceSnapshots: [], lines: [{ ...h.args.lines[0], itemGroupCode: h.group.code, itemGroupName: h.group.name, amount: h.quote.rentalAmount }] };
    const beforeQuote = structuredClone(h.quote), beforeOrder = structuredClone(order), beforeWrites = structuredClone(h.writes());
    const invoke = () => h.business.quotePostPickupExchange(f.TENANT, h.context, { order, orderLineId: "synthetic-line",
      replacementItemGroupId: replacement.id, priceBasis, appliedAt: h.args.appliedAt,
      fulfillmentMode: h.args.fulfillmentMode, locationIds: h.args.locationIds, customerType: "personal" });
    const result = await invoke();
    assert.equal(result.priced.rateSnapshot[0].baseAmount, priceBasis === "original_order_price" ? 100 : 888);
    assert.equal(result.priced.linePricing.overdueBasis.context.dayRates.find(row => row.unit === 'day_24h').baseAmount,
      priceBasis === "original_order_price" ? 123 : 222);
    if (priceBasis === "original_order_price") assert.equal(result.priced.pricingSnapshot.differenceAmount, 0);
    assert.deepEqual(h.quote, beforeQuote); assert.deepEqual(order, beforeOrder); assert.deepEqual(h.writes(), beforeWrites);
  });
}
