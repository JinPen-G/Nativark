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

  console.log("Rental category core alignment checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
