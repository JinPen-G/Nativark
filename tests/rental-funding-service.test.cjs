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
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/zcode/.test(dbName)) {
  console.error(`拒绝执行：资金事件专项只能使用带 zcode 标记的专用库，当前 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaService } = require(path.join(ROOT, "apps/api/src/modules/database/prisma.service"));
const { RentalFundingService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-funding.service"));

const tenantId = "tenant_001";
const tag = `R01B-${Date.now().toString(36)}`;
let prisma;

void (async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  const funding = new RentalFundingService(prisma);
  const workspaces = await prisma.businessWorkspace.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" }, take: 2 });
  assert.ok(workspaces.length >= 2, "夹具租户至少需要两个经营空间以验证空间隔离");
  const workspace = workspaces[0];
  const otherWorkspace = workspaces[1];
  const location = await prisma.rentalFulfillmentLocation.findFirst({ where: { tenantId, workspaceId: workspace.id } });
  assert.ok(location, "夹具需要履约地点");

  await prisma.rentalOrder.deleteMany({ where: { tenantId, createdBy: "rule-01b-test" } });
  const orderId = `${tag}-order`;
  await prisma.rentalOrder.create({
    data: {
      id: orderId,
      tenantId,
      workspaceId: workspace.id,
      orderNo: tag,
      categoryCode: workspace.categoryCode,
      customerType: "individual",
      customerName: "资金专项客户",
      fulfillmentMode: "pickup",
      fulfillmentLocationId: location.id,
      fulfillmentLocationName: location.name,
      startAt: new Date("2049-01-01T00:00:00.000Z"),
      endAt: new Date("2049-01-02T00:00:00.000Z"),
      quoteId: `${tag}-quote`,
      quoteNo: `${tag}-Q`,
      pricingPlanVersion: "test",
      ruleVersion: "test",
      ruleSnapshot: {},
      chargeLines: [],
      rentalAmount: 1000,
      discountAmount: 0,
      couponAmount: 0,
      serviceAmount: 0,
      depositAmount: 500,
      preAuthAmount: 800,
      payableAmount: 1500,
      adjustmentAmount: 0,
      finalPayableAmount: 1500,
      totalAmount: 1500,
      createdBy: "rule-01b-test"
    }
  });

  // 续租申请尚未生效时，押金/预授权增量也必须进入首次发起目标；
  // 这是基础订单金额为 0 时仍能补收/补冻的关键回归用例。
  const pendingExtensionId = `${tag}-extension`;
  await prisma.rentalOrderExtension.create({
    data: {
      id: pendingExtensionId,
      tenantId,
      workspaceId: workspace.id,
      orderId,
      sequence: 1,
      status: "pending_payment",
      originalEndAt: new Date("2049-01-02T00:00:00.000Z"),
      newEndAt: new Date("2049-01-03T00:00:00.000Z"),
      billableUnits: 1,
      rentalAmount: 100,
      serviceAmount: 0,
      depositDelta: 100,
      preAuthDelta: 200,
      payableAmount: 100,
      currency: "CNY",
      ruleVersion: "test",
      rateSnapshot: [],
      ruleSnapshot: {},
      calendarSnapshot: [],
      settlementMode: "immediate",
      idempotencyKey: `${tag}:extension`,
      createdBy: "rule-01b-test"
    }
  });
  await prisma.rentalOrder.update({ where: { id: orderId }, data: { depositAmount: 0, preAuthAmount: 0 } });
  const pendingSummary = await funding.listEvents(tenantId, workspace.id, orderId);
  assert.equal(pendingSummary.deposit.requiredAmount, 100, "资金摘要总押金目标要包含待生效续租增量");
  assert.equal(pendingSummary.preauthorization.requiredAmount, 200, "资金摘要总预授权目标要包含待生效续租增量");
  assert.equal(pendingSummary.deposit.pendingExtensionAmount, 100, "资金摘要要展示待补押金增量");
  assert.equal(pendingSummary.preauthorization.pendingExtensionAmount, 200, "资金摘要要展示待补预授权增量");
  assert.equal(pendingSummary.rental.pendingExtensionAmount, 100, "资金摘要要展示待补租金");

  const pendingDeposit = await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "deposit", action: "initiate", idempotencyKey: `${tag}:pending-deposit`, reason: "基础押金为 0 时收取续租押金增量"
  }, "专项");
  assert.equal(pendingDeposit.amount, 100, "基础押金为 0 时也必须能发起待生效续租押金增量");
  const pendingPreauth = await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "preauthorization", action: "initiate", idempotencyKey: `${tag}:pending-preauth`, reason: "基础预授权为 0 时冻结续租预授权增量"
  }, "专项");
  assert.equal(pendingPreauth.amount, 200, "基础预授权为 0 时也必须能发起待生效续租预授权增量");
  await prisma.rentalFundingEvent.deleteMany({ where: { orderId } });
  await prisma.rentalOrderExtension.delete({ where: { id: pendingExtensionId } });
  await prisma.rentalOrder.update({ where: { id: orderId }, data: { depositAmount: 500, preAuthAmount: 800 } });
  console.log("  PASS  待补款续租的押金/预授权增量可在基础目标为 0 或未收取时正常发起");

  await assert.rejects(
    prisma.$transaction((tx) => funding.assertReadyForPickup(tenantId, workspace.id, orderId, tx)),
    /足额收取押金/,
    "未处理押金与预授权时不得领取"
  );

  const deposit = await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "deposit", action: "initiate", idempotencyKey: `${tag}:deposit`, reason: "按订单快照收取", paymentMethod: "offline_transfer"
  }, "专项");
  assert.equal(deposit.amount, 500, "首次押金金额必须来自订单快照");
  assert.equal(deposit.paymentMethod, "offline_transfer", "人工收款应记录实际线下收款方式");
  const replay = await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "deposit", action: "initiate", idempotencyKey: `${tag}:deposit`, reason: "重放"
  }, "专项");
  assert.equal(replay.id, deposit.id, "同键重放返回原事件");
  assert.equal(await prisma.rentalFundingEvent.count({ where: { orderId, instrument: "deposit", action: "initiate" } }), 1);

  await assert.rejects(
    prisma.$transaction((tx) => funding.assertReadyForPickup(tenantId, workspace.id, orderId, tx)),
    /足额冻结预授权/,
    "只收押金但未冻结预授权时仍不得领取"
  );

  await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "preauthorization", action: "initiate", idempotencyKey: `${tag}:preauth`, reason: "按订单快照冻结"
  }, "专项");
  const rental = await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "rental", action: "initiate", idempotencyKey: `${tag}:rental`, reason: "按订单应收登记租金"
  }, "专项");
  assert.equal(rental.amount, 1500, "领取前租金必须按订单最终应收登记");
  await prisma.$transaction((tx) => funding.assertReadyForPickup(tenantId, workspace.id, orderId, tx));
  // 模拟归还检查后新增一笔尚未收取的异常费用：预授权抵扣只能覆盖真实未收应收，
  // 不能在没有费用的订单上凭空转扣。
  await prisma.rentalOrder.update({ where: { id: orderId }, data: { finalPayableAmount: 2000, totalAmount: 2000, adjustmentAmount: 500 } });
  await assert.rejects(
    prisma.$transaction((tx) => funding.assertReadyToClose(tenantId, workspace.id, orderId, tx)),
    /押金余额/,
    "资金余额未处理完不得关闭"
  );
  const raced = await Promise.allSettled([
    funding.recordEvent(tenantId, workspace.id, orderId, {
      instrument: "preauthorization", action: "capture", amount: 500, idempotencyKey: `${tag}:capture-a`, reason: "并发转扣 A"
    }, "专项"),
    funding.recordEvent(tenantId, workspace.id, orderId, {
      instrument: "preauthorization", action: "capture", amount: 400, idempotencyKey: `${tag}:capture-b`, reason: "并发转扣 B"
    }, "专项")
  ]);
  assert.equal(raced.filter((row) => row.status === "fulfilled").length, 1, "争抢不足余额时只能一笔成功");
  assert.equal(raced.filter((row) => row.status === "rejected").length, 1, "超余额的并发动作必须失败");

  await assert.rejects(
    funding.listEvents(tenantId, otherWorkspace.id, orderId),
    /当前经营空间/,
    "同租户其他空间不能读取资金事件"
  );
  const beforeRelease = await funding.listEvents(tenantId, workspace.id, orderId);
  const released = await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "preauthorization", action: "release", idempotencyKey: `${tag}:release`, reason: "释放剩余额度"
  }, "专项");
  assert.equal(released.amount, beforeRelease.preauthorization.balance, "不传金额时释放服务端计算的全部余额");
  assert.equal(released.paymentMethod, undefined, "预授权释放是内部资金动作，不应伪装成现金收款");
  assert.equal((await funding.listEvents(tenantId, workspace.id, orderId)).preauthorization.balance, 0);
  await funding.recordEvent(tenantId, workspace.id, orderId, {
    instrument: "deposit", action: "refund", amount: 500, idempotencyKey: `${tag}:refund`, reason: "退还全部押金"
  }, "专项");
  await prisma.$transaction((tx) => funding.assertReadyToClose(tenantId, workspace.id, orderId, tx));

  await prisma.rentalOrder.delete({ where: { id: orderId } });
  console.log("Funding service DB assertions passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (prisma) {
    await prisma.rentalOrder.deleteMany({ where: { tenantId, createdBy: "rule-01b-test" } }).catch(() => undefined);
    await prisma.$disconnect();
  }
});
