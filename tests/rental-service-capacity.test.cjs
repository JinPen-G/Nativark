const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const ROOT = path.resolve(__dirname, "..");
const fileEnv = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/zcode/.test(dbName)) {
  console.error(`拒绝执行：服务容量专项只能使用带 zcode 标记的专用库，当前 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaService } = require(path.join(ROOT, "apps/api/src/modules/database/prisma.service"));
const { RentalBusinessConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-business-config.repository"));
const { RentalServiceCapacityService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-service-capacity.service"));

const tenantId = "tenant_001";
const tag = `M02B-${Date.now().toString(36)}`;
let prisma;

const snapshot = (service, locationId) => ({
  serviceId: service.id,
  serviceCode: service.code,
  serviceName: service.name,
  serviceType: "operator",
  serviceVersion: "1.0",
  workspaceId: service.workspaceId,
  billingUnit: "per_hour",
  selectionMode: "optional",
  requiredByRule: false,
  unitPrice: 100,
  quantity: 1,
  billingUnits: 1,
  amount: 100,
  formula: "100 × 1 × 1",
  termsVersion: "1.0",
  terms: "容量专项条款",
  eligibility: [],
  insuredDisplayable: false,
  requiresCapacity: true,
  scheduledStartAt: "2048-01-01T02:00:00.000Z",
  scheduledEndAt: "2048-01-01T03:00:00.000Z",
  serviceLocationId: locationId,
  capacityQuantity: 1
});

void (async () => {
  prisma = new PrismaService();
  await prisma.$connect();
  const capacityService = new RentalServiceCapacityService(prisma);
  const configRepository = new RentalBusinessConfigRepository(prisma);
  const workspace = await prisma.businessWorkspace.findFirst({ where: { tenantId, isDefault: true } });
  assert.ok(workspace, "夹具需要默认经营空间");
  const location = await prisma.rentalFulfillmentLocation.findFirst({ where: { tenantId, workspaceId: workspace.id, status: "enabled" } });
  assert.ok(location, "夹具需要启用地点");
  // 专项异常中断后也必须能重跑：只清理本测试明确命名的专用数据。
  const staleServices = await prisma.rentalValueAddedService.findMany({
    where: { tenantId, workspaceId: workspace.id, code: { startsWith: "M02B-" } },
    select: { id: true }
  });
  const staleServiceIds = staleServices.map((row) => row.id);
  if (staleServiceIds.length) {
    await prisma.rentalServiceReservation.deleteMany({ where: { serviceId: { in: staleServiceIds } } });
    await prisma.rentalServiceCapacity.deleteMany({ where: { serviceId: { in: staleServiceIds } } });
    await prisma.rentalValueAddedServiceVersion.deleteMany({ where: { serviceId: { in: staleServiceIds } } });
    await prisma.rentalValueAddedService.deleteMany({ where: { id: { in: staleServiceIds } } });
  }
  await prisma.rentalOrder.deleteMany({ where: { tenantId, workspaceId: workspace.id, createdBy: "mkt-02b-test" } });
  const orderIds = [`${tag}-order-1`, `${tag}-order-2`];
  await prisma.rentalOrder.createMany({
    data: orderIds.map((id, index) => ({
      id,
      tenantId,
      workspaceId: workspace.id,
      orderNo: `${tag}-${index + 1}`,
      categoryCode: workspace.categoryCode,
      customerType: "individual",
      customerName: "容量专项客户",
      fulfillmentMode: "pickup",
      fulfillmentLocationId: location.id,
      fulfillmentLocationName: location.name,
      startAt: new Date("2048-01-01T00:00:00.000Z"),
      endAt: new Date("2048-01-02T00:00:00.000Z"),
      quoteId: `${tag}-quote-${index + 1}`,
      quoteNo: `${tag}-Q${index + 1}`,
      pricingPlanVersion: "test",
      ruleVersion: "test",
      ruleSnapshot: {},
      chargeLines: [],
      rentalAmount: 0,
      discountAmount: 0,
      couponAmount: 0,
      serviceAmount: 0,
      depositAmount: 0,
      payableAmount: 0,
      adjustmentAmount: 0,
      finalPayableAmount: 0,
      totalAmount: 0,
      createdBy: "mkt-02b-test"
    }))
  });
  const orders = await prisma.rentalOrder.findMany({ where: { id: { in: orderIds } }, orderBy: { id: "asc" } });
  assert.equal(orders.length, 2, "专项必须自行创建两张隔离订单夹具");

  const now = new Date().toISOString();
  const serviceFact = {
    id: `${tag}-service`,
    tenantId,
    categoryCode: workspace.categoryCode,
    code: tag,
    name: "MKT-02B 容量专项服务",
    serviceType: "operator",
    billingUnit: "per_hour",
    price: 100,
    minimumQuantity: 1,
    maximumQuantity: 1,
    termsVersion: "1.0",
    terms: "容量专项条款",
    applicableItemGroupIds: [],
    applicableFulfillmentModes: [],
    applicableLocationIds: [location.id],
    customerScope: "all",
    selectionMode: "optional",
    requiresCapacity: true,
    status: "enabled",
    version: "1.0",
    createdAt: now,
    updatedAt: now
  };
  await configRepository.upsertService(serviceFact);
  await configRepository.upsertService(serviceFact);
  assert.equal(await prisma.rentalValueAddedServiceVersion.count({ where: { serviceId: serviceFact.id } }), 1,
    "同一内容重放不得创建重复版本");
  await assert.rejects(
    configRepository.upsertService({ ...serviceFact, terms: "禁止原地改写的条款" }),
    /不能原地改写/
  );
  const service = await prisma.rentalValueAddedService.findUnique({ where: { id: serviceFact.id } });
  assert.equal(service.terms, serviceFact.terms, "版本冲突时当前主档也必须随事务回滚");

  const capacity = await capacityService.saveCapacity(tenantId, {
    serviceId: service.id,
    locationId: location.id,
    windowStart: "2048-01-01T00:00:00.000Z",
    windowEnd: "2048-01-01T06:00:00.000Z",
    totalCapacity: 1,
    status: "enabled"
  });
  const serviceSnapshot = snapshot(service, location.id);

  // 1. 报价只检查，不产生预留。
  await capacityService.assertAvailableForQuote(tenantId, [serviceSnapshot]);
  assert.equal(await prisma.rentalServiceReservation.count({ where: { serviceId: service.id } }), 0);
  assert.equal((await prisma.rentalServiceCapacity.findUnique({ where: { id: capacity.id } })).reservedQuantity, 0);

  const orderInput = (order, expiresAt) => ({
    id: order.id,
    serviceSnapshots: [serviceSnapshot],
    reservations: [{ expiresAt }]
  });

  // 2. 外层失败必须回滚容量与流水。
  await assert.rejects(
    prisma.$transaction(async (tx) => {
      await capacityService.reserveForOrder(tenantId, orderInput(orders[0], "2048-01-01T00:10:00.000Z"), `${tag}:rollback`, tx);
      throw new Error("inject rollback");
    }),
    /inject rollback/
  );
  assert.equal(await prisma.rentalServiceReservation.count({ where: { serviceId: service.id } }), 0);
  assert.equal((await prisma.rentalServiceCapacity.findUnique({ where: { id: capacity.id } })).reservedQuantity, 0);

  // 3. 两单争抢最后一份容量，最多一单成功。
  const outcomes = await Promise.allSettled(orders.map((order, index) => prisma.$transaction((tx) =>
    capacityService.reserveForOrder(tenantId, orderInput(order, "2048-01-01T00:10:00.000Z"), `${tag}:race:${index}`, tx)
  )));
  assert.equal(outcomes.filter((row) => row.status === "fulfilled").length, 1);
  assert.equal(outcomes.filter((row) => row.status === "rejected").length, 1);
  const winner = outcomes[0].status === "fulfilled" ? orders[0] : orders[1];
  assert.equal((await prisma.rentalServiceCapacity.findUnique({ where: { id: capacity.id } })).reservedQuantity, 1);
  assert.equal(await prisma.rentalServiceReservation.count({ where: { serviceId: service.id, status: "reserved" } }), 1);

  // 4. 确认、重复确认、取消释放均幂等且账相等。
  await prisma.$transaction((tx) => capacityService.confirmForOrder(tenantId, winner.id, new Date().toISOString(), tx));
  await prisma.$transaction((tx) => capacityService.confirmForOrder(tenantId, winner.id, new Date().toISOString(), tx));
  let current = await prisma.rentalServiceCapacity.findUnique({ where: { id: capacity.id } });
  assert.equal(current.reservedQuantity, 0);
  assert.equal(current.usedQuantity, 1);
  await prisma.$transaction((tx) => capacityService.releaseForOrder(tenantId, winner.id, "test_cancel", new Date().toISOString(), tx));
  await prisma.$transaction((tx) => capacityService.releaseForOrder(tenantId, winner.id, "test_cancel", new Date().toISOString(), tx));
  current = await prisma.rentalServiceCapacity.findUnique({ where: { id: capacity.id } });
  assert.equal(current.reservedQuantity, 0);
  assert.equal(current.usedQuantity, 0);

  // 5. 过期软预留惰性释放，随后报价重新可用。
  await prisma.$transaction((tx) => capacityService.reserveForOrder(
    tenantId,
    orderInput(orders[0], new Date(Date.now() - 60_000).toISOString()),
    `${tag}:expires`,
    tx
  ));
  await capacityService.assertAvailableForQuote(tenantId, [serviceSnapshot]);
  assert.equal(await prisma.rentalServiceReservation.count({ where: { serviceId: service.id, status: "expired" } }), 1);
  assert.equal((await prisma.rentalServiceCapacity.findUnique({ where: { id: capacity.id } })).reservedQuantity, 0);

  // 6. 履约转换只改流水状态，不重复移动容量计数。
  await prisma.$transaction((tx) => capacityService.reserveForOrder(
    tenantId,
    orderInput(orders[0], "2048-01-01T00:10:00.000Z"),
    `${tag}:used`,
    tx
  ));
  await prisma.$transaction(async (tx) => {
    await capacityService.confirmForOrder(tenantId, orders[0].id, new Date().toISOString(), tx);
    await capacityService.markUsedForOrder(tenantId, orders[0].id, new Date().toISOString(), tx);
  });
  assert.equal(await prisma.rentalServiceReservation.count({ where: { serviceId: service.id, status: "used" } }), 1);
  current = await prisma.rentalServiceCapacity.findUnique({ where: { id: capacity.id } });
  assert.equal(current.usedQuantity, 1);

  await prisma.rentalServiceReservation.deleteMany({ where: { serviceId: service.id } });
  await prisma.rentalServiceCapacity.deleteMany({ where: { serviceId: service.id } });
  await prisma.rentalValueAddedServiceVersion.deleteMany({ where: { serviceId: service.id } });
  await prisma.rentalValueAddedService.delete({ where: { id: service.id } });
  await prisma.rentalOrder.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.$disconnect();
  console.log("MKT-02B 服务容量真库专项：报价不预占、事务回滚、并发、确认、释放、超时与履约均通过");
})().catch(async (error) => {
  console.error(error);
  if (prisma) await prisma.$disconnect();
  process.exit(1);
});
