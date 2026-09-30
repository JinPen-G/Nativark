"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { categoryAdoptionCapabilityReferences: check } = require("../apps/api/dist/modules/rental-core/category-adoption-references.js");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
target.businessModel.assetFields = [
  { code: "mount", scope: "item_group", type: "select", label: "卡口", options: ["RF"] },
  { code: "serialNo", scope: "asset", type: "string", label: "序列号" },
  { code: "capacity", scope: "item_group", type: "number", label: "容量" },
  { code: "assetFit", scope: "asset", type: "string", label: "适配" }
];
const records = { groups: [{ id: "g1" }], assets: [{ id: "a1" }] };
const relation = { id: "r1", source: { kind: "item_group", id: "g1" }, target: { kind: "asset", id: "a1" } };
const instance = { code: "camera_compatibility", status: "enabled", config: { relations: [relation] } };
const run = (patch) => check(target, [{ ...instance, config: { relations: [{ ...relation, ...patch }] } }], records);
assert.equal(run({}).valid, true);
assert.equal(run({ source: { kind: "item_group", id: "other-space-group" } }).valid, false);
assert.equal(run({ target: { kind: "asset", id: "other-tenant-asset" } }).valid, false);
assert.equal(run({ target: { kind: "attribute", field: "mount", value: "RF" } }).valid, true);
assert.equal(run({ target: { kind: "attribute", field: "mount", value: "EF" } }).valid, false);
assert.equal(run({ target: { kind: "attribute", field: "retired", value: "RF" } }).valid, false);
assert.equal(run({ target: { kind: "attribute", field: "serialNo", value: "SN1" } }).valid, false);
assert.equal(run({ target: { kind: "attribute", field: "assetFit", value: "RF" } }).valid, true, "配货兼容性会合并资产属性，不能误禁资产字段");
assert.equal(run({ target: { kind: "attribute", field: "capacity", value: "1" } }).valid, false, "当前执行器仅匹配文本值，不能承诺数值关系可用");
assert.equal(check(target, [{ ...instance, config: { relations: [null] } }], records).valid, false);
assert.equal(check(target, [{ ...instance, config: { relations: {} } }], records).valid, false);
assert.equal(check(target, [{ ...instance, status: "disabled", config: { relations: [null] } }], records).valid, true);
assert.equal(run({}).complete, false);
assert.deepEqual(instance.config.relations, [relation]);
console.log("category-adoption-references: 空间内型号/资产、当前型号属性与枚举、退役与畸形引用拒绝，不改写配置通过");
