"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { RentalWorkspaceReportRepository } = require("../apps/api/src/modules/rental-core/rental-workspace-report.repository");
const { PlatformService } = require("../apps/api/src/modules/platform/platform.service");
const { PaymentRuntimeService, PaymentProviderDefinitiveError } = require("../apps/api/src/modules/integrations/payment.runtime.service");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const stores = require("./helpers/absorbing-config-store.cjs");
const input = require("./fixtures/ai-native/fact-baseline.cjs");

// Fail fast if a supposedly isolated characterization starts an external connection.
const originalConnect = net.Socket.prototype.connect, originalFetch = global.fetch;
const externalAttempts = [];
test.before(() => {
  net.Socket.prototype.connect = function () { externalAttempts.push("socket"); throw new Error("S02 prohibits sockets"); };
  global.fetch = async () => { externalAttempts.push("fetch"); throw new Error("S02 prohibits provider calls"); };
});
test.after(() => {
  net.Socket.prototype.connect = originalConnect;
  global.fetch = originalFetch;
  assert.deepEqual(externalAttempts, [], "no database/model/payment/network calls are permitted");
});

async function harness(categoryCode, memberships) {
  const config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [input.workspace(categoryCode)];
  const facts = stores.createAbsorbingFactStore();
  const core = new RentalCoreService(config, facts);
  const businessConfig = stores.createAbsorbingBusinessConfigStore();
  const businessFacts = stores.createAbsorbingBusinessFactStore();
  const business = new RentalBusinessService(businessConfig, businessFacts, config,
    undefined, undefined, undefined, undefined, undefined, undefined, memberships);
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();
  const context = { profile: core.getProfile(input.TENANT_ID),
    category: RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === categoryCode),
    settings: core.getBusinessSettings(input.TENANT_ID), groups: core.listItemGroups(input.TENANT_ID),
    pricingGroups: core.listPricingGroups(input.TENANT_ID), locations: core.listLocations(input.TENANT_ID),
    operators: core.listOperators(input.TENANT_ID), couponTemplates: core.listCouponTemplates(input.TENANT_ID) };
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], input.TENANT_ID,
    (await config.listWorkspaces()).find(row => row.tenantId === input.TENANT_ID).id, context);
  // Explicit fixture snapshot read; production never falls back to this cache.
  businessFacts.findQuote = async (tenant, id) => tenant === input.TENANT_ID
    ? structuredClone(business.state(tenant, context).quotes.find(row => row.id === id)) : undefined;
  return { core, business, context, config, facts, businessConfig, businessFacts };
}

for (const categoryCode of ["camera", "camping", "vehicle", "construction"]) {
  test(`${categoryCode}: authoritative empty configuration fails closed; opening gaps are not ready`, async () => {
    const h = await harness(categoryCode);
    h.businessConfig.loadAll = async () => [input.emptyConfiguration(categoryCode)];
    await h.business.refreshFromDatabase();
    assert.throws(() => h.business.currentRule(input.TENANT_ID, h.context), /没有生效的租赁规则版本/u);
    await assert.rejects(() => h.business.createQuote(input.TENANT_ID, h.context, input.quoteInput(h.context)), /没有覆盖.*定价计划/u);
    // Install only the readiness dependency after testing the legacy no-membership quote path.
    h.business.memberships = { listPlans: async () => [] };
    const missingContext = { ...h.context, locations: [], groups: [], pricingGroups: [] };
    const readiness = await h.business.tenantReadiness(input.TENANT_ID, missingContext);
    assert.equal(readiness.ready, false);
    for (const key of ["business_rule", "fulfillment_network", "item_groups", "pricing_groups_rates", "price_version"]) {
      assert.ok(readiness.missingKeys.includes(key), key);
      assert.equal(readiness.items.find(row => row.key === key).done, false);
    }
    const member = readiness.items.find(row => row.key === "membership_base");
    assert.equal(member.unavailable, false);
    assert.equal(member.done, false);
    assert.equal(member.optional, true);
    assert.equal(h.businessFacts.writes.filter(row => row.kind === "quote").length, 0);
  });
  test(`${categoryCode}: missing published rule rejects quote even when current pricing exists`, async () => {
    const h = await harness(categoryCode);
    const snapshot = input.emptyConfiguration(categoryCode);
    snapshot.pricingPlans = structuredClone(h.business.listPricingPlans(input.TENANT_ID, h.context));
    assert.ok(snapshot.pricingPlans.length > 0);
    h.businessConfig.loadAll = async () => [snapshot];
    await h.business.refreshFromDatabase();
    await assert.rejects(() => h.business.createQuote(input.TENANT_ID, h.context, input.quoteInput(h.context)), /没有生效的租赁规则版本/u);
    assert.equal(h.businessFacts.writes.filter(row => row.kind === "quote").length, 0);
  });
  test(`${categoryCode}: membership outage is unavailable, not absence or readiness`, async () => {
    const h = await harness(categoryCode, { listPlans: async () => { throw new Error("synthetic dependency outage"); } });
    const readiness = await h.business.tenantReadiness(input.TENANT_ID, h.context);
    const member = readiness.items.find(row => row.key === "membership_base");
    assert.equal(member.unavailable, true);
    assert.equal(member.done, false);
    assert.equal(member.summary, undefined);
    assert.match(member.missing, /无法读取/u);
    assert.equal(readiness.ready, false, "in-memory price-version facts cannot establish full opening readiness");
  });
  test(`${categoryCode}: quote persistence invocation writes only quote, not order or inventory`, async () => {
    const h = await harness(categoryCode);
    const before = h.facts.writes.length;
    const quote = await h.business.createQuote(input.TENANT_ID, h.context, input.quoteInput(h.context));
    assert.equal(quote.categoryCode, categoryCode);
    assert.ok(quote.rentalAmount > 0);
    assert.ok(h.businessFacts.writes.some(row => row.kind === "quote" && row.id === quote.id));
    assert.deepEqual(h.businessFacts.writes.map(row => row.kind), ["quote"]);
    assert.equal(h.facts.writes.length, before, "quotation must not save an order or reserve inventory");
    assert.equal(quote.priceVersionId, undefined, "memory fallback is not a persisted space price version");
    // Real order preparation must recheck the empty inventory repository, even with a valid quote.
    await assert.rejects(() => h.core.prepareOrder(input.TENANT_ID,
      { ...quote.request, customerName: "S02 synthetic legacy customer", qualificationApproved: true },
      "S02", quote), /库存不足/u);
    // factContext initializes demo asset/stock facts into the absorbing store on first use.
    // Those calls are NOT order reservations and are not silently counted as read-only.
    assert.equal(h.facts.writes.filter(row => row.kind === "order").length, 0);
    assert.ok(h.facts.writes.slice(before).every(row => ["asset", "stockBalance"].includes(row.kind)));
  });
  test(`${categoryCode}: original-total extension rejects missing historical rate instead of using current prices`, async () => {
    const h = await harness(categoryCode);
    const quote = await h.business.createQuote(input.TENANT_ID, h.context, input.quoteInput(h.context));
    quote.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode: "original_total" };
    quote.rateSnapshot = [];
    await assert.rejects(() => h.business.quoteOrderExtension(input.TENANT_ID, h.context, input.extensionInput(quote)), /缺少原订单费率快照/u);
  });
  test(`${categoryCode}: confirmation only creates confirmed reservation, not paid or handed-over status`, async () => {
    const h = await harness(categoryCode);
    const order = { id: "order_ain", tenantId: input.TENANT_ID, categoryCode, status: "draft",
      fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: h.context.locations[0].id,
      returnLocationId: h.context.locations[0].id,
      reservations: [{ id: "reservation_ain", status: "soft", expiresAt: new Date(Date.now() + 60_000).toISOString() }],
      allocations: [] };
    h.facts.findOrder = async () => order;
    const confirmed = await h.core.confirmOrder(input.TENANT_ID, order.id);
    assert.equal(confirmed.status, "reserved");
    assert.equal(confirmed.reservations[0].status, "confirmed");
    assert.equal(confirmed.reservations[0].expiresAt, undefined);
    assert.deepEqual(confirmed.allocations, []);
    assert.equal(h.facts.writes.filter(row => row.kind === "order").length, 1);
    await assert.rejects(() => h.core.confirmOrder(input.TENANT_ID, order.id), /只有草稿订单可以确认/u);
    order.status = "draft";
    order.reservations[0].expiresAt = new Date(Date.now() - 60_000).toISOString();
    await assert.rejects(() => h.core.confirmOrder(input.TENANT_ID, order.id), /软预占已过期/u);
    assert.equal(h.facts.writes.filter(row => row.kind === "order").length, 1);
  });
}

test("KNOWN GAP: missing historical rule snapshot rejects with TypeError, not a structured missing-basis error", async () => {
  const h = await harness("camera");
  const quote = await h.business.createQuote(input.TENANT_ID, h.context, input.quoteInput(h.context));
  delete quote.ruleSnapshot;
  await assert.rejects(() => h.business.quoteOrderExtension(input.TENANT_ID, h.context, input.extensionInput(quote)),
    error => error instanceof TypeError);
  assert.deepEqual(h.businessFacts.writes.map(row => row.kind), ["quote"], "no extension write after missing basis");
});

test("KNOWN GAP: account dependency failure propagates, not a falsely ready or structured unavailable diagnostic", async () => {
  const h = await harness("camera");
  h.business.prisma = { workspaceMember: { count: async () => { throw new Error("synthetic account dependency outage"); } } };
  await assert.rejects(() => h.business.tenantReadiness(input.TENANT_ID, h.context), /synthetic account dependency outage/u);
});

test("legacy AI connection entry is fail-closed until the real Gateway probe is assembled", () => {
  const platform = new PlatformService({ get: () => "memory" }, undefined);
  const result = platform.testAiConnection("S02 synthetic operator");
  assert.equal(result.status, "失败");
  assert.match(result.message, /未装配服务端 AI Gateway 能力探测/u);
  const log = platform.systemRulesConfig.aiModel.logs[0];
  assert.equal(JSON.parse(log.responsePayload).status, "unavailable");
  assert.match(log.promptText, /未装配 AI Gateway 能力探测/u);
  assert.equal(externalAttempts.length, 0);
});

test("report returns current snapshot and explicit historical gaps, not historical utilization or profit", async () => {
  const data = input.inventoryRows(), queries = [];
  const capture = (name, result) => async args => { queries.push({ name, args }); return structuredClone(result); };
  const prisma = { rentalOrder: { groupBy: capture("orders", []), aggregate: capture("amounts", { _sum: {} }),
    findMany: capture("scan", []) }, rentalAsset: { groupBy: capture("assets", data.assets) },
    rentalStockBalance: { aggregate: capture("stock", data.stock) } };
  const reports = new RentalWorkspaceReportRepository(prisma);
  const a = await reports.getOperationReport(input.TENANT_ID, input.workspace("camera").id, "camera",
    { from: "2026-01-01T00:00:00Z", to: "2026-02-01T00:00:00Z" });
  const b = await reports.getOperationReport(input.TENANT_ID, input.workspace("camera").id, "camera",
    { from: "2026-06-01T00:00:00Z", to: "2026-07-01T00:00:00Z" });
  assert.equal(a.utilization.serializedAssets.operableCount, 4);
  assert.equal(a.utilization.serializedAssets.rentedRatio, 0.25);
  assert.equal(a.utilization.quantityStock.availableTotal, 5);
  assert.ok(Number.isFinite(Date.parse(a.utilization.serializedAssets.snapshotAt)));
  assert.equal(b.utilization.serializedAssets.rentedRatio, a.utilization.serializedAssets.rentedRatio);
  assert.ok(a.historicalCaliberGaps.some(row => row.includes("分母") && row.includes("历史")));
  for (const key of ["profit", "cost", "historicalUtilization"]) assert.equal(key in a, false);
  for (const { name, args } of queries) {
    assert.equal(args.where.tenantId, input.TENANT_ID);
    assert.equal(args.where.workspaceId, input.workspace("camera").id);
    if (["assets", "stock"].includes(name)) assert.equal("startAt" in args.where, false);
  }
});

function refundHarness(fundingFails = false) {
  let row = input.refundRow({ revision: 1 });
  const fundingCalls = [], writes = [];
  const apply = data => {
    writes.push(structuredClone(data));
    const { revision, ...fields } = data;
    Object.assign(row, fields);
    if (revision !== undefined) row.revision = typeof revision === 'number' ? revision : row.revision + revision.increment;
    return structuredClone(row);
  };
  // Match the current production delegate/CAS shape. This is still one-row
  // execution substitution, not MySQL isolation or provider/funding evidence.
  const matches = where => Object.entries(where).every(([key, value]) =>
    value === undefined || (value && typeof value === 'object' && Array.isArray(value.in)
      ? value.in.includes(row[key]) : row[key] === value));
  const table = { findFirst: async ({ where }) => matches(where) ? structuredClone(row) : null,
    findFirstOrThrow: async ({ where }) => {
      assert.ok(matches(where), 'original refund must match the exact read-back scope');
      return structuredClone(row);
    },
    update: async ({ where, data }) => {
      assert.ok(matches(where), 'refund update must target the original row');
      return apply(data);
    },
    updateMany: async ({ where, data }) => {
      if (!matches(where)) return { count: 0 };
      apply(data); return { count: 1 };
    } };
  // Controlled repository substitute, not evidence of MySQL locks/atomicity/idempotency.
  const prisma = { rentalPaymentRefund: table, $transaction: async callback => {
    const before = structuredClone(row);
    try { return await callback({ rentalPaymentRefund: table }); }
    catch (error) { row = before; throw error; }
  } };
  const funding = { recordEvent: async (...args) => {
    fundingCalls.push(args.slice(0, 4));
    if (fundingFails) throw new Error("synthetic funding persistence failure");
  } };
  return { service: new PaymentRuntimeService(prisma, {}, funding), fundingCalls, writes, row: () => row };
}
const refundArgs = [input.TENANT_ID, input.workspace("camera").id, "order_ain", "refund_ain"];
test("refund request and acceptance are not financial success; explicit rejection is failed", async () => {
  const h = refundHarness();
  const pending = await h.service.markRefundProviderCallPending(...refundArgs, new Error("HTTP 503: dependency unavailable"));
  assert.equal(pending.status, "pending");
  assert.equal(pending.response.fundedAt, undefined);
  const accepted = await h.service.applyProviderRefundOutcome(...refundArgs,
    { status: "accepted", externalStatus: "PROCESSING", responseJson: {} });
  assert.equal(accepted.status, "accepted");
  assert.equal(h.row().fundedAt, null);
  assert.equal(h.fundingCalls.length, 0);
  const rejected = await h.service.markRefundProviderCallPending(...refundArgs,
    new PaymentProviderDefinitiveError("REJECTED", "synthetic definitive rejection"));
  assert.equal(rejected.status, "failed");
  assert.equal(h.fundingCalls.length, 0);
});
test("provider success with internal funding failure is funding_pending and cannot downgrade", async () => {
  const h = refundHarness(true);
  const result = await h.service.applyProviderRefundOutcome(...refundArgs,
    { status: "succeeded", externalStatus: "SUCCESS", responseJson: {} });
  assert.equal(result.status, "funding_pending");
  assert.equal(h.row().fundedAt, null);
  assert.ok(h.row().succeededAt instanceof Date);
  assert.equal(h.fundingCalls.length, 1);
  const retry = await h.service.applyProviderRefundOutcome(...refundArgs,
    { status: "accepted", externalStatus: "PROCESSING", responseJson: {} });
  assert.equal(retry.status, "funding_pending");
});
test("only successful funding invocation records succeeded/funded refund (controlled substitute only)", async () => {
  const h = refundHarness();
  const result = await h.service.applyProviderRefundOutcome(...refundArgs,
    { status: "succeeded", externalStatus: "SUCCESS", responseJson: {} });
  assert.equal(result.status, "succeeded");
  assert.ok(h.row().fundedAt instanceof Date);
  assert.equal(h.fundingCalls[0][3].action, "refund");
  assert.equal(h.fundingCalls[0][3].amount, 10);
  assert.equal(h.fundingCalls[0][3].idempotencyKey, "payment-refund:refund_ain");
});

test("KNOWN GAP: legacy order without inspection snapshots reads current templates, not historical proof", async () => {
  const h = await harness("camera");
  const order = { id: "legacy_ain", tenantId: input.TENANT_ID, categoryCode: "camera", allocations: [] };
  const legacy = await h.core.listInspectionTemplates(input.TENANT_ID, "pickup", order);
  const current = await h.core.listInspectionTemplates(input.TENANT_ID, "pickup");
  assert.ok(legacy.length > 0, "fixture must exercise real nonempty current templates");
  assert.deepEqual(legacy, current, "characterization of unsafe historical fallback, NOT requirement acceptance");
  const explicitlyEmpty = await h.core.listInspectionTemplates(input.TENANT_ID, "pickup",
    { ...order, inspectionTemplateSnapshots: [] });
  assert.deepEqual(explicitlyEmpty, [], "an explicitly empty frozen snapshot must stay empty");
});
