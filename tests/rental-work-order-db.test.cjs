const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");

const root = require("node:path").resolve(__dirname, "..");
const fs = require("node:fs");
const envFile = require("node:path").join(root, ".env");
const fileEnv = {};
if (fs.existsSync(envFile)) {
  for (const raw of fs.readFileSync(envFile, "utf8").split(/\r?\n/u)) {
    const line = raw.trim();
    const separator = line.indexOf("=");
    if (separator > 0 && !line.startsWith("#")) fileEnv[line.slice(0, separator)] = line.slice(separator + 1).trim().replace(/^(["'])(.*)\1$/u, "$2");
  }
}
const databaseUrl = process.env.DATABASE_URL || fileEnv.DATABASE_URL;
assert.ok(databaseUrl, "必须提供专用 DATABASE_URL");
const databaseName = new URL(databaseUrl).pathname.slice(1);
assert.match(databaseName, /^rental_os_claude(?:_dedicated_work_order_\d+)?$/u, "工单真库专项只能运行在专用库");
process.env.DATABASE_URL = databaseUrl;

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { PrismaService } = require("../apps/api/src/modules/database/prisma.service");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");

const prisma = new PrismaService();
const facts = new RentalCoreFactRepository(prisma);
const created = { orderId: undefined, dispositionId: undefined, workOrderId: undefined, tenantId: undefined, workspaceId: undefined, stockId: undefined, stockCreated: false, quantity: 1 };
let maintenanceAdded = false;
let restored = false;
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS ${message}`); };

void (async () => {
  try {
    const balanceCandidate = await prisma.rentalStockBalance.findFirst({
      where: { itemGroup: { inventoryMode: "QUANTITY" } },
      include: { itemGroup: true, location: true }
    });
    const itemGroup = balanceCandidate?.itemGroup || await prisma.rentalItemGroup.findFirst({ where: { inventoryMode: "QUANTITY" } });
    assert.ok(itemGroup, "专用库需要一个数量库存商品作为工单底稿");
    const location = balanceCandidate?.location || await prisma.rentalFulfillmentLocation.findFirst({ where: { tenantId: itemGroup.tenantId, workspaceId: itemGroup.workspaceId } });
    assert.ok(location, "专用库需要一个与数量库存商品同空间的履约地点");
    let balance = balanceCandidate;
    if (!balance) {
      balance = await prisma.rentalStockBalance.findUnique({
        where: { workspaceId_itemGroupId_locationId: { workspaceId: itemGroup.workspaceId, itemGroupId: itemGroup.id, locationId: location.id } }
      });
    }
    if (!balance) {
      balance = await prisma.rentalStockBalance.create({
        data: {
          id: `wo_db_stock_${randomUUID()}`,
          tenantId: itemGroup.tenantId,
          workspaceId: itemGroup.workspaceId,
          itemGroupId: itemGroup.id,
          locationId: location.id,
          onHandQuantity: 10,
          reservedQuantity: 0,
          maintenanceQuantity: 0
        }
      });
      created.stockCreated = true;
    }

    created.tenantId = itemGroup.tenantId;
    created.workspaceId = itemGroup.workspaceId;
    created.stockId = balance.id;
    created.orderId = `wo_db_order_${randomUUID()}`;
    created.dispositionId = `wo_db_disp_${randomUUID()}`;
    created.workOrderId = `wo_db_${randomUUID()}`;
    const now = new Date();

    await prisma.rentalOrder.create({
      data: {
        id: created.orderId,
        tenantId: created.tenantId,
        workspaceId: created.workspaceId,
        orderNo: `WO-DB-ORDER-${randomUUID().slice(0, 8).toUpperCase()}`,
        categoryCode: itemGroup.categoryCode,
        status: "RENTING",
        customerType: "individual",
        customerName: "工单真库验收客户",
        contactPhone: "13800000000",
        fulfillmentMode: "pickup",
        fulfillmentLocationId: location.id,
        fulfillmentLocationName: location.name,
        startAt: new Date(now.getTime() - 86_400_000),
        endAt: new Date(now.getTime() + 86_400_000),
        quoteId: `wo_db_quote_${randomUUID()}`,
        quoteNo: `WO-DB-QUOTE-${randomUUID().slice(0, 8).toUpperCase()}`,
        pricingPlanVersion: "v1.0",
        ruleVersion: "v1.0",
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
        createdBy: "work-order-db-test"
      }
    });
    await prisma.rentalOrderLine.create({
      data: {
        id: `wo_db_line_${randomUUID()}`,
        orderId: created.orderId,
        itemGroupId: itemGroup.id,
        itemGroupCode: itemGroup.code,
        itemGroupName: itemGroup.name,
        inventoryMode: itemGroup.inventoryMode,
        quantity: created.quantity,
        unitPrice: 0,
        amount: 0
      }
    });

    await prisma.rentalStockDisposition.create({
      data: {
        id: created.dispositionId,
        tenantId: created.tenantId,
        workspaceId: created.workspaceId,
        orderId: created.orderId,
        returnBatchKey: `wo-db-batch-${randomUUID()}`,
        dedupeKey: `wo-db-dedupe-${randomUUID()}`,
        itemGroupId: balance.itemGroupId,
        locationId: balance.locationId,
        quantity: created.quantity,
        receivedAt: now,
        bufferUntil: new Date(now.getTime() - 60_000),
        status: "blocked",
        blockReason: "真库工单验收测试",
        restoredQuantity: 0
      }
    });
    await prisma.rentalStockBalance.update({
      where: { id: created.stockId },
      data: { maintenanceQuantity: { increment: created.quantity } }
    });
    maintenanceAdded = true;

    await runWithRequestIdentity({ tenantId: created.tenantId, userId: "work-order-db-test", workspaceId: created.workspaceId }, async () => {
      const workOrder = await facts.upsertWorkOrder({
        id: created.workOrderId,
        tenantId: created.tenantId,
        workspaceId: created.workspaceId,
        workNo: `WO-DB-${randomUUID().slice(0, 8).toUpperCase()}`,
        type: "repair",
        status: "pending",
        dispositionId: created.dispositionId,
        orderId: created.orderId,
        itemGroupId: balance.itemGroupId,
        locationId: balance.locationId,
        quantity: created.quantity,
        reason: "真库工单验收测试",
        attachments: [],
        createdBy: "真库测试",
        createdAt: now.toISOString(),
        updatedAt: now.toISOString()
      });
      assert.equal(workOrder.status, "pending");
      const replayed = await facts.upsertWorkOrder({
        ...workOrder,
        id: `duplicate-${randomUUID()}`,
        workNo: `WO-DUP-${randomUUID().slice(0, 8).toUpperCase()}`
      });
      assert.equal(replayed.id, created.workOrderId, "同一处置与工单类型重复创建必须回放原工单");
      ok("真库创建工单并按处置+类型幂等回放");

      const started = await facts.transitionWorkOrder(created.tenantId, created.workOrderId, "start", "真库测试");
      assert.equal(started.status, "in_progress");
      const submitted = await facts.transitionWorkOrder(created.tenantId, created.workOrderId, "submit", "真库测试", { result: "已完成维修", attachments: ["file://evidence"] });
      assert.equal(submitted.status, "pending_review");
      ok("真库工单按处理中→待验收推进并保存结果证据");

      const reviewed = await facts.transitionWorkOrder(created.tenantId, created.workOrderId, "review", "真库主管", { decision: "approved", reason: "复核通过" });
      assert.equal(reviewed.status, "completed");
      const buffered = await prisma.rentalStockDisposition.findUniqueOrThrow({ where: { id: created.dispositionId }, select: { status: true, blockReason: true } });
      assert.equal(buffered.status, "buffered");
      assert.equal(buffered.blockReason, null);
      ok("真库验收通过同时解除异常阻断并保留周转缓冲状态");

      const restoredRow = await facts.restoreStockDisposition(created.tenantId, created.dispositionId, "真库主管");
      assert.equal(restoredRow.status, "restored");
      assert.equal(restoredRow.restoredQuantity, created.quantity);
      restored = true;
      const balanceAfter = await prisma.rentalStockBalance.findUniqueOrThrow({ where: { id: created.stockId }, select: { maintenanceQuantity: true } });
      assert.equal(balanceAfter.maintenanceQuantity, balance.maintenanceQuantity);
      ok("真库受控恢复扣回维护量并将处置标记为已恢复");
    });

    console.log(`\n养护工单真库专项：${passed} 项全部通过`);
  } finally {
    if (created.workOrderId) await prisma.rentalWorkOrder.deleteMany({ where: { id: created.workOrderId } });
    if (created.dispositionId) await prisma.rentalStockDisposition.deleteMany({ where: { id: created.dispositionId } });
    if (maintenanceAdded && !restored && created.stockId) {
      await prisma.rentalStockBalance.updateMany({ where: { id: created.stockId, maintenanceQuantity: { gte: created.quantity } }, data: { maintenanceQuantity: { decrement: created.quantity } } });
    }
    if (created.stockCreated && created.stockId) await prisma.rentalStockBalance.deleteMany({ where: { id: created.stockId } });
    if (created.orderId) await prisma.rentalOrder.deleteMany({ where: { id: created.orderId } });
    if (created.workOrderId) {
      const logs = await prisma.operationLog.findMany({ where: { tenantId: created.tenantId, workspaceId: created.workspaceId, action: { startsWith: "rental.work_order." } }, select: { id: true, detail: true } });
      const logIds = logs.filter((row) => row.detail && typeof row.detail === "object" && row.detail.workOrderId === created.workOrderId).map((row) => row.id);
      if (logIds.length) await prisma.operationLog.deleteMany({ where: { id: { in: logIds } } });
    }
    await prisma.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
