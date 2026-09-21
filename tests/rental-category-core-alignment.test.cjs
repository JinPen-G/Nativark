const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");
require("reflect-metadata");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { plainToInstance } = require("class-transformer");
const { validate } = require("class-validator");
const {
  RENTAL_CATEGORY_DEFINITIONS,
  RENTAL_CORE_CAPABILITY_CODES,
  RENTAL_CAPABILITY_MODULES,
  RENTAL_LOCATION_TYPES
} = require("@rental-os/shared");
const {
  SaveRentalFulfillmentLocationDto
} = require("../apps/api/src/modules/rental-core/rental-core-request.dto");

void (async () => {
  assert.equal(RENTAL_CATEGORY_DEFINITIONS.length, 4, "首批必须登记四个经营品类");
  assert.ok(
    RENTAL_CATEGORY_DEFINITIONS.every((category) => category.requiredCapabilities.length === 0),
    "四品类基础营业不得被尚未启用的品类扩展模块阻断"
  );
  const coreCodes = new Set(RENTAL_CORE_CAPABILITY_CODES);
  assert.ok(
    ["delivery", "usage_reading", "qualification", "inspection_care"].every((code) =>
      coreCodes.has(code) && RENTAL_CAPABILITY_MODULES.find((module) => module.code === code)?.implementationVersion === "core-1.0"
    ),
    "配送、使用量、资质与检查养护必须明确由 Rental Core 提供"
  );
  assert.equal(
    RENTAL_CAPABILITY_MODULES.find((module) => module.code === "vehicle_relocation")?.kind,
    "category_optional",
    "车辆异地归还调度不得成为车辆空间基础营业门槛"
  );
  assert.equal(
    RENTAL_CATEGORY_DEFINITIONS.find((category) => category.code === "vehicle").terminology.navigationLabels.pricingGroups,
    "车辆定价分组",
    "车辆空间必须沿用 品类+定价分组 的统一模块命名"
  );
  assert.ok(
    RENTAL_CATEGORY_DEFINITIONS.every((category) =>
      category.businessModel.locationTypes.every((type) => RENTAL_LOCATION_TYPES.includes(type))
    ),
    "四品类地点类型必须全部来自共享契约"
  );

  for (const type of RENTAL_LOCATION_TYPES) {
    const input = plainToInstance(SaveRentalFulfillmentLocationDto, {
      code: `LOC_${type}`,
      name: type,
      type,
      capabilities: ["pickup", "return"],
      status: "enabled"
    });
    assert.deepEqual(await validate(input), [], `共享地点类型 ${type} 必须通过 API DTO 校验`);
  }

  for (const legacyType of ["pickup_point", "delivery_point", "parking"]) {
    const input = plainToInstance(SaveRentalFulfillmentLocationDto, {
      code: `LEGACY_${legacyType}`,
      name: legacyType,
      type: legacyType,
      capabilities: ["pickup", "return"],
      status: "enabled"
    });
    assert.ok(
      (await validate(input)).some((error) => error.property === "type"),
      `旧地点类型 ${legacyType} 必须被拒绝`
    );
  }

  const genericUiFiles = [
    "apps/admin/src/features/catalog/CatalogPage.tsx",
    "apps/admin/src/features/catalog/AssetWorkspacePage.tsx",
    "apps/admin/src/features/commercial/PricingGroupPage.tsx",
    "apps/admin/src/features/fulfillment/LocationPage.tsx"
  ].map((file) => readFileSync(join(__dirname, "..", file), "utf8")).join("\n");
  for (const vehicleOnlyText of ["舒适轿车组", "车牌/VIN", "具体单车", "车行、摄影合作商"]) {
    assert.ok(!genericUiFiles.includes(vehicleOnlyText), `通用页面不得写死车辆文案：${vehicleOnlyText}`);
  }

  const categorySettingsUi = readFileSync(
    join(__dirname, "..", "apps/admin/src/features/settings/governance/CategoryTab.tsx"),
    "utf8"
  );
  assert.ok(
    categorySettingsUi.includes("category.businessModel.pricingUnits.map"),
    "经营设置的计价单位必须来自当前品类定义"
  );
  assert.ok(
    categorySettingsUi.includes("category.businessModel.fulfillmentModes.map"),
    "经营设置的履约方式必须来自当前品类定义"
  );
  assert.ok(
    genericUiFiles.includes("category?.supportedInventoryModes.map"),
    "商品型号的库存形态必须来自当前品类定义"
  );
  assert.ok(
    genericUiFiles.includes("category?.businessModel.locationTypes.map"),
    "履约地点类型必须来自当前品类定义"
  );

  const genericPermissionSources = [
    "apps/admin/src/features/catalog/CatalogPage.tsx",
    "apps/admin/src/features/catalog/AssetWorkspacePage.tsx",
    "apps/api/src/common/api-auth.guard.ts",
    "apps/api/src/contracts/openapi-document.ts"
  ].map((file) => readFileSync(join(__dirname, "..", file), "utf8")).join("\n");
  for (const legacyPermission of [
    "rental-os:vehicle-group:manage",
    "rental-os:vehicle:view",
    "rental-os:vehicle:manage"
  ]) {
    assert.ok(
      !genericPermissionSources.includes(legacyPermission),
      `Rental Core 通用页面与 API 不得继续接受旧车辆权限：${legacyPermission}`
    );
  }

  const permissionMigration = readFileSync(
    join(__dirname, "..", "apps/api/prisma/migrations/20260920233000_migrate_vehicle_permissions_to_rental_core/migration.sql"),
    "utf8"
  );
  for (const targetPermission of [
    "rental-core:catalog:view",
    "rental-core:catalog:manage",
    "rental-core:asset:view",
    "rental-core:asset:manage"
  ]) {
    assert.ok(permissionMigration.includes(targetPermission), `存量角色迁移必须补授 ${targetPermission}`);
  }
  const platformRepository = readFileSync(
    join(__dirname, "..", "apps/api/src/modules/platform/platform.repository.ts"),
    "utf8"
  );
  assert.ok(
    platformRepository.includes("DEPRECATED_RENTAL_PERMISSION_CODES.has(permission.code)"),
    "数据库权限树必须隐藏旧车辆权限"
  );
  assert.ok(
    platformRepository.includes("normalizePermissionCodes"),
    "角色保存与读回必须把旧车辆权限转换为 Rental Core 新权限"
  );

  console.log("Rental category core alignment checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
