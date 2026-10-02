"use strict";
const assert = require("node:assert/strict");
const { buildCapabilityEquipment, buildCapabilityEquipmentFromAssets } = require("../apps/api/dist/modules/rental-core/capability-equipment.js");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const { RentalBusinessService } = require("../apps/api/dist/modules/rental-core/rental-business.service.js");
const fields = [
  { code: "mount", scope: "item_group", type: "string" },
  { code: "assetFit", scope: "asset", type: "string" },
  { code: "reading", scope: "asset", type: "number" },
  { code: "flag", scope: "item_group", type: "boolean" }
];
const group = { id: "g1", name: "model", inventoryMode: "serialized", attributes: { mount: "RF", retired: "history", assetFit: "retired-model-value", flag: false, __itemGroupMedia: { images: [] } } };
const groups = new Map([[group.id, group]]);
const asset = { id: "a1", assetNo: "A1", itemGroupId: "g1", attributes: { assetFit: "RF", mount: "retired-asset-value", retiredAsset: "history", reading: 0 } };
const before = structuredClone({ group, asset });
assert.deepEqual(buildCapabilityEquipment(groups, [{ itemGroupId: "g1", quantity: 1 }], fields)[0].attributes, { mount: "RF", flag: false });
assert.deepEqual(buildCapabilityEquipmentFromAssets(groups, [asset], fields)[0].attributes, { mount: "RF", flag: false, assetFit: "RF", reading: 0 }, "先按来源范围投影，再合并，不能用退役资产字段覆盖型号属性");
assert.deepEqual(buildCapabilityEquipmentFromAssets(groups, [{ ...asset, attributes: {} }], fields)[0].attributes, { mount: "RF", flag: false }, "型号退役字段不能因同名资产字段重新生效");
(async () => {
  const calls = [];
  const core = Object.create(RentalCoreService.prototype);
  core.capabilityEquipmentGroups = () => groups;
  core.workspaceOf = () => "ws";
  core.state = () => ({ profile: { categoryCode: "camera" } });
  const historicalFields = [{ code: "retired", scope: "item_group", type: "string" }];
  const tx = {};
  core.categoryResolver = { forVersion: async (code, version, client) => { calls.push([code, version, client]); return { requiredCapabilities: [], businessModel: { assetFields: historicalFields } }; } };
  const order = { categoryCode: "camera", categoryVersionId: "old-version", lines: [{ itemGroupId: "g1", quantity: 1 }] };
  const orderEquipment = await core.buildOrderCapabilityEquipment("tenant", order, tx);
  assert.deepEqual(orderEquipment[0].attributes, { retired: "history" }, "历史订单按旧版字段执行，不能套当前字段");
  assert.deepEqual(calls[0], ["camera", "old-version", tx], "读取在调用方事务内");
  let captured;
  core.hooks = { evaluate: async (input) => { captured = input; return {}; } };
  const subject = { ...order, equipment: buildCapabilityEquipment(groups, [{ itemGroupId: "g1", quantity: 1 }]) };
  await core.runHook("tenant", "allocation_dispatch", { type: "order", id: "order" }, subject, tx, undefined, []);
  assert.deepEqual(captured.subject.equipment[0].attributes, { retired: "history" });
  assert.equal(subject.equipment[0].attributes.mount, "RF", "不改写订单输入/存量资料");
  core.categoryResolver = undefined;
  await assert.rejects(core.buildOrderCapabilityEquipment("tenant", order, tx), /解析器不可用/);
  const business = Object.create(RentalBusinessService.prototype);
  business.workspaceOf = () => "ws";
  business.hooks = { evaluate: async (input) => { captured = input; return { executed: [] }; } };
  await business.runQuoteHook("tenant", { category: { code: "camera", requiredCapabilities: [], businessModel: { assetFields: fields } }, groups: [group] }, { id: "quote", createdAt: new Date().toISOString(), request: { lines: [{ itemGroupId: "g1", quantity: 1 }] }, capabilitySnapshot: [] });
  assert.deepEqual(captured.subject.equipment[0].attributes, { mount: "RF", flag: false }, "真实报价 Hook 入口消费当前字段投影");
  assert.deepEqual({ group, asset }, before);
  console.log("category-capability-execution-fields: 报价当前版本、订单历史版本、事务内解析、来源范围投影与存量不变通过（执行链替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
