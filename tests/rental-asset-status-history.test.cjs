const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "vehicle"));
definition.businessModel.assetFields = [{ code: "serialNo", scope: "asset", label: "序列号", type: "string", required: true, unique: true }];

const tenantId = "tenant_status_history";
const workspaceId = "ws_status_history";
const assets = new Map();
const histories = [];

const fakeClient = {
  $queryRaw: async () => [{ categoryCode: "VEHICLE", categoryVersionId: "vehicle_v1", categoryAdoptionRevision: 0, status: "ACTIVE" }],
  rentalCategoryVersion: { findUnique: async () => ({ categoryCode: "VEHICLE", structureVersion: 1, status: "published", definition }) },
  businessWorkspace: { findFirst: async () => ({ id: workspaceId }) },
  rentalAttributeUniqueValue: {
    deleteMany: async () => ({ count: 0 }),
    create: async ({ data }) => data
  },
  rentalAsset: {
    findMany: async ({ where }) => [...assets.values()]
      .filter((row) => row.tenantId === where.tenantId && row.workspaceId === where.workspaceId)
      .map((row) => ({ ...row, itemGroup: { code: "VEHICLE", name: "测试车型" }, location: { name: "测试地点" } })),
    findUnique: async ({ where }) => {
      const row = assets.get(where.id);
      return row ? { tenantId: row.tenantId, workspaceId: row.workspaceId, status: row.status, assetNo: row.assetNo } : null;
    },
    findFirst: async ({ where }) => {
      const row = assets.get(where.id);
      return row && row.tenantId === where.tenantId && row.workspaceId === where.workspaceId
        ? { id: row.id, assetNo: row.assetNo, status: row.status, attributes: row.attributes, serialNo: row.serialNo }
        : null;
    },
    create: async ({ data }) => {
      const row = { ...data, updatedAt: new Date() };
      assets.set(row.id, row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = { ...assets.get(where.id), ...data, updatedAt: new Date() };
      assets.set(row.id, row);
      return row;
    }
  },
  rentalAssetStatusHistory: {
    create: async ({ data }) => {
      const row = { ...data, createdAt: new Date() };
      histories.push(row);
      return row;
    },
    findMany: async ({ where }) => histories
      .filter((row) => row.tenantId === where.tenantId && row.workspaceId === where.workspaceId && row.assetId === where.assetId)
      .sort((a, b) => b.createdAt - a.createdAt)
  }
};

const prisma = { ...fakeClient, $transaction: async (callback, options) => {
  assert.equal(options?.isolationLevel, "ReadCommitted", "资产资料仓储的自建事务应读取锁后最新事实");
  return callback(fakeClient);
} };
const facts = new RentalCoreFactRepository(prisma);
const asset = {
  id: "asset_status_1",
  tenantId,
  itemGroupId: "group_vehicle",
  assetNo: "VH-STATUS-001",
  serialNo: "VIN-STATUS-001",
  locationId: "location_main",
  status: "available",
  attributes: {},
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};

(async () => {
  await facts.upsertAsset(asset, [], { reason: "资产登记", operator: "管理员" });
  assert.equal(histories.length, 1);
  assert.equal(histories[0].fromStatus, null);
  assert.equal(histories[0].toStatus, "AVAILABLE");
  assert.equal(histories[0].source, "onboarding");
  console.log("  PASS 新增序列化资产写入初始状态历史");

  await facts.upsertAsset({ ...asset, status: "reserved", updatedAt: new Date().toISOString() }, [], { reason: "订单预占", operator: "订单服务" });
  assert.equal(histories.length, 2);
  assert.equal(histories[1].fromStatus, "AVAILABLE");
  assert.equal(histories[1].toStatus, "RESERVED");
  assert.equal(histories[1].source, "manual");
  assert.equal(histories[1].reason, "订单预占");
  console.log("  PASS 状态变化写入来源、前后状态、原因和操作人");

  await facts.upsertAsset({ ...asset, status: "reserved", updatedAt: new Date().toISOString() });
  assert.equal(histories.length, 2);
  console.log("  PASS 相同状态更新不会制造重复历史");

  const listed = await facts.listAssetStatusHistory(tenantId, asset.id);
  assert.equal(listed.length, 2);
  assert.equal(listed.some((row) => row.toStatus === "reserved" && row.source === "manual"), true);
  await assert.rejects(() => facts.listAssetStatusHistory("other_tenant", asset.id), /资产不存在或不属于当前经营空间/u);
  console.log("  PASS 查询按租户和经营空间隔离");

  console.log("\n序列化资产状态历史专项：4 项全部通过");
})().catch((error) => { console.error(error); process.exitCode = 1; });
