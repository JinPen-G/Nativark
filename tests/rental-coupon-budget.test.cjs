const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const dbName = new URL(env.DATABASE_URL).pathname.slice(1);
if (!/zcode/.test(dbName)) {
  console.error(`拒绝执行：优惠券预算专项只能使用 ZCode 专用库，当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = env.DATABASE_URL;

const { PrismaService } = require(path.join(ROOT, "apps/api/src/modules/database/prisma.service"));
const { RentalBusinessFactRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-fact.repository"));

const tenantId = "tenant_001";
const tag = `MKT01B-${Date.now().toString(36)}`;
const now = new Date();
const validFrom = new Date(now.getTime() - 86_400_000);
const validTo = new Date(now.getTime() + 30 * 86_400_000);

void (async () => {
  const prisma = new PrismaService();
  await prisma.$connect();
  const workspace = await prisma.businessWorkspace.findFirst({ where: { tenantId, isDefault: true } });
  assert.ok(workspace, "专用库必须有 tenant_001 默认经营空间");
  const workspaceId = workspace.id;
  const repo = new RentalBusinessFactRepository(prisma);

  const cleanup = async () => {
    const templates = await prisma.rentalCouponTemplate.findMany({ where: { workspaceId, code: { startsWith: "MKT01B-" } }, select: { id: true } });
    const ids = templates.map((row) => row.id);
    if (ids.length) await prisma.rentalCustomerCoupon.deleteMany({ where: { templateId: { in: ids } } });
    await prisma.rentalCouponTemplate.deleteMany({ where: { id: { in: ids } } });
  };

  try {
    await cleanup();
    const template = await prisma.rentalCouponTemplate.create({
      data: {
        tenantId, workspaceId, code: tag, name: "预算并发专项券", discountType: "fixed_amount",
        discountValue: 40, minimumSpend: 0, appliesTo: "rental", stackableWithDiscountPlans: true,
        totalQuota: 10, claimedQuantity: 2, perCustomerLimit: 10, perCustomerUseLimit: 10,
        totalBudget: 50, lockedBudget: 0, redeemedBudget: 0,
        effectiveFrom: validFrom, effectiveTo: validTo, applicableItemGroupIds: [], status: "active", version: "1.0"
      }
    });
    const createCoupon = (id, customerId) => prisma.rentalCustomerCoupon.create({
      data: {
        id, tenantId, workspaceId, customerId, templateId: template.id, templateCode: template.code,
        templateName: template.name, templateVersion: template.version, discountType: "fixed_amount",
        discountValue: 40, minimumSpend: 0, appliesTo: "rental", stackableWithDiscountPlans: true,
        applicableItemGroupIds: [], grantReason: "test", status: "claimed", effectiveFrom: validFrom, effectiveTo: validTo
      }
    });
    const couponA = await createCoupon(`${tag}-A`, `${tag}-CUSTOMER-A`);
    const couponB = await createCoupon(`${tag}-B`, `${tag}-CUSTOMER-B`);

    const lock = (coupon, orderId) => prisma.$transaction((tx) => repo.lockCouponIfAvailable(
      tenantId, coupon.id, coupon.customerId, orderId, now.toISOString(), now.toISOString(), 40, tx
    ));
    const outcomes = await Promise.all([lock(couponA, `${tag}-ORDER-A`), lock(couponB, `${tag}-ORDER-B`)]);
    assert.deepEqual([...outcomes].sort(), [false, true], "最后 50 元预算只能让一个 40 元锁券成功");
    let storedTemplate = await prisma.rentalCouponTemplate.findUniqueOrThrow({ where: { id: template.id } });
    assert.equal(Number(storedTemplate.lockedBudget), 40);
    assert.equal(Number(storedTemplate.redeemedBudget), 0);

    const winner = (await prisma.rentalCustomerCoupon.findMany({ where: { templateId: template.id } })).find((row) => row.status === "locked");
    assert.ok(winner?.lockedOrderId);
    await prisma.$transaction((tx) => repo.redeemCouponForOrder(tenantId, winner.lockedOrderId, now.toISOString(), tx));
    storedTemplate = await prisma.rentalCouponTemplate.findUniqueOrThrow({ where: { id: template.id } });
    assert.equal(Number(storedTemplate.lockedBudget), 0, "核销应从锁定预算扣除");
    assert.equal(Number(storedTemplate.redeemedBudget), 40, "核销应转入已核销预算");

    await prisma.$transaction((tx) => repo.releaseCouponForOrder(tenantId, winner.lockedOrderId, now.toISOString(), tx));
    storedTemplate = await prisma.rentalCouponTemplate.findUniqueOrThrow({ where: { id: template.id } });
    assert.equal(Number(storedTemplate.lockedBudget), 0);
    assert.equal(Number(storedTemplate.redeemedBudget), 0, "取消恢复券时应释放实际预占金额");
    const released = await prisma.rentalCustomerCoupon.findUniqueOrThrow({ where: { id: winner.id } });
    assert.equal(released.status, "claimed");
    assert.equal(released.releaseReason, "order_cancelled");

    const sameCouponResults = await Promise.all([
      lock({ id: winner.id, customerId: winner.customerId }, `${tag}-ORDER-C`),
      lock({ id: winner.id, customerId: winner.customerId }, `${tag}-ORDER-D`)
    ]);
    assert.deepEqual([...sameCouponResults].sort(), [false, true], "同一张券并发只能被一个订单锁定");

    const available = await prisma.rentalCustomerCoupon.findFirstOrThrow({ where: { templateId: template.id, status: "claimed" } });
    const voided = await prisma.$transaction((tx) => repo.voidClaimedCoupon(tenantId, available.id, "专项作废", now.toISOString(), tx));
    assert.equal(voided, true);
    assert.equal((await prisma.rentalCustomerCoupon.findUniqueOrThrow({ where: { id: available.id } })).status, "void");

    console.log("Rental coupon budget test passed: snapshot persistence, budget locking, redemption, release, void and concurrency verified.");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
