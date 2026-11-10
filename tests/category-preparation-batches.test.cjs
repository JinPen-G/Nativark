"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { mergeCategoryPreparationBatch, categoryPreparationBatchFingerprint } = require("../apps/api/dist/modules/rental-core/category-preparation-batches.js");
const { prepareCategoryAdoptionRecords } = require("../apps/api/dist/modules/rental-core/category-adoption-records.js");

const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS[0]);
target.businessModel.assetFields = [
  { scope: "asset", code: "code", label: "新编号", type: "string", required: true, unique: true },
  { scope: "asset", code: "condition", label: "状态", type: "select", options: ["good"], required: true }
];
const at = new Date("2026-11-09T00:00:00.000Z");
const assets = ["a", "b"].map(id => ({ id, updatedAt: at, attributes: { historical: "retain" } }));
const records = { groups: [], assets };
const patch = (entityId, values, expectedUpdatedAt = at.toISOString()) => ({ entityType: "asset", entityId, expectedUpdatedAt, values });
const original = structuredClone({ target, records });
const first = mergeCategoryPreparationBatch(target, records, [], [patch("a", { code: "A" })]);
assert.equal(first.length, 1, "missing other required data must not prevent a partial batch from being staged");
assert.throws(() => prepareCategoryAdoptionRecords(target, [], assets, first), /不能为空/, "partial save is not adoption readiness");
const second = mergeCategoryPreparationBatch(target, records, first, [patch("b", { code: "B", condition: "good" }), patch("a", { condition: "good" })]);
assert.equal(second.find(row => row.entityId === "a").values.code, "A", "a later batch must retain earlier fields");
assert.equal(first[0].values.condition, undefined, "merging must not mutate the previous collection");
const completed = prepareCategoryAdoptionRecords(target, [], assets, second);
assert.equal(completed.assetClaims.length, 2);
assert.equal(completed.assets[0].attributes.historical, "retain");
assert.deepEqual({ target, records }, original, "staging must never change active facts or the category definition");

const withdrawn = mergeCategoryPreparationBatch(target, records, second, [], [{ entityType: "asset", entityId: "a", fieldCodes: ["code"] }]);
assert.deepEqual(withdrawn.find(row => row.entityId === "a").values, { condition: "good" });
assert.equal(withdrawn.find(row => row.entityId === "b").values.code, "B");
assert.throws(() => prepareCategoryAdoptionRecords(target, [], assets, withdrawn), /不能为空/);
assert.throws(() => mergeCategoryPreparationBatch(target, records, second, [patch("a", { code: "X" })], [{ entityType: "asset", entityId: "a", fieldCodes: ["code"] }]), /同批不能/);
assert.throws(() => mergeCategoryPreparationBatch(target, records, first, [patch("outside", { code: "X" })]), /当前空间/);
assert.throws(() => mergeCategoryPreparationBatch(target, records, first, [patch("a", { condition: "bad" })]), /允许选项/);
assert.throws(() => mergeCategoryPreparationBatch(target, records, first, [patch("a", { historical: "overwrite" })]), /未定义/);
assert.throws(() => mergeCategoryPreparationBatch(target, records, first, [patch("a", { code: "A" }), patch("a", { code: "B" })]), /重复/);
assert.throws(() => mergeCategoryPreparationBatch(target, records, first, [patch("a", JSON.parse('{"__proto__":"pollute"}'))]), /安全编码/);
const moved = { groups: [], assets: assets.map(row => ({ ...row, updatedAt: new Date("2026-11-09T01:00:00.000Z") })) };
assert.throws(() => mergeCategoryPreparationBatch(target, moved, first, [patch("a", { condition: "good" })]), /来源实体已修改/);
assert.throws(() => mergeCategoryPreparationBatch(target, moved, first, [patch("a", { condition: "good" }, moved.assets[0].updatedAt.toISOString())]), /旧修订/);

const duplicate = mergeCategoryPreparationBatch(target, records, second, [patch("b", { code: "A" })]);
assert.throws(() => prepareCategoryAdoptionRecords(target, [], assets, duplicate), /已存在/, "the final collection check must still reject unique collisions");
const many = Array.from({ length: 1001 }, (_, i) => ({ id: `a${i}`, updatedAt: at, attributes: {} }));
const largeRecords = { groups: [], assets: many };
const largeFirst = mergeCategoryPreparationBatch(target, largeRecords, [], many.slice(0, 1000).map(row => patch(row.id, { code: row.id, condition: "good" })));
const largeSecond = mergeCategoryPreparationBatch(target, largeRecords, largeFirst, [patch(many[1000].id, { code: many[1000].id, condition: "good" })]);
assert.equal(largeSecond.length, 1001, "a staged collection may grow across independently bounded batches");
assert.equal(prepareCategoryAdoptionRecords(target, [], many, largeSecond, "collection").assetClaims.length, 1001, "the complete collection can be validated without removing per-request limits");
assert.throws(() => prepareCategoryAdoptionRecords(target, [], many, largeSecond), /安全上限/, "legacy single-batch requests remain bounded");
assert.throws(() => mergeCategoryPreparationBatch(target, largeRecords, [], many.map(row => patch(row.id, { code: row.id }))), /单批/);

const batch = { expectedSourceVersionId: "v1", expectedSourceRevision: 1, expectedPreparationRevision: 0, operation: "upgrade", batchId: "batch-1", patches: [patch("a", { code: "A", condition: "good" })], reason: "prepare" };
assert.equal(categoryPreparationBatchFingerprint(batch), categoryPreparationBatchFingerprint({ ...batch, patches: [patch("a", { condition: "good", code: "A" })] }));
assert.notEqual(categoryPreparationBatchFingerprint(batch), categoryPreparationBatchFingerprint({ ...batch, expectedPreparationRevision: 1 }));
assert.notEqual(categoryPreparationBatchFingerprint(batch), categoryPreparationBatchFingerprint({ ...batch, reason: "changed" }));
console.log("category-preparation-batches: partial/accumulated staging, withdrawal, source revisions, scope, original facts and final uniqueness preserved");
