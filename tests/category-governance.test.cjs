"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS, CATEGORY_GOVERNANCE_PERMISSIONS: P } = require("@rental-os/shared");
const { patchCategorySection, assertCategoryGovernancePermission } = require("../apps/api/dist/modules/rental-core/category-governance.service.js");
const { categoryScopeAllows } = require("../apps/api/dist/modules/rental-core/category-governance-policy.js");
const definition = RENTAL_CATEGORY_DEFINITIONS[0];
const before = structuredClone(definition);
const changed = patchCategorySection(definition, "basic", { name: "独立保存" });
assert.equal(changed.name, "独立保存");
assert.deepEqual(changed.businessModel, definition.businessModel);
assert.deepEqual(definition, before, "编辑不能修改源对象");
for (const values of [{ code: "vehicle" }, { pricingUnits: ["hour"] }, { name: null }, {}, { name: "x".repeat(256 * 1024) }]) {
  assert.throws(() => patchCategorySection(definition, "basic", values));
}
assert.throws(() => patchCategorySection(definition, "basic", JSON.parse('{"terminology":{"__proto__":{"polluted":true}}}')));
assert.equal({}.polluted, undefined);
assert.throws(() => assertCategoryGovernancePermission({ isSaasAdmin: false, permissions: ["*"] }, P.view));
assert.throws(() => assertCategoryGovernancePermission({ isSaasAdmin: true, permissions: [P.view] }, P.publish));
assert.doesNotThrow(() => assertCategoryGovernancePermission({ isSaasAdmin: true, permissions: [P.edit] }, P.edit));
assert.equal(categoryScopeAllows("all", [], "tenant-a"), true);
assert.equal(categoryScopeAllows("pilot", ["tenant-a"], "tenant-a"), true);
for (const scope of ["pilot", "none", "stopped", "unopened", "garbage"]) assert.equal(categoryScopeAllows(scope, [], "tenant-a"), false);
console.log("category-governance: 分页签边界、不可变源对象、权限分离、安全输入与开放范围通过");
