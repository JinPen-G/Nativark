"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { validateActiveCategoryWrite } = require("../apps/api/dist/modules/rental-core/category-active-write.js");
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
definition.businessModel.assetFields = [
  { code: "identity", scope: "item_group", label: "型号编号", type: "string", required: true, unique: true },
  { code: "serialNo", scope: "asset", label: "序列号", type: "string", required: true, unique: true }
];
const calls = [];
const db = {
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "camera", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("version"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } }
};
(async () => {
  const group = { id: "g", scope: "item_group", categoryCode: "camera", inventoryMode: "serialized", attributes: { identity: " abc ", __itemGroupMedia: { images: [] } } };
  const claims = await validateActiveCategoryWrite(db, "t", "ws", group, { categoryVersionId: "v2", adoptionRevision: 2 });
  assert.deepEqual(calls, ["lock", "version"]);
  assert.equal(claims[0].normalizedValue, "ABC");
  assert.ok(group.attributes.__itemGroupMedia, "不得修改输入媒体资料");
  await assert.rejects(validateActiveCategoryWrite(db, "t", "ws", group, { categoryVersionId: "v1", adoptionRevision: 1 }), /版本已变化/);
  await assert.rejects(validateActiveCategoryWrite(db, "t", "ws", { ...group, attributes: {} }), /不能为空/);
  await assert.rejects(validateActiveCategoryWrite(db, "t", "ws", { ...group, categoryCode: "vehicle" }), /品类不一致/);
  assert.equal((await validateActiveCategoryWrite(db, "t", "ws", { ...group, inventoryMode: "bundle", attributes: {} })).length, 0);
  const asset = { id: "a", scope: "asset", serialNo: "SN1", attributes: {} };
  assert.equal((await validateActiveCategoryWrite(db, "t", "ws", asset))[0].normalizedValue, "SN1");
  await assert.rejects(validateActiveCategoryWrite(db, "t", "ws", { ...asset, serialNo: undefined }), /不能为空/);
  await assert.rejects(validateActiveCategoryWrite(db, "t", "ws", { ...asset, attributes: { serialNo: "SN2" } }), /未定义/);
  console.log("category-active-write: 事务锁先于读版本、旧绑定拒绝、当前字段/唯一声明、媒体与序列号边界通过（替身专项）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
