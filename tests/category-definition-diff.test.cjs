"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { categoryDefinitionDifferences } = require("../apps/api/dist/modules/rental-core/category-definition-diff.js");
const source = structuredClone(RENTAL_CATEGORY_DEFINITIONS[0]);
assert.deepEqual(categoryDefinitionDifferences(source, structuredClone(source)), []);
const next = structuredClone(source);
next.name = "新的品类名称";
next.businessModel.assetFields = [
  { scope: "asset", code: "identity", label: "资产身份", type: "string", required: true, unique: true },
  { scope: "item_group", code: "identity", label: "型号身份", type: "number" },
  { scope: "asset", code: "newRequired", label: "新增资料", type: "string", required: true }
];
source.businessModel.assetFields = [
  { scope: "asset", code: "identity", label: "资产身份", type: "string", required: false },
  { scope: "item_group", code: "identity", label: "型号身份", type: "string" }
];
next.businessModel.pricingUnits = source.businessModel.pricingUnits.slice(1);
const untouched = structuredClone([source, next]);
const diffs = categoryDefinitionDifferences(source, next);
assert(diffs.some((row) => row.path === "name" && row.before === source.name && row.after === next.name));
assert(diffs.some((row) => row.kind === "required_added" && row.path.includes("asset:identity")));
assert(diffs.some((row) => row.kind === "unique_enabled" && row.path.includes("asset:identity")));
assert(diffs.some((row) => row.kind === "type_changed" && row.path.includes("item_group:identity")));
assert(diffs.some((row) => row.kind === "required_added" && row.path.includes("newRequired")));
assert(diffs.some((row) => row.kind === "scope_narrowed" && row.path.endsWith("pricingUnits")));
assert.equal(new Set(diffs.map((row) => row.path)).size, diffs.length, "不同作用域同名字段不能合并");
assert.deepEqual([source, next], untouched, "预览不能修改任一正文");
const reordered = structuredClone(source); reordered.businessModel.assetFields.reverse();
assert.deepEqual(categoryDefinitionDifferences(source, reordered), [], "字段排序不能假称属性语义变更");
const enums = structuredClone(source); enums.businessModel.defaults.inspectionFields = [{ code: "condition", label: "成色", type: "select", options: ["good", "bad"] }];
const narrowed = structuredClone(enums); narrowed.businessModel.defaults.inspectionFields[0].options = ["good"];
assert.equal(categoryDefinitionDifferences(enums, narrowed)[0].kind, "scope_narrowed");
assert.equal(categoryDefinitionDifferences(undefined, next).length > 0, true);
assert.doesNotThrow(() => categoryDefinitionDifferences(source, { businessModel: { assetFields: null } }), "无效草稿可展示差异，但发布校验另行拒绝");
console.log("category-definition-diff: 必填/唯一/类型/范围变化、字段作用域、排序与不可变预览通过");
