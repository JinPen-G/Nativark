"use strict";
const assert = require("node:assert/strict");
const { categoryAdoptionFulfillmentReferences: check } = require("../apps/api/dist/modules/rental-core/category-adoption-fulfillment-references.js");
const input = { operators: [{ id: "op", status: "disabled" }], locations: [
  { id: "parent", status: "disabled", operatorId: null, parentLocationId: null, capabilities: null },
  { id: "l", status: "enabled", operatorId: "op", parentLocationId: "parent", capabilities: ["pickup", "return"] }
] };
const before = structuredClone(input);
assert.equal(check(input).valid, true, "停用运营方/父地点不等于结构错误，不自动改变经营状态");
for (const patch of [{ operatorId: null }, { operatorId: "foreign" }, { parentLocationId: "l" },
  { parentLocationId: "foreign" }, { capabilities: [] }, { capabilities: {} }, { capabilities: ["onsite"] }, { capabilities: ["pickup "] }]) {
  const candidate = structuredClone(input); Object.assign(candidate.locations[1], patch);
  assert.equal(check(candidate).valid, false, JSON.stringify(patch));
}
assert.deepEqual(input, before);
assert.equal(check({ operators: [], locations: [] }).valid, true, "空空间由开业配置检查，不冒充采用完整性");
assert.equal(check(input).complete, false);
console.log("category-adoption-fulfillment-references: 关联/能力拒绝、停用配置保留、只读通过");
