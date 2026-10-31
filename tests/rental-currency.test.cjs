const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// 需求 §948：一个订单只能属于一个结算币种。币种是**经营空间的事实**，
// 报价与订单各自带快照，界面金额一律按快照的币种展示。
//
// 这里钉住三件容易回退的事：
//   1. 展示函数不猜符号——认不出的币种回落成「代码 金额」，而不是显示成人民币；
//   2. 登记表只收两位小数币种（日元、韩元故意不在内，全库金额列是 Decimal(12,2)）；
//   3. 报价的币种来自经营空间设置，不是代码里写死的字面量。
const {
  RENTAL_CURRENCY_CODES,
  RENTAL_CURRENCY_META,
  formatRentalMoney,
  rentalCurrencySymbol
} = require("../packages/shared/dist/index.js");
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const {
  createAbsorbingConfigStore,
  createAbsorbingFactStore,
  createAbsorbingBusinessConfigStore,
  createAbsorbingBusinessFactStore
} = require("./helpers/absorbing-config-store.cjs");

let passed = 0;
const ok = (message) => {
  passed += 1;
  console.log(`  PASS  ${message}`);
};

/* ---------- 登记表：符号与标签成对存在，且只收两位小数币种 ---------- */

assert.ok(RENTAL_CURRENCY_CODES.length > 0);
for (const code of RENTAL_CURRENCY_CODES) {
  const meta = RENTAL_CURRENCY_META[code];
  assert.ok(meta && meta.symbol && meta.label, `${code} 缺符号或中文名`);
}
ok(`登记的 ${RENTAL_CURRENCY_CODES.length} 个币种都有符号与中文名，界面不会出现空前缀`);

for (const zeroDecimal of ["JPY", "KRW", "VND"]) {
  assert.ok(
    !RENTAL_CURRENCY_CODES.includes(zeroDecimal),
    `${zeroDecimal} 是 0 位小数币种，混进 Decimal(12,2) 的金额列会引入未实现的精度维度`
  );
}
ok("0 位小数币种（日元/韩元/越南盾）不在登记表内——这是刻意的边界，不是遗漏");

assert.equal(new Set(RENTAL_CURRENCY_CODES).size, RENTAL_CURRENCY_CODES.length);
ok("币种代码无重复");

/* ---------- 展示：符号跟着币种走，认不出就不猜 ---------- */

assert.equal(formatRentalMoney(300, "CNY"), "¥300.00");
assert.equal(formatRentalMoney(300, "HKD"), "HK$300.00");
assert.equal(formatRentalMoney(300, "USD"), "$300.00");
ok("同一个金额在不同币种下带不同符号——这正是硬编码 ¥ 会掩盖的错误");

assert.equal(formatRentalMoney(300, "XYZ"), "XYZ 300.00");
ok("未登记的币种回落成「代码 金额」，绝不猜一个符号");

assert.equal(formatRentalMoney(300), "¥300.00");
assert.equal(formatRentalMoney(300, undefined), "¥300.00");
ok("缺币种（存量数据）按人民币展示，与新增字段之前的行为一致");

assert.equal(formatRentalMoney(1234567.5, "CNY"), "¥1,234,567.50");
ok("千分位分组固定按 en-US，不随运行环境 locale 变化");

assert.equal(formatRentalMoney(Number.NaN, "CNY"), "¥0.00");
assert.equal(formatRentalMoney(Number.POSITIVE_INFINITY, "HKD"), "HK$0.00");
ok("非有限数按 0 展示，不把 NaN 印到界面上");

assert.equal(formatRentalMoney(0.005, "CNY"), "¥0.01");
assert.equal(formatRentalMoney(-12.3, "CNY"), "-¥12.30");
assert.equal(formatRentalMoney(-12.3, "HKD"), "-HK$12.30");
ok("四舍五入到分；负号排在币种符号之前（退款与冲销行会出现负数）");

assert.equal(formatRentalMoney(300, ""), "¥300.00");
ok("币种为空串（存量脏值）与缺省一致按人民币，不显示成「 300.00」");

assert.equal(rentalCurrencySymbol("HKD"), "HK$");
assert.equal(rentalCurrencySymbol("XYZ"), "XYZ");
assert.equal(rentalCurrencySymbol(), "¥");
ok("取符号与格式化共用同一张登记表，输入框前缀不会和金额列显示成两种币种");

/* ---------- 传导：报价的币种来自经营空间设置 ---------- */

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

void (async () => {
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();

  const profile = core.getProfile(tenantId);
  const settings = core.getBusinessSettings(tenantId);

  assert.ok(
    RENTAL_CURRENCY_CODES.includes(settings.pricing.currency),
    `经营空间的结算币种 ${settings.pricing.currency} 必须是登记过的币种`
  );
  ok(`经营空间设置带结算币种（当前 ${settings.pricing.currency}），它是这一层唯一的币种事实源`);

  const ctx = {
    profile,
    category: core.listCategories().find((item) => item.code === profile.categoryCode),
    settings,
    groups: core.listItemGroups(tenantId),
    pricingGroups: core.listPricingGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenantId, 'ws_tenant_002', ctx);
  const group = ctx.groups.find((row) => row.status === "enabled") ?? ctx.groups[0];
  const location = ctx.locations.find((row) => row.status === "enabled") ?? ctx.locations[0];

  const quote = await business.createQuote(tenantId, ctx, {
    customerType: "personal",
    customerName: "币种测试客户",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: location.id,
    startAt,
    endAt,
    lines: [{ itemGroupId: group.id, quantity: 1 }]
  });

  assert.equal(quote.currency, settings.pricing.currency);
  ok("报价快照的币种等于经营空间的结算币种，不是代码里写死的字面量");

  // 换币种后新报价必须跟着换：这条断言才真正排除"恰好等于默认值"的假通过。
  const hkSettings = { ...settings, pricing: { ...settings.pricing, currency: "HKD" } };
  const hkQuote = await business.createQuote(
    tenantId,
    { ...ctx, settings: hkSettings },
    {
      customerType: "personal",
      customerName: "港币空间客户",
      fulfillmentMode: "store_pickup_return",
      fulfillmentLocationId: location.id,
      startAt,
      endAt,
      lines: [{ itemGroupId: group.id, quantity: 1 }]
    }
  );
  assert.equal(hkQuote.currency, "HKD");
  assert.equal(hkQuote.payableAmount, quote.payableAmount);
  ok("同一空间改成 HKD 后新报价的币种随之改变，金额本身不因币种而变（不做汇率换算）");

  assert.equal(formatRentalMoney(hkQuote.payableAmount, hkQuote.currency).startsWith("HK$"), true);
  ok("界面按报价自带的币种展示；同一笔金额在两个空间会显示成两种币种");

  console.log(`\n结算币种专项：${passed} 项全部通过`);
})();
