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
  business.factStore.findQuote = async (_tenant, id) => { const quote = business.getQuote(_tenant, ctx, id); return quote?.id === id ? clone(quote) : undefined; };
  const profile = core.getProfile(tenant);
  const ctx = { profile, category: core.listCategories().find(x => x.code === profile.categoryCode), settings: core.getBusinessSettings(tenant), groups: core.listItemGroups(tenant), pricingGroups: core.listPricingGroups(tenant), locations: core.listLocations(tenant), couponTemplates: core.listCouponTemplates(tenant), operators: core.listOperators(tenant) };
  const group = ctx.groups.find(x => x.inventoryMode === RentalInventoryMode.Quantity && x.status === 'enabled');
  const location = ctx.locations.find(x => x.status === 'enabled');
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenant, 'ws_tenant_002', ctx);
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
  const effective = (priced, sequence = 1) => ({ ...clone(priced), tenantId: tenant, workspaceId: business.workspaceOf(tenant),
    orderId: 'renewal-test', id: `ext-${sequence}`, sequence, status: 'effective' });
  const q = fixture(); const before = clone(q);
  const incompatibleUsage = fixture();
  incompatibleUsage.request.lines[0].pricingUnit = 'usage';
  incompatibleUsage.rateSnapshot[0] = { ...incompatibleUsage.rateSnapshot[0], unit: 'usage', includedUsage: 20, excessUsageAmount: 2 };
  incompatibleUsage.ruleSnapshot.overdue.feeMode = 'next_period';
  assert.throws(() => business.calculateOverdueCharge(tenant, ctx, incompatibleUsage, at(3.5)), /没有固定时间周期/,
    '历史/异常订单在计算逾时费时仍须明确拒绝不兼容的使用量与下一周期组合');
  pass('使用量费率与小时/下一周期逾时费在报价与结算计算两端均 fail-closed');
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
  for (const status of ['rejected', 'superseded']) {
    const previous = effective(negative); previous.pricingSnapshot.refundReview.status = status;
    const successor = await price(tier, 96, [previous]);
    assert.equal(successor.pricingSnapshot.previousPayableAmount, 480);
    assert.equal(successor.pricingSnapshot.refundReview.amount, 80, '未核减状态不改变账面已计金额');
  }
  const approved = effective(negative); approved.createdAt = at(1); approved.effectiveAt = at(1);
  approved.pricingSnapshot.refundReview = { ...approved.pricingSnapshot.refundReview, status: 'approved', reviewedAt: at(1.5) };
  assert.equal((await price(tier, 96, [approved])).payableAmount, 100);
  const afterApproval = effective(await price(tier, 96, [approved]), 2);
  afterApproval.createdAt = at(2); afterApproval.effectiveAt = at(2);
  assert.equal((await price(tier, 120, [approved, afterApproval])).payableAmount, 100,
    '后继准备在批准后，原收据必须接已经核减的300余额');
  const preparedBeforeApproval = effective(tierNext, 2);
  preparedBeforeApproval.createdAt = at(1.25); preparedBeforeApproval.effectiveAt = at(1.25);
  assert.equal((await price(tier, 120, [approved, preparedBeforeApproval])).payableAmount, 200,
    '已有效旧收据保留准备时的480余额，后来的批准不反写旧收据');
  const missingReviewTime = clone(approved); delete missingReviewTime.pricingSnapshot.refundReview.reviewedAt;
  await assert.rejects(() => price(tier, 96, [missingReviewTime]), error => error.getStatus() === 409);
  const skewedPreparation = clone(afterApproval); skewedPreparation.createdAt = at(1.25); skewedPreparation.effectiveAt = at(1.25);
  assert.equal((await price(tier, 120, [approved, skewedPreparation])).payableAmount, 100,
    '冻结来源证明已消费核减，不拿两个节点墙钟的大小代替因果');
  const missingPreparationTime = clone(afterApproval); delete missingPreparationTime.createdAt;
  assert.equal((await price(tier, 120, [approved, missingPreparationTime])).payableAmount, 100);
  const skewedReview = clone(approved); skewedReview.pricingSnapshot.refundReview.reviewedAt = at(0.5);
  assert.equal((await price(tier, 96, [skewedReview])).payableAmount, 100,
    '有效批准与原收据来源决定余额，时钟回拨不证明批准非法');
  for (const mutate of [row => { delete row.pricingSnapshot.balanceBasis; },
    row => { row.pricingSnapshot.balanceBasis.version = 2; }, row => { row.pricingSnapshot.balanceBasis.approvedReductionExtensionIds = ['ext-1', 'ext-1']; },
    row => { row.pricingSnapshot.balanceBasis.approvedReductionExtensionIds = ['foreign']; },
    row => { row.pricingSnapshot.balanceBasis.approvedReductionExtensionIds = ['ext-2']; },
    row => { row.pricingSnapshot.balanceBasis.approvedReductionExtensionIds = []; }]) {
    const broken = clone(afterApproval); mutate(broken);
    await assert.rejects(() => price(tier, 120, [approved, broken]), error => error.getStatus() === 409);
  }
  const legacyNoReductions = effective(paid); delete legacyNoReductions.pricingSnapshot.balanceBasis;
  assert.equal((await price(q, 27, [legacyNoReductions])).payableAmount, 0,
    '无核减来源歧义的旧收据继续只读，不补写历史字段');
  for (const mutate of [row => { row.pricingSnapshot.refundReview.amount++; },
    row => { row.pricingSnapshot.refundReview.status = 'unknown'; }, row => { row.pricingSnapshot.refundReview = null; }]) {
    const broken = clone(approved); mutate(broken);
    await assert.rejects(() => price(tier, 96, [broken]), error => error.getStatus() === 409);
  }
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
  facts.insertExtension = async row => { extensionRows.push({ ...clone(row), workspaceId: core.resolveWorkspaceId(tenant) }); };
  facts.updateExtensionPricingSnapshot = async (_t, _o, id, snapshot) => { extensionRows.find(r => r.id === id).pricingSnapshot = clone(snapshot); };
  facts.saveOrderAggregate = async order => { saved = clone(order); };
  const order = { ...args(q, 3).order, tenantId: tenant, currency: q.currency, status: RentalCoreOrderStatus.Renting, payableAmount: 240, adjustmentAmount: 0, finalPayableAmount: 240, chargeLines: clone(q.chargeLines), ruleSnapshot: clone(q.ruleSnapshot), allocations: [{ status: 'picked_up', assetId: 'specific-asset' }], reservations: [{ itemGroupId: group.id, locationId: location.id, quantity: 1, releasedQuantity: 0, status: RentalReservationStatus.Fulfilled }] };
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
  const { RentalFundingService } = require('../apps/api/src/modules/rental-core/rental-funding.service');
  const funding = new RentalFundingService({});
  funding.lockedOrderScope = async () => ({ payable: (saved ?? order).finalPayableAmount, depositAmount: 0, preAuthAmount: 0 });
  funding.loadBalanceContext = async () => ({ accountingEvents: [{ instrument: 'rental', action: 'initiate', amount: 480 }] });
  core.funding = funding;
  const requested = await core.requestOrderExtension(tenant, order.id, free, { idempotencyKey: 'zero', operator: 'tester' }, {});
  assert.equal(requested.extension.status, 'effective'); assert.equal(saved.effectiveEndAt, at(3)); assert.equal(saved.finalPayableAmount, 240);
  pass('零差额续租实际生效且不伪造补款时间');
  saved = { ...clone(order), endAt: at(48), payableAmount: 480, finalPayableAmount: 480, chargeLines: clone(tier.chargeLines) }; extensionRows = [];
  const pendingRefund = await core.requestOrderExtension(tenant, order.id, negative, { idempotencyKey: 'refund', operator: 'tester' }, {});
  assert.equal(saved.finalPayableAmount, 480); assert.equal(saved.effectiveEndAt, at(72));
  await core.reviewExtensionRefund(tenant, order.id, pendingRefund.extension.id, { decision: 'approved', reason: '核对原阶梯价' }, 'finance', {});
  assert.equal(saved.finalPayableAmount, 300);
  await assert.rejects(() => core.reviewExtensionRefund(tenant, order.id, pendingRefund.extension.id, { decision: 'approved', reason: '重复' }, 'finance', {}), /没有待审核退款/);
  pass('负差额只在审核通过后核减一次，不等于已向客户打款');

  // 核减状态不能替代原费用行；后继试算与锁内受理都须核对同一订单账。
  {
    const received = clone(extensionRows);
    const valid = { ...clone(saved), rentalAmount: tier.rentalAmount, serviceAmount: 0, fulfillmentAmount: 0,
      chargeLines: [...clone(tier.chargeLines), ...saved.chargeLines.filter(line => line.code.startsWith('extension:'))] };
    received.forEach(row => { row.workspaceId = core.resolveWorkspaceId(tenant); });
    const base = { previousPayableAmount: 300, balanceBasis: { version: 1, approvedReductionExtensionIds: [received[0].id] } };
    core.assertExtensionPriceBase(valid, received, base);
    business.getQuote = () => tier;
    const successorArgs = { ...args(tier, 96, received), order: valid };
    const successor = await business.quoteOrderExtension(tenant, ctx, successorArgs);
    assert.equal(successor.pricingSnapshot.previousPayableAmount, 300);
    for (const mutate of [target => { target.chargeLines = clone(tier.chargeLines); },
      target => { target.chargeLines.push(clone(target.chargeLines.at(-1))); },
      target => { target.chargeLines.at(-1).amount++; },
      target => { target.chargeLines.at(-1).sourceId = 'foreign-extension'; },
      target => { target.chargeLines.at(-1).type = 'discount'; },
      target => { target.finalPayableAmount++; },
      target => { target.adjustmentAmount++; }]) {
      const broken = clone(valid); mutate(broken);
      assert.throws(() => core.assertExtensionPriceBase(broken, received, base), error => error.getStatus() === 409);
      await assert.rejects(() => business.quoteOrderExtension(tenant, ctx, { ...successorArgs, order: broken }), error => error.getStatus() === 409);
      const beforeOrder = clone(broken), beforeRows = clone(extensionRows), beforeSaved = clone(saved);
      core.lockedOrder = async () => clone(broken);
      await assert.rejects(() => core.requestOrderExtension(tenant, valid.id, successor,
        { idempotencyKey: 'bad-ledger', operator: 'tester' }, {}), error => error.getStatus() === 409);
      assert.deepEqual(broken, beforeOrder); assert.deepEqual(extensionRows, beforeRows); assert.deepEqual(saved, beforeSaved);
      let paymentWrites = 0, fundingReads = 0;
      const paying = Object.create(RentalCoreService.prototype);
      const pending = { ...effective(successor, 2), status: 'pending_payment' };
      paying.state = () => ({ profile: ctx.profile }); paying.resolveWorkspaceId = () => core.resolveWorkspaceId(tenant);
      paying.lockedOrder = async () => clone(broken); paying.assertOrderQualification = async () => {};
      paying.assertOrderExtensionAvailable = async () => {};
      paying.funding = { assertReadyForExtension: async () => { fundingReads++; } };
      paying.factStore = { listExtensions: async () => [...clone(received), clone(pending)],
        markExtensionEffective: async () => { paymentWrites++; }, saveOrderAggregate: async () => { paymentWrites++; } };
      await assert.rejects(() => paying.payOrderExtension(tenant, valid.id, pending.id, {}), error => error.getStatus() === 409);
      assert.equal(paymentWrites, 0); assert.equal(fundingReads, 0, '坏账不推进补款生效或重新执行资金动作');
    }
    core.lockedOrder = async () => clone(saved ?? order);
    const corrupt = clone(received); corrupt[0].pricingSnapshot.refundReview.amount++;
    assert.throws(() => core.assertExtensionPriceBase(valid, corrupt, base), error => error.getStatus() === 409);
    const independentFee = clone(valid);
    independentFee.chargeLines.push({ code: 'damage:original-inspection', type: 'damage', amount: 7 });
    independentFee.adjustmentAmount += 7; independentFee.finalPayableAmount += 7;
    core.assertExtensionPriceBase(independentFee, received, base);
    const notApproved = clone(received); notApproved[0].pricingSnapshot.refundReview.status = 'pending';
    assert.throws(() => core.assertExtensionPriceBase(valid, notApproved, { previousPayableAmount: 480 }), error => error.getStatus() === 409);
    for (const mutate of [target => { target.rows[0].pricingSnapshot.refundReview.amount++; },
      target => { target.order.chargeLines.push({ code: `extension:${target.rows[0].sequence}:refund`, type: 'early_return_refund',
        amount: -180, sourceId: 'foreign-extension' }); },
      target => { target.order.finalPayableAmount++; }]) {
      const target = { order: { ...clone(valid), adjustmentAmount: 0, finalPayableAmount: 480, chargeLines: clone(tier.chargeLines) },
        rows: clone(notApproved) };
      mutate(target); const before = clone(target); let writes = 0;
      const reviewing = Object.create(RentalCoreService.prototype);
      reviewing.lockedOrder = async () => clone(target.order);
      reviewing.factStore = { listExtensions: async () => clone(target.rows), updateExtensionPricingSnapshot: async () => { writes++; },
        saveOrderAggregate: async () => { writes++; } };
      await assert.rejects(() => reviewing.reviewExtensionRefund(tenant, valid.id, target.rows[0].id,
        { decision: 'approved', reason: '原费用来源异常' }, 'finance', {}), error => error.getStatus() === 409);
      assert.deepEqual(target, before); assert.equal(writes, 0, '坏核减不改审核状态、不加费用行');
    }
    const priorSaved = clone(saved), priorRows = clone(extensionRows), markEffective = facts.markExtensionEffective;
    core.lockedOrder = async () => clone(saved ?? order);
    facts.markExtensionEffective = async (_t, id, paidAt, effectiveAt) => Object.assign(extensionRows.find(row => row.id === id),
      { status: 'effective', paidAt, effectiveAt });
    // 批准节点的时钟领先受理/补款节点；金额与原账已提交，不能比较墙钟拒绝合法来源。
    extensionRows[0].workspaceId = core.resolveWorkspaceId(tenant);
    extensionRows[0].pricingSnapshot.refundReview.reviewedAt = at(1.5);
    for (const ids of [[], ['foreign'], [received[0].id, received[0].id]]) {
      const changed = clone(successor); changed.pricingSnapshot.balanceBasis.approvedReductionExtensionIds = ids;
      const beforeOrder = clone(saved), beforeRows = clone(extensionRows);
      await assert.rejects(() => core.requestOrderExtension(tenant, valid.id, changed,
        { idempotencyKey: 'bad-causal-source', operator: 'tester' }, {}), error => error.getStatus() === 409);
      assert.deepEqual(saved, beforeOrder); assert.deepEqual(extensionRows, beforeRows);
    }
    const accepted = await core.requestOrderExtension(tenant, valid.id, successor,
      { idempotencyKey: 'valid-ledger-successor', operator: 'tester' }, {});
    assert.equal(accepted.extension.status, 'pending_payment'); assert.equal(saved.finalPayableAmount, 300);
    assert.deepEqual(accepted.extension.pricingSnapshot.balanceBasis, base.balanceBasis);
    assert.ok(Date.parse(accepted.extension.createdAt) < Date.parse(extensionRows[0].pricingSnapshot.refundReview.reviewedAt));
    const originalPending = clone(extensionRows[1]), beforePayment = clone(saved);
    extensionRows[1].pricingSnapshot.balanceBasis.approvedReductionExtensionIds = [];
    await assert.rejects(() => core.payOrderExtension(tenant, valid.id, accepted.extension.id, {}), error => error.getStatus() === 409);
    assert.equal(extensionRows[1].status, 'pending_payment'); assert.deepEqual(saved, beforePayment);
    extensionRows[1] = originalPending;
    const applied = await core.payOrderExtension(tenant, valid.id, accepted.extension.id, {});
    assert.equal(applied.extension.status, 'effective'); assert.equal(saved.finalPayableAmount, 400);
    business.getQuote = () => tier;
    const third = await business.quoteOrderExtension(tenant, ctx, { ...args(tier, 120, extensionRows), order: saved });
    assert.equal(third.pricingSnapshot.previousPayableAmount, 400); assert.equal(third.payableAmount, 100);
    const { OPENAPI_DOCUMENT } = require('../apps/api/src/contracts/openapi-document');
    const components = OPENAPI_DOCUMENT.components.schemas;
    assert.deepEqual(components.RentalExtensionBalanceBasis.properties.version.enum, [1]);
    assert.equal(components.RentalExtensionBalanceBasis.properties.approvedReductionExtensionIds.uniqueItems, true);
    assert.ok(!components.RentalExtensionPricingSnapshot.required.includes('balanceBasis'), '旧收据不伪造新字段');
    assert.equal(OPENAPI_DOCUMENT.paths['/api/rental/v1/orders/{id}/extensions/preview'].post.responses[200]
      .content['application/json'].schema.properties.data.$ref, '#/components/schemas/RentalOrderExtensionPreview');
    assert.equal(components.ClientExtensionPreview.$ref, '#/components/schemas/RentalOrderExtensionPreview');
    const { validateAiCoreExtensionPreview } = require('../apps/api/src/modules/ai-native/scenes/extension-preview-http.contract');
    const wirePreview = { orderId: third.orderId, originalEndAt: third.originalEndAt, newEndAt: third.newEndAt,
      billableUnits: third.billableUnits, rentalAmount: third.rentalAmount, serviceAmount: third.serviceAmount,
      depositDelta: third.depositDelta, preAuthDelta: third.preAuthDelta, payableAmount: third.payableAmount, currency: third.currency,
      settlementMode: third.settlementMode, paymentRequired: third.paymentRequired, chargeLines: [], calendarSnapshot: [],
      ruleVersion: third.ruleVersion, pricingSnapshot: { method: third.pricingSnapshot.method, fullChargeLines: [],
        context: { timeZone: 'UTC', legacyDayTypeMultipliers: false, calendars: [] },
        previousPayableAmount: third.pricingSnapshot.previousPayableAmount, balanceBasis: third.pricingSnapshot.balanceBasis,
        recalculatedPayableAmount: third.pricingSnapshot.recalculatedPayableAmount,
        recalculatedRentalAmount: third.pricingSnapshot.recalculatedRentalAmount, recalculatedServiceAmount: third.pricingSnapshot.recalculatedServiceAmount,
        recalculatedDiscountAmount: third.pricingSnapshot.recalculatedDiscountAmount, recalculatedCouponAmount: third.pricingSnapshot.recalculatedCouponAmount,
        totalBillableUnits: third.pricingSnapshot.totalBillableUnits, differenceAmount: third.pricingSnapshot.differenceAmount,
        discountEvaluations: [], chargeLines: [] } };
    assert.deepEqual(validateAiCoreExtensionPreview(wirePreview, valid.id, third.newEndAt), wirePreview,
      '原AI只读出口保留真实Core核减来源，不执行审批或重新计价');
    const legacyWire = clone(wirePreview); delete legacyWire.pricingSnapshot.balanceBasis;
    assert.deepEqual(validateAiCoreExtensionPreview(legacyWire, valid.id, third.newEndAt), legacyWire);
    for (const mutate of [basis => { basis.version = 2; }, basis => { basis.approvedReductionExtensionIds.push(received[0].id); },
      basis => { basis.authorization = 'unregistered'; }]) {
      const invalid = clone(wirePreview); mutate(invalid.pricingSnapshot.balanceBasis);
      assert.throws(() => validateAiCoreExtensionPreview(invalid, valid.id, third.newEndAt), { code: 'AI_STORAGE_UNAVAILABLE' });
    }
    core.assertExtensionPriceBase(saved, extensionRows, { previousPayableAmount: 400, balanceBasis: base.balanceBasis });
    const beforeReplay = clone(saved), rowsBeforeReplay = clone(extensionRows);
    await core.payOrderExtension(tenant, valid.id, accepted.extension.id, {});
    assert.deepEqual(saved, beforeReplay); assert.deepEqual(extensionRows, rowsBeforeReplay);
    saved = priorSaved; extensionRows = priorRows; facts.markExtensionEffective = markEffective;
    pass('批准核减必须对应唯一原费用行，坏来源/金额/状态/总账拒绝，独立异常费不混入续租基准');
  }

  // 异常费逐行按分入账；核减审核不能因原始半分精度与总额口径不同而卡住。
  {
    const reviewing = Object.create(RentalCoreService.prototype);
    let current = { ...clone(order), status: RentalCoreOrderStatus.Settling, endAt: at(48),
      payableAmount: 480, adjustmentAmount: 0, finalPayableAmount: 480, chargeLines: clone(tier.chargeLines), serviceSnapshots: [] };
    const receipts = [effective(negative)];
    reviewing.lockedOrder = async () => clone(current);
    reviewing.factStore = { listExtensions: async () => clone(receipts),
      saveOrderAggregate: async row => { current = clone(row); },
      updateExtensionPricingSnapshot: async (_t, _o, id, snapshot) => { receipts.find(row => row.id === id).pricingSnapshot = clone(snapshot); } };
    for (const index of [0, 1]) {
      const result = await reviewing.approveInspectionException(tenant, current.id, 'half-cent-inspection', index,
        0.005, '客户责任异常费', {}, at(1), { liability: 'customer' });
      assert.equal(result.approvedChargeAmount, 0.01);
    }
    assert.deepEqual(current.chargeLines.filter(line => line.type === 'damage').map(line => line.amount), [0.01, 0.01]);
    assert.equal(current.adjustmentAmount, 0.02); assert.equal(current.finalPayableAmount, 480.02);
    await reviewing.reviewExtensionRefund(tenant, current.id, receipts[0].id,
      { decision: 'approved', reason: '原阶梯价核减' }, 'finance', {});
    assert.equal(current.finalPayableAmount, 300.02);
    // 存量原始精度行按同一逐行口径只读核对，不覆盖历史费用。
    current = { ...clone(order), status: RentalCoreOrderStatus.Settling, payableAmount: 480, adjustmentAmount: 0.02,
      finalPayableAmount: 480.02, chargeLines: [...clone(tier.chargeLines),
        ...[0, 1].map(index => ({ code: `damage:legacy:${index}`, type: 'damage', amount: 0.005 }))] };
    receipts[0] = effective(negative);
    await reviewing.reviewExtensionRefund(tenant, current.id, receipts[0].id,
      { decision: 'approved', reason: '存量精度只读核对' }, 'finance', {});
    assert.equal(current.finalPayableAmount, 300.02);
    assert.deepEqual(current.chargeLines.filter(line => line.type === 'damage').map(line => line.amount), [0.005, 0.005]);
    pass('半分异常费逐行舍入入账，存量精度不改写且不阻断原续租核减');
  }

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
    assert.deepEqual(priced.pricingSnapshot.rentalLineAmounts, { [group.id]: 240 }, '原重算收据冻结逐目标毛租金');
    assert.equal(priced.payableAmount, 0, '会员折扣必须被继承，否则会虚收整个折扣额');
    const twoDays = await price(member, 26);
    assert.equal(business.calculateEarlyReturnRefund(tenant, ctx, member, at(26), at(24), 0, twoDays.pricingSnapshot).amount, 216,
      '早退须扣全租期已重算会员减免 48，而不是原报价减免 24');
    pass('反例1 会员九折：延长仍在已买当天补款 0；后继早退消费原全租期会员净额');
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
    const explicit = clone(quote); explicit.couponEvaluation.applicableItemGroupIds = [quote.request.lines[0].itemGroupId];
    assert.equal((await price(explicit, 3)).pricingSnapshot.recalculatedCouponAmount, 120);
    for (const scope of [null, [quote.request.lines[0].itemGroupId, quote.request.lines[0].itemGroupId], [12], ['']]) {
      const bad = clone(explicit); bad.couponEvaluation.applicableItemGroupIds = scope;
      await assert.rejects(price(bad, 3), /原优惠券商品适用范围/);
    }
    const all = clone(quote); all.couponEvaluation.applicableItemGroupIds = [];
    all.couponEvaluation.discountType = 'fixed_amount'; all.couponEvaluation.discountValue = 120;
    const expanded = await price(all, 3);
    assert.equal(expanded.pricingSnapshot.recalculatedCouponAmount, 120);
    assert.deepEqual(Object.keys(expanded.pricingSnapshot.couponEvaluation.rentalAllocations).sort(), Object.keys(all.rentalLineAmounts).sort(),
      'explicit all-item scope includes an eligible original line with no prior allocation');
    assert.deepEqual(expanded.pricingSnapshot.couponEvaluation.applicableItemGroupIds, []);
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

  // Frozen member applicability is exercised through the actual quote producer,
  // not a second discount calculator or an allow-all production adapter.
  {
    const service = id => ({ id, tenantId: tenant, categoryCode: ctx.category.code, code: id, name: id,
      serviceType: 'other', billingUnit: 'per_order', price: 100, minimumQuantity: 1, maximumQuantity: 5,
      applicableFulfillmentModes: [], applicableLocationIds: [], applicableItemGroupIds: [], customerScope: 'all',
      selectionMode: 'optional', termsVersion: 'v1', terms: '原条款', requiresCapacity: false, status: 'enabled', version: 'v1' });
    const svcA = service('member-service-a'), svcB = service('member-service-b');
    business.listServices(tenant, ctx).push(svcA, svcB);
    const assignment = { id: 'member-assignment', customerId: 'member-test', planId: 'member-plan', planVersionId: 'member-v1',
      source: 'manual', status: 'active', effectiveFrom: start, createdAt: start,
      snapshot: { planName: '限定服务会员', targetType: 'personal', benefits: [
        { type: 'service_benefit', calculation: 'percentage', value: 50, applicableServiceIds: [svcA.id] },
        { type: 'service_benefit', calculation: 'percentage', value: 90, scope: { type: 'workspaces', workspaceIds: ['other-workspace'] } }
      ] } };
    const member = { bookingIdentity: 'personal', personalCustomerId: 'member-test', personalCustomerName: '测试会员',
      enterpriseContractAndPayer: false, benefitSource: 'personal', personalPlan: assignment, qualifications: [], resolvedAt: start };
    business.memberships = { resolveBookingIdentity: async () => clone(member) };
    const oldPlans = business.state(tenant, ctx).discountPlans;
    business.state(tenant, ctx).discountPlans = [];
    // This acceptance case needs an explicitly priced day, independent of the
    // configured default unit and the earlier current-price mutation.
    for (const plan of business.state(tenant, ctx).pricingPlans) {
      for (const rate of plan.rates) if (rate.itemGroupId === group.id || rate.pricingGroupId === seed.request.lines[0].pricingGroupId) {
        rate.unit = 'day_24h'; rate.baseAmount = 240;
      }
    }
    const produced = await business.createQuote(tenant, ctx, { customerType: 'personal', customerId: 'member-test',
      bookingIdentity: { bookingIdentity: 'personal' }, fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: location.id,
      startAt: start, endAt: at(2), lines: [{ itemGroupId: group.id, quantity: 1, pricingUnit: 'day_24h' }],
      services: [{ serviceId: svcA.id, quantity: 1 }, { serviceId: svcB.id, quantity: 1 }] });
    produced.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode: 'original_total' };
    const original = clone(produced);
    const adopted = produced.membershipBenefitEvaluations.find(row => row.appliedAmount > 0);
    assert.deepEqual(adopted.applicableServiceIds, [svcA.id]); assert.equal(adopted.appliedAmount, 50);
    assert.equal(produced.membershipBenefitEvaluations.find(row => row.scopeMatched === false).appliedAmount, 0);
    assert.equal((await price(produced, 3)).payableAmount, 0, 'A 半价不能扩到已存在但不适用的 B');
    assignment.snapshot.benefits[0].applicableServiceIds = []; assignment.snapshot.benefits[0].value = 100;
    const add = async (quote, hours, previous = []) => {
      business.getQuote = () => quote;
      return business.quoteOrderExtension(tenant, ctx, { ...args(quote, hours, previous),
        services: [{ serviceId: svcA.id, quantity: 1 }, { serviceId: svcB.id, quantity: 1 }] });
    };
    const added = await add(produced, 3);
    assert.equal(added.pricingSnapshot.recalculatedDiscountAmount, 100);
    assert.equal(added.payableAmount, 150);
    assert.equal(added.serviceSnapshots.find(row => row.serviceId === svcA.id).discountAllocatedAmount, 50);
    assert.equal(added.serviceSnapshots.find(row => row.serviceId === svcB.id).discountAllocatedAmount, 0);
    const next = await add(produced, 4, [effective(added)]);
    assert.equal(next.payableAmount, 150); assert.equal(next.pricingSnapshot.recalculatedDiscountAmount, 150);
    assert.equal(next.serviceSnapshots.find(row => row.serviceId === svcA.id).discountAllocatedAmount, 50);
    assert.deepEqual(produced, original, '当前权益改版及续租不覆盖原报价/发生项');
    pass('限定服务权益：实际生产者冻结 A，新增/多次服务按原范围分摊且当前方案不改历史');
    const legacy = clone(produced); delete legacy.membershipBenefitEvaluations[0].applicableServiceIds;
    assert.equal((await add(legacy, 3)).payableAmount, 150, '旧快照仅由原 allocation keys 恢复适用服务');
    delete legacy.membershipBenefitEvaluations[0].allocations;
    await assert.rejects(() => price(legacy, 3), /缺少适用服务快照/);
    const wrongScope = clone(produced); wrongScope.membershipBenefitEvaluations[0].scope = { type: 'workspaces', workspaceIds: ['another-space'] };
    await assert.rejects(() => price(wrongScope, 3), /适用范围无效/);
    const badNet = clone(produced); badNet.serviceSnapshots[0].discountAllocatedAmount = 200;
    await assert.rejects(() => price(badNet, 3), /原服务金额或优惠分摊无效/);
    pass('旧服务范围精确恢复；缺依据、跨空间及坏净额拒绝自动重算');

    const discountedServices = clone(produced);
    const servicePlan = { ...plan, id: 'original-service-plan', code: 'SERVICE10', appliesTo: 'service', discountValue: 10 };
    discountedServices.discountEvaluations = [{ applied: true, appliesTo: 'service', discountAmount: 20,
      planId: servicePlan.id, planVersion: servicePlan.version, planSnapshot: servicePlan }];
    discountedServices.couponEvaluation = { appliesTo: 'service', discountType: 'percentage', discountValue: 10, minimumSpend: 0,
      maximumDiscount: undefined, stackableWithDiscountPlans: true, templateVersion: 'v1', discountAmount: 18,
      serviceAllocations: { [svcA.id]: 9, [svcB.id]: 9 } };
    discountedServices.membershipBenefitEvaluations[0].base = 81;
    discountedServices.membershipBenefitEvaluations[0].appliedAmount = 40.5;
    discountedServices.membershipBenefitEvaluations[0].allocations = { [svcA.id]: 40.5 };
    discountedServices.serviceSnapshots[0].discountAllocatedAmount = 50.5; discountedServices.serviceSnapshots[0].couponAllocatedAmount = 9;
    discountedServices.serviceSnapshots[1].discountAllocatedAmount = 10; discountedServices.serviceSnapshots[1].couponAllocatedAmount = 9;
    discountedServices.discountAmount = 60.5; discountedServices.couponAmount = 18;
    discountedServices.payableAmount = discountedServices.rentalAmount + 121.5;
    const afterChain = await add(discountedServices, 3);
    assert.equal(afterChain.payableAmount, 121.5);
    assert.equal(afterChain.serviceSnapshots[0].discountAllocatedAmount, 50.5);
    assert.equal(afterChain.serviceSnapshots[0].couponAllocatedAmount, 9);
    assert.equal(afterChain.serviceSnapshots[1].discountAllocatedAmount, 10);
    assert.equal(afterChain.serviceSnapshots[1].couponAllocatedAmount, 9);
    assert.deepEqual(afterChain.pricingSnapshot.couponEvaluation.serviceAllocations, { [svcA.id]: 18, [svcB.id]: 18 });
    pass('原方案→券→限服务会员：全额与新增发生项净额、分摊一致');
    const cents = clone(produced); svcA.price = svcB.price = 0.03;
    cents.serviceAmount = 0.06; cents.discountAmount = 0.02; cents.payableAmount = cents.rentalAmount + 0.04;
    cents.serviceSnapshots[0].amount = cents.serviceSnapshots[1].amount = 0.03;
    cents.serviceSnapshots[0].discountAllocatedAmount = 0.02;
    cents.membershipBenefitEvaluations[0].base = 0.03; cents.membershipBenefitEvaluations[0].appliedAmount = 0.02;
    cents.membershipBenefitEvaluations[0].allocations = { [svcA.id]: 0.02 };
    const centsAdded = await add(cents, 3);
    assert.equal(centsAdded.serviceSnapshots[0].discountAllocatedAmount, 0.01, '全租期四舍五入剩余一分精确归属新增服务');
    assert.equal(centsAdded.serviceSnapshots[1].discountAllocatedAmount, 0);
    assert.equal(centsAdded.payableAmount, 0.05);
    assert.equal((await add(cents, 4, [effective(centsAdded)])).serviceSnapshots[0].discountAllocatedAmount, 0.02);
    svcA.price = svcB.price = 100;
    pass('限服务会员按分精度分摊尾差，连续续租不多减或把尾差分给不适用服务');
    business.state(tenant, ctx).discountPlans = oldPlans;
    business.memberships = undefined;
  }

  {
    const securityQuote = fixture();
    const policy = { enabled: true, allowedRiskLevels: ['low'], maxReductionPercent: 100, maxReductionAmount: 1000 };
    const oldAttributes = clone(group.attributes); group.attributes.securityRiskLevel = 'low';
    const oldRate = securityQuote.rateSnapshot[0]; oldRate.depositMultiple = 0.5; oldRate.preAuthMultiple = 1;
    securityQuote.ruleSnapshot.deposit = { mode: 'price_multiple' };
    securityQuote.ruleSnapshot.preauthorization = { mode: 'price_multiple' };
    securityQuote.ruleSnapshot.membershipSecurityReduction = { deposit: clone(policy), preauthorization: clone(policy) };
    const evaluation = (instrument, gross, reduction) => ({ source: 'personal', planId: 'security-plan', planVersionId: 'security-v1',
      planName: '原保证金权益', type: instrument === 'deposit' ? 'deposit_reduction' : 'preauth_reduction', appliesTo: instrument,
      scope: { type: 'tenant' }, scopeMatched: true, calculation: 'percentage', configuredValue: 50,
      appliedAmount: reduction, base: gross, allocations: { [instrument]: reduction }, securityRiskCheck: 'clear',
      securityOriginalAmount: gross, securityEligibleBase: gross, securityPolicySnapshot: clone(policy),
      securityRiskAssessments: [{ itemGroupId: group.id, pricingGroupId: securityQuote.request.lines[0].pricingGroupId,
        riskLevel: 'low', allowed: true, quantity: 1 }], detail: '原减免' });
    securityQuote.depositAmount = 60; securityQuote.preAuthAmount = 120;
    securityQuote.membershipBenefitEvaluations = [evaluation('deposit', 120, 60), evaluation('preauthorization', 240, 120)];
    securityQuote.membershipSnapshot = { personalCustomerId: 'member-test' };
    const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
    let openRisk = false, riskUnavailable = false;
    const riskReader = new MembershipService({}, { hasOpenRisk: async () => {
      if (riskUnavailable) throw Error('risk reader unavailable'); return openRisk;
    } });
    business.memberships = riskReader;
    const original = clone(securityQuote);
    const unchanged = await price(securityQuote, 3);
    assert.equal(unchanged.depositDelta, 0); assert.equal(unchanged.preAuthDelta, 0);
    const extended = await price(securityQuote, 26);
    assert.equal(extended.depositDelta, 60); assert.equal(extended.preAuthDelta, 120, '先按原会员减免取净要求再求差');
    const repeated = await price(securityQuote, 27, [effective(extended)]);
    assert.equal(repeated.depositDelta, 0); assert.equal(repeated.preAuthDelta, 0);
    assert.equal(extended.pricingSnapshot.membershipBenefitEvaluations.find(row => row.appliesTo === 'deposit').appliedAmount, 120);
    assert.deepEqual(securityQuote, original);
    const fullWaiver = clone(securityQuote);
    for (const benefit of fullWaiver.membershipBenefitEvaluations) {
      benefit.configuredValue = 100; benefit.appliedAmount = benefit.securityOriginalAmount;
    }
    fullWaiver.depositAmount = fullWaiver.preAuthAmount = 0;
    const waived = await price(fullWaiver, 26); assert.equal(waived.depositDelta, 0); assert.equal(waived.preAuthDelta, 0);
    pass('保证金原减免：净额不变零补款、增长按净差额、多次不重收、全免押/授权仍零');
    const capped = clone(securityQuote);
    for (const benefit of capped.membershipBenefitEvaluations) benefit.securityPolicySnapshot.maxReductionAmount = 60;
    capped.membershipBenefitEvaluations[1].appliedAmount = 60; capped.preAuthAmount = 180;
    assert.equal((await price(capped, 26)).preAuthDelta, 240, '原绝对上限不能随租期放大');
    const missingRisk = clone(securityQuote); delete missingRisk.membershipBenefitEvaluations[0].securityRiskAssessments;
    await assert.rejects(() => price(missingRisk, 3), /缺少有效风控/);
    const tampered = clone(securityQuote); tampered.depositAmount = 50;
    await assert.rejects(() => price(tampered, 3), /净额与会员减免依据不一致/);
    group.attributes.securityRiskLevel = 'high';
    await assert.rejects(() => price(securityQuote, 3), /风险等级已变化/);
    group.attributes.securityRiskLevel = 'low'; openRisk = true;
    await assert.rejects(() => price(securityQuote, 3), /未关闭风险/);
    openRisk = false; riskUnavailable = true;
    await assert.rejects(() => price(securityQuote, 3), /风险无法核实/);
    riskUnavailable = false; business.memberships = undefined;
    await assert.rejects(() => price(securityQuote, 3), /风险读取不可用/);
    group.attributes.securityRiskLevel = 'high';
    business.getQuote = () => securityQuote;
    const historicalReduction = await business.quoteOrderExtension(tenant, ctx, { ...args(securityQuote, 1), mode: 'line_cancellation' });
    assert.equal(historicalReduction.depositDelta, 0); assert.equal(historicalReduction.preAuthDelta, 0,
      '减少既有责任不把当前会员风险当作历史减免失效，也不批准新增业务');
    group.attributes.securityRiskLevel = 'low';
    pass('原资金上限不放大；新业务风险失败拒绝，历史核减仍保留原净额');

    let riskTx, writes = 0;
    const guarded = Object.create(RentalCoreService.prototype), originalTx = {};
    const locked = { ...clone(order), endAt: at(2), effectiveEndAt: undefined,
      membershipSnapshot: clone(securityQuote.membershipSnapshot), membershipBenefitEvaluations: clone(securityQuote.membershipBenefitEvaluations) };
    const pending = { ...effective(extended), status: 'pending_payment' };
    guarded.state = () => ({ profile: ctx.profile, itemGroups: [group] });
    guarded.resolveWorkspaceId = () => 'ws_tenant_002';
    guarded.lockedOrder = async () => clone(locked);
    guarded.assertOrderQualification = async () => {};
    guarded.assertOrderExtensionAvailable = async () => {};
    guarded.factStore = { listExtensions: async () => [clone(pending)], markExtensionEffective: async () => { writes++; } };
    riskReader.operations.lockCustomerBusinessGate = async (_t, _c, tx) => { riskTx = tx; return true; };
    guarded.memberships = riskReader; openRisk = true;
    await assert.rejects(() => guarded.requestOrderExtension(tenant, locked.id, unchanged,
      { idempotencyKey: 'blocked-member-free', operator: 'tester' }, originalTx), /未关闭风险/);
    await assert.rejects(() => guarded.payOrderExtension(tenant, locked.id, pending.id, originalTx), /未关闭风险/);
    assert.equal(riskTx, originalTx); assert.equal(writes, 0, '旧 preview 不能授权后续零差额或补款生效');
    openRisk = false;
    await guarded.assertExtensionMembershipSecurity(tenant, locked, extended.pricingSnapshot, originalTx);
    riskReader.operations.lockCustomerBusinessGate = async () => false;
    await assert.rejects(() => guarded.assertExtensionMembershipSecurity(tenant, locked, extended.pricingSnapshot, originalTx), /未关闭风险/);
    guarded.memberships = undefined;
    await assert.rejects(() => guarded.assertExtensionMembershipSecurity(tenant, locked, extended.pricingSnapshot, originalTx), /读取不可用/);
    group.attributes = oldAttributes;
    pass('Core 零差额受理/补款均复验原会员风险锁，旧试算不授权且拒绝前零写入');
  }

  console.log(`续租修正专项 ${count} 组通过（计算与应用服务测试；不冒充数据库并发验收）`);
})().catch(error => { console.error(error); process.exitCode = 1; });
