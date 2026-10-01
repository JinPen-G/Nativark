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
for (const override of [{ defaultPricingUnit: "shift" }, { members: [{ itemGroupId: "foreign" }] }]) {
  assert.equal(check(target, { ...input, pricingGroups: [{ ...pricing, ...override }] }).valid, false);
  assert.equal(check(target, { ...input, pricingGroups: [{ ...pricing, ...override, status: "disabled" }] }).valid, true);
}
for (const defaultPricingUnit of [null, "hour"]) assert.equal(check(target, { ...input, pricingGroups: [{ ...pricing, defaultPricingUnit }] }).valid, true);
for (const asset of [{ ...input.assets[0], itemGroupId: "foreign" }, { ...input.assets[0], locationId: "foreign" }]) assert.deepEqual(check(target, { ...input, assets: [asset] }).blockers.map((row) => row.domain), ["asset_reference"]);
for (const bundleComponents of [[{ componentItemGroupId: "foreign", quantity: 1 }], [{ componentItemGroupId: "b", quantity: 1 }], [{ componentItemGroupId: "g", quantity: 0 }], [{ componentItemGroupId: "g", quantity: 1.5 }], [bundle.bundleComponents[0], bundle.bundleComponents[0]]]) {
  const bad = { ...input, groups: [group, { ...bundle, bundleComponents }] }, before = structuredClone(bad);
  assert.deepEqual(check(target, bad).blockers.map((row) => row.domain), ["bundle_reference"]);
  assert.deepEqual(bad, before);
  assert.equal(check(target, { ...bad, groups: [group, { ...bundle, bundleComponents, status: "disabled" }] }).valid, true);
}
assert.equal(check(target, { ...input, groups: [group, bundle, { ...bundle, id: "nested", bundleComponents: [{ componentItemGroupId: "b", quantity: 1 }] }] }).valid, false);
assert.equal(check(target, input).complete, false);
console.log("category-adoption-product-graph: 分组单位/成员、资产空间关联、套装自身/嵌套/数量/重复及历史保留通过");
