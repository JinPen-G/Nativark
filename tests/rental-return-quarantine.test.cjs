const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

// Codex review #8a：带异常归还时，数量库存直接回到可用池，下一单就能把坏的租出去。
//
// 修复前 createInspection 的异常分支只有一行——把本批 assetChanges 全部置 Maintenance，
// 那只作用于序列化资产。数量库存（inventoryMode = quantity）的预占一释放，可用量立刻恢复，
// 系统完全不知道刚还回来的两件里有坏的。
//
// 修复后同一批归还的数量库存进 maintenanceQuantity 隔离（StockQuarantineChange），
// 与序列化资产的一刀切同口径：异常不带商品标识，宁可多隔离等人工核减。
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { RentalCoreOrderStatus, RentalInventoryMode, RentalReservationStatus, RentalAssetStatus } = require("@rental-os/shared");

let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };

const ITEM_GROUPS = [
  { id: "group_q", inventoryMode: RentalInventoryMode.Quantity },
  { id: "group_q2", inventoryMode: RentalInventoryMode.Quantity },
  { id: "group_s", inventoryMode: RentalInventoryMode.Serialized }
];

const TEMPLATE = { id: "tpl_return", code: "return", version: "1", stage: "return", enabled: true, fields: [] };

const orderFixture = (returnBufferMinutes = 0) => ({
  id: "order_1",
  tenantId: "tenant_1",
  orderNo: "SO-1",
  status: RentalCoreOrderStatus.Renting,
  fulfillmentLocationId: "loc_1",
  ruleSnapshot: { fulfillment: { returnBufferMinutes } },
  reservations: [
    { id: "res_q", orderLineId: "line_q", itemGroupId: "group_q", locationId: "loc_1", quantity: 2, releasedQuantity: 0, status: RentalReservationStatus.Fulfilled },
    { id: "res_s", orderLineId: "line_s", itemGroupId: "group_s", locationId: "loc_1", quantity: 1, releasedQuantity: 0, status: RentalReservationStatus.Fulfilled }
  ],
  allocations: [
    { id: "alloc_q", orderLineId: "line_q", itemGroupId: "group_q", quantity: 2, status: "picked_up" },
    { id: "alloc_s", orderLineId: "line_s", itemGroupId: "group_s", assetId: "asset_1", quantity: 1, status: "picked_up" }
  ],
  chargeLines: [], payableAmount: 100, adjustmentAmount: 0, finalPayableAmount: 100
});

/** 用打桩依赖跑真实的 createInspection，断言落库时带上了隔离量。 */
function serviceWith(order) {
  const captured = {};
  const instance = Object.create(RentalCoreService.prototype);
  instance.state = () => ({
    profile: { categoryCode: "camera" },
    inspectionTemplates: [TEMPLATE],
    itemGroups: ITEM_GROUPS
  });
  instance.lockedOrder = async () => order;
  instance.getWorkspaceCategory = async () => require('@rental-os/shared').RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'camera');
  instance.assertOrderFulfillmentAdmission = async () => {};
  instance.runHook = async () => {};
  instance.orderHookInstances = () => undefined;
  instance.factStore = {
    listInspections: async () => [],
    listAssets: async () => [],
    listExtensions: async () => [],
    cancelExtensions: async () => {},
    upsertStockDisposition: async () => {},
    insertInspection: async (record) => { captured.inspection = record; },
    saveOrderAggregate: async (_order, assetChanges, _tx, stockQuarantines) => {
      captured.assetChanges = assetChanges;
      captured.stockQuarantines = stockQuarantines;
    }
  };
  return { instance, captured };
}

const returnInspection = (exceptions) => ({ templateId: TEMPLATE.id, results: {}, ...(exceptions ? { exceptions } : {}) });

/** 直接验证隔离量的推导：私有方法不依赖 this，可以脱离实例调用。 */
const quarantineOf = (reservations, releasedBefore) =>
  RentalCoreService.prototype.quarantinedReturnQuantities.call(
    { hasReturnHold: RentalCoreService.prototype.hasReturnHold },
    { itemGroups: ITEM_GROUPS },
    { reservations, fulfillmentLocationId: "loc_1", ruleSnapshot: { fulfillment: { returnBufferMinutes: 15 } } },
    new Map(releasedBefore)
  ).map(({ itemGroupId, locationId, quantity }) => ({ itemGroupId, locationId, quantity }));

/**
 * 仓储层的假 Prisma 事务客户端。
 *
 * 上面几条都把 saveOrderAggregate 整个打桩了，于是仓储里真正执行隔离的那段
 * （workspaceId 作用域、increment 载荷、匹配不到行时的 fail-closed）一行都没跑到。
 * 这里换成真实的 RentalCoreFactRepository，只把 Prisma 换成假的。
 */
function fakeTx(stockUpdateCount) {
  const stockUpdates = [];
  const noop = async () => ({});
  const findNone = async () => null;
  return {
    stockUpdates,
    businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
    // 仓储在写回前会先核对既有事实的租户/空间/订单归属；
    // 这个夹具只验证隔离增量，因此模拟“所有事实都是本次新写入”。
    rentalOrder: { findUnique: findNone, create: noop, update: noop },
    rentalOrderLine: { findUnique: findNone, create: noop, update: noop },
    rentalReservation: { findUnique: findNone, create: noop, update: noop },
    rentalAllocation: { deleteMany: async () => ({ count: 0 }), findUnique: findNone, create: noop },
    rentalAsset: { updateMany: async () => ({ count: 1 }) },
    rentalStockBalance: {
      updateMany: async (args) => { stockUpdates.push(args); return { count: stockUpdateCount }; }
    }
  };
}

/** saveOrderAggregate 会把整张订单写回，因此固化一份字段齐全的最小订单。 */
const persistedOrder = () => ({
  id: "order_1", tenantId: "tenant_1", orderNo: "SO-1", categoryCode: "camera",
  status: RentalCoreOrderStatus.Settling, customerType: "individual", customerName: "客户",
  fulfillmentMode: "self_pickup", fulfillmentLocationId: "loc_1", fulfillmentLocationName: "门店",
  fulfillmentLocationSnapshot: {}, returnLocationSnapshot: null,
  startAt: "2026-09-01T00:00:00.000Z", endAt: "2026-09-02T00:00:00.000Z",
  quoteId: "quote_1", quoteNo: "Q-1", pricingPlanVersion: "1", ruleVersion: "1",
  ruleSnapshot: { fulfillment: {} }, chargeLines: [],
  rentalAmount: 0, discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0,
  depositAmount: 0, preAuthAmount: 0, payableAmount: 0, adjustmentAmount: 0, finalPayableAmount: 0,
  totalAmount: 0, createdBy: "运营", createdAt: "2026-09-01T00:00:00.000Z",
  lines: [], reservations: [], allocations: []
});

const repository = () => new RentalCoreFactRepository({});

/** 盘点写入走 this.prisma.$transaction，且先 lockInventoryTargets（$queryRaw 行锁）。 */
function fakeStockPrisma(existing) {
  const upserts = [];
  const tx = {
    upserts,
    businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
    $queryRaw: async () => [],
    rentalStockBalance: {
      findFirst: async () => existing,
      findUnique: async () => existing ? { tenantId: "tenant_1", workspaceId: "ws_1" } : null,
      update: async (args) => { upserts.push({ where: args.where, update: args.data }); return {}; },
      create: async (args) => { upserts.push({ where: { id: args.data.id }, update: args.data }); return {}; },
      upsert: async (args) => { upserts.push(args); return {}; }
    }
  };
  return { tx, prisma: { $transaction: async (run) => run(tx) } };
}

void (async () => {
  {
    const order = orderFixture();
    order.status = RentalCoreOrderStatus.ReadyForPickup;
    order.allocations.forEach((allocation) => { allocation.status = "locked"; });
    const { instance, captured } = serviceWith(order);
    instance.state = () => ({ profile: { categoryCode: "camera" }, itemGroups: ITEM_GROUPS,
      inspectionTemplates: [{ ...TEMPLATE, stage: "pickup" }] });
    instance.assertOrderQualification = async () => {};
    instance.assertOutboundLocationActive = () => {};
    instance.assertAllocatedPickupReady = async () => {};
    instance.markPickedUp = async () => { order.status = RentalCoreOrderStatus.Renting; };
    await instance.createInspection("tenant_1", order.id, returnInspection([
      { code: "existing-scratch", description: "领取时已有划痕", allocationId: "alloc_s" }
    ]), "operator", {}, {});
    assert.equal(captured.inspection.exceptions[0].allocationId, "alloc_s");
    assert.equal(captured.inspection.stage, "pickup");
    await assert.rejects(() => instance.createInspection("tenant_1", order.id, returnInspection([
      { code: "wrong-resource", description: "无关资源", allocationId: "another-order-allocation" }
    ]), "operator", {}, {}), /订单尚未完成配货/u);
    order.status = RentalCoreOrderStatus.ReadyForPickup;
    await assert.rejects(() => instance.createInspection("tenant_1", order.id, returnInspection([
      { code: "wrong-resource", description: "无关资源", allocationId: "another-order-allocation" }
    ]), "operator", {}, {}), /不属于本次检查批次/u);
    ok("领取检查可关联已锁定资源登记已有损伤，但不能关联其他订单资源");
  }

  {
    const order = orderFixture();
    const { instance, captured } = serviceWith(order);
    const transaction = { name: "inspection-transaction" };
    let receivedTx;
    instance.factStore.listInspections = async (_tenant, _order, tx) => { receivedTx = tx; return []; };
    await instance.createInspection("tenant_1", order.id, returnInspection(), "operator", {}, transaction);
    assert.equal(receivedTx, transaction);
    assert.equal(captured.inspection.stage, "return");
    ok("归还检查在同一订单事务读取领取基线");
  }

/* ---------- 带异常整单归还：数量库存必须进隔离 ---------- */

{
  const { instance, captured } = serviceWith(orderFixture());
  await instance.createInspection("tenant_1", "order_1", returnInspection([{ code: "scratch", description: "机身划伤" }]), "检查员");
  assert.deepEqual(captured.stockQuarantines.map(({ itemGroupId, locationId, quantity }) => ({ itemGroupId, locationId, quantity })), [{ itemGroupId: "group_q", locationId: "loc_1", quantity: 2 }],
    "本批归还的数量库存必须按 itemGroup + 地点进维修隔离");
  ok("带异常整单归还时数量库存进维修隔离——修复前这里是 undefined，数量直接回可用池");
}

/* ---------- 多行订单异常必须能定位到本次归还的具体分配项 ---------- */

{
  const { instance, captured } = serviceWith(orderFixture());
  await instance.createInspection("tenant_1", "order_1", returnInspection([{ code: "scratch", description: "镜头划伤", allocationId: "alloc_s" }]), "检查员");
  assert.equal(captured.inspection.exceptions[0].allocationId, "alloc_s", "异常记录必须保留具体分配项标识");
  assert.deepEqual(captured.stockQuarantines, [], "明确定位到序列资产的异常不能隔离正常数量库存");
  assert.equal(captured.assetChanges[0].status, RentalAssetStatus.Maintenance);
  ok("多行归还异常保留具体分配项，费用审核和养护链可以继续追溯资源");
}

{
  const { instance, captured } = serviceWith(orderFixture());
  await instance.createInspection("tenant_1", "order_1", returnInspection([{ code: "damage", description: "数量批次损坏", allocationId: "alloc_q" }]), "检查员");
  assert.equal(captured.assetChanges[0].status, RentalAssetStatus.Available, "数量库存的异常不能隔离无异常的独立资产");
  assert.equal(captured.stockQuarantines[0].quantity, 2);
  ok("明确定位到数量库存的异常只隔离对应批次，正常独立资产恢复可用");
}

{
  const { instance } = serviceWith(orderFixture());
  await assert.rejects(
    () => instance.createInspection("tenant_1", "order_1", returnInspection([{ code: "scratch", description: "越界资源", allocationId: "alloc_other" }]), "检查员"),
    /异常关联的分配项不属于本次检查批次/u,
    "异常不能关联订单外或未在本次归还的分配项"
  );
  ok("异常关联分配项必须属于本订单当前归还批次");
}

/* ---------- 序列化资产仍然置维护，且不重复按数量隔离 ---------- */

{
  const { instance, captured } = serviceWith(orderFixture());
  await instance.createInspection("tenant_1", "order_1", returnInspection([{ code: "scratch", description: "机身划伤" }]), "检查员");
  assert.deepEqual(captured.assetChanges, [{ assetId: "asset_1", status: RentalAssetStatus.Maintenance, locationId: "loc_1" }],
    "序列化资产的既有一刀切行为不能被改掉");
  assert.equal(captured.stockQuarantines.some((row) => row.itemGroupId === "group_s"), false,
    "序列化分组已经靠资产状态隔离，再按数量隔离一次就是同一件货扣两遍");
  ok("序列化资产照旧进维护，且不会被数量隔离重复扣减");
}

/* ---------- 无异常归还：不隔离 ---------- */

{
  const { instance, captured } = serviceWith(orderFixture());
  await instance.createInspection("tenant_1", "order_1", returnInspection(), "检查员");
  assert.deepEqual(captured.stockQuarantines, [], "没有异常就没有隔离依据，数量必须正常回可用池");
  ok("无异常归还不隔离任何数量");
}

/* ---------- 分批归还成功后必须释放操作锁 ---------- */

{
  const order = orderFixture();
  order.assignment = {
    revision: 4,
    operationLock: {
      ownerId: "operator_1",
      ownerName: "运营",
      token: "lock-token",
      expiresAt: "2099-01-01T00:00:00.000Z"
    }
  };
  const { instance } = serviceWith(order);
  await instance.createInspection("tenant_1", "order_1", {
    ...returnInspection(),
    returnItems: [{ allocationId: "alloc_q", quantity: 1 }],
    returnBatchNo: "batch-1"
  }, "检查员");
  assert.equal(order.assignment.operationLock, undefined,
    "分批归还检查成功后必须清掉订单操作锁，否则下一批归还会被旧凭证阻断");
  ok("分批归还检查成功后释放操作锁，下一批可重新办理");
}

/* ---------- 正常归还的周转缓冲也必须暂时阻止再次出租 ---------- */

{
  const { instance, captured } = serviceWith(orderFixture(30));
  await instance.createInspection("tenant_1", "order_1", returnInspection(), "检查员");
  assert.deepEqual(captured.stockQuarantines.map(({ itemGroupId, locationId, quantity }) => ({ itemGroupId, locationId, quantity })), [{ itemGroupId: "group_q", locationId: "loc_1", quantity: 2 }],
    "正常归还的周转缓冲期间，数量库存也必须暂时从可用池隔离");
  assert.deepEqual(captured.assetChanges, [{ assetId: "asset_1", status: RentalAssetStatus.Maintenance, locationId: "loc_1" }],
    "正常归还的周转缓冲期间，序列化资产必须暂时保持维护状态");
  ok("周转缓冲期间数量与序列化库存都不可再次出租");
}

/* ---------- 分批归还只隔离本批增量 ---------- */

{
  const reservations = [{ id: "res_q", itemGroupId: "group_q", locationId: "loc_1", quantity: 3, releasedQuantity: 3 }];
  assert.deepEqual(quarantineOf(reservations, [["res_q", 1]]), [{ itemGroupId: "group_q", locationId: "loc_1", quantity: 2 }],
    "已释放 1 件的前提下再还 2 件，只能隔离本批的 2 件");
  ok("分批归还按 releasedQuantity 增量隔离，不会把前几批已回池的数量再隔离一遍");
}

/* ---------- 同一分组同一地点的多条预占合并 ---------- */

{
  const reservations = [
    { id: "a", itemGroupId: "group_q", locationId: "loc_1", quantity: 1, releasedQuantity: 1 },
    { id: "b", itemGroupId: "group_q", locationId: "loc_1", quantity: 2, releasedQuantity: 2 },
    { id: "c", itemGroupId: "group_q", locationId: "loc_2", quantity: 1, releasedQuantity: 1 },
    { id: "d", itemGroupId: "group_q2", locationId: "loc_1", quantity: 4, releasedQuantity: 0 }
  ];
  assert.deepEqual(quarantineOf(reservations, []), [
    { itemGroupId: "group_q", locationId: "loc_1", quantity: 1 },
    { itemGroupId: "group_q", locationId: "loc_1", quantity: 2 },
    { itemGroupId: "group_q", locationId: "loc_1", quantity: 1 }
  ], "只处理已释放数量；各预占分别留来源，但都以实际归还地点为准");
  ok("多条预占逐笔保留隔离来源，未释放数量不参与，归还地点统一为实收地点");
}

/* ---------- 仓储层：隔离真的落成 maintenanceQuantity 增量 ---------- */
function fakeMaintenanceTx({ balance = { id: "stock_1", onHandQuantity: 5, maintenanceQuantity: 1 }, updateCount = 1 } = {}) {
  const updates = [];
  const ledgerEntries = [];
  return {
    updates, ledgerEntries,
    businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
    $queryRaw: async () => balance ? [balance] : [],
    rentalReservation: { findMany: async () => [] },
    rentalStockBalance: { updateMany: async (args) => { updates.push(args); return { count: updateCount }; } },
    rentalStockLedgerEntry: {
      findFirst: async () => null,
      create: async ({ data }) => { ledgerEntries.push(data); return data; }
    }
  };
}

{
  const tx = fakeMaintenanceTx();
  const change = { itemGroupId: "group_q", locationId: "loc_1", quantity: 2, idempotencyKey: "quarantine-1", sourceOrderId: "order_1", sourceOrderNo: "SO-1", sourceInspectionId: "inspection_1", sourceDispositionId: "disp_1", batchNo: "batch-1", reason: "异常隔离", operator: "检查员" };
  await repository().applyStockMaintenanceDelta(tx, "tenant_1", "ws_1", change, 2, "maintenance_quarantine");
  assert.equal(tx.updates.length, 1, "隔离必须更新维修量余额");
  assert.deepEqual(tx.updates[0].where, { id: "stock_1", tenantId: "tenant_1", workspaceId: "ws_1", maintenanceQuantity: 1 }, "更新必须受租户、空间及旧维修量约束");
  assert.deepEqual(tx.updates[0].data, { maintenanceQuantity: 3 }, "隔离按锁定余额计算，不得使用无条件 increment");
  assert.equal(tx.ledgerEntries.length, 1, "余额变更必须同步写入一条台账流水");
  assert.equal(tx.ledgerEntries[0].maintenanceDelta, 2);
  assert.equal(tx.ledgerEntries[0].sourceOrderId, "order_1");
  assert.equal(tx.ledgerEntries[0].sourceInspectionId, "inspection_1");
  assert.equal(tx.ledgerEntries[0].sourceDispositionId, "disp_1");
  assert.equal(tx.ledgerEntries[0].operator, "检查员");
  ok("数量库存隔离写入带租户空间作用域的余额及订单/检查/处置来源流水");
}

/* ---------- 仓储层：匹配不到余额行必须 fail-closed ---------- */

{
  const tx = fakeMaintenanceTx({ balance: null });
  const change = { itemGroupId: "group_q", locationId: "loc_1", quantity: 1, idempotencyKey: "quarantine-missing", sourceOrderId: "order_1", sourceOrderNo: "SO-1", batchNo: "batch-1", reason: "异常隔离", operator: "检查员" };
  await assert.rejects(() => repository().applyStockMaintenanceDelta(tx, "tenant_1", "ws_1", change, 1, "maintenance_quarantine"), /没有库存台账，无法记录维修隔离变更/u);
  assert.equal(tx.ledgerEntries.length, 0);
  ok("没有库存余额时隔离 fail-closed，不留下孤立流水");
}

/* ---------- 仓储层：非正数隔离量跳过，不发无意义的写 ---------- */

{
  const tx = fakeMaintenanceTx({ updateCount: 0 });
  const change = { itemGroupId: "group_q", locationId: "loc_1", quantity: 1, idempotencyKey: "quarantine-race", sourceOrderId: "order_1", sourceOrderNo: "SO-1", batchNo: "batch-1", reason: "异常隔离", operator: "检查员" };
  await assert.rejects(() => repository().applyStockMaintenanceDelta(tx, "tenant_1", "ws_1", change, 1, "maintenance_quarantine"), /维修隔离量已变化/u);
  assert.equal(tx.ledgerEntries.length, 0, "余额 CAS 失败时不能落流水");
  ok("并发余额条件更新失败时不写隔离流水，整笔事务回滚");
}

/* ---------- 盘点写入不得静默解除隔离 ---------- */

{
  // 隔离量记在 maintenanceQuantity 上，而盘点表单也写这一列。表单只报在手数量时，
  // 旧实现 `input.maintenanceQuantity ?? 0` 会把隔离清零——一次例行盘点顺手把坏货放回可用池。
  const { prisma, tx } = fakeStockPrisma({ id: "stock_1", maintenanceQuantity: 2 });
  const saved = await new RentalCoreFactRepository(prisma).applyStockCount({
    id: "stock_new", tenantId: "tenant_1", itemGroupId: "group_q", locationId: "loc_1", onHandQuantity: 5
  });
  assert.equal(saved.maintenanceQuantity, 2, "省略维修量时必须保留库里现值");
  assert.equal(tx.upserts[0].update.maintenanceQuantity, 2, "落库值同样是现值，不是 0");
  assert.equal(tx.upserts[0].where.id, "stock_1", "已存在的余额行必须沿用库里 id，不能 upsert 出第二行");
  ok("盘点只报在手数量时保留隔离量——修复前这里被清零，隔离被静默解除");
}

{
  const { prisma, tx } = fakeStockPrisma({ id: "stock_1", maintenanceQuantity: 2 });
  await assert.rejects(() => new RentalCoreFactRepository(prisma).applyStockCount({
    id: "stock_new", tenantId: "tenant_1", itemGroupId: "group_q", locationId: "loc_1",
    onHandQuantity: 5, maintenanceQuantity: 0
  }), /维修隔离量不能通过盘点直接修改/u);
  assert.equal(tx.upserts.length, 0, "拒绝绕过来源流水后不得写库存余额");
  ok("盘点不能通过显式填 0 绕过处置流水释放维修隔离");
}

{
  const { prisma } = fakeStockPrisma({ id: "stock_1", maintenanceQuantity: 4 });
  await assert.rejects(
    () => new RentalCoreFactRepository(prisma).applyStockCount({
      id: "stock_new", tenantId: "tenant_1", itemGroupId: "group_q", locationId: "loc_1", onHandQuantity: 3
    }),
    /超过在手数量/u,
    "在手数量兜不住隔离量时必须拒绝"
  );
  ok("在手数量下调到低于隔离量时明确拒绝，而不是把维修量截断（截断等于释放隔离）");
}

console.log(`\n归还异常库存隔离专项：${passed} 项全部通过`);

})();
