"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { prepareCategoryAdoptionRecords } = require("../apps/api/dist/modules/rental-core/category-adoption-records.js");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
target.businessModel.assetFields = [
  { scope: "item_group", code: "categoryKey", label: "新型号资料", type: "select", options: ["B"], required: true, unique: true },
  { scope: "asset", code: "serialNo", label: "序列号", type: "string", required: true, unique: true },
  { scope: "asset", code: "condition", label: "成色", type: "select", options: ["good"], required: true }
];
const updatedAt = new Date("2026-09-30T00:00:00.000Z");
const groups = [{ id: "g", updatedAt, inventoryMode: "SERIALIZED", attributes: { categoryKey: "A", oldField: "保留历史", __itemGroupMedia: { images: [] } } }];
const assets = [{ id: "a", updatedAt, serialNo: "SN1", attributes: { condition: "old", retired: "不删除" } }];
const patches = [
  { entityType: "item_group", entityId: "g", expectedUpdatedAt: updatedAt.toISOString(), values: { categoryKey: "B" } },
  { entityType: "asset", entityId: "a", expectedUpdatedAt: updatedAt.toISOString(), values: { condition: "good", serialNo: "SN2" } }
];
const original = structuredClone({ target, groups, assets, patches });
const result = prepareCategoryAdoptionRecords(target, groups, assets, patches);
assert.equal(result.itemGroups[0].attributes.categoryKey, "B");
assert.equal(result.itemGroups[0].attributes.oldField, "保留历史");
assert.equal(result.assets[0].attributes.retired, "不删除");
assert.equal(result.assets[0].serialNo, "SN2");
assert.equal(result.assetClaims[0].normalizedValue, "SN2");
assert.deepEqual({ target, groups, assets, patches }, original, "准备阶段不能改变当前营业事实或补丁输入");
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, []), /允许选项/);
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [{ ...patches[0], expectedUpdatedAt: "2026-09-29T00:00:00.000Z" }, patches[1]]), /已修改/);
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [{ ...patches[0], expectedUpdatedAt: "2026-02-30T00:00:00.000Z" }, patches[1]]), /格式不合法/);
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [patches[0], { ...patches[1], values: { condition: "good", serialNo: 123 } }]), /必须是文本/);
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [{ ...patches[0], entityId: "outside" }, patches[1]]));
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [...patches, patches[0]]), /重复/);
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [{ ...patches[0], values: { oldField: "绕过" } }]), /未定义/);
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [{ ...patches[0], values: { categoryKey: null } }]), /只能/);
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, assets, [{ ...patches[0], values: { categoryKey: { script: "bad" } } }]), /只能/);
const duplicates = [...groups, { ...groups[0], id: "g2", attributes: { categoryKey: "B" } }];
assert.throws(() => prepareCategoryAdoptionRecords(target, duplicates, assets, patches), /已存在/);
const late = [...assets, { id: "late", updatedAt, serialNo: "SN2", attributes: { condition: "good" } }];
assert.throws(() => prepareCategoryAdoptionRecords(target, groups, late, patches), /已存在/, "最终复核必须包含准备后新增的实体");
console.log("category-adoption-records: 候选枚举/必填补齐、来源修订、唯一冲突、跨实体拒绝及保留历史/媒体资料通过");
