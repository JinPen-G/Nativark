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
const entityChanged = structuredClone(preview);
entityChanged.entities.itemGroups[0].updatedAt = "2026-09-30T00:00:01.000Z";
entityChanged.entities.itemGroups[0].attributes.name = "其他人员更新后的型号";
assert.equal(initial(entityChanged, "upgrade")["item_group:same"].name, "其他人员更新后的型号", "绑定未变但实体已修改时，不得自动套用旧补丁并用新时间戳掩盖陈旧来源");
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
const capabilitySource = fs.readFileSync("apps/admin/src/features/settings/governance/categoryPreparationCapabilities.ts", "utf8");
const capabilityCompiled = ts.transpileModule(capabilitySource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const capExports = {};
new Function("exports", "require", capabilityCompiled)(capExports, require);
const capPreview = { ...structuredClone(preview), targetDefinition: structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera")), entities: { ...preview.entities, capabilities: [
  { code: "camera_compatibility", status: "enabled", revision: 9, implementationVersion: "cam-1.0", configVersion: "v3", config: { relations: [], powerMarginPercent: 0 } },
  { code: "delivery", status: "enabled", revision: 1, implementationVersion: "core-1.0", config: {} },
  { code: "vehicle_driving_license", status: "enabled", revision: 1, implementationVersion: "core-1.0", config: {} }
] }, preparation: { revision: 1, patches: { operation: "upgrade", capabilityPatches: [
  { code: "camera_compatibility", expectedRevision: 8, expectedImplementationVersion: "old", config: { relations: [], powerMarginPercent: 25 } }
] } } };
const capBefore = structuredClone(capPreview);
const capDrafts = capExports.initialCapabilityDrafts(capPreview, "upgrade");
assert.deepEqual(Object.keys(capDrafts), ["camera_compatibility"]);
assert.equal(capDrafts.camera_compatibility.expectedRevision, 8, "旧输入不得伪装为最新修订");
assert.equal(capDrafts.camera_compatibility.expectedImplementationVersion, "old");
capDrafts.camera_compatibility.fields.unknown = "不能提交";
const capPatches = capExports.capabilityPreparationPatches(capPreview, capDrafts);
assert.deepEqual(capPatches[0].config, { relations: [], powerMarginPercent: 25 });
assert.equal(capPatches[0].expectedRevision, 8);
const freshCaps = capExports.initialCapabilityDrafts({ ...capPreview, preparation: null }, "upgrade");
assert.equal(freshCaps.camera_compatibility.expectedRevision, 9);
assert.equal(freshCaps.camera_compatibility.fields.powerMarginPercent, 0);
assert.equal(capExports.initialCapabilityDrafts({ ...capPreview, stale: true }, "upgrade").camera_compatibility.expectedRevision, 9);
for (const invalid of ["not JSON", "{}", "null"]) {
  freshCaps.camera_compatibility.fields.relations = invalid;
  assert.throws(() => capExports.capabilityPreparationPatches(capPreview, freshCaps), /JSON|数组/);
}
assert.deepEqual(capPreview, capBefore, "准备表单不能原地改活动配置或保存信封");
assert.deepEqual(capExports.preparationCapabilityDefinitions({ ...capPreview, entities: { ...capPreview.entities, capabilities: [] } }), []);
const pausedPreview = structuredClone(capPreview);
pausedPreview.entities.capabilities[0].status = "paused";
assert.throws(() => capExports.capabilityPreparationPatches(pausedPreview, {}), /不再适用/, "不可静默删掉已保存的失效补丁");
assert.throws(() => capExports.capabilityPreparationPatches(pausedPreview, capDrafts), /状态|适用范围/);
console.log("category-preparation-admin-capabilities: 按声明字段、范围、零值、陈旧来源保留、明确重新准备及结构化数组校验通过");
const newPreview = structuredClone(capPreview);
newPreview.preparation = null;
newPreview.targetDefinition.requiredCapabilities.push("camera_kit_handover");
newPreview.registeredCapabilityVersions = ["camera_kit_handover@cam-kit-1.0"];
const newBefore = structuredClone(newPreview);
const newDrafts = capExports.initialCapabilityDrafts(newPreview, "upgrade");
assert.equal(newDrafts.camera_kit_handover.intent, "enable_new");
assert.equal(newDrafts.camera_kit_handover.selected, false, "新增必选能力不得自动勾选");
assert.ok(!capExports.capabilityPreparationPatches(newPreview, newDrafts).some((patch) => patch.code === "camera_kit_handover"));
newDrafts.camera_kit_handover.selected = true;
const newPatch = capExports.capabilityPreparationPatches(newPreview, newDrafts).find((patch) => patch.code === "camera_kit_handover");
assert.deepEqual(newPatch, { intent: "enable_new", code: "camera_kit_handover", expectedRevision: 0, expectedImplementationVersion: "cam-kit-1.0", config: {} });
newPreview.preparation = { revision: 1, patches: { operation: "upgrade", capabilityPatches: [newPatch] } };
assert.equal(capExports.initialCapabilityDrafts(newPreview, "upgrade").camera_kit_handover.selected, true, "已保存的明确选择必须读回");
assert.equal(capExports.initialCapabilityDrafts({ ...newPreview, stale: true }, "upgrade").camera_kit_handover.selected, false);
const unavailable = structuredClone(newPreview);
unavailable.registeredCapabilityVersions = [];
assert.ok(!capExports.preparationCapabilityDefinitions(unavailable).some((row) => row.code === "camera_kit_handover"));
assert.throws(() => capExports.capabilityPreparationPatches(unavailable, {}), /不再适用/);
const pausedNew = structuredClone(newPreview);
const appearedNew = structuredClone(newPreview);
appearedNew.entities.capabilities.push({ code: "camera_kit_handover", status: "enabled", revision: 2, implementationVersion: "cam-kit-1.0", config: {} });
assert.equal(capExports.initialCapabilityDrafts(appearedNew, "upgrade").camera_kit_handover.intent, "enable_new", "来源变化不能静默重写保存意图");
const rereadAppeared = capExports.initialCapabilityDrafts({ ...appearedNew, preparation: null }, "upgrade").camera_kit_handover;
assert.equal(rereadAppeared.intent, "configure", "显式放弃旧准备后可以按已启用零字段能力重新准备");
assert.equal(rereadAppeared.expectedRevision, 2);
pausedNew.entities.capabilities.push({ code: "camera_kit_handover", status: "paused", revision: 1, implementationVersion: "cam-kit-1.0", config: {} });
assert.ok(!capExports.preparationCapabilityDefinitions(pausedNew).some((row) => row.code === "camera_kit_handover"));
assert.deepEqual({ ...newPreview, preparation: null }, newBefore, "显式选择不能修改服务端预览");
console.log("category-preparation-new-capabilities: 注册执行器、显式选择、零字段能力、准备读回、失效保留及停用不恢复通过");
