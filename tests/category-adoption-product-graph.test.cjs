"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { categoryAdoptionProductGraph: check } = require("../apps/api/dist/modules/rental-core/category-adoption-product-graph.js");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const group = { id: "g", status: "enabled", inventoryMode: "SERIALIZED", bundleComponents: [] };
const bundle = { id: "b", status: "enabled", inventoryMode: "BUNDLE", bundleComponents: [{ componentItemGroupId: "g", quantity: 1 }] };
const pricing = { id: "p", status: "enabled", defaultPricingUnit: "hour", members: [{ itemGroupId: "g" }] };
const input = { groups: [group, bundle], assets: [{ id: "a", itemGroupId: "g", locationId: "l" }], locations: [{ id: "l" }], pricingGroups: [pricing] };
assert.equal(check(target, input).valid, true);
for (const override of [{ defaultPricingUnit: "shift" }, { members: [] }, { members: [pricing.members[0], pricing.members[0]] }, { members: [{ itemGroupId: "foreign" }] }]) {
  assert.equal(check(target, { ...input, pricingGroups: [{ ...pricing, ...override }] }).valid, false);
  assert.equal(check(target, { ...input, pricingGroups: [{ ...pricing, ...override, status: "disabled" }] }).valid, true);
}
for (const defaultPricingUnit of [null, "hour"]) assert.equal(check(target, { ...input, pricingGroups: [{ ...pricing, defaultPricingUnit }] }).valid, true);
for (const asset of [{ ...input.assets[0], itemGroupId: "foreign" }, { ...input.assets[0], locationId: "foreign" }]) assert.deepEqual(check(target, { ...input, assets: [asset] }).blockers.map((row) => row.domain), ["asset_reference"]);
for (const bundleComponents of [[], [{ componentItemGroupId: "foreign", quantity: 1 }], [{ componentItemGroupId: "b", quantity: 1 }], [{ componentItemGroupId: "g", quantity: 0 }], [{ componentItemGroupId: "g", quantity: 1.5 }], [bundle.bundleComponents[0], bundle.bundleComponents[0]], [{ ...bundle.bundleComponents[0], optional: true }], [{ ...bundle.bundleComponents[0], substitutionGroup: "solo" }]]) {
  const bad = { ...input, groups: [group, { ...bundle, bundleComponents }] }, before = structuredClone(bad);
  assert.deepEqual(check(target, bad).blockers.map((row) => row.domain), ["bundle_reference"]);
  assert.deepEqual(bad, before);
  assert.equal(check(target, { ...bad, groups: [group, { ...bundle, bundleComponents, status: "disabled" }] }).valid, true);
}
assert.equal(check(target, { ...input, groups: [group, bundle, { ...bundle, id: "nested", bundleComponents: [{ componentItemGroupId: "b", quantity: 1 }] }] }).valid, false);
assert.equal(check(target, { ...input, groups: [{ ...group, inventoryMode: "QUANTITY" }, bundle] }).valid, false, "数量型号不能关联独立资产");
assert.equal(check(target, { ...input, groups: [{ ...group, bundleComponents: [{ componentItemGroupId: "b", quantity: 1 }] }, bundle] }).valid, false, "非套装型号不能配置组成");
const second = { ...group, id: "g2" };
const substitutes = [
  { componentItemGroupId: "g", quantity: 1, optional: false, substitutionGroup: "body" },
  { componentItemGroupId: "g2", quantity: 1, optional: true, substitutionGroup: "body" }
];
assert.equal(check(target, { ...input, groups: [group, second, { ...bundle, bundleComponents: substitutes }] }).valid, true);
assert.equal(check(target, { ...input, groups: [group, second, { ...bundle, bundleComponents: substitutes.map((row, index) => ({ ...row, substitutionGroup: index ? "body " : "body" })) }] }).valid, false, "不允许通过去空白把两个存量替代组码合并");
for (const optional of [true, false]) {
  const bad = { ...input, groups: [group, second, { ...bundle, bundleComponents: substitutes.map((row) => ({ ...row, optional })) }] };
  const frozen = structuredClone(bad);
  assert.deepEqual(check(target, bad).blockers.map((row) => row.domain), ["bundle_reference"], "替代组必须有且只有一个默认项");
  assert.deepEqual(bad, frozen);
}
assert.equal(check(target, input).complete, false);
console.log("category-adoption-product-graph: 分组非空/唯一成员、资产序列化关联、套装非空/替代组/自身/嵌套/数量/重复及历史保留通过");
