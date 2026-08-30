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
const savedRule = await business.saveRuleVersion(tenantId, context(), {
  config: { ...structuredClone(currentRule.config), cancellation: { ...currentRule.config.cancellation, weatherExceptionEnabled: true } },
  changeReason: "测试露营天气取消规则",
  publish: true
}, "test");
assert.equal(savedRule.status, "published");
assert.equal(business.currentRule(tenantId, context()).version, "1.1");

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
  status: "enabled"
});
// claimCoupon 现在返回 { coupon, template }：模板的 claimedQuantity 也是本次写入的一部分，
// 调用方需要它才能在事务提交后正确更新缓存。
const claimResult = await business.claimCoupon(tenantId, context(), couponTemplate.id, "member_001");
const customerCoupon = claimResult.coupon;
assert.equal(customerCoupon.status, "claimed");
assert.equal(claimResult.template.claimedQuantity, 1, "领取应使模板已领数量加一");
await assert.rejects(async () => business.claimCoupon(tenantId, context(), couponTemplate.id, "member_001"), /限领/);

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
assert.ok(quote.serviceAmount > 0);
assert.equal(quote.calendarVersion, `${publishedCalendar.year}:${publishedCalendar.version}`);
assert.ok(quote.chargeLines.some((line) => line.type === "coupon"));

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
  maximumQuantity: 1,
  coverageLimit: 5000,
  deductible: 200,
  termsVersion: "1.0",
  terms: "每单免赔上限 5000 元，免赔额 200 元。",
  applicableItemGroupIds: [],
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

const crossYearQuote = await business.createQuote(tenantId, context(), {
  customerType: "personal",
  fulfillmentMode: "store_pickup_return",
  fulfillmentLocationId: location.id,
  startAt: `${new Date(startAt).getUTCFullYear()}-12-31T09:00:00.000Z`,
  endAt: `${new Date(startAt).getUTCFullYear() + 1}-01-02T09:00:00.000Z`,
  lines: [{ itemGroupId: group.id, quantity: 1 }]
});
assert.match(crossYearQuote.calendarVersion, /\|/, "cross-year quotes must snapshot every calendar year");

const template = business.listNotificationTemplates(tenantId, context())[0];
const sendLog = await business.sendNotification(tenantId, context(), {
  templateId: template.id,
  recipient: "member_001",
  variables: { customerName: "露营测试会员", orderNo: "RC-NOTIFY-TEST-001" }
});
assert.equal(sendLog.status, "sent");
assert.equal(sendLog.provider, "mock-notification-adapter");
assert.equal(sendLog.templateVersion, template.version);
await assert.rejects(async () => business.sendNotification(tenantId, context(), { templateId: template.id, recipient: "member_001", variables: {} }), /缺少通知变量/);

assert.equal(business.listPricingPlans("tenant_001", {
  profile: core.getProfile("tenant_001"),
  category: core.listCategories().find((item) => item.code === core.getProfile("tenant_001").categoryCode),
  settings: core.getBusinessSettings("tenant_001"),
  groups: core.listItemGroups("tenant_001"),
  couponTemplates: core.listCouponTemplates("tenant_001")
})[0].categoryCode, "camera");

console.log("Rental business v1 test passed: generic pricing, official calendar publication, rule snapshots, discounts, coupon lifecycle, quote/order snapshots, rewards and notifications verified.");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
