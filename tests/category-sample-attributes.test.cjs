"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { buildRentalCategorySamples } = require("../apps/api/dist/modules/rental-core/rental-category-samples.js");
const { prepareRentalCategoryUniqueClaims } = require("../apps/api/dist/modules/rental-core/rental-category-attributes.js");
for (const definition of RENTAL_CATEGORY_DEFINITIONS) {
  const samples = buildRentalCategorySamples({ tenantId: "test", idPrefix: "sample", categoryCode: definition.code, location: { id: "location", name: "演示地点" }, timestamp: "2026-09-30T00:00:00.000Z" });
  const groups = samples.itemGroups.map((row) => ({ id: row.id, attributes: row.attributes, validateRequired: row.inventoryMode !== "bundle" }));
  const assets = samples.assets.map((row) => ({ id: row.id, attributes: row.attributes, aliases: definition.businessModel.assetFields.some((field) => field.scope === "asset" && field.code === "serialNo") ? { serialNo: row.serialNo } : {} }));
  assert.doesNotThrow(() => prepareRentalCategoryUniqueClaims(definition.businessModel.assetFields, "item_group", groups), `${definition.code} 型号样本必须符合真实声明`);
  assert.doesNotThrow(() => prepareRentalCategoryUniqueClaims(definition.businessModel.assetFields, "asset", assets), `${definition.code} 资产样本必须符合真实声明`);
  for (const group of samples.itemGroups) {
    assert.ok(definition.supportedInventoryModes.includes(group.inventoryMode));
    if (group.attributes.ratedLoad !== undefined) assert.ok(["kg", "t"].includes(group.attributes.ratedLoadUnit));
  }
}
console.log("category-sample-attributes: 四品类型号/资产字段、枚举、必填、唯一及载荷单位校验通过");
