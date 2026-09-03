const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// 需求 4.6.9：续租只对新增时间段重新报价，原租期金额与快照不重算；押金按整个新租期
// 的应收减去已收取差额；任何一步失败原归还时间不变。这里用不连库的吸收式 store 驱动
// 增量报价，钉住金额口径——闸门与落库路径由 mysql-e2e 覆盖。
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

  const order = {
    id: "order_ext_test",
    startAt,
    endAt,
    quoteId: quote.id,
    depositAmount: quote.depositAmount,
    preAuthAmount: quote.preAuthAmount
  };
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
  ok("增量租金只覆盖新增时间段，不是把整单重算一遍");

  assert.ok(preview.billableUnits > 0 && preview.billableUnits < 7);
  ok(`增量期的计费单位数按新增时长计（${preview.billableUnits} 个单位）`);

  assert.equal(preview.payableAmount, Math.round((preview.rentalAmount + preview.serviceAmount) * 100) / 100);
  ok("本次应付 = 增量租金 + 增量服务费，押金差额不混进应付");

  /* ---------- 费用明细：code 带 extension 前缀，类型是 extension ---------- */

  const extensionLines = preview.chargeLines.filter((line) => line.type === "extension");
  assert.ok(extensionLines.length > 0);
  assert.ok(extensionLines.every((line) => line.code.startsWith("extension:")));
  ok("增量租金进 type=extension 的费用明细，code 带 extension 前缀");

  assert.ok(extensionLines.every((line) => typeof line.detail === "string" && line.detail.length > 0));
  ok("每条续租明细都带计算说明，客服可据此解释金额");

  /* ---------- 快照：申请时的价格与规则版本都记下来 ---------- */

  assert.equal(preview.ruleVersion, quote.ruleVersion);
  assert.ok(Array.isArray(preview.rateSnapshot) && preview.rateSnapshot.length === lines.length);
  ok("续租记录带申请当时的费率快照与规则版本，事后可复算这一段");

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

  console.log(`\n续租/延期专项：${passed} 项全部通过`);
})();
