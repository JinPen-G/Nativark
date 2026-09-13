const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { ConflictException } = require("@nestjs/common");

const state = {
  workspaceId: "ws_stock_ops",
  balances: new Map([
    ["loc_a", { id: "balance_a", locationId: "loc_a", onHandQuantity: 10, maintenanceQuantity: 2 }],
    ["loc_b", { id: "balance_b", locationId: "loc_b", onHandQuantity: 1, maintenanceQuantity: 0 }]
  ]),
  ledger: []
};

const nested = (row) => ({ ...row, itemGroup: { code: "Q-01", name: "数量商品" }, location: { name: row.locationId === "loc_a" ? "仓 A" : "仓 B" } });
const rawRowsQueue = [["loc_a"], ["loc_a", "loc_b"], ["loc_a"], ["loc_b"]];
const fakeClient = {
  businessWorkspace: { findFirst: async () => ({ id: state.workspaceId }) },
  rentalReservation: { findMany: async () => [] },
  rentalStockBalance: {
    upsert: async ({ where, create }) => {
      if (!state.balances.has(where.workspaceId_itemGroupId_locationId.locationId)) state.balances.set(create.locationId, { id: create.id, locationId: create.locationId, onHandQuantity: 0, maintenanceQuantity: 0 });
      return state.balances.get(where.workspaceId_itemGroupId_locationId.locationId);
    },
    updateMany: async ({ where, data }) => {
      const row = [...state.balances.values()].find((candidate) => candidate.id === where.id && candidate.onHandQuantity === where.onHandQuantity);
      if (!row) return { count: 0 };
      row.onHandQuantity = data.onHandQuantity;
      return { count: 1 };
    }
  },
  rentalStockLedgerEntry: {
    findMany: async ({ where }) => state.ledger.filter((row) => row.tenantId === where.tenantId && row.workspaceId === where.workspaceId && (!where.idempotencyKey || row.idempotencyKey === where.idempotencyKey)).sort((a, b) => a.createdAt - b.createdAt).map(nested),
    create: async ({ data }) => { const row = { ...data, createdAt: new Date(), id: data.id }; state.ledger.push(row); return nested(row); }
  },
  $queryRaw: async () => {
    const requestedLocationIds = rawRowsQueue.shift();
    if (!requestedLocationIds) throw new Error("测试未预期的库存锁行查询");
    return requestedLocationIds.map((locationId) => state.balances.get(locationId)).sort((a, b) => a.locationId.localeCompare(b.locationId));
  }
};

const prisma = { $transaction: async (callback) => callback(fakeClient) };
const facts = new RentalCoreFactRepository(prisma);
const base = { tenantId: "tenant_stock_ops", itemGroupId: "group_q", reason: "盘点来源", operator: "测试员" };
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS ${message}`); };

(async () => {
  const received = await facts.applyStockOperation({ ...base, type: "receive", locationId: "loc_a", quantity: 5, batchNo: "B-2026-01", sourceDocumentNo: "IN-001", idempotencyKey: "receive-1" });
  assert.equal(received.entries[0].quantityDelta, 5);
  assert.equal(received.entries[0].batchNo, "B-2026-01");
  assert.equal(received.entries[0].sourceDocumentNo, "IN-001");
  assert.equal(state.balances.get("loc_a").onHandQuantity, 15);
  ok("入库在同一作业中增加余额并追加前后值流水");

  const replay = await facts.applyStockOperation({ ...base, type: "receive", locationId: "loc_a", quantity: 5, batchNo: "B-2026-01", sourceDocumentNo: "IN-001", idempotencyKey: "receive-1" });
  assert.equal(replay.idempotent, true);
  assert.equal(state.balances.get("loc_a").onHandQuantity, 15);
  ok("相同幂等键重试不重复增加库存");

  await assert.rejects(
    () => facts.applyStockOperation({ ...base, type: "receive", locationId: "loc_a", quantity: 5, batchNo: "B-2026-01", sourceDocumentNo: "IN-002", idempotencyKey: "receive-1" }),
    (error) => error instanceof ConflictException && /另一笔库存作业/u.test(error.message)
  );
  ok("同一幂等键参数变化会拒绝而不是回放错误结果");

  const transferred = await facts.applyStockOperation({ ...base, type: "transfer", fromLocationId: "loc_a", toLocationId: "loc_b", quantity: 4, reason: "调拨单 TO-01", idempotencyKey: "transfer-1" });
  assert.equal(transferred.entries.length, 2);
  assert.equal(state.balances.get("loc_a").onHandQuantity, 11);
  assert.equal(state.balances.get("loc_b").onHandQuantity, 5);
  assert.deepEqual(new Set(transferred.entries.map((entry) => entry.entryKind)), new Set(["out", "in"]));
  ok("地点调拨同时写出库和入库两条流水并保持数量守恒");

  await assert.rejects(
    () => facts.applyStockOperation({ ...base, type: "scrap", locationId: "loc_a", quantity: 10, reason: "报损单 SO-01", idempotencyKey: "scrap-1" }),
    (error) => error instanceof ConflictException && /预占或维护隔离数量/u.test(error.message)
  );
  assert.equal(state.balances.get("loc_a").onHandQuantity, 11);
  ok("报损不能越过维护隔离和已预占数量的安全底线");

  const counted = await facts.applyStockOperation({ ...base, type: "count_adjustment", locationId: "loc_b", actualOnHandQuantity: 7, reason: "月末盘点", idempotencyKey: "count-1" });
  assert.equal(counted.entries[0].quantityDelta, 2);
  assert.equal(state.balances.get("loc_b").onHandQuantity, 7);
  ok("盘点差异按实际盘点数落流水，不直接改写审计历史");
  assert.equal(rawRowsQueue.length, 0);

  console.log(`\n库存日常作业专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
