"use strict";
const assert = require("node:assert/strict");
const { randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const { validateActiveCategoryWrite } = require("../apps/api/dist/modules/rental-core/category-active-write.js");
if (!/^rental_os_e2e_/u.test(new URL(process.env.DATABASE_URL).pathname.slice(1))) throw new Error("仅允许专用 E2E 库");
const db = new PrismaClient();
const fixture = `catwrite_${randomUUID()}`;
const workspaceId = fixture;
const versionId = `${fixture}_v2`;
const repo = new RentalCoreConfigRepository(db);
const context = (fn) => runWithRequestIdentity({ tenantId: "tenant_001", workspaceId }, fn);
(async () => {
  try {
    const baseline = await db.rentalCategoryDefinition.findUniqueOrThrow({ where: { code: "CAMERA" } });
    const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
    definition.businessModel.assetFields = [
      { code: "identity", scope: "item_group", label: "型号身份", type: "string", required: true, unique: true },
      { code: "serialNo", scope: "asset", label: "序列号", type: "string", required: true, unique: true }
    ];
    await db.rentalCategoryVersion.create({ data: { id: versionId, categoryCode: "CAMERA", versionLabel: fixture, sourceKind: "test", status: "published", structureVersion: 1, definition } });
    await db.businessWorkspace.create({ data: { id: workspaceId, tenantId: "tenant_001", code: fixture, name: "并发写入专用空间", categoryCode: "CAMERA", categoryVersionId: baseline.recommendedVersionId, defaultMarker: fixture } });
    const oldBinding = { categoryVersionId: baseline.recommendedVersionId, adoptionRevision: 0 };
    const input = { id: `${fixture}_g1`, tenantId: "tenant_001", categoryCode: "camera", code: "G1", name: "专项型号", inventoryMode: "serialized", unit: "件", attributes: { identity: " abc " }, status: "enabled", bundleComponents: [], createdAt: new Date().toISOString() };
    // Deliberately minimal repository fixtures, not a claim of usable business settings.
    const settings = { tenantId: "tenant_001", categoryCode: "camera", configVersion: "fixture", pricing: { enabledUnits: ["hour"], defaultUnit: "hour", holidayPricingEnabled: false }, calendar: { holidayPricingEnabled: false }, fulfillment: { enabledModes: ["store_pickup_return"] } };
    const location = { id: `${fixture}_location`, tenantId: "tenant_001", code: "L", name: "专项地点", type: "store", status: "enabled", capabilities: ["pickup", "return"] };
    // Hold the exact lock used by active writes, then switch while an old request is waiting.
    let locked; const ready = new Promise((resolve) => { locked = resolve; });
    let unlock; const release = new Promise((resolve) => { unlock = resolve; });
    const switching = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM business_workspaces WHERE id = ${workspaceId} FOR UPDATE`;
      locked(); await release;
      await tx.businessWorkspace.update({ where: { id: workspaceId }, data: { categoryVersionId: versionId, categoryAdoptionRevision: 1 } });
    });
    await ready;
    const stale = context(() => repo.upsertItemGroup(input, undefined, [], oldBinding));
    const rejected = assert.rejects(stale, /版本已变化/);
    const staleSettings = assert.rejects(context(() => repo.upsertBusinessSettings(settings, "fixture", undefined, oldBinding)), /版本已变化/);
    const staleLocation = assert.rejects(context(() => repo.upsertLocation(location, undefined, oldBinding)), /版本已变化/);
    unlock(); await switching; await Promise.all([rejected, staleSettings, staleLocation]);
    assert.equal(await db.rentalItemGroup.count({ where: { workspaceId } }), 0, "旧请求不能在切换后写入");
    assert.equal(await db.rentalTenantBusinessSettings.count({ where: { workspaceId } }), 0);
    assert.equal(await db.rentalFulfillmentLocation.count({ where: { workspaceId } }), 0);
    const currentBinding = { categoryVersionId: versionId, adoptionRevision: 1 };
    await context(() => repo.upsertBusinessSettings(settings, "fixture", undefined, currentBinding));
    await assert.rejects(context(() => repo.upsertBusinessSettings({ ...settings, pricing: { enabledUnits: ["shift"], defaultUnit: "shift" } }, "fixture")), /不支持/);
    assert.deepEqual((await db.rentalTenantBusinessSettings.findUnique({ where: { workspaceId } })).settings.pricing.enabledUnits, ["hour"], "被拒绝的设置不能覆盖已提交事实");
    await context(() => repo.upsertLocation(location, undefined, currentBinding));
    await assert.rejects(context(() => repo.upsertLocation({ ...location, type: "project_site" })), /不支持/);
    assert.equal((await db.rentalFulfillmentLocation.findUnique({ where: { id: location.id } })).type, "store");
    await assert.rejects(context(() => repo.upsertItemGroup({ ...input, attributes: {} }, undefined, [])), /不能为空/);
    await context(() => repo.upsertItemGroup(input, undefined, []));
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: { workspaceId, entityId: input.id } }), 1, "调用方给空声明也必须按当前版本建立唯一声明");
    const duplicate = { ...input, id: `${fixture}_g2`, code: "G2", attributes: { identity: "ＡＢＣ" } };
    await assert.rejects(context(() => repo.upsertItemGroup(duplicate, undefined, [])), /已存在/);
    assert.equal(await db.rentalItemGroup.count({ where: { workspaceId } }), 1);
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "DEF" } }));
    await context(() => repo.upsertItemGroup(duplicate));
    assert.equal(await db.rentalAttributeUniqueValue.count({ where: { workspaceId } }), 2, "改值应释放旧唯一声明");
    await assert.rejects(db.$transaction((tx) => validateActiveCategoryWrite(tx, "tenant_001", workspaceId, { id: "a", scope: "asset", attributes: {} })), /不能为空/);
    const assetClaims = await db.$transaction((tx) => validateActiveCategoryWrite(tx, "tenant_001", workspaceId, { id: "a", scope: "asset", serialNo: " SN1 ", attributes: {} }));
    assert.equal(assetClaims.claims[0].normalizedValue, "SN1");
    await db.rentalItemGroup.update({ where: { id: input.id }, data: { attributes: { identity: "DEF", retiredProof: { original: true } } } });
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI" } }));
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes, { identity: "GHI", retiredProof: { original: true } });
    await assert.rejects(context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI", retiredProof: null } })), /不可修改/);
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes.retiredProof, { original: true });
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI", __itemGroupMedia: { images: ["new"] } } }, undefined, undefined, undefined, true));
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes.__itemGroupMedia, { images: ["new"] }, "受控上传写穿到库");
    await context(() => repo.upsertItemGroup({ ...input, attributes: { identity: "GHI", __itemGroupMedia: { images: ["stale"] } } }));
    assert.deepEqual((await db.rentalItemGroup.findUnique({ where: { id: input.id } })).attributes.__itemGroupMedia, { images: ["new"] }, "普通资料保存不能覆盖最新图片");
    console.log("category-active-write-db: 锁竞争后型号/设置/地点旧请求拒绝、当前定义复核与拒绝无改写、唯一声明及媒体边界通过");
  } finally {
    await db.businessWorkspace.deleteMany({ where: { id: workspaceId } });
    await db.rentalCategoryVersion.deleteMany({ where: { id: versionId } });
    await db.$disconnect();
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
