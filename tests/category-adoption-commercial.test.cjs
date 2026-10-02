"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS, RENTAL_CAPABILITY_MODULES } = require("@rental-os/shared");
const { CATEGORY_COMMERCIAL_REQUIREMENTS: registry, categoryCommercialRequirements: plan, categoryCommercialCompatibility: check } = require("../apps/api/dist/modules/rental-core/category-adoption-commercial.js");
for (const definition of RENTAL_CAPABILITY_MODULES) assert.ok(Object.hasOwn(registry, definition.code), "新能力必须明确登记商业依赖");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const baseline = plan(target, []);
assert.equal(baseline.valid, true); assert.deepEqual(baseline.featureCodes, []);
assert.equal(check("camera", baseline, { newBusinessAllowed: true, entitlements: [] }).valid, true);
assert.equal(check("camera", baseline, { newBusinessAllowed: false, entitlements: [] }).valid, false);
assert.equal(plan(target, [{ code: "unregistered", status: "enabled" }]).valid, false);
assert.equal(plan(target, [{ code: "unregistered", status: "disabled" }]).valid, true);
const paidRegistry = { ...registry, camera_compatibility: ["fixture_existing_feature"] };
const optionalTarget = { ...target, requiredCapabilities: target.requiredCapabilities.filter((code) => code !== "camera_compatibility") };
assert.deepEqual(plan(optionalTarget, [], paidRegistry).featureCodes, [], "只声明但未启用的可选能力不得要求购买");
const requirements = plan(target, [{ code: "camera_compatibility", status: "enabled" }], paidRegistry);
assert.deepEqual(requirements.featureCodes, ["fixture_existing_feature"]);
for (const entitlements of [[], [{ code: "fixture_existing_feature", available: false, categories: [] }], [{ code: "fixture_existing_feature", available: true, categories: ["vehicle"] }]]) {
  assert.equal(check("camera", requirements, { newBusinessAllowed: true, entitlements }).valid, false);
}
const context = { newBusinessAllowed: true, entitlements: [{ code: "fixture_existing_feature", available: true, categories: ["camera"] }] };
const before = structuredClone(context);
assert.equal(check("camera", requirements, context).valid, true);
assert.equal(check("camera", requirements, { ...context, entitlements: [...context.entitlements, ...context.entitlements] }).valid, false);
assert.deepEqual(context, before);
assert.equal(plan(target, [{ code: "camera_compatibility", status: "enabled" }], { ...paidRegistry, camera_compatibility: [" "] }).valid, false);
console.log("category-adoption-commercial: 现有收费口径、未登记拒绝、显式依赖、期限/交付/范围及无办理副作用通过");
