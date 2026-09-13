const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { bufferedRentalPeriod, peakReservedQuantity } = require('../apps/api/src/modules/rental-core/rental-occupancy');
const { RentalCoreOrderStatus, RentalInventoryMode, RentalReservationStatus } = require('@rental-os/shared');
const stores = require('./helpers/absorbing-config-store.cjs');
let count = 0;
const pass = label => { count++; console.log('PASS', label); };
const clone = structuredClone;
const tenant = 'tenant_002';
const start = new Date(Date.now() + 3 * 86400000).toISOString();
const at = hours => new Date(Date.parse(start) + hours * 3600000).toISOString();

(async () => {
  const facts = stores.createAbsorbingFactStore();
  const core = new RentalCoreService(stores.createAbsorbingConfigStore(), facts);
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), stores.createAbsorbingConfigStore());
  await core.onApplicationBootstrap(); await business.onApplicationBootstrap();
  const profile = core.getProfile(tenant);
  const ctx = { profile, category: core.listCategories().find(x => x.code === profile.categoryCode), settings: core.getBusinessSettings(tenant), groups: core.listItemGroups(tenant), pricingGroups: core.listPricingGroups(tenant), locations: core.listLocations(tenant), couponTemplates: core.listCouponTemplates(tenant), operators: core.listOperators(tenant) };
  const group = ctx.groups.find(x => x.inventoryMode === RentalInventoryMode.Quantity && x.status === 'enabled');
  const location = ctx.locations.find(x => x.status === 'enabled');
  assert.ok(group && location);
  const seed = await business.createQuote(tenant, ctx, { customerType: 'personal', customerName: '续租计算测试', fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: location.id, startAt: start, endAt: at(2), lines: [{ itemGroupId: group.id, quantity: 1 }] });
  function fixture(hours = 2, rateChanges = {}) {
    const quote = clone(seed);
    quote.request.endAt = at(hours);
    quote.request.lines[0].pricingUnit = 'day_24h';
    quote.rateSnapshot = [{ ...quote.rateSnapshot[0], unit: 'day_24h', baseAmount: 240, minimumUnits: 1, weekendMultiplier: 1, holidayMultiplier: 1, maxAmount: undefined, tiers: undefined, dayTypePrices: undefined, periodicWindows: undefined, datetimeOverrides: undefined, ...rateChanges }];
    quote.rentalAmount = 240 * Math.ceil(hours / 24); quote.serviceAmount = 0; quote.fulfillmentAmount = 0;
    quote.discountAmount = 0; quote.couponAmount = 0; quote.payableAmount = quote.rentalAmount;
    quote.discountEvaluations = []; quote.couponEvaluation = undefined; quote.serviceSnapshots = [];
    quote.request.services = [];
    quote.pricingContext.legacyDayTypeMultipliers = false;
    quote.priceVersionId = 'frozen-v1'; quote.priceVersion = 'v1';
    quote.ruleSnapshot.overdue = { graceMinutes: 30, feeMode: 'hourly', feeMultiplier: 1 };
    quote.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode: 'original_total' };
    quote.ruleSnapshot.earlyReturn = { mode: 'auto', minAdvanceHours: 0, refundPercent: 100, refundUndeliveredServices: false };
    const rate = quote.rateSnapshot[0];
    quote.chargeLines = [{ code: `rental:${rate.pricingGroupCode ?? rate.itemGroupCode}`, type: 'rental', name: '租金', amount: quote.rentalAmount }];
    return quote;
  }
  function args(quote, hours, previous = []) {
    return { order: { id: 'renewal-test', quoteId: quote.id, startAt: start, endAt: quote.request.endAt, effectiveEndAt: previous.at(-1)?.newEndAt, depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount }, lines: quote.request.lines, previousExtensions: previous, newEndAt: at(hours), appliedAt: at(1), settlementMode: 'immediate', fulfillmentMode: 'store_pickup_return', locationIds: [location.id], customerType: 'personal' };
  }
  const price = async (quote, hours, previous = []) => { business.getQuote = () => quote; return business.quoteOrderExtension(tenant, ctx, args(quote, hours, previous)); };
  const effective = (priced, sequence = 1) => ({ ...clone(priced), tenantId: tenant, orderId: 'renewal-test', id: `ext-${sequence}`, sequence, status: 'effective' });
  const q = fixture(); const before = clone(q);
  const free = await price(q, 3);
  assert.equal(free.payableAmount, 0); assert.equal(free.paymentRequired, false); assert.equal(free.pricingSnapshot.recalculatedRentalAmount, 240);
  pass('2小时已买一天，延至3小时不重复收费');
  const paid = await price(q, 26);
  assert.equal(paid.payableAmount, 240); assert.equal(paid.pricingSnapshot.recalculatedPayableAmount, 480);
  const again = await price(q, 27, [effective(paid)]);
  assert.equal(again.payableAmount, 0); assert.equal(again.pricingSnapshot.previousPayableAmount, 480);
  assert.equal((await price(q, 50, [effective(paid), effective(again, 2)])).payableAmount, 240);
  assert.deepEqual(q, before); pass('多次续租累计抵扣且不改原报价');
  business.state(tenant, ctx).pricingPlans.forEach(p => p.rates.forEach(r => { r.baseAmount = 99999; }));
  assert.equal((await price(q, 26)).payableAmount, 240); assert.equal(paid.priceVersionId, 'frozen-v1');
  pass('当前价格涨价不改变原价续租');
  const oldMode = clone(seed); oldMode.ruleSnapshot.extension = { enabled: true, pricingMode: 'incremental', forceImmediateWhenOverdue: true };
  const independently = await price(oldMode, 3);
  assert.ok(independently.payableAmount > 240); assert.equal(independently.pricingSnapshot, undefined);
  delete oldMode.ruleSnapshot.extension.pricingMode;
  assert.equal((await price(oldMode, 3)).payableAmount, independently.payableAmount);
  business.getQuote = () => oldMode;
  const legacyLate = args(oldMode, 4); legacyLate.appliedAt = at(3);
  assert.ok((await business.quoteOrderExtension(tenant, ctx, legacyLate)).payableAmount > 0, '保留旧模式逾期续租路径');
  business.getQuote = () => q;
  const repricedLate = args(q, 4); repricedLate.appliedAt = at(3);
  await assert.rejects(() => business.quoteOrderExtension(tenant, ctx, repricedLate), /逾时/);
  pass('空间可选旧方式，未设置模式的历史订单保留新增时段现价计费');
  const hourly = fixture();
  hourly.rateSnapshot[0] = { ...hourly.rateSnapshot[0], unit: 'hour', baseAmount: 30, hourGranularityMinutes: 60 };
  hourly.request.lines[0].pricingUnit = 'hour';
  hourly.rentalAmount = hourly.payableAmount = hourly.chargeLines[0].amount = 60;
  hourly.pricingContext.dayRates = [{ ...hourly.rateSnapshot[0], unit: 'day_24h', baseAmount: 200 }];
  hourly.ruleSnapshot.pricing = { hourToDayEnabled: true, hourToDayThresholdHours: 6 };
  assert.equal((await price(hourly, 5)).pricingSnapshot.recalculatedRentalAmount, 150);
  assert.equal((await price(hourly, 6)).pricingSnapshot.recalculatedRentalAmount, 180);
  const converted = await price(hourly, 6.1);
  assert.equal(converted.pricingSnapshot.recalculatedRentalAmount, 200); assert.equal(converted.payableAmount, 140);
  assert.equal((await price(hourly, 24)).pricingSnapshot.recalculatedRentalAmount, 200);
  assert.equal((await price(hourly, 26)).pricingSnapshot.recalculatedRentalAmount, 260);
  assert.equal((await price(hourly, 31)).pricingSnapshot.recalculatedRentalAmount, 400);
  hourly.ruleSnapshot.pricing.hourToDayThresholdHours = 10;
  assert.equal((await price(hourly, 7)).pricingSnapshot.recalculatedRentalAmount, 200);
  const absentDay = clone(hourly); absentDay.pricingContext.dayRates = [];
  await assert.rejects(() => price(absentDay, 7), /未配置.*日价/);
  pass('时租阈值、日价封顶、连续24小时与余段、缺日价拒绝均生效');
  const late = fixture(); late.ruleSnapshot.overdue = { graceMinutes: 30, feeMode: 'hourly_to_daily', feeMultiplier: 1, hourlyRatePercent: 10, dailyAfterHours: 6 };
  late.pricingContext.dayRates = [{ ...late.rateSnapshot[0], baseAmount: 200 }];
  assert.equal(business.calculateOverdueCharge(tenant, ctx, late, at(2.5)), 0);
  assert.equal(business.calculateOverdueCharge(tenant, ctx, late, at(3.5)), 20);
  assert.equal(business.calculateOverdueCharge(tenant, ctx, late, at(8.5)), 120);
  assert.equal(business.calculateOverdueCharge(tenant, ctx, late, at(8.6)), 200);
  assert.equal(business.calculateOverdueCharge(tenant, ctx, late, at(28.5)), 240);
  late.ruleSnapshot.overdue.maximumFee = 210;
  assert.equal(business.calculateOverdueCharge(tenant, ctx, late, at(28.5)), 210);
  delete late.ruleSnapshot.overdue.maximumFee;
  late.ruleSnapshot.overdue.dailyAfterHours = 24;
  late.ruleSnapshot.overdue.hourlyRatePercent = 1;
  assert.equal(business.calculateOverdueCharge(tenant, ctx, late, at(26.5)), 200, '完整24小时必须收一天，不能按低小时比例折成0.24天');
  const tieredLate = clone(late);
  tieredLate.ruleSnapshot.overdue.dailyAfterHours = 6;
  tieredLate.ruleSnapshot.overdue.hourlyRatePercent = 10;
  tieredLate.pricingContext.dayRates = [{ ...tieredLate.rateSnapshot[0], unit: 'day_24h', baseAmount: 200, tiers: [{ minUnits: 1, unitAmount: 250 }] }];
  assert.equal(business.calculateOverdueCharge(tenant, ctx, tieredLate, at(3.5)), 25, '逾时转日租必须沿用日价阶梯而不是只取基础价');
  pass('独立逾时规则：一次宽限、小时比例、严格超过转日、不叠加、跨日与总封顶');
  const minimum = fixture(2, { minimumUnits: 3 }); minimum.rentalAmount = minimum.payableAmount = 720;
  assert.equal((await price(minimum, 30)).payableAmount, 0); pass('最低起租单位只收一次');
  const cap = fixture(2, { maxAmount: 300 }); assert.equal((await price(cap, 50)).payableAmount, 60); pass('封顶按全租期统一计算');
  const tier = fixture(48, { tiers: [{ minUnits: 3, unitAmount: 100 }] });
  const negative = await price(tier, 72);
  assert.equal(negative.pricingSnapshot.recalculatedPayableAmount, 300); assert.equal(negative.payableAmount, 0);
  assert.deepEqual(negative.pricingSnapshot.refundReview, { amount: 180, status: 'pending' });
  const tierNext = await price(tier, 96, [effective(negative)]);
  assert.equal(tierNext.pricingSnapshot.refundReview.amount, 80); assert.equal(tierNext.payableAmount, 0);
  const approved = effective(negative); approved.pricingSnapshot.refundReview.status = 'approved';
  assert.equal((await price(tier, 96, [approved])).payableAmount, 100);
  pass('负差额待审不提前核减，审核通过后的续租以已核减账额为基准');
  const discounted = fixture();
  const plan = { id: 'original-discount', code: 'ORIGINAL', name: '原九折', status: 'enabled', discountType: 'percentage', discountValue: 10, minimumSpend: 0, appliesTo: 'rental', customerScope: 'all', applicableItemGroupIds: [], applicableDayTypes: [], priority: 1, stackableWithOtherPlans: false, stackableWithCoupon: true, effectiveFrom: '2020-01-01T00:00:00Z', version: 'v1' };
  discounted.discountEvaluations = [{ applied: true, appliesTo: 'rental', discountAmount: 24, planId: plan.id, planVersion: 'v1', planSnapshot: plan }];
  discounted.discountAmount = 24; discounted.couponAmount = 21.6; discounted.payableAmount = 194.4;
  discounted.couponEvaluation = { appliesTo: 'rental', discountType: 'percentage', discountValue: 10, minimumSpend: 0, maximumDiscount: 30, stackableWithDiscountPlans: true, templateVersion: 'v1', discountAmount: 21.6 };
  const discountRenewal = await price(discounted, 26);
  assert.equal(discountRenewal.pricingSnapshot.recalculatedDiscountAmount, 48);
  assert.equal(discountRenewal.pricingSnapshot.recalculatedCouponAmount, 30);
  assert.equal(discountRenewal.payableAmount, 207.6);
  pass('原优惠按新总额重算，原券规则封顶仍有效');
  const missing = clone(discounted); delete missing.discountEvaluations[0].planSnapshot;
  await assert.rejects(() => price(missing, 26), /缺少原优惠规则快照/); pass('历史优惠无法恢复时拒绝偷偷套现规则');
  assert.equal(business.calculateOverdueCharge(tenant, ctx, q, at(2 + 70 / 60)), 10);
  const long = fixture(72);
  long.ruleSnapshot.overdue.feeMode = 'next_period';
  assert.equal(business.calculateOverdueCharge(tenant, ctx, long, at(72 + 70 / 60)), 240);
  assert.equal(business.calculateOverdueCharge(tenant, ctx, long, at(72 + 49)), 720);
  long.ruleSnapshot.overdue.maximumFee = 500;
  assert.equal(business.calculateOverdueCharge(tenant, ctx, long, at(121)), 500);
  pass('逾时小时价按已买周期分摊，下一周期按实际周期数收取并封顶');
  const early = business.calculateEarlyReturnRefund(tenant, ctx, q, at(3), at(2.5), 0, free.pricingSnapshot);
  assert.equal(early.amount, 0); pass('免费续租后提前归还不虚构第二个计费周期退款');
  const period = bufferedRentalPeriod(at(0), at(10), { fulfillment: { pickupBufferMinutes: 30, returnBufferMinutes: 60 } });
  assert.deepEqual(period, { startAt: at(-0.5), endAt: at(11) });
  assert.equal(peakReservedQuantity([{ startAt: at(0), endAt: at(1), quantity: 1 }, { startAt: at(1), endAt: at(2), quantity: 1 }], at(0), at(3)), 1);
  pass('占用包含两端缓冲，首尾相接按半开区间、不累加错开订单');
  let reservations = []; let saved; let extensionRows = [];
  facts.activeReservations = async () => clone(reservations);
  facts.listStockBalances = async () => [{ itemGroupId: group.id, locationId: location.id, onHandQuantity: 2, maintenanceQuantity: 0 }];
  facts.listExtensions = async () => clone(extensionRows);
  facts.insertExtension = async row => { extensionRows.push(clone(row)); };
  facts.updateExtensionPricingSnapshot = async (_t, _o, id, snapshot) => { extensionRows.find(r => r.id === id).pricingSnapshot = clone(snapshot); };
  facts.saveOrderAggregate = async order => { saved = clone(order); };
  const order = { ...args(q, 3).order, tenantId: tenant, status: RentalCoreOrderStatus.Renting, payableAmount: 240, adjustmentAmount: 0, finalPayableAmount: 240, chargeLines: clone(q.chargeLines), ruleSnapshot: clone(q.ruleSnapshot), allocations: [{ status: 'picked_up', assetId: 'specific-asset' }], reservations: [{ itemGroupId: group.id, locationId: location.id, quantity: 1, releasedQuantity: 0, status: RentalReservationStatus.Fulfilled }] };
  order.ruleSnapshot.fulfillment.returnBufferMinutes = 60;
  reservations = [{ orderId: 'renewal-test', itemGroupId: group.id, locationId: location.id, quantity: 1, startAt: at(0), endAt: at(3) }];
  await core.assertOrderExtensionAvailable(tenant, order, at(3));
  reservations.push({ orderId: 'next-order', itemGroupId: group.id, locationId: location.id, quantity: 1, startAt: at(3.5), endAt: at(5), assetIds: ['specific-asset'] });
  await assert.rejects(() => core.assertOrderExtensionAvailable(tenant, order, at(3)), /已分配的资产/);
  reservations[1].assetIds = []; reservations[1].quantity = 2;
  await assert.rejects(() => core.assertOrderExtensionAvailable(tenant, order, at(3)), /库存冲突/);
  reservations[1].startAt = at(4); await core.assertOrderExtensionAvailable(tenant, order, at(3));
  pass('排除本单，检查具体资产及数量库存；缓冲相交拒绝、端点相等通过');
  reservations = []; core.lockedOrder = async () => clone(saved ?? order);
  const requested = await core.requestOrderExtension(tenant, order.id, free, { idempotencyKey: 'zero', operator: 'tester' }, {});
  assert.equal(requested.extension.status, 'effective'); assert.equal(saved.effectiveEndAt, at(3)); assert.equal(saved.finalPayableAmount, 240);
  pass('零差额续租实际生效且不伪造补款时间');
  saved = { ...clone(order), endAt: at(48), payableAmount: 480, finalPayableAmount: 480 }; extensionRows = [];
  const pendingRefund = await core.requestOrderExtension(tenant, order.id, negative, { idempotencyKey: 'refund', operator: 'tester' }, {});
  assert.equal(saved.finalPayableAmount, 480); assert.equal(saved.effectiveEndAt, at(72));
  await core.reviewExtensionRefund(tenant, order.id, pendingRefund.extension.id, { decision: 'approved', reason: '核对原阶梯价' }, 'finance', {});
  assert.equal(saved.finalPayableAmount, 300);
  await assert.rejects(() => core.reviewExtensionRefund(tenant, order.id, pendingRefund.extension.id, { decision: 'approved', reason: '重复' }, 'finance', {}), /没有待审核退款/);
  pass('负差额只在审核通过后核减一次，不等于已向客户打款');

  /* ==== Codex review #2：续租必须继承原报价的完整优惠链 ====
     三个反例共同前提：延长后仍落在原来已购买的那一天内，全租期租金不变，
     因此补款必须为 0。修复前分别虚收 24 / 虚收 120 / 虚退 120。 */

  // 反例 1：日租 240、会员九折，原应付 216。
  // 修复前重算不含会员减免 → recalculated 240 vs previous 216 → 虚收 24。
  {
    const member = fixture();
    member.discountAmount = 24; member.payableAmount = 216;
    member.membershipBenefitEvaluations = [{
      source: 'personal', planId: 'plan_m', planVersionId: 'plan_m_v1', planName: '九折会员',
      type: 'rental_discount', calculation: 'percentage', configuredValue: 10,
      appliesTo: 'rental', appliedAmount: 24, base: 240, detail: '九折会员：percentage 10，基数 240'
    }];
    const priced = await price(member, 3);
    assert.equal(priced.pricingSnapshot.recalculatedRentalAmount, 240, '全租期租金不变');
    assert.equal(priced.payableAmount, 0, '会员折扣必须被继承，否则会虚收整个折扣额');
    pass('反例1 会员九折：延长仍在已买当天，补款 0（修复前虚收 24）');
  }

  // 反例 2、3 需要两行商品才能表达"只对 A 生效"。
  const groupB = ctx.groups.find(x => x.id !== group.id && x.status === 'enabled');
  assert.ok(groupB, '需要第二个启用的商品组来构造限定商品场景');
  function twoLines() {
    const quote = fixture();
    const lineA = quote.request.lines[0];
    const rateA = quote.rateSnapshot[0];
    quote.request.lines = [lineA, { ...lineA, itemGroupId: groupB.id, pricingGroupId: undefined }];
    quote.rateSnapshot = [rateA, { ...rateA, itemGroupId: groupB.id, itemGroupCode: groupB.code, pricingGroupId: undefined, pricingGroupCode: undefined }];
    quote.rentalAmount = 480;
    quote.chargeLines = quote.rateSnapshot.map(rate => ({ code: `rental:${rate.pricingGroupCode ?? rate.itemGroupCode}`, type: 'rental', name: '租金', amount: 240 }));
    const targetA = lineA.pricingGroupId ?? lineA.itemGroupId;
    quote.rentalLineAmounts = { [targetA]: 240, [groupB.id]: 240 };
    return { quote, targetA, targetB: groupB.id };
  }

  // 反例 2：A、B 各 240，活动只给 A 五折，原应付 360。
  // 修复前不传逐行金额 → 限定商品的方案在重算里失效 → 虚收 120。
  {
    const { quote, targetA } = twoLines();
    quote.discountAmount = 120; quote.payableAmount = 360;
    quote.discountEvaluations = [{
      planId: 'plan_a', planVersion: 'v1', planCode: 'ONLY_A', planName: '限定A五折',
      appliesTo: 'rental', applied: true, discountAmount: 120, rentalAllocations: { [targetA]: 120 },
      planSnapshot: {
        id: 'plan_a', tenantId: tenant, code: 'ONLY_A', name: '限定A五折', version: 'v1', status: 'enabled',
        appliesTo: 'rental', discountType: 'percentage', discountValue: 50,
        applicableItemGroupIds: [quote.request.lines[0].itemGroupId], applicablePricingGroupIds: [], applicableDayTypes: [],
        stackableWithCoupon: true, stackableWithOtherPlans: true, minimumSpend: 0, customerScope: 'all',
        effectiveFrom: '2000-01-01T00:00:00.000Z', effectiveTo: '2100-01-01T00:00:00.000Z'
      }
    }];
    const priced = await price(quote, 3);
    assert.equal(priced.pricingSnapshot.recalculatedRentalAmount, 480);
    assert.equal(priced.payableAmount, 0, '限定商品的活动必须仍只作用于 A 并保持原减免');
    pass('反例2 限定商品活动：延长仍在已买当天，补款 0（修复前虚收 120）');
  }

  // 反例 3：券只给 A 五折，原应付 360。
  // 修复前券基数取整单 480 → 减免变大 → 重算应付变小 → 凭空产生 120 待退款。
  {
    const { quote, targetA } = twoLines();
    quote.couponAmount = 120; quote.payableAmount = 360;
    quote.couponEvaluation = {
      couponId: 'c1', templateId: 't1', templateCode: 'ONLY_A', templateName: '限定A五折券', templateVersion: 'v1',
      appliesTo: 'rental', discountType: 'percentage', discountValue: 50, minimumSpend: 0,
      stackableWithDiscountPlans: true, baseBeforeDiscount: 240, runningBase: 240, discountAmount: 120,
      formula: '240 × 50%', rentalAllocations: { [targetA]: 120 }
    };
    const priced = await price(quote, 3);
    assert.equal(priced.pricingSnapshot.recalculatedCouponAmount, 120, '券减免额不应因整单基数而放大');
    assert.equal(priced.payableAmount, 0, '券必须按原适用范围取基数，不能扩大到整单');
    pass('反例3 限定商品券：延长仍在已买当天，补款 0（修复前虚退 120）');
  }

  /* ==== Codex review #3：分批归还后逾期费只按仍在占用的部分收 ====
     两件各日租 240（每小时 10），一件按时归还、另一件逾时一小时。
     按原报价的全部数量算会收 20；实际只有一件在逾期，应收 10。 */
  {
    const { quote, targetA, targetB } = twoLines();
    const dueAt = quote.request.endAt;
    const lateBy1h = new Date(Date.parse(dueAt) + 90 * 60_000).toISOString(); // 30 分钟宽限 + 逾时 1 小时
    const whole = business.calculateOverdueCharge(tenant, ctx, quote, lateBy1h, dueAt);
    assert.equal(whole, 20, '不传仍在租数量时按整单两件计（这就是修复前的行为）');
    const onlyA = business.calculateOverdueCharge(tenant, ctx, quote, lateBy1h, dueAt, { [targetA]: 1, [targetB]: 0 });
    assert.equal(onlyA, 10, '一件已交回后，逾期费只按仍在租的那一件收');
    const bothOut = business.calculateOverdueCharge(tenant, ctx, quote, lateBy1h, dueAt, { [targetA]: 1, [targetB]: 1 });
    assert.equal(bothOut, 20, '两件都还没交回时与整单口径一致');
    const allReturned = business.calculateOverdueCharge(tenant, ctx, quote, lateBy1h, dueAt, { [targetA]: 0, [targetB]: 0 });
    assert.equal(allReturned, 0, '全部已交回则不产生逾期费');
    pass('反例4 分批归还：逾期费按仍在占用的数量收（修复前按全部数量收 20）');
  }

  console.log(`续租修正专项 ${count} 组通过（计算与应用服务测试；不冒充数据库并发验收）`);
})().catch(error => { console.error(error); process.exitCode = 1; });
