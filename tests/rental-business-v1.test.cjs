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
    couponTemplates: core.listCouponTemplates(tenantId)
  };
}

// 核心服务的配置写方法已随「配置落库」转为异步，.cjs 无顶层 await，故包一层异步 IIFE。
void (async () => {

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
const publishedCalendar = await business.publishCalendar(tenantId, context(), calendar.year);
assert.equal(publishedCalendar.status, "published");
assert.ok(publishedCalendar.sourceUrl.startsWith("https://"));

// GET 只能返回缺省视图，不能把尚未保存的年度悄悄塞进缓存。
const cachedCalendarCount = business.states.get(tenantId).calendars.length;
business.getCalendar(tenantId, context(), calendar.year + 10);
assert.equal(business.states.get(tenantId).calendars.length, cachedCalendarCount, "calendar GET must be side-effect free");

// 写库失败时必须保留最后一次成功提交的缓存，而不是留下幽灵日历配置。
const calendarBeforeRejectedWrite = structuredClone(business.getCalendar(tenantId, context(), calendar.year));
businessConfigStore.failCalendar = true;
await assert.rejects(
  business.saveCalendarDay(tenantId, context(), calendar.year, {
    date: `${calendar.year}-12-31`,
    dayType: "tenant_special",
    name: "不得进入缓存",
    pricingMultiplier: 1.5,
    closed: false
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
const customerCoupon = await business.claimCoupon(tenantId, context(), couponTemplate.id, "member_001");
assert.equal(customerCoupon.status, "claimed");
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
assert.equal((await business.grantReward(tenantId, context(), { customerId: "member_001", triggerType: "registration", idempotencyKey: "register:member_001" }))[0].id, reward[0].id, "reward grant must be idempotent");
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
