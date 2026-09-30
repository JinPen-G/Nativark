"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const source = fs.readFileSync("apps/admin/src/features/settings/governance/categoryPreparationFields.ts", "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const exportsObject = {};
new Function("exports", "require", compiled)(exportsObject, require);
const { categoryPreparationInitialValues: initial, categoryPreparationPatches: patches } = exportsObject;
const targetDefinition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
targetDefinition.businessModel.assetFields = [
  { scope: "item_group", code: "name", type: "string", label: "名称", required: true },
  { scope: "asset", code: "serialNo", type: "string", label: "编号" },
  { scope: "asset", code: "approved", type: "boolean", label: "确认" },
  { scope: "asset", code: "amount", type: "number", label: "数量" }
];
const timestamp = "2026-09-30T00:00:00.000Z";
const preview = { targetDefinition, stale: false, entities: {
  itemGroups: [{ id: "same", updatedAt: timestamp, attributes: { name: "原型号", retired: "不覆盖", __itemGroupMedia: {} } }],
  assets: [{ id: "same", updatedAt: timestamp, serialNo: "SN1", attributes: { approved: false, amount: 0, retired: "保留" } }]
}, preparation: { revision: 1, patches: { operation: "upgrade", items: [{ entityType: "item_group", entityId: "same", expectedUpdatedAt: timestamp, values: { name: "候选型号", retired: "恶意未声明" } }] } } };
const before = structuredClone(preview);
const values = initial(preview, "upgrade");
assert.equal(values["item_group:same"].name, "候选型号");
assert.equal(values["item_group:same"].retired, undefined);
assert.equal(values["asset:same"].serialNo, "SN1");
assert.equal(values["asset:same"].approved, false);
assert.equal(values["asset:same"].amount, 0);
assert.equal(initial(preview, "restore")["item_group:same"].name, "原型号");
assert.equal(initial({ ...preview, stale: true }, "upgrade")["item_group:same"].name, "原型号", "失效准备不能静默套到新来源");
values["asset:same"].serialNo = "SN2";
values["asset:same"].amount = "";
values["asset:same"].unknown = "不能提交";
const result = patches(preview, values);
assert.equal(result.length, 2);
assert.equal(result[0].entityType, "item_group");
assert.equal(result[0].expectedUpdatedAt, timestamp);
assert.deepEqual({ ...result[1].values }, { serialNo: "SN2", amount: "" });
assert.deepEqual(preview, before, "表单投影和补丁生成不能改活动资料、媒体或服务端预览");
assert.equal(patches(preview, initial({ ...preview, preparation: null }, "upgrade")).length, 0, "未改变事实无需生成补丁");
console.log("category-preparation-admin-fields: 作用域同 ID 区分、候选读回、退役/媒体隔离、序列号专列、false/0、失效准备及差异补丁通过");
