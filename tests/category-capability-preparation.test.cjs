"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { WorkspaceCapabilityService } = require("../apps/api/dist/modules/rental-core/workspace-capability.service.js");
const service = new WorkspaceCapabilityService({});
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const instance = { code: "camera_compatibility", status: "enabled", revision: 7, implementationVersion: "cam-1.0", configVersion: "v3", config: { relations: [] } };
const relation = { id: "r", relationType: "model_fit", source: { kind: "item_group", id: "g" }, target: { kind: "asset", id: "a" }, outcome: "warn", sourceName: "source", reason: "reason" };
const patch = { code: instance.code, expectedRevision: 7, expectedImplementationVersion: "cam-1.0", config: { relations: [relation] } };
const hooks = ["camera_compatibility@cam-1.0"];
const input = structuredClone({ target, instance, patch });
const result = service.prepareAdoptionConfigs(target, [instance], [patch], hooks);
assert.deepEqual(result[0].config.relations, [relation]);
for (const key of ["status", "revision", "implementationVersion", "configVersion"]) assert.equal(result[0][key], instance[key]);
assert.deepEqual({ target, instance, patch }, input, "候选投影不得改活动配置或输入");
for (const change of [{ expectedRevision: 6 }, { expectedImplementationVersion: "missing" }, { code: "vehicle_driving_license" }]) {
  assert.throws(() => service.prepareAdoptionConfigs(target, [instance], [{ ...patch, ...change }], hooks), /已变化|不存在/);
}
for (const config of [null, [], { arbitrary: true }, { relations: [{ ...relation, outcome: "execute_script" }] }]) {
  assert.throws(() => service.prepareAdoptionConfigs(target, [instance], [{ ...patch, config }], hooks));
}
for (const patches of [null, [patch, patch], [{ ...patch, status: "enabled" }], [{ ...patch, expectedRevision: 0 }], Array(101).fill(patch)]) {
  assert.throws(() => service.prepareAdoptionConfigs(target, [instance], patches, hooks));
}
assert.throws(() => service.prepareAdoptionConfigs(target, [{ ...instance, status: "paused" }], [patch], hooks), /未启用/);
assert.throws(() => service.prepareAdoptionConfigs({ ...target, code: "vehicle" }, [instance], [patch], hooks), /目标品类/);
assert.throws(() => service.prepareAdoptionConfigs(target, [{ ...instance, implementationVersion: "missing" }], [{ ...patch, expectedImplementationVersion: "missing" }], hooks), /不可执行/);
const legacy = { ...instance, implementationVersion: "previous" };
assert.equal(service.prepareAdoptionConfigs(target, [legacy], [{ ...patch, expectedImplementationVersion: "previous" }], [...hooks, "camera_compatibility@previous"])[0].implementationVersion, "previous");
console.log("category-capability-preparation: 真实配置结构、来源修订/实现、跨品类/未启用/重复拒绝、只读投影及历史实现保留通过");
