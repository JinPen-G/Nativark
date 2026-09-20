const assert = require("node:assert/strict");
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

  console.log("Rental category core alignment checks passed.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
