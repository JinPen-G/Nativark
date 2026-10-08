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
  return { core, business, context, group, state, quote, args, writes, current, preview };
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

test("KNOWN GAP: absent saved context retains matching frozen old rows but new blocks use changed current context", async () => {
  const h = await harness(); delete h.quote.pricingContext; h.current();
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.timeZone, "UTC");
  assert.equal(result.pricingSnapshot.context.legacyDayTypeMultipliers, false);
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "2.0");
  assert.equal(result.rateSnapshot[0].baseAmount, 100);
  assert.ok(result.calendarSnapshot.some(x => x.calendarVersion === "1.0" && x.multiplier === 2));
  assert.ok(result.calendarSnapshot.some(x => x.calendarVersion === "2.0" && x.multiplier === 1));
});

test("KNOWN GAP: saved context missing timezone and multiplier switch falls back separately", async () => {
  const h = await harness(); delete h.quote.pricingContext.timeZone; delete h.quote.pricingContext.legacyDayTypeMultipliers; h.current();
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.timeZone, "UTC");
  assert.equal(result.pricingSnapshot.context.legacyDayTypeMultipliers, false);
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "1.0");
  assert.ok(result.calendarSnapshot.every(x => x.multiplier === 1));
});

test("absent saved calendars uses referenced historical version when available", async () => {
  const h = await harness(); h.quote.pricingContext.calendars = []; h.current();
  h.state.calendars.push({ ...f.calendar("1.0"), status: "superseded" });
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "1.0");
  assert.ok(result.calendarSnapshot.every(x => x.calendarVersion === "1.0"));
});

for (const reference of ["missing", "draft", undefined]) {
  test(`KNOWN GAP: saved calendars absent and ${reference ?? "absent"} reference uses current calendar`, async () => {
    const h = await harness(); h.quote.pricingContext.calendars = []; h.current();
    for (const row of h.quote.calendarSnapshot) row.calendarVersion = reference;
    const result = await h.preview();
    assert.equal(result.pricingSnapshot.context.calendars[0].version, "2.0");
    assert.ok(result.calendarSnapshot.every(x => x.multiplier === 1 && x.calendarVersion === "2.0"));
  });
}

test("KNOWN GAP: saved calendar reference missing from historical rate falls through rather than rejecting", async () => {
  const h = await harness(); h.current();
  for (const day of h.quote.pricingContext.calendars[0].days) day.pricingOverrideRef = "missing-old-price-reference";
  h.quote.pricingContext.legacyDayTypeMultipliers = false;
  const result = await h.preview();
  assert.ok(result.calendarSnapshot.every(x => x.hitLayer === "base" && x.multiplier === 1));
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "1.0");
});

test("historical calendar override resolves historical rate reference despite changed current configuration", async () => {
  const h = await harness(); h.current();
  for (const day of h.quote.pricingContext.calendars[0].days) day.pricingOverrideRef = "old-price-reference";
  h.quote.rateSnapshot[0].datetimeOverrides = [{ id: "old-price-reference", start: "2027-01-01T00:00:00.000Z",
    end: "2027-01-06T00:00:00.000Z", multiplier: 3 }];
  const result = await h.preview();
  assert.ok(result.calendarSnapshot.every(x => x.calendarVersion === "1.0" && x.hitLayer === "date_override" && x.multiplier === 3));
});

test("KNOWN GAP: invalid historical timezone is a native RangeError rather than domain missing-context error", async () => {
  const h = await harness(); h.quote.pricingContext.timeZone = "Synthetic/Invalid"; h.current();
  await assert.rejects(() => h.preview(), error => error instanceof RangeError && /time zone/i.test(error.message));
});

test("latest effective extension saved context wins over original quote context", async () => {
  const h = await harness(); h.current();
  const previous = { status: "effective", sequence: 1, payableAmount: 0, rentalAmount: 0, billableUnits: 0, depositDelta: 0, preAuthDelta: 0,
    pricingSnapshot: { context: { ...structuredClone(h.quote.pricingContext), timeZone: "UTC", calendars: [f.calendar("3.0", "workday")] } } };
  const result = await h.preview({ previousExtensions: [previous] });
  assert.equal(result.pricingSnapshot.context.timeZone, "UTC");
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "3.0");
});

test("KNOWN GAP: partial latest extension context does not merge missing fields from complete original context", async () => {
  const h = await harness(); h.current();
  const previous = { status: "effective", sequence: 1, payableAmount: 0, rentalAmount: 0, billableUnits: 0, depositDelta: 0, preAuthDelta: 0,
    pricingSnapshot: { context: { calendars: [f.calendar("3.0", "workday")] } } };
  const result = await h.preview({ previousExtensions: [previous] });
  assert.equal(result.pricingSnapshot.context.timeZone, "UTC");
  assert.equal(result.pricingSnapshot.context.legacyDayTypeMultipliers, false);
  assert.equal(result.pricingSnapshot.context.calendars[0].version, "3.0");
});

test("KNOWN GAP: no saved or referenced or published calendar falls back to current weekly draft", async () => {
  const h = await harness(); h.current(); h.state.calendars = [];
  h.quote.pricingContext.calendars = []; h.quote.calendarSnapshot = [];
  const result = await h.preview();
  assert.equal(result.pricingSnapshot.context.calendars[0].status, "draft");
  assert.ok(result.calendarSnapshot.every(x => x.calendarVersion === "draft" && x.source === "week_rule"));
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
    const order = { ...h.args.order, serviceSnapshots: [], lines: [{ ...h.args.lines[0], itemGroupCode: h.group.code, amount: h.quote.rentalAmount }] };
    const quoteBefore = structuredClone(h.quote), orderBefore = structuredClone(order), writesBefore = structuredClone(h.writes());
    const result = await h.business.quotePostPickupExchange(f.TENANT, h.context, { order, orderLineId: "synthetic-line",
      replacementItemGroupId: replacement.id, priceBasis, appliedAt: h.args.appliedAt,
      fulfillmentMode: h.args.fulfillmentMode, locationIds: h.args.locationIds, customerType: "personal" });
    assert.equal(result.priced.rateSnapshot[0].baseAmount, priceBasis === "original_order_price" ? 100 : 888);
    assert.equal(Boolean(result.currentVersion), priceBasis === "replacement_current_price");
    assert.equal(result.priced.ruleVersion, h.quote.ruleVersion);
    assert.equal(result.priced.pricingSnapshot.context.timeZone, "Asia/Shanghai");
    const actualVersions = [...new Set(result.priced.calendarSnapshot.map(x => x.calendarVersion))];
    assert.deepEqual(actualVersions, [priceBasis === "original_order_price" ? "1.0" : "2.0"]);
    assert.deepEqual(h.quote, quoteBefore); assert.deepEqual(order, orderBefore); assert.deepEqual(h.writes(), writesBefore);
  });
  test(`KNOWN GAP: exchange ${priceBasis} absent context uses current calendar when frozen rows identify original group`, async () => {
    const h = await harness(); h.current(); delete h.quote.pricingContext;
    const replacement = { ...structuredClone(h.group), id: "synthetic-replacement", code: "S04-REPLACEMENT", status: "enabled" };
    h.context.groups = [...h.context.groups, replacement];
    h.state.pricingPlans[0].rates.push(f.rate(replacement, "calendar_day", 888));
    const order = { ...h.args.order, serviceSnapshots: [], lines: [{ ...h.args.lines[0], itemGroupCode: h.group.code, amount: h.quote.rentalAmount }] };
    const beforeQuote = structuredClone(h.quote), beforeOrder = structuredClone(order), beforeWrites = structuredClone(h.writes());
    const result = await h.business.quotePostPickupExchange(f.TENANT, h.context, { order, orderLineId: "synthetic-line",
      replacementItemGroupId: replacement.id, priceBasis, appliedAt: h.args.appliedAt,
      fulfillmentMode: h.args.fulfillmentMode, locationIds: h.args.locationIds, customerType: "personal" });
    assert.equal(result.priced.rateSnapshot[0].baseAmount, priceBasis === "original_order_price" ? 100 : 888);
    assert.equal(result.priced.pricingSnapshot.context.timeZone, "UTC");
    // Replacement group identity differs from frozen original rows, so those rows cannot match it.
    assert.ok(result.priced.calendarSnapshot.every(x => x.calendarVersion === "2.0" && x.multiplier === 1));
    assert.deepEqual(h.quote, beforeQuote); assert.deepEqual(order, beforeOrder); assert.deepEqual(h.writes(), beforeWrites);
  });
}

for (const priceBasis of ["original_order_price", "replacement_current_price"]) {
  test(`${priceBasis === "original_order_price" ? "KNOWN GAP: " : ""}hour-to-day exchange ${priceBasis} does not silently reuse day price from different target`, async () => {
    const h = await harness("hour"); h.current();
    const replacement = { ...structuredClone(h.group), id: "synthetic-replacement", code: "S04-REPLACEMENT", status: "enabled" };
    h.context.groups = [...h.context.groups, replacement];
    h.quote.ruleSnapshot.pricing = { ...h.quote.ruleSnapshot.pricing, hourToDayEnabled: true, hourToDayThresholdHours: 8 };
    h.quote.pricingContext.dayRates = [f.rate(h.group, "day_24h", 123)];
    h.quote.rateSnapshot.push(f.rate(h.group, "day_24h", 123));
    h.state.pricingPlans[0].rates.push(f.rate(replacement, "hour", 888), f.rate(replacement, "day_24h", 222));
    const order = { ...h.args.order, serviceSnapshots: [], lines: [{ ...h.args.lines[0], itemGroupCode: h.group.code, amount: h.quote.rentalAmount }] };
    const beforeQuote = structuredClone(h.quote), beforeOrder = structuredClone(order), beforeWrites = structuredClone(h.writes());
    const invoke = () => h.business.quotePostPickupExchange(f.TENANT, h.context, { order, orderLineId: "synthetic-line",
      replacementItemGroupId: replacement.id, priceBasis, appliedAt: h.args.appliedAt,
      fulfillmentMode: h.args.fulfillmentMode, locationIds: h.args.locationIds, customerType: "personal" });
    if (priceBasis === "original_order_price") {
      await assert.rejects(invoke, /同一价格版本的24小时日价/u);
    } else {
      const result = await invoke();
      assert.equal(result.priced.rateSnapshot[0].baseAmount, 888);
      assert.ok(result.priced.pricingSnapshot.fullChargeLines[0].detail.includes("222"));
    }
    assert.deepEqual(h.quote, beforeQuote); assert.deepEqual(order, beforeOrder); assert.deepEqual(h.writes(), beforeWrites);
  });
}
