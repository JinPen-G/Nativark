const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

/**
 * ACCESS-01B 专项：建单商品/定价分组选择器的空间范围。
 *
 * 管理端建单不直接提交某个空间 id，而是读取当前会话空间的商品与定价分组。
 * 这里直接走 RentalCoreService 的实际状态解析与写穿配置路径，验证同租户不同品类
 * 空间不会互相看到对方的商品型号或定价分组，另一租户也不会被带入选择器。
 */
const ROOT = path.resolve(__dirname, "..");
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)
    .filter((line) => line.includes("=") && !line.trim().startsWith("#"))
    .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1).replace(/^"|"$/g, "")])
);
const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
const dbName = new URL(databaseUrl).pathname.slice(1);
if (!/^store_rental_(?:claude(?:_dedicated_access_\d+)?|zcode)$/u.test(dbName)) {
  console.error(`拒绝执行：订单选择器专项只能跑在并行专用库上（claude/zcode），当前指向 ${dbName}`);
  process.exit(1);
}
process.env.DATABASE_URL = databaseUrl;

const { PrismaClient } = require(path.join(ROOT, "node_modules", "@prisma", "client"));
const { runWithRequestIdentity } = require(path.join(ROOT, "apps/api/src/common/request-identity"));
const { RentalCoreService } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core.service"));
const { RentalCoreConfigRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-config.repository"));
const { RentalCoreFactRepository } = require(path.join(ROOT, "apps/api/src/modules/rental-core/rental-core-fact.repository"));

const suffix = Date.now().toString(36);
const tenantA = `t_rs_a_${suffix}`;
const tenantB = `t_rs_b_${suffix}`;
const wsA1 = `ws_rs_a1_${suffix}`;
const wsA2 = `ws_rs_a2_${suffix}`;
const wsB1 = `ws_rs_b1_${suffix}`;

const prisma = new PrismaClient();
const core = new RentalCoreService(new RentalCoreConfigRepository(prisma), new RentalCoreFactRepository(prisma));

async function cleanup() {
  // 定价分组通过成员关联引用产品型号，先清理分组再删租户，避免
  // MySQL 在租户级联删除时先碰到 itemGroupId 外键。
  // 使用本专项保留的 t_rs_ 前缀，失败重跑时也能清掉上一次未完成的夹具。
  await prisma.rentalPricingGroup.deleteMany({ where: { tenantId: { startsWith: "t_rs_" } } });
  await prisma.tenant.deleteMany({ where: { id: { startsWith: "t_rs_" } } });
}

async function seed() {
  await prisma.tenant.createMany({
    data: [
      { id: tenantA, code: `rs-a-${suffix}`, name: "ACCESS-01B 选择器租户 A" },
      { id: tenantB, code: `rs-b-${suffix}`, name: "ACCESS-01B 选择器租户 B" }
    ]
  });
  await prisma.businessWorkspace.createMany({
    data: [
      { id: wsA1, tenantId: tenantA, code: wsA1, name: "摄影空间", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" },
      { id: wsA2, tenantId: tenantA, code: wsA2, name: "车辆空间", categoryCode: "VEHICLE", isDefault: false, defaultMarker: wsA2 },
      { id: wsB1, tenantId: tenantB, code: wsB1, name: "另一租户摄影空间", categoryCode: "CAMERA", isDefault: true, defaultMarker: "default" }
    ]
  });
  await core.registerWorkspace(wsA1, tenantA, "camera");
  await core.registerWorkspace(wsA2, tenantA, "vehicle");
  await core.registerWorkspace(wsB1, tenantB, "camera");
}

async function inWorkspace(tenantId, workspaceId, callback) {
  return runWithRequestIdentity({ tenantId, workspaceId, userId: "access-selector-test" }, callback);
}

async function addCatalog(tenantId, workspaceId, input, pricingCode) {
  return inWorkspace(tenantId, workspaceId, async () => {
    const group = await core.saveItemGroup(tenantId, input);
    const pricingGroup = await core.savePricingGroup(tenantId, {
      code: pricingCode,
      name: `${input.name}定价组`,
      memberItemGroupIds: [group.id],
      defaultPricingUnit: "day_24h",
      status: "enabled"
    });
    return { group, pricingGroup };
  });
}

void (async () => {
  try {
    await cleanup();
    await seed();

    const cameraA = await addCatalog(tenantA, wsA1, {
      code: `CAM-${suffix}`, name: "A空间相机型号", inventoryMode: "serialized", unit: "件",
      attributes: { brand: "A品牌", model: "A相机" }
    }, `PG-CAM-${suffix}`);
    const vehicleA = await addCatalog(tenantA, wsA2, {
      code: `VEH-${suffix}`, name: "A空间车型", inventoryMode: "serialized", unit: "辆",
      attributes: { manufacturer: "A厂牌", brand: "A品牌", model: "A车型" }
    }, `PG-VEH-${suffix}`);
    const cameraB = await addCatalog(tenantB, wsB1, {
      code: `CAM-B-${suffix}`, name: "B空间相机型号", inventoryMode: "serialized", unit: "件",
      attributes: { brand: "B品牌", model: "B相机" }
    }, `PG-CAM-B-${suffix}`);

    const a1 = await inWorkspace(tenantA, wsA1, () => ({
      profile: core.getProfile(tenantA), groups: core.listItemGroups(tenantA), pricingGroups: core.listPricingGroups(tenantA)
    }));
    assert.equal(a1.profile.categoryCode, "camera");
    assert.deepEqual(a1.groups.map((row) => row.id), [cameraA.group.id]);
    assert.deepEqual(a1.pricingGroups.map((row) => row.id), [cameraA.pricingGroup.id]);
    console.log("  ✓ 摄影空间选择器只返回本空间的产品型号和定价分组");

    const a2 = await inWorkspace(tenantA, wsA2, () => ({
      profile: core.getProfile(tenantA), groups: core.listItemGroups(tenantA), pricingGroups: core.listPricingGroups(tenantA)
    }));
    assert.equal(a2.profile.categoryCode, "vehicle");
    assert.deepEqual(a2.groups.map((row) => row.id), [vehicleA.group.id]);
    assert.deepEqual(a2.pricingGroups.map((row) => row.id), [vehicleA.pricingGroup.id]);
    console.log("  ✓ 切换到车辆空间后不会混入摄影空间商品或定价分组");

    const b1 = await inWorkspace(tenantB, wsB1, () => ({
      groups: core.listItemGroups(tenantB), pricingGroups: core.listPricingGroups(tenantB)
    }));
    assert.deepEqual(b1.groups.map((row) => row.id), [cameraB.group.id]);
    assert.deepEqual(b1.pricingGroups.map((row) => row.id), [cameraB.pricingGroup.id]);
    assert.ok(!b1.groups.some((row) => row.id === cameraA.group.id));
    console.log("  ✓ 另一租户的建单选择器不会看到当前租户商品");

    console.log("订单商品选择器空间范围专项：3 项全部通过");
  } finally {
    await cleanup();
    await prisma.$disconnect();
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
