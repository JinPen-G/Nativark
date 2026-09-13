// 只对专门克隆的续租验收库执行，绝不读取 .env 回落到开发库。
const assert = require('node:assert/strict');
const target = new URL(process.env.DATABASE_URL || 'mysql://invalid/invalid');
assert.match(target.pathname.slice(1), /^rental_os_dedicated_renewal_\d+$/);
require('ts-node').register({ transpileOnly: true, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { PrismaService } = require('../apps/api/src/modules/database/prisma.service');
const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
const { RentalCoreFactRepository } = require('../apps/api/src/modules/rental-core/rental-core-fact.repository');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const prisma = new PrismaService();
const tag = `renewal-db-${Date.now()}`;
let templateId;
let extensionId;
let quoteBefore;
const business = new RentalBusinessFactRepository(prisma);
const core = new RentalCoreFactRepository(prisma);
(async () => {
  await prisma.$connect();
  const candidates = await prisma.rentalOrder.findMany({
    orderBy: { createdAt: 'asc' }
  });
  let row;
  for (const candidate of candidates) {
    if (await prisma.rentalQuote.findUnique({ where: { id: candidate.quoteId } })) {
      row = candidate;
      break;
    }
  }
  assert.ok(row, '克隆备份需包含订单及其报价快照供续租持久化验证');
  const { tenantId, workspaceId } = row;
  await runWithRequestIdentity({ tenantId, workspaceId, userId: 'renewal-test', isSaasAdmin: false }, async () => {
    try {
      const order = await core.findOrder(tenantId, row.id);
      quoteBefore = await business.findQuote(tenantId, order.quoteId);
      assert.ok(quoteBefore);
      const quote = structuredClone(quoteBefore);
      quote.pricingContext = { ...(quote.pricingContext || {}), timeZone: 'Asia/Shanghai', dayRates: [{ ...quote.rateSnapshot[0], unit: 'day_24h', baseAmount: 241 }] };
      await business.upsertQuote(quote);
      const snapshot = { mode: 'original_total', previousPayableAmount: 480, recalculatedRentalAmount: 300, recalculatedPayableAmount: 300, differenceAmount: -180, refundReview: { status: 'pending', amount: 180 }, context: quote.pricingContext, chargeLines: [] };
      const max = await prisma.rentalOrderExtension.aggregate({ where: { orderId: row.id }, _max: { sequence: true } });
      extensionId = tag;
      await prisma.$transaction(tx => core.insertExtension({
        id: extensionId, tenantId, orderId: row.id, sequence: (max._max.sequence || 0) + 1, status: 'effective',
        originalEndAt: order.endAt, newEndAt: new Date(Date.parse(order.endAt) + 86400000).toISOString(),
        billableUnits: 1, rentalAmount: -180, serviceAmount: 0, depositDelta: 0, preAuthDelta: 0, payableAmount: 0,
        currency: order.currency, ruleVersion: quote.ruleVersion, rateSnapshot: quote.rateSnapshot, ruleSnapshot: quote.ruleSnapshot,
        calendarSnapshot: quote.calendarSnapshot || [], pricingSnapshot: snapshot, settlementMode: 'immediate', idempotencyKey: tag,
        createdBy: 'renewal-test', createdAt: new Date().toISOString()
      }, tx));
      await prisma.$disconnect(); await prisma.$connect();
      assert.deepEqual((await business.findQuote(tenantId, order.quoteId)).pricingContext, quote.pricingContext);
      assert.deepEqual((await core.listExtensions(tenantId, row.id)).find(e => e.id === extensionId).pricingSnapshot, snapshot);
      console.log('PASS 续租与报价快照落库、断连重连保持原值');
      await assert.rejects(() => prisma.$transaction(async tx => {
        await core.updateExtensionPricingSnapshot(tenantId, row.id, extensionId, { ...snapshot, refundReview: { status: 'approved', amount: 180 } }, tx);
        throw new Error('intentional rollback');
      }), /intentional rollback/);
      assert.deepEqual((await core.listExtensions(tenantId, row.id)).find(e => e.id === extensionId).pricingSnapshot, snapshot);
      console.log('PASS 退款审核快照随事务回滚');
      await runWithRequestIdentity({ tenantId, workspaceId: 'wrong-space' }, async () => {
        await assert.rejects(
          () => business.findQuote(tenantId, order.quoteId),
          /当前经营空间不属于目标租户/
        );
        await assert.rejects(
          () => core.listExtensions(tenantId, row.id),
          /当前经营空间不属于目标租户/
        );
      });
      console.log('PASS 快照跨空间读取 fail-closed');
      const effectiveFrom = new Date(Date.now() - 86400000), effectiveTo = new Date(Date.now() + 86400000);
      const template = await prisma.rentalCouponTemplate.create({ data: {
        tenantId, workspaceId, code: tag, name: '续租预算并发', discountType: 'fixed_amount', discountValue: 40,
        minimumSpend: 0, appliesTo: 'rental', stackableWithDiscountPlans: true, totalQuota: 10, claimedQuantity: 2,
        perCustomerLimit: 10, perCustomerUseLimit: 10, totalBudget: 60, lockedBudget: 0, redeemedBudget: 40,
        effectiveFrom, effectiveTo, applicableItemGroupIds: [], status: 'active', version: '1.0'
      } });
      templateId = template.id;
      for (const letter of ['a', 'b']) await prisma.rentalCustomerCoupon.create({ data: {
        id: `${tag}-${letter}`, tenantId, workspaceId, customerId: `${tag}-customer-${letter}`, templateId,
        templateCode: tag, templateName: template.name, templateVersion: template.version, discountType: 'fixed_amount',
        discountValue: 40, minimumSpend: 0, appliesTo: 'rental', stackableWithDiscountPlans: true, applicableItemGroupIds: [],
        grantReason: 'test', status: 'redeemed', effectiveFrom, effectiveTo, lockedOrderId: `${tag}-order-${letter}`,
        redeemedOrderId: `${tag}-order-${letter}`, lockedDiscountAmount: 20
      } });
      const outcomes = await Promise.allSettled(['a', 'b'].map(letter => prisma.$transaction(tx => business.repriceOrderCoupon(tenantId, `${tag}-order-${letter}`, 40, tx))));
      assert.equal(outcomes.filter(o => o.status === 'fulfilled').length, 1);
      assert.equal(outcomes.find(o => o.status === 'rejected').reason.getStatus(), 409);
      const coupons = await prisma.rentalCustomerCoupon.findMany({ where: { templateId } });
      assert.deepEqual(coupons.map(c => Number(c.lockedDiscountAmount)).sort(), [20, 40]);
      const stored = await prisma.rentalCouponTemplate.findUniqueOrThrow({ where: { id: templateId } });
      assert.equal(Number(stored.redeemedBudget), 60); assert.equal(stored.claimedQuantity, 2);
      console.log('PASS 最后一份用券预算并发只允许一个续租成功，不重复领券');
      const winner = coupons.find(c => Number(c.lockedDiscountAmount) === 40);
      await assert.rejects(() => prisma.$transaction(async tx => {
        await business.repriceOrderCoupon(tenantId, winner.redeemedOrderId, 10, tx);
        throw new Error('budget rollback');
      }), /budget rollback/);
      assert.equal(Number((await prisma.rentalCouponTemplate.findUniqueOrThrow({ where: { id: templateId } })).redeemedBudget), 60);
      assert.equal(Number((await prisma.rentalCustomerCoupon.findUniqueOrThrow({ where: { id: winner.id } })).lockedDiscountAmount), 40);
      await runWithRequestIdentity({ tenantId, workspaceId: 'wrong-space' }, () => assert.rejects(
        () => prisma.$transaction(tx => business.repriceOrderCoupon(tenantId, winner.redeemedOrderId, 10, tx)), /当前经营空间不属于目标租户/));
      await prisma.$transaction(tx => business.releaseCouponForOrder(tenantId, winner.redeemedOrderId, new Date().toISOString(), tx));
      assert.equal(Number((await prisma.rentalCouponTemplate.findUniqueOrThrow({ where: { id: templateId } })).redeemedBudget), 20);
      console.log('PASS 预算事务回滚、空间隔离、取消按调整后金额释放');
    } finally {
      if (extensionId) await prisma.rentalOrderExtension.deleteMany({ where: { id: extensionId, tenantId, workspaceId } });
      if (templateId) { await prisma.rentalCustomerCoupon.deleteMany({ where: { templateId } }); await prisma.rentalCouponTemplate.delete({ where: { id: templateId } }); }
      if (quoteBefore) await business.upsertQuote(quoteBefore);
    }
  });
})().catch(e => { console.error(e.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
