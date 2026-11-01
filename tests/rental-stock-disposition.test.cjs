const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };
const order = () => ({
  id: "order_1", orderNo: "R-1", tenantId: "tenant_1", status: "settling",
  fulfillmentLocationId: "loc_a", returnLocationId: "loc_b",
  ruleSnapshot: { fulfillment: { returnBufferMinutes: 60, returnInspectionRequired: false } },
  reservations: [{ id: "res_1", orderLineId: "line_1", itemGroupId: "group_q", locationId: "loc_a", quantity: 2, releasedQuantity: 2 }],
  allocations: []
});
function dispositionStore() {
  const rows = [];
  return {
    rows,
    upsertStockDisposition: async (row) => {
      const index = rows.findIndex((item) => item.dedupeKey === row.dedupeKey);
      if (index >= 0) rows[index] = { ...rows[index], ...row };
      else rows.push(row);
      return rows[index >= 0 ? index : rows.length - 1];
    },
    upsertWorkOrder: async () => {}
  };
}
void (async () => {
  const facts = dispositionStore();
  const service = Object.create(RentalCoreService.prototype);
  service.factStore = facts;
  service.hasReturnHold = RentalCoreService.prototype.hasReturnHold;
  const state = { itemGroups: [{ id: "group_q", inventoryMode: "quantity", attributes: {} }] };
  const identity = { tenantId: "tenant_1", workspaceId: "ws_1" };
  const record = (blockedReason) => runWithRequestIdentity(identity, () => RentalCoreService.prototype.recordReturnDispositions.call(
    service, "tenant_1", state, order(), "inspection_1", "batch_1", new Map([["res_1", 0]]), blockedReason, undefined, "运营"
  ));

  await record(undefined);
  assert.equal(facts.rows.length, 1);
  assert.equal(facts.rows[0].quantity, 2);
  assert.equal(facts.rows[0].status, "buffered");
  assert.equal(facts.rows[0].locationId, "loc_b", "归还处置应记在实际收货地点而非预占地点");
  assert.equal(Date.parse(facts.rows[0].bufferUntil) - Date.parse(facts.rows[0].receivedAt), 60 * 60 * 1000);
  ok("正常异地归还按实收地点及实际收到时间记录周转缓冲处置");

  await record("damage");
  assert.equal(facts.rows.length, 1, "同批重复提交不能生成第二条处置记录");
  assert.equal(facts.rows[0].status, "blocked");
  assert.equal(facts.rows[0].blockReason, "damage");
  ok("同批重试保持幂等，异常归还进入阻断状态");

  const repo = Object.create(RentalCoreFactRepository.prototype);
  repo.prisma = {};
  const original = {
    id: "disp_1", tenantId: "tenant_1", workspaceId: "ws_1", orderId: "order_1", inspectionId: "inspection_1",
    returnBatchKey: "batch_1", itemGroupId: "group_q", locationId: "loc_b", assetId: null,
    quantity: 2, restoredQuantity: 0, receivedAt: new Date("2040-01-01T10:00:00.000Z"),
    bufferUntil: new Date("2020-01-01T00:00:00.000Z"), status: "buffered", blockReason: null,
    restoredAt: null, restoredBy: null, createdAt: new Date("2040-01-01T10:00:00.000Z"), updatedAt: new Date("2040-01-01T10:00:00.000Z")
  };
  let restored = false;
  let maintenanceDelta;
  const tx = {
    $queryRaw: async query => {
      if (/rental_allocations/.test(query.sql)) return [];
      if (/rental_orders/.test(query.sql)) return [{ id: 'order_1', workspaceId: 'ws_1' }];
      if (/rental_stock_dispositions/.test(query.sql)) return [original];
      if (/rental_work_orders/.test(query.sql)) return [];
      throw Error(`Unexpected SQL: ${query.sql}`);
    },
    businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
    rentalStockDisposition: {
      findFirst: async () => restored ? { ...original, status: "restored", restoredQuantity: 2, restoredAt: new Date(), restoredBy: "运营" } : original,
      updateMany: async () => { restored = true; return { count: 1 }; },
      count: async () => 0
    },
    rentalWorkOrder: { count: async () => 0 },
    rentalOrder: { findFirst: async () => ({ orderNo: "R-1" }) }
  };
  repo.applyStockMaintenanceDelta = async (...args) => { maintenanceDelta = args; };
  const restoredResult = await RentalCoreFactRepository.prototype.restoreStockDisposition.call(repo, "tenant_1", "disp_1", "运营", tx);
  assert.equal(restoredResult.status, "restored");
  assert.equal(restoredResult.restoredQuantity, 2);
  assert.equal(maintenanceDelta[1], "tenant_1");
  assert.equal(maintenanceDelta[2], "ws_1");
  assert.equal(maintenanceDelta[3].locationId, "loc_b");
  assert.equal(maintenanceDelta[4], -2);
  assert.equal(maintenanceDelta[5], "maintenance_release");
  ok("缓冲结束后受控恢复通过带来源的维修库存流水释放实收地点隔离量");

  const writeOffRepo = Object.create(RentalCoreFactRepository.prototype);
  const writeOffDisposition = {
    ...original,
    status: "blocked",
    receivedAt: new Date("2040-01-01T10:00:00.000Z"),
    bufferUntil: new Date("2040-01-01T11:00:00.000Z")
  };
  const stockBalance = { id: "stock_1", onHandQuantity: 5, maintenanceQuantity: 2 };
  const writeOffLedger = [];
  const stockBalanceUpdates = [];
  const writeOffTx = {
    businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
    rentalStockDisposition: {
      findFirst: async () => writeOffDisposition,
      updateMany: async ({ data }) => { Object.assign(writeOffDisposition, data); return { count: 1 }; }
    },
    rentalWorkOrder: { count: async () => 0 },
    rentalOrder: { findFirst: async () => ({ orderNo: "R-1" }) },
    rentalStockLedgerEntry: {
      findFirst: async () => writeOffLedger[0] ? { requestFingerprint: writeOffLedger[0].requestFingerprint } : null,
      create: async ({ data }) => { writeOffLedger.push(data); return data; }
    },
    $queryRaw: async () => [stockBalance],
    rentalReservation: { findMany: async () => [] },
    rentalStockBalance: {
      updateMany: async ({ data, ...args }) => {
        stockBalanceUpdates.push({ where: args.where, data });
        Object.assign(stockBalance, data);
        return { count: 1 };
      }
    }
  };
  const writeOffResult = await runWithRequestIdentity(identity, () =>
    RentalCoreFactRepository.prototype.writeOffStockDisposition.call(writeOffRepo, "tenant_1", "disp_1", "无法修复，确认报废", "主管", writeOffTx)
  );
  assert.equal(writeOffResult.status, "written_off");
  assert.deepEqual(stockBalanceUpdates[0].data, { onHandQuantity: 3, maintenanceQuantity: 0 });
  assert.equal(writeOffLedger.length, 1, "核销必须与余额变更同事务落一条唯一流水");
  assert.equal(writeOffLedger[0].quantityDelta, -2);
  assert.equal(writeOffLedger[0].maintenanceDelta, -2);
  assert.equal(writeOffLedger[0].sourceOrderId, "order_1");
  assert.equal(writeOffLedger[0].sourceInspectionId, "inspection_1");
  assert.equal(writeOffLedger[0].sourceDispositionId, "disp_1");
  assert.equal(writeOffLedger[0].reason, "无法修复，确认报废");
  assert.equal(writeOffLedger[0].operator, "主管");
  await runWithRequestIdentity(identity, () =>
    RentalCoreFactRepository.prototype.writeOffStockDisposition.call(writeOffRepo, "tenant_1", "disp_1", "无法修复，确认报废", "主管", writeOffTx)
  );
  assert.equal(writeOffLedger.length, 1, "同原因重试只能命中原核销流水");
  assert.equal(stockBalanceUpdates.length, 1, "同原因重试不能重复扣减在手数量");
  ok("异常隔离的数量库存核销会原子扣减在手/维修量并记录订单、检查、处置、原因和操作人；重试幂等");

  const bufferedTx = {
    businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) },
    rentalStockDisposition: { findFirst: async () => ({ ...writeOffDisposition, status: "buffered" }) }
  };
  await assert.rejects(
    () => runWithRequestIdentity(identity, () =>
      RentalCoreFactRepository.prototype.writeOffStockDisposition.call(writeOffRepo, "tenant_1", "disp_1", "不应核销", "主管", bufferedTx)
    ),
    /仅异常隔离中的数量库存可以核销/u
  );
  ok("正常周转缓冲中的库存不能走异常核销入口");

  console.log(`\n库存处置专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
