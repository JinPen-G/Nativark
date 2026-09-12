const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { createAbsorbingConfigStore, createAbsorbingFactStore, createAbsorbingBusinessConfigStore, createAbsorbingBusinessFactStore } = require("./helpers/absorbing-config-store.cjs");

// 不连库用例：注入吸收式 store 让配置写穿落空，配置读取仍由服务内存缓存提供。
const core = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore());
const businessConfigStore = createAbsorbingBusinessConfigStore();
const business = new RentalBusinessService(businessConfigStore, createAbsorbingBusinessFactStore(), createAbsorbingConfigStore());
const tenantId = "tenant_002";
const now = Date.now();
const startAt = new Date(now + 2 * 24 * 60 * 60 * 1000).toISOString();
const endAt = new Date(now + 5 * 24 * 60 * 60 * 1000).toISOString();

function context() {
  const profile = core.getProfile(tenantId);
  return {
    profile,
    category: core.listCategories().find((item) => item.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
}

// 核心服务的配置写方法已随「配置落库」转为异步，.cjs 无顶层 await，故包一层异步 IIFE。
void (async () => {

const ok2 = (message) => console.log(`  PASS  ${message}`);

// SPACE-03：状态按经营空间取，先跑启动预热建立查找表（夹具提供演示空间）。
await core.onApplicationBootstrap();
await business.onApplicationBootstrap();

const pricing = business.listPricingPlans(tenantId, context());
assert.equal(pricing[0].categoryCode, "camping");
assert.ok(pricing[0].rates.every((rate) => rate.unit === "calendar_day"));
assert.ok(pricing[0].rates.every((rate) => rate.itemGroupCode.startsWith("CAMP-")));

const savedPricing = await business.savePricingPlan(tenantId, context(), {
  id: pricing[0].id,
  code: pricing[0].code,
  name: pricing[0].name,
  status: "enabled",
  effectiveFrom: pricing[0].effectiveFrom,
  changeReason: "测试价格版本",
  rates: pricing[0].rates.map(({ id, itemGroupCode, itemGroupName, ...rate }) => ({ ...rate, baseAmount: rate.baseAmount + 10 }))
});
assert.equal(savedPricing.version, "1.1");

const calendar = await business.importOfficialCalendar(tenantId, context(), {
  year: new Date(startAt).getUTCFullYear(),
  region: "CN",
  sourceName: "测试用国务院办公厅年度通知",
  sourceUrl: "https://www.gov.cn/test-calendar",
  sourcePublishedAt: new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString(),
  days: [{ date: startAt.slice(0, 10), dayType: "statutory_holiday", name: "测试法定假日" }]
});
assert.equal(calendar.status, "draft");
const publishedCalendar = await business.publishCalendar(tenantId, context(), calendar.year, {
  changeReason: "测试年度日历首发"
});
assert.equal(publishedCalendar.status, "published");
assert.ok(publishedCalendar.sourceUrl.startsWith("https://"));
assert.equal(publishedCalendar.changeReason, "测试年度日历首发", "发布必须记录变更原因");

// GET 只能返回缺省视图，不能把尚未保存的年度悄悄塞进缓存。
// SPACE-03：states 现在按经营空间键，演示租户的默认空间是 ws_<tenantId>。
const workspaceKey = `ws_${tenantId}`;
const cachedCalendarCount = business.states.get(workspaceKey).calendars.length;
business.getCalendar(tenantId, context(), calendar.year + 10);
assert.equal(business.states.get(workspaceKey).calendars.length, cachedCalendarCount, "calendar GET must be side-effect free");

// 写库失败时必须保留最后一次成功提交的缓存，而不是留下幽灵日历配置。
const calendarBeforeRejectedWrite = structuredClone(business.getCalendar(tenantId, context(), calendar.year));
businessConfigStore.failCalendar = true;
await assert.rejects(
  business.saveCalendarDay(tenantId, context(), calendar.year, {
    date: `${calendar.year}-12-31`,
    dayType: "tenant_special",
    name: "不得进入缓存",
    pricingMultiplier: 1.5,
    closed: false,
    overrideReason: "写库失败回滚验证"
  }),
  /calendar write rejected/
);
assert.deepEqual(
  business.getCalendar(tenantId, context(), calendar.year),
  calendarBeforeRejectedWrite,
  "failed calendar write must leave cache unchanged"
);
businessConfigStore.failCalendar = false;

const currentRule = business.currentRule(tenantId, context());
// RULE-01A：保存草稿与发布是两步。saveRuleVersion 只产出草稿，publishRuleVersion 才生效。
const savedRule = await business.saveRuleVersion(tenantId, context(), {
  config: { ...structuredClone(currentRule.config), cancellation: { ...currentRule.config.cancellation, weatherExceptionEnabled: true } },
  changeReason: "测试露营天气取消规则"
}, "test");
assert.equal(savedRule.status, "draft", "保存只产出草稿，不直接生效");
const publishedRule = await business.publishRuleVersion(tenantId, context(), savedRule.version, { reason: "发布天气取消规则" }, "test");
assert.equal(publishedRule.status, "published", "立即发布即已生效");
assert.equal(business.currentRule(tenantId, context()).version, "1.1", "按当前时间匹配到新发布的 1.1");

const couponTemplate = await core.saveCouponTemplate(tenantId, {
  code: "CAMP-WELCOME",
  name: "露营新客券",
  discountType: "fixed_amount",
  discountValue: 30,
  minimumSpend: 100,
  totalQuota: 10,
  perCustomerLimit: 1,
  effectiveFrom: new Date(now - 24 * 60 * 60 * 1000).toISOString(),
  effectiveTo: new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString(),
  applicableItemGroupIds: [],
  status: "active"
});
// claimCoupon 现在返回 { coupon, template }：模板的 claimedQuantity 也是本次写入的一部分，
// 调用方需要它才能在事务提交后正确更新缓存。
const claimResult = await business.claimCoupon(tenantId, context(), couponTemplate.id, "member_001");
const customerCoupon = claimResult.coupon;
assert.equal(customerCoupon.status, "claimed");
assert.equal(claimResult.template.claimedQuantity, 1, "领取应使模板已领数量加一");
await assert.rejects(async () => business.claimCoupon(tenantId, context(), couponTemplate.id, "member_001"), /限领/);
await core.saveCouponTemplate(tenantId, {
  id: couponTemplate.id,
  code: couponTemplate.code,
  name: couponTemplate.name,
  discountType: couponTemplate.discountType,
  discountValue: 1,
  minimumSpend: couponTemplate.minimumSpend,
  maximumDiscount: couponTemplate.maximumDiscount,
  appliesTo: couponTemplate.appliesTo,
  stackableWithDiscountPlans: couponTemplate.stackableWithDiscountPlans,
  totalQuota: couponTemplate.totalQuota,
  perCustomerLimit: couponTemplate.perCustomerLimit,
  perCustomerUseLimit: couponTemplate.perCustomerUseLimit,
  totalBudget: couponTemplate.totalBudget,
  effectiveFrom: couponTemplate.effectiveFrom,
  effectiveTo: couponTemplate.effectiveTo,
  applicableItemGroupIds: couponTemplate.applicableItemGroupIds,
  status: "active"
});

const group = context().groups.find((item) => item.code === "CAMP-TENT");
const location = core.listLocations(tenantId)[0];
const selectedService = business.listServices(tenantId, context())[0];
const quote = await business.createQuote(tenantId, context(), {
  customerType: "personal",
  customerId: "member_001",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: location.id,
  startAt,
  endAt,
  customerCouponId: customerCoupon.id,
  lines: [{ itemGroupId: group.id, quantity: 1 }],
  services: [{ serviceId: selectedService.id, quantity: 1 }]
});
assert.ok(quote.rentalAmount > 0);
assert.ok(quote.couponAmount > 0);
assert.equal(quote.couponAmount, 30, "已发券必须按领取时的 30 元权益快照计算，不能跟随模板改成 1 元");
assert.equal(quote.couponEvaluation.templateVersion, "1.0", "报价必须记录客户券固化的模板版本");
assert.ok(quote.serviceAmount > 0);
assert.equal(quote.calendarVersion, `${publishedCalendar.year}:${publishedCalendar.version}`);
assert.ok(quote.chargeLines.some((line) => line.type === "coupon"));
// MKT-02A：报价必须固化命中的服务快照（服务、价格、单位数、资格判据与条款正文）。
// 只有 chargeLines 的话，服务改价改条款后就无从复算这张报价按哪一版收的。
const quotedService = quote.serviceSnapshots.find((row) => row.serviceId === selectedService.id);
assert.ok(quotedService, "报价必须保存命中的增值服务快照");
assert.equal(quotedService.serviceVersion, selectedService.version, "服务快照必须带服务版本");
assert.equal(quotedService.termsVersion, selectedService.termsVersion, "服务快照必须带条款版本");
assert.equal(quotedService.terms, selectedService.terms, "服务快照必须整段固化条款正文");
assert.equal(quotedService.insuredDisplayable, false, "未接入真实保险服务商时不得显示已投保");
assert.ok(quotedService.eligibility.length >= 5, "服务快照必须逐条记录资格判据");
assert.equal(
  quotedService.amount,
  quote.chargeLines.filter((line) => line.sourceId === selectedService.id).reduce((sum, line) => sum + line.amount, 0),
  "服务快照金额必须与明细行一致"
);

// 券状态机（锁定→核销→释放）是业务状态，仍在内存，这里继续断言。
// 但订单本体已随 RC-01 阶段 3 迁入数据库：core.createOrder 会先查可用量，
// 而吸收式 stub 没有库存事实，必然判定库存不足。券操作只需要一个订单标识，
// 因此这里用合成 id 驱动，订单生命周期本身由 E2E 第 9/11/12 节对真实 MySQL 验证。
const orderId = "order_coupon_flow_test";
const consumed = business.consumeQuote(tenantId, context(), quote.id);
assert.equal(consumed.id, quote.id);
await business.markQuoteConsumed(tenantId, context(), quote.id, orderId);
assert.throws(() => business.consumeQuote(tenantId, context(), quote.id), /已用于订单/, "quote snapshots must be single-use");
await business.lockCoupon(tenantId, context(), quote.customerCouponId, orderId);
assert.equal(business.listCustomerCoupons(tenantId, context(), "member_001")[0].status, "locked");
await business.redeemCoupon(tenantId, context(), orderId);
assert.equal(business.listCustomerCoupons(tenantId, context(), "member_001")[0].status, "redeemed");
await business.releaseCoupon(tenantId, context(), orderId);
assert.equal(business.listCustomerCoupons(tenantId, context(), "member_001")[0].status, "claimed");

const settings = core.getBusinessSettings(tenantId);
await core.saveBusinessSettings(tenantId, {
  ...settings,
  membership: { ...settings.membership, signupRewardEnabled: true, signupRewardType: "points", signupRewardAmount: 100, referralRewardEnabled: true, referralRewardType: "points", referrerRewardAmount: 50, inviteeRewardAmount: 20 }
}, "test");
const reward = await business.grantReward(tenantId, context(), { customerId: "member_001", triggerType: "registration", idempotencyKey: "register:member_001" });
assert.equal(reward[0].amount, 100);
assert.equal(business.listBenefitAccounts(tenantId, context(), "member_001")[0].pointsBalance, 100, "points rewards must be applied to the tenant benefit account");
// 奖励幂等已改为以数据库为准（RC-04）：判重查 rental_reward_ledger_entries 的
// (tenantId, idempotencyKey) 唯一约束与派生子键前缀，而这里注入的是吸收式 stub（读返回空）。
// 在 stub 上断言幂等只会测到"重写了一遍查询逻辑的假实现"，因此该断言迁至
// tests/mysql-e2e.test.cjs 第 42 节，用"重启清空内存后同键再发"证伪内存判重。
await business.reverseReward(tenantId, context(), reward[0].id, "测试撤销");
assert.equal(business.listRewards(tenantId, context())[0].status, "reversed");
assert.equal(business.listBenefitAccounts(tenantId, context(), "member_001")[0].pointsBalance, 0, "reversing a reward must reverse the applied benefit");
const referralReward = await business.grantReward(tenantId, context(), { customerId: "member_referrer", relatedCustomerId: "member_invitee", triggerType: "first_order_completed", idempotencyKey: "referral:first-order:member_invitee" });
assert.equal(referralReward.length, 2, "configured referral trigger must grant both referrer and invitee rewards");
await business.registerReferral(tenantId, context(), "member_event_invitee", "member_event_referrer");
const eventRewards = await business.handleCustomerEvent(tenantId, context(), "member_event_invitee", "first_order_completed");
assert.equal(eventRewards.length, 2, "first completed order must execute the configured referral trigger");
assert.equal((await business.handleCustomerEvent(tenantId, context(), "member_event_invitee", "first_order_completed")).length, 2, "business event rewards must be idempotent");
const pointsBeforeOtherTenantRead = business.listBenefitAccounts(tenantId, context()).length;
const cameraContext = {
  profile: core.getProfile("tenant_001"),
  category: core.listCategories().find((item) => item.code === core.getProfile("tenant_001").categoryCode),
  settings: core.getBusinessSettings("tenant_001"),
  groups: core.listItemGroups("tenant_001"),
  couponTemplates: core.listCouponTemplates("tenant_001")
};
assert.equal(business.listBenefitAccounts("tenant_001", cameraContext).length, 0, "benefit accounts must remain isolated by SaaS tenant");

const couponRewardSettings = core.getBusinessSettings(tenantId);
await core.saveBusinessSettings(tenantId, {
  ...couponRewardSettings,
  membership: { ...couponRewardSettings.membership, referralRewardEnabled: true, referralRewardType: "coupon", referrerRewardAmount: 1, inviteeRewardAmount: 1, referralRewardCouponTemplateId: couponTemplate.id }
}, "test");
const couponRewards = await business.grantReward(tenantId, context(), { customerId: "coupon_referrer", relatedCustomerId: "coupon_invitee", triggerType: "first_order_completed", idempotencyKey: "referral:coupon:test" });
assert.equal(couponRewards.length, 2);
assert.equal(business.listCustomerCoupons(tenantId, context(), "coupon_referrer").length, 1, "coupon rewards must create an actual customer coupon");
assert.equal(business.listBenefitAccounts(tenantId, context(), "coupon_invitee")[0].availableRewardCouponCount, 1);
await business.reverseReward(tenantId, context(), couponRewards[0].id, "撤销测试券奖励");
assert.equal(business.listBenefitAccounts(tenantId, context(), "coupon_referrer")[0].availableRewardCouponCount, 0);
assert.equal(business.listBenefitAccounts(tenantId, context()).length >= pointsBeforeOtherTenantRead, true);

const damageWaiver = await business.saveService(tenantId, context(), {
  code: "DAMAGE-WAIVER",
  name: "露营设备损坏免赔",
  serviceType: "damage_waiver",
  billingUnit: "per_order",
  price: 80,
  minimumQuantity: 1,
  maximumQuantity: 1,
  coverageLimit: 5000,
  deductible: 200,
  termsVersion: "1.0",
  terms: "每单免赔上限 5000 元，免赔额 200 元。",
  applicableItemGroupIds: [],
  applicableFulfillmentModes: [],
  applicableLocationIds: [],
  customerScope: "all",
  selectionMode: "optional",
  requiresCapacity: false,
  status: "enabled"
});
const damageQuote = { ...quote, request: { ...quote.request, services: [{ serviceId: damageWaiver.id, quantity: 1 }] } };
assert.ok(business.calculateDamageCharge(tenantId, context(), damageQuote, [{ chargeAmount: 1000 }]) < 1000, "damage waiver must reduce the customer charge according to its saved terms");

// ============ 兼容开关只关旧倍率：dayTypePrices 与时间窗规则照常生效 ============
// 需求 4.4.5 的第 3 层有两个来源：逐商品配置的 dayTypePrices（价格版本里的显式配置）
// 与 PRICE-03 之前的空间级 weekendMultiplier/holidayMultiplier。
// `pricing.holidayPricingEnabled` 只管后者：关掉它，配好的日期类型价格仍要按配置收钱。
// 早前 resolveUnitPrice 的每个分支都返回「属于价格模块」，于是这个开关无论开关都不生效。
const layerGroup = context().groups.find((item) => item.code !== "CAMP-TENT") ?? context().groups[0];
const layerYear = new Date(now).getUTCFullYear();
const layerCalendar = business.getCalendar(tenantId, context(), layerYear);
// 从日历里挑一个真正的周末且可营业的日期，而不是自己推算星期：
// 周末口径由 settings.calendar.weekendDays 决定，硬编码会在改配置后静默失效。
const weekendDay = layerCalendar.days.find(
  (day) => day.dayType === "weekend" && (day.businessStatus ?? "open") === "open" && day.date > new Date(now).toISOString().slice(0, 10)
);
assert.ok(weekendDay, "夹具日历里必须存在一个可营业的周末日期");
// 12:00–18:00（+08:00）：同一营业日内 1 个自然日单位，且落在常规营业时段内。
const layerStartAt = `${weekendDay.date}T04:00:00.000Z`;
const layerEndAt = `${weekendDay.date}T10:00:00.000Z`;
const layerRate = {
  itemGroupId: layerGroup.id,
  unit: "calendar_day",
  baseAmount: 100,
  weekendMultiplier: 1.5,
  holidayMultiplier: 2,
  depositAmount: 0,
  minimumUnits: 1,
  preAuthAmount: 0
};
const layerPlan = await business.savePricingPlan(tenantId, context(), {
  code: "LAYER-COMPAT",
  name: "兼容开关专项计划",
  status: "enabled",
  // 生效时间必须晚于夹具计划：空间全集同键取「生效最晚者」，早于夹具的话本用例
  // 断言的其实是夹具的价格，改坏取价层也照样绿。
  effectiveFrom: new Date(now + 60 * 60 * 1000).toISOString(),
  changeReason: "兼容开关专项",
  rates: [layerRate]
}, "test");

const layerSettingsBefore = core.getBusinessSettings(tenantId);
const setLegacySwitch = async (enabled) => {
  const current = core.getBusinessSettings(tenantId);
  await core.saveBusinessSettings(tenantId, { ...current, pricing: { ...current.pricing, holidayPricingEnabled: enabled } }, "test");
};
const layerQuote = async () => business.createQuote(tenantId, context(), {
  customerType: "personal",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: location.id,
  startAt: layerStartAt,
  endAt: layerEndAt,
  lines: [{ itemGroupId: layerGroup.id, quantity: 1, pricingUnit: "calendar_day" }]
});
const layerRentalOf = (quoteResult) =>
  quoteResult.chargeLines.filter((line) => line.type === "rental").reduce((sum, line) => sum + line.amount, 0);

// 1) 开关打开：旧周末倍率生效，快照记 day_type_legacy——它是兼容层，不能和
//    逐商品配置的 day_type 混在一起，否则将来移除旧字段时无从筛选。
await setLegacySwitch(true);
const legacyOnQuote = await layerQuote();
// 先证明取价用的确实是本用例的费率：夹具计划同样覆盖该商品，若被它胜出，
// 下面的金额断言就变成在测夹具而不是测取价层。
assert.equal(
  legacyOnQuote.rateSnapshot.find((row) => row.itemGroupId === layerGroup.id)?.weekendMultiplier,
  1.5,
  "取价必须命中本用例的费率（生效最晚者）"
);
assert.equal(layerRentalOf(legacyOnQuote), 150, "开关打开时旧周末倍率必须生效（100 × 1.5）");
assert.equal(
  legacyOnQuote.calendarSnapshot.find((row) => row.itemGroupId === layerGroup.id)?.hitLayer,
  "day_type_legacy",
  "旧倍率命中必须记为 day_type_legacy"
);

// 2) 开关关闭且未配 dayTypePrices：落回商品基础价，而不是继续按周末倍率收钱。
await setLegacySwitch(false);
const legacyOffQuote = await layerQuote();
assert.equal(layerRentalOf(legacyOffQuote), 100, "开关关闭时旧周末倍率不得生效，应回落基础价");
assert.equal(
  legacyOffQuote.calendarSnapshot.find((row) => row.itemGroupId === layerGroup.id)?.hitLayer,
  "base",
  "旧倍率被关闭后命中层必须是 base"
);

// 3) 开关仍关闭，但配了逐商品的日期类型价格：必须按配置生效。
//    这是本轮口径的核心——兼容开关不得连带关掉 PRICE-03 的显式配置。
//    用一个生效更晚的计划来承载它，走的是与生产相同的「同键取生效最晚者」路径，
//    而不是就地改写一个已启用计划（那条路在数据库模式下要求走调价计划）。
await business.savePricingPlan(tenantId, context(), {
  code: "LAYER-COMPAT-DT",
  name: "兼容开关专项计划（日期类型价）",
  status: "enabled",
  effectiveFrom: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
  changeReason: "补配日期类型价格",
  rates: [{ ...layerRate, dayTypePrices: { weekend: 2 } }]
}, "test");
const dayTypeQuote = await layerQuote();
assert.equal(layerRentalOf(dayTypeQuote), 200, "兼容开关关闭时，配好的日期类型价格仍必须生效（100 × 2）");
assert.equal(
  dayTypeQuote.calendarSnapshot.find((row) => row.itemGroupId === layerGroup.id)?.hitLayer,
  "day_type",
  "逐商品日期类型价格命中必须记为 day_type"
);
assert.equal(layerPlan.code, "LAYER-COMPAT", "前一个计划仍然存在，用于对比两种来源");
await core.saveBusinessSettings(tenantId, layerSettingsBefore, "test");

// ============ 营业与履约时段三态：缺省继承、空数组停用、非空按时点命中 ============
// 需求 4.5.1 把营业时段与领取/归还/配送时段并列声明。三者都必须区分「未声明」与
// 「空数组」：早前只有配送分支处理了空数组，营业时段与领取/归还的空数组都走
// withinWindows 的 `!windows?.length → true`，于是「当天不营业」「当天不办领取」
// 反而变成随时可办。校验只看**已发布**日历，因此每次覆盖后都要发布。
const hoursDay = layerCalendar.days.find(
  (day) => day.dayType !== "weekend" && (day.businessStatus ?? "open") === "open" && day.date > new Date(now).toISOString().slice(0, 10)
);
assert.ok(hoursDay, "夹具日历里必须存在一个可营业的工作日");
const publishHours = async (hours, reason) => {
  const day = business.getCalendar(tenantId, context(), layerYear).days.find((item) => item.date === hoursDay.date);
  const { source: _s, overrideBy: _b, overrideAt: _a, overriddenFrom: _o, overrideScope: _c, ...rest } = day;
  await business.saveCalendarDay(tenantId, context(), layerYear, { ...rest, hours, overrideReason: reason }, "test");
  await business.publishCalendar(tenantId, context(), layerYear, { changeReason: reason }, "test");
};
// 12:00 领取、14:00 归还（Asia/Shanghai）。
const hoursQuote = async () => business.createQuote(tenantId, context(), {
  customerType: "personal",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: location.id,
  startAt: `${hoursDay.date}T04:00:00.000Z`,
  endAt: `${hoursDay.date}T06:00:00.000Z`,
  lines: [{ itemGroupId: layerGroup.id, quantity: 1, pricingUnit: "calendar_day" }]
});

// 1) 动作时段未声明：继承营业时段，时点落在营业时段内即可下单。
await publishHours({ windows: [{ start: "09:00", end: "18:00" }] }, "时段三态：仅声明营业时段");
const inheritedQuote = await hoursQuote();
assert.ok(inheritedQuote.quoteNo, "动作时段未声明时应继承营业时段并允许下单");

// 2) 营业时段为空数组＝当天不营业，必须拒绝，而不是当成"不限制"。
await publishHours({ windows: [] }, "时段三态：营业时段置空");
await assert.rejects(hoursQuote, /营业时段为空/, "营业时段为空数组必须拒绝下单");

// 3) 领取时段为空数组＝当天不办领取；营业时段仍开放。
await publishHours({ windows: [{ start: "09:00", end: "18:00" }], pickup: [] }, "时段三态：领取时段置空");
await assert.rejects(hoursQuote, /不提供领取/, "领取时段为空数组必须拒绝下单");

// 4) 非空动作时段按时点命中：12:00 领取落在 10:00-11:00 之外。
await publishHours({ windows: [{ start: "09:00", end: "18:00" }], pickup: [{ start: "10:00", end: "11:00" }] }, "时段三态：领取时段收窄");
await assert.rejects(hoursQuote, /不在领取可用时段内/, "时点落在领取时段外必须拒绝下单");

// 5) 归还时段为空同样拒绝——下单时两个端点都要校验（需求 4.5.4）。
await publishHours({ windows: [{ start: "09:00", end: "18:00" }], return: [] }, "时段三态：归还时段置空");
await assert.rejects(hoursQuote, /不提供归还/, "归还时段为空数组必须拒绝下单");

// 6) 实际领取复查只检查领取动作，不能把同一时刻再当作归还时刻校验。
//    领取 12:00 在 pickup 时段内，而 return 明确停用；报价需要同时检查两端会拒绝，
//    但领取动作本身必须允许。早前 assertPickupOpenAt 把 startAt/endAt 都设为领取时刻，
//    又调用双端点校验，合法领取会被 return: [] 错误拦截。
await publishHours(
  { windows: [{ start: "09:00", end: "18:00" }], pickup: [{ start: "11:00", end: "13:00" }], return: [] },
  "时段三态：领取动作独立复查"
);
assert.doesNotThrow(
  () => business.assertPickupOpenAt(
    tenantId,
    context(),
    location.id,
    `${hoursDay.date}T04:00:00.000Z`,
    "store_pickup_return"
  ),
  "实际领取复查不得同时校验归还时段"
);
// 恢复成可营业，避免影响后续用例。
await publishHours({ windows: [{ start: "09:00", end: "18:00" }] }, "时段三态：恢复");

// ============ MKT-01A：报价必须保存逐方案评估，且优惠不得触碰押金与预授权 ============
// 需求 4.4.10：报价保存已应用与未应用方案、原因、计算基数、公式、版本和空间范围；
// 标准租金优惠不得含糊地减免押金、预授权或异常费用。
const mktGroup = context().groups.find((item) => item.code !== "CAMP-TENT") ?? context().groups[0];
const mktStartAt = new Date(now + 10 * 24 * 60 * 60 * 1000).toISOString();
const mktEndAt = new Date(now + 12 * 24 * 60 * 60 * 1000).toISOString();
// 两个同互斥组的方案：减免小者优先级更高，用来验证「按实际减免最大择一」在报价链路上成立。
await business.saveDiscountPlan(tenantId, context(), {
  code: "MKT-SMALL", name: "小额优惠", status: "enabled",
  discountType: "fixed_amount", discountValue: 10, minimumSpend: 0,
  appliesTo: "rental", customerScope: "all", applicableItemGroupIds: [], applicableDayTypes: [],
  priority: 1, exclusiveGroup: "MKT-G", stackableWithOtherPlans: false, stackableWithCoupon: true,
  effectiveFrom: new Date(now - 86_400_000).toISOString(), changeReason: "MKT-01A 专项"
});
await business.saveDiscountPlan(tenantId, context(), {
  code: "MKT-BIG", name: "大额优惠", status: "enabled",
  discountType: "fixed_amount", discountValue: 60, minimumSpend: 0,
  appliesTo: "rental", customerScope: "all", applicableItemGroupIds: [], applicableDayTypes: [],
  priority: 90, exclusiveGroup: "MKT-G", stackableWithOtherPlans: false, stackableWithCoupon: true,
  effectiveFrom: new Date(now - 86_400_000).toISOString(), changeReason: "MKT-01A 专项"
});
const mktQuote = await business.createQuote(tenantId, context(), {
  customerType: "personal",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: location.id,
  startAt: mktStartAt,
  endAt: mktEndAt,
  lines: [{ itemGroupId: mktGroup.id, quantity: 1, pricingUnit: "calendar_day" }]
});
assert.ok(Array.isArray(mktQuote.discountEvaluations), "报价必须保存逐方案评估");
const mktBig = mktQuote.discountEvaluations.find((row) => row.planCode === "MKT-BIG");
const mktSmall = mktQuote.discountEvaluations.find((row) => row.planCode === "MKT-SMALL");
assert.equal(mktBig.applied, true, "报价链路上必须选实际减免更大的方案");
assert.equal(mktSmall.applied, false, "同互斥组的另一方案必须落选");
assert.equal(mktSmall.skipReason, "exclusive_group_lost", "落选必须带原因码");
assert.match(mktSmall.skipDetail, /MKT-BIG/, "落选原因必须点明竞争对手");
assert.ok(mktBig.formula && mktBig.base > 0, "已应用方案必须记录计算基数与公式");
assert.equal(mktBig.planVersion, "1.0", "评估必须带方案版本");
assert.ok(mktBig.workspaceId, "评估必须带经营空间范围");
assert.equal(mktQuote.appliedDiscountPlanIds.length, 1, "只应用一个互斥方案");
// 优惠只作用于租金：押金与预授权必须与「无优惠」时完全一致。
const mktDepositProbe = await business.createQuote(tenantId, context(), {
  customerType: "personal",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: location.id,
  startAt: mktStartAt,
  endAt: mktEndAt,
  lines: [{ itemGroupId: mktGroup.id, quantity: 1, pricingUnit: "calendar_day" }]
});
assert.equal(mktQuote.depositAmount, mktDepositProbe.depositAmount, "优惠不得改变押金");
assert.equal(mktQuote.preAuthAmount, mktDepositProbe.preAuthAmount, "优惠不得改变预授权额度");
assert.equal(
  mktQuote.payableAmount,
  Math.round((mktQuote.rentalAmount - mktQuote.discountAmount - mktQuote.couponAmount + mktQuote.serviceAmount + mktQuote.fulfillmentAmount) * 100) / 100,
  "应付必须等于各费用项减去优惠，押金不参与"
);
assert.ok(mktQuote.discountAmount > 0 && mktQuote.payableAmount < mktQuote.rentalAmount, "优惠必须真的减少应付");
ok2("MKT-01A：报价保存逐方案评估与落选原因，优惠不触碰押金与预授权");

// 会员权益必须取预约身份实际使用的方案。企业员工预约不叠加个人方案，且本次的
// 减免与来源要固化在报价中，不能等后续方案改版后再回读当前配置。
const membershipProbeInput = {
  customerType: "personal", customerId: "member_001", fulfillmentMode: "store_pickup_return", fulfillmentLocationId: location.id,
  startAt: mktStartAt, endAt: mktEndAt, lines: [{ itemGroupId: mktGroup.id, quantity: 1, pricingUnit: "calendar_day" }]
};
const noMembershipBenefitQuote = await business.createQuote(tenantId, context(), membershipProbeInput);
business.memberships = {
  resolveBookingIdentity: async () => ({
    bookingIdentity: "enterprise_employee", personalCustomerId: "member_001", personalCustomerName: "个人会员",
    corporateCustomerId: "corp_001", corporateCustomerName: "企业会员", corporateMembershipId: "employment_001",
    enterpriseContractAndPayer: false, benefitSource: "corporate", qualifications: [], resolvedAt: new Date().toISOString(),
    personalPlan: { id: "assignment_personal", customerId: "member_001", planId: "plan_personal", planVersionId: "version_personal", source: "manual", status: "active", effectiveFrom: startAt, snapshot: { planName: "个人方案", targetType: "personal", benefits: [{ type: "rental_discount", calculation: "amount", value: 50 }] }, createdAt: startAt },
    corporatePlan: { id: "assignment_corporate", customerId: "corp_001", planId: "plan_corporate", planVersionId: "version_corporate", source: "corporate_contract", status: "active", effectiveFrom: startAt, snapshot: { planName: "企业方案", targetType: "corporate", benefits: [{ type: "rental_discount", calculation: "amount", value: 25 }] }, createdAt: startAt }
  })
};
const membershipBenefitQuote = await business.createQuote(tenantId, context(), {
  ...membershipProbeInput,
  bookingIdentity: { bookingIdentity: "enterprise_employee", corporateCustomerId: "corp_001" }
});
const membershipRentalBenefit = membershipBenefitQuote.membershipBenefitEvaluations.find((row) => row.type === "rental_discount" && row.appliedAmount > 0);
assert.equal(membershipRentalBenefit?.source, "corporate", "企业员工预约只能使用企业方案，不得与个人方案叠加");
assert.equal(membershipRentalBenefit?.appliedAmount, 25, "企业方案固定租金权益必须按本次剩余租金实际减免");
assert.equal(membershipBenefitQuote.discountAmount, noMembershipBenefitQuote.discountAmount + 25, "会员权益必须真正减少报价应付");
assert.ok(membershipBenefitQuote.chargeLines.some((line) => line.code === "membership:rental_discount:corporate" && line.amount === -25), "会员减免必须有独立可解释费用行");
ok2("会员权益：企业员工仅用企业方案，金额、来源与费用行均随报价固化");
// 这个专项只注入一次性会员解析 stub；后续历史报价测试没有客户主档，不能误走新会员门禁。
business.memberships = undefined;

const crossYearQuote = await business.createQuote(tenantId, context(), {
  customerType: "personal",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: location.id,
  startAt: `${new Date(startAt).getUTCFullYear()}-12-31T09:00:00.000Z`,
  endAt: `${new Date(startAt).getUTCFullYear() + 1}-01-02T09:00:00.000Z`,
  lines: [{ itemGroupId: group.id, quantity: 1 }]
});
assert.match(crossYearQuote.calendarVersion, /\|/, "cross-year quotes must snapshot every calendar year");

const template = business.listNotificationTemplates(tenantId, context()).find((item) => item.eventCode === "order.created");
assert.ok(template, "必须存在订单创建通知模板");
const sendLog = await business.sendNotification(tenantId, context(), {
  templateId: template.id,
  recipient: "member_001",
  variables: { customerName: "露营测试会员", orderNo: "RC-NOTIFY-TEST-001" }
});
assert.equal(sendLog.status, "simulated");
assert.equal(sendLog.provider, "simulation");
assert.equal(sendLog.templateVersion, template.version);
await assert.rejects(async () => business.sendNotification(tenantId, context(), { templateId: template.id, recipient: "member_001", variables: {} }), /缺少通知变量/);

assert.equal(business.listPricingPlans("tenant_001", {
  profile: core.getProfile("tenant_001"),
  category: core.listCategories().find((item) => item.code === core.getProfile("tenant_001").categoryCode),
  settings: core.getBusinessSettings("tenant_001"),
  groups: core.listItemGroups("tenant_001"),
  couponTemplates: core.listCouponTemplates("tenant_001")
})[0].categoryCode, "camera");

// TENANT-READY-01：空白租户开业判定——履约网络是必做项，会员方案是可暂缓项。
// 用非演示租户（R1 决策：普通租户不自带经营主体/地点）验证 readiness 的口径。
const readyTenant = "tenant_ready_r1";
await core.initializeTenant(readyTenant, "camping");
assert.equal(core.listLocations(readyTenant).length, 0, "普通新租户不得自带演示履约地点");
assert.equal(core.listOperators(readyTenant).length, 0, "普通新租户不得自带演示经营主体");
// readiness 按会话空间取工作区：与 API 一致，用 ALS 注入 bootstrap 建立的默认空间（ws_<tenantId>）。
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");
const readyWorkspaceId = `ws_${readyTenant}`;
const readReady = () => runWithRequestIdentity(
  { tenantId: readyTenant, userId: "test-ready", workspaceId: readyWorkspaceId, isSaasAdmin: false },
  () => business.tenantReadiness(readyTenant, readyContext())
);
const readyContext = () => ({
  profile: core.getProfile(readyTenant),
  category: core.listCategories().find((item) => item.code === core.getProfile(readyTenant).categoryCode),
  settings: core.getBusinessSettings(readyTenant),
  groups: core.listItemGroups(readyTenant),
  couponTemplates: core.listCouponTemplates(readyTenant),
  locations: core.listLocations(readyTenant),
  operators: core.listOperators(readyTenant),
  pricingGroups: core.listPricingGroups(readyTenant)
});
const blankReadiness = await readReady();
const fulfillmentItem = blankReadiness.items.find((item) => item.key === "fulfillment_network");
assert.ok(fulfillmentItem && !fulfillmentItem.done, "空白租户的履约地点项必须未完成");
assert.ok(blankReadiness.quoteBlockers.some((row) => row.includes("履约地点")), "缺履约地点必须进入报价闸门说明");
const membershipItem = blankReadiness.items.find((item) => item.key === "membership_base");
assert.equal(membershipItem.optional, true, "会员方案必须标注为可暂缓");
assert.ok(!blankReadiness.quoteBlockers.some((row) => row.includes("会员")), "会员缺失不得伪装成报价闸门");
assert.ok(blankReadiness.missingKeys.includes("membership_base"), "missingKeys 仍须如实列出可暂缓缺项");
assert.ok(blankReadiness.items.find((item) => item.key === "business_rule").done, "新空间的品类初始化规则应已发布且生效");
assert.ok(blankReadiness.items.find((item) => item.key === "business_calendar").done === false, "空白租户日历项应未完成（但不是报价闸门）");
ok2("TENANT-READY-01：空白租户 readiness 如实标注履约网络缺失并进报价闸门，会员可暂缓不进闸门");

const readyOperator = await core.saveOperator(readyTenant, { code: "SELF", name: "自营露营站", type: "self_operated" });
await core.saveLocation(readyTenant, {
  code: "MAIN", name: "营地仓", type: "warehouse", operatorId: readyOperator.id,
  capabilities: ["pickup", "return", "storage"]
});
const configuredReadiness = await readReady();
assert.ok(configuredReadiness.items.find((item) => item.key === "fulfillment_network").done, "配置取还地点后履约项应完成");
assert.ok(!configuredReadiness.quoteBlockers.some((row) => row.includes("履约地点")), "履约地点配置后必须移出报价闸门");
await core.saveLocation(readyTenant, {
  code: "DEPOT", name: "中转仓", type: "warehouse", operatorId: readyOperator.id,
  capabilities: ["storage"]
});
const depotReadiness = await readReady();
assert.equal(
  depotReadiness.items.find((item) => item.key === "fulfillment_network").summary,
  "可用履约地点 1 个",
  "仅 storage 能力的地点不得计入取还履约网络"
);
ok2("TENANT-READY-01：取还地点配置后履约项转绿并移出报价闸门，storage-only 地点不计入");

console.log("Rental business v1 test passed: generic pricing, official calendar publication, rule snapshots, discounts, coupon lifecycle, quote/order snapshots, rewards and notifications verified.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
