const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// 需求 4.6.9（2026-09-04）：原价格/优惠规则重算全租期，再减此前已计金额。
// 此文件是不连库的计算专项，不把吸收式 store 当成事务或并发验证。
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const {
  createAbsorbingConfigStore,
  createAbsorbingFactStore,
  createAbsorbingBusinessConfigStore,
  createAbsorbingBusinessFactStore
} = require("./helpers/absorbing-config-store.cjs");

const core = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore());
const business = new RentalBusinessService(
  createAbsorbingBusinessConfigStore(),
  createAbsorbingBusinessFactStore(),
  createAbsorbingConfigStore()
);
const tenantId = "tenant_002";
const now = Date.now();
const startAt = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
const endAt = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();
const extendedTo = new Date(now + 7 * 24 * 60 * 60 * 1000).toISOString();

let passed = 0;
const ok = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

function context() {
  const profile = core.getProfile(tenantId);
  return {
    profile,
    category: core.listCategories().find((item) => item.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    pricingGroups: core.listPricingGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
}

void (async () => {
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();

  const ctx = context();
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenantId, 'ws_tenant_002', ctx);
  const group = ctx.groups.find((row) => row.status === "enabled") ?? ctx.groups[0];
  const location = ctx.locations.find((row) => row.status === "enabled") ?? ctx.locations[0];

  const quote = await business.createQuote(tenantId, ctx, {
    customerType: "personal",
    customerName: "续租测试客户",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: location.id,
    startAt,
    endAt,
    lines: [{ itemGroupId: group.id, quantity: 1 }]
  });

  business.factStore.findQuote = async (_tenant, id) => id === quote.id ? structuredClone(quote) : undefined;
  const order = {
    // 本专项覆盖新增的完整重算方式；缺省旧订单仍走独立续租。
    id: "order_ext_test",
    startAt,
    endAt,
    quoteId: quote.id,
    depositAmount: quote.depositAmount,
    preAuthAmount: quote.preAuthAmount
  };
  quote.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode: "original_total" };
  const lines = quote.request.lines.map((line) => ({
    itemGroupId: line.itemGroupId,
    pricingGroupId: line.pricingGroupId,
    quantity: line.quantity
  }));
  const baseArgs = {
    order,
    lines,
    // 申请时点落在租期之内：客户是在租着的时候申请续租的，也只有这个时点才有生效的规则版本。
    appliedAt: new Date(now + 3 * 24 * 60 * 60 * 1000).toISOString(),
    settlementMode: "immediate",
    fulfillmentMode: "store_pickup_return",
    locationIds: [location.id],
    customerType: "personal"
  };

  /* ---------- 增量期计费：只收新增那段，原租期不重算 ---------- */

  const preview = await business.quoteOrderExtension(tenantId, ctx, { ...baseArgs, newEndAt: extendedTo });
  assert.equal(preview.originalEndAt, endAt);
  assert.equal(preview.newEndAt, extendedTo);
  ok("续租的起点是订单当前归还时间，终点是申请的新时间");

  assert.ok(preview.rentalAmount > 0, "增量租金必须大于 0");
  assert.ok(
    preview.rentalAmount < quote.rentalAmount,
    `增量租金 ${preview.rentalAmount} 必须小于整单租金 ${quote.rentalAmount}——续租只收新增那段`
  );
  assert.equal(preview.pricingSnapshot.recalculatedRentalAmount - quote.rentalAmount, preview.rentalAmount);
  ok("全租期重算再减已计租金，明细保留原价与新总价");

  assert.ok(preview.billableUnits > 0 && preview.billableUnits < 7);
  ok(`增量期的计费单位数按新增时长计（${preview.billableUnits} 个单位）`);

  assert.equal(preview.payableAmount, Math.round((preview.rentalAmount + preview.serviceAmount) * 100) / 100);
  ok("本次应付 = 增量租金 + 增量服务费，押金差额不混进应付");

  /* ---------- 费用明细：code 带 extension 前缀，类型是 extension ---------- */

  const extensionLines = preview.chargeLines.filter((line) => line.type === "extension");
  assert.ok(extensionLines.length > 0);
  assert.equal(extensionLines[0].code, "rental");
  ok("租金差额为 extension 明细，生效落账时统一加续租序号");

  assert.ok(extensionLines.every((line) => typeof line.detail === "string" && line.detail.length > 0));
  ok("每条续租明细都带计算说明，客服可据此解释金额");

  /* ---------- 快照：申请时的价格与规则版本都记下来 ---------- */

  assert.equal(preview.ruleVersion, quote.ruleVersion);
  assert.ok(Array.isArray(preview.rateSnapshot) && preview.rateSnapshot.length === lines.length);
  assert.deepEqual(preview.rateSnapshot, quote.rateSnapshot);
  ok("续租沿用原订单费率与规则快照，不读取新价格");

  assert.ok(Array.isArray(preview.calendarSnapshot));
  ok("增量期的逐日取价依据一并落快照");

  /* ---------- 押金：按整个新租期重算后取差额，不重复收 ---------- */

  assert.ok(preview.depositDelta >= 0, "押金差额不得为负");
  assert.ok(preview.preAuthDelta >= 0, "预授权差额不得为负");
  ok("押金与预授权只取正差额，多收的部分由退款流程处理而不是这里倒扣");

  /* ---------- 结算方式透传：月结不需要补款 ---------- */

  assert.equal(preview.paymentRequired, true);
  ok("个人客户（immediate）需要补款后才生效");

  const monthly = await business.quoteOrderExtension(tenantId, ctx, {
    ...baseArgs,
    newEndAt: extendedTo,
    settlementMode: "monthly"
  });
  assert.equal(monthly.paymentRequired, false);
  assert.equal(monthly.settlementMode, "monthly");
  assert.equal(monthly.rentalAmount, preview.rentalAmount);
  ok("企业月结不需要补款动作，但金额与个人完全一致——结算方式不影响定价");

  /* ---------- 闸门：时间必须前进 ---------- */

  await assert.rejects(
    () => business.quoteOrderExtension(tenantId, ctx, { ...baseArgs, newEndAt: endAt }),
    /新的归还时间必须晚于当前归还时间/
  );
  ok("新归还时间等于当前归还时间时拒绝");

  await assert.rejects(
    () => business.quoteOrderExtension(tenantId, ctx, { ...baseArgs, newEndAt: startAt }),
    /新的归还时间必须晚于当前归还时间/
  );
  ok("新归还时间早于当前归还时间时拒绝");

  /* ---------- 已续租过的订单：基准是 effectiveEndAt 而不是原 endAt ---------- */

  const secondRound = await business.quoteOrderExtension(tenantId, ctx, {
    ...baseArgs,
    order: { ...order, effectiveEndAt: extendedTo },
    previousExtensions: [{ ...preview, id: "ext-first", tenantId, workspaceId: business.workspaceOf(tenantId),
      sequence: 1, status: "effective" }],
    newEndAt: new Date(now + 9 * 24 * 60 * 60 * 1000).toISOString()
  });
  assert.equal(secondRound.originalEndAt, extendedTo);
  ok("再次续租从 effectiveEndAt 起算，不会把已经续过的那段重复收费");

  /* ---------- 逾期费：小时单价不随续租摊薄 ---------- */

  // 逾期起点用 effectiveEndAt，但小时单价必须按**原报价**的时长摊——
  // `quote.rentalAmount` 只覆盖原租期，用续到的时间做分母会让续得越久逾期费越便宜。
  const lateBy = (dueAt, hours) => new Date(new Date(dueAt).getTime() + hours * 3_600_000).toISOString();
  const overdueOriginal = business.calculateOverdueCharge(tenantId, ctx, quote, lateBy(endAt, 3), endAt);
  const overdueExtended = business.calculateOverdueCharge(tenantId, ctx, quote, lateBy(extendedTo, 3), extendedTo);
  assert.ok(overdueOriginal > 0, "逾期 3 小时必须产生逾期费");
  assert.equal(overdueExtended, overdueOriginal);
  ok(`同样逾期 3 小时，续租过与没续过的逾期费相同（${overdueOriginal}）——单价不按续到的时间摊薄`);

  const farExtended = new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  assert.equal(business.calculateOverdueCharge(tenantId, ctx, quote, lateBy(farExtended, 3), farExtended), overdueOriginal);
  ok("续 25 天之后逾期费仍不变：分母固定是原报价时长，不是当前归还时间");

  /* ---------- 提前归还退款：基数包含续租租金，且套最小起租量下限 ---------- */

  const returnedEarly = new Date(now + 4 * 24 * 60 * 60 * 1000).toISOString();
  // 缺省规则是「不退」，两边都会是 0 而让断言变成空跑；这里显式开启退款规则。
  const refundable = structuredClone(quote);
  refundable.ruleSnapshot.earlyReturn = {
    mode: "auto",
    minAdvanceHours: 1,
    refundPercent: 100,
    refundUndeliveredServices: false
  };
  const refundNoExtension = business.calculateEarlyReturnRefund(tenantId, ctx, refundable, endAt, returnedEarly);
  const refundWithExtension = business.calculateEarlyReturnRefund(tenantId, ctx, refundable, extendedTo, returnedEarly, preview.rentalAmount);
  assert.ok(refundNoExtension.rentalRefund > 0, "开启规则后提前 1 天归还必须产生退款，否则下面的比较是空跑");
  assert.ok(
    refundWithExtension.rentalRefund > refundNoExtension.rentalRefund,
    `续过租的退款 ${refundWithExtension.rentalRefund} 必须大于没续租的 ${refundNoExtension.rentalRefund}——`
      + "续租那段整段没用上，它的租金必须进折算基数，否则续过租的单只退到一部分"
  );
  ok("提前归还退款的基数含已生效的续租租金，不会因为续过租反而退得更少");

  // 最小起租量：起租量吃掉整段租期时，提前还车并没有省下任何计费单位，不该退钱。
  const flooredQuote = structuredClone(refundable);
  flooredQuote.rateSnapshot[0].minimumUnits = 99;
  const flooredRefund = business.calculateEarlyReturnRefund(tenantId, ctx, flooredQuote, endAt, returnedEarly);
  assert.equal(flooredRefund.rentalRefund, 0);
  ok("最小起租量吃掉整段租期时不退租金：客户被收的计费单位一个都没省下");

  /* ---------- 一次性耗材：续租不重复计费，且不要求耗材重新命中现价 ---------- */

  const originalInventoryMode = group.inventoryMode;
  group.inventoryMode = "consumable";
  const consumableLine = {
    itemGroupId: group.id,
    pricingGroupId: undefined,
    quantity: 1,
    inventoryMode: "consumable",
    amount: quote.rentalAmount
  };
  const consumableOriginalTotal = await business.quoteOrderExtension(tenantId, ctx, {
    ...baseArgs,
    lines: [consumableLine],
    newEndAt: extendedTo
  });
  assert.equal(consumableOriginalTotal.rentalAmount, 0);
  assert.equal(consumableOriginalTotal.billableUnits, 0);
  assert.equal(consumableOriginalTotal.pricingSnapshot.recalculatedRentalAmount, quote.rentalAmount);
  ok("原价全租期续租不会再次收取已领取的一次性耗材");

  quote.ruleSnapshot.extension.pricingMode = "incremental";
  const consumableIncremental = await business.quoteOrderExtension(tenantId, ctx, {
    ...baseArgs,
    lines: [consumableLine],
    newEndAt: extendedTo
  });
  assert.equal(consumableIncremental.rentalAmount, 0);
  assert.equal(consumableIncremental.billableUnits, 0);
  ok("增量续租不会因耗材价格版本变化而重新计价");
  group.inventoryMode = originalInventoryMode;

  /* ---------- 动作版本依据与缺失原单位 fail-closed ---------- */
  const historicalCategory = structuredClone(ctx.category);
  const currentCategory = { ...structuredClone(ctx.category), name: "新发布的品类政策" };
  const currentContext = { ...ctx, category: currentCategory };
  quote.categoryVersionId = "category-v1";
  business.categoryResolver = {
    forWorkspace: async () => ({ definition: currentCategory, categoryVersionId: "category-v2", adoptionRevision: 2 }),
    forVersion: async (code, id) => { assert.equal(id, "category-v1"); return historicalCategory; }
  };
  const incremental = await business.quoteOrderExtension(tenantId, currentContext, { ...baseArgs, newEndAt: extendedTo });
  assert.equal(incremental.executionBasis.categoryVersionId, "category-v2");
  assert.equal(incremental.executionBasis.originalCategoryVersionId, "category-v1");
  assert.equal(incremental.executionBasis.policySource, "current_workspace");
  assert.equal(incremental.executionBasis.adoptionRevision, 2);
  assert.ok(incremental.executionBasis.pricingStrategies.every((row) => row.implementationVersion === "1"));
  currentCategory.name = "随后编辑";
  assert.equal(incremental.executionBasis.categoryPolicySnapshot.name, "新发布的品类政策", "动作快照不能引用可变对象");
  quote.ruleSnapshot.extension.pricingMode = "original_total";
  const originalMode = await business.quoteOrderExtension(tenantId, currentContext, { ...baseArgs, newEndAt: extendedTo });
  assert.equal(originalMode.executionBasis.categoryVersionId, "category-v1");
  assert.equal(originalMode.executionBasis.policySource, "original_quote");
  assert.deepEqual(originalMode.executionBasis.categoryPolicySnapshot, historicalCategory);
  ok("独立续租记录当前政策，原价补差记录原政策，实现版本与正文快照各自独立");

  const resolveSpaceRates = business.resolveSpaceRates;
  business.resolveSpaceRates = async () => ({ rates: quote.rateSnapshot.map((row) => ({ ...row, baseAmount: row.baseAmount * 2 })), versionId: "new-price", version: "2" });
  quote.ruleSnapshot.extension.pricingMode = "incremental";
  const changedPrice = await business.quoteOrderExtension(tenantId, currentContext, { ...baseArgs, newEndAt: extendedTo });
  assert.equal(changedPrice.priceVersionId, "new-price");
  assert.equal(changedPrice.rentalAmount, incremental.rentalAmount * 2);
  quote.ruleSnapshot.extension.pricingMode = "original_total";
  const unchangedOriginal = await business.quoteOrderExtension(tenantId, currentContext, { ...baseArgs, newEndAt: extendedTo });
  assert.equal(unchangedOriginal.rentalAmount, originalMode.rentalAmount);
  business.resolveSpaceRates = resolveSpaceRates;
  ok("现价上涨影响独立续租，不影响原价全租期补差");

  quote.ruleSnapshot.extension.pricingMode = "incremental";
  const preservedRates = quote.rateSnapshot;
  quote.rateSnapshot = [];
  await assert.rejects(() => business.quoteOrderExtension(tenantId, currentContext, { ...baseArgs, newEndAt: extendedTo }), /缺少原订单计价单位依据/u);
  quote.rateSnapshot = preservedRates;
  ok("没有原计价单位时明确拒绝，不能静默改用当前价格任意单位");
  const unit = preservedRates[0].unit;
  currentCategory.businessModel.pricingUnits = currentCategory.businessModel.pricingUnits.filter((row) => row !== unit);
  const compatible = await business.quoteOrderExtension(tenantId, currentContext, { ...baseArgs, newEndAt: extendedTo });
  assert.equal(compatible.executionBasis.pricingStrategies[0].unit, unit);
  quote.categoryVersionId = undefined;
  await assert.rejects(() => business.quoteOrderExtension(tenantId, currentContext, { ...baseArgs, newEndAt: extendedTo }), /历史兼容政策/u);
  ok("新版收窄单位时有原版政策可保留单位执行；缺历史证据则明确拒绝");
  const { rentalPricingStrategy } = require("../apps/api/src/modules/rental-core/rental-pricing-strategy");
  assert.throws(() => rentalPricingStrategy(unit, "missing-version"), /实现版本不可用/u);
  assert.throws(() => rentalPricingStrategy(unit, "constructor"), /实现版本不可用/u);
  ok("缺失计价实现版本不允许静默切换到默认算法");

  quote.categoryVersionId = "category-v1";
  const hourlyBasis = await business.extensionExecutionBasis(tenantId, currentContext, quote,
    [{ ...preservedRates[0], unit: "hour" }], "original_total",
    { ...quote.ruleSnapshot, pricing: { ...quote.ruleSnapshot.pricing, hourToDayEnabled: true } });
  assert.deepEqual(hourlyBasis.pricingStrategies.map((entry) => entry.unit), ["hour", "day_24h"]);
  ok("时租转日租的动作依据同时记录小时和24小时策略，不漏记实际使用的算法");

  console.log(`\n续租/延期专项：${passed} 项全部通过`);
})();
