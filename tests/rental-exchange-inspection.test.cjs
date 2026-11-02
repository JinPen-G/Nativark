"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/dist/modules/rental-core/rental-business.service");
const { exchangeInspectionTemplates, assertInspectionAllocationScope } = require("../apps/api/dist/modules/rental-core/rental-exchange-inspection");

void (async () => {
  const category = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
  const oldTemplate = { id: "old", tenantId: "tenant", categoryCode: "camera", code: "CUSTOM_RETURN", name: "Original", stage: "return", version: "1", enabled: true,
    fields: [{ code: "old_required", label: "Original field", type: "boolean", required: true }] };
  const replacementTemplate = { ...structuredClone(oldTemplate), id: "new", version: "2", name: "Replacement", fields: [
    { code: "new_required", label: "Replacement field", type: "boolean", required: true },
    { code: "counter", label: "Reading", type: "number", required: true, usageMetric: true }
  ] };
  const basis = { categoryCode: "camera", categoryVersionId: "v2", priceBasis: "replacement_current_price", effectiveFrom: new Date().toISOString(),
    pricingStrategies: [{ unit: "day_24h", implementationVersion: "1" }], rateSnapshot: [], ruleSnapshot: {}, calendarSnapshot: [],
    inspectionTemplateSnapshots: [replacementTemplate], capabilitySnapshot: [] };
  const changes = [{ id: "exchange-one", type: "post_pickup_exchange", status: "applied", diff: { exchange: { executionBasis: basis } } }];
  const order = { id: "order", tenantId: "tenant", categoryCode: "camera", categoryVersionId: "v1", status: "renting", reservations: [],
    lines: [{ id: "line-old" }, { id: "line-new" }], inspectionTemplateSnapshots: [oldTemplate],
    allocations: [
      { id: "old-resource", orderLineId: "line-old", itemGroupId: "old-model", status: "picked_up" },
      { id: "new-resource", orderLineId: "line-new", itemGroupId: "new-model", status: "locked", metadata: { exchangeId: "exchange-one", itemGroupName: "New model" } },
      { id: "retired-resource", orderLineId: "line-new", status: "returned", metadata: { exchangeId: "unavailable-old-change" } }
    ] };
  const templates = exchangeInspectionTemplates(order, order.inspectionTemplateSnapshots, changes);
  assert.equal(templates.length, 2);
  assert.deepEqual(templates[0].allocationIds, ["old-resource"]);
  assert.deepEqual(templates[1].allocationIds, ["new-resource"]);
  assert.equal(templates[1].exchangeId, "exchange-one");
  templates[1].fields[0].label = "mutated projection";
  assert.equal(basis.inspectionTemplateSnapshots[0].fields[0].label, "Replacement field");
  assert.deepEqual(order.inspectionTemplateSnapshots, [oldTemplate]);
  assert.throws(() => assertInspectionAllocationScope(templates[0], ["new-resource"]), /分批/u);
  assert.throws(() => assertInspectionAllocationScope(templates[1], ["old-resource", "new-resource"]), /分批/u);
  assertInspectionAllocationScope(templates[1], ["new-resource"]);
  assert.throws(() => exchangeInspectionTemplates(order, [oldTemplate], []), /缺少独立检查依据/u);
  assert.throws(() => exchangeInspectionTemplates(order, [oldTemplate], [{ ...changes[0], status: "cancelled" }]), /缺少独立检查依据/u);

  const business = Object.create(RentalBusinessService.prototype);
  business.workspaceOf = () => "workspace";
  business.categoryResolver = { forWorkspace: async () => ({ categoryVersionId: "v2", adoptionRevision: 2, definition: category }) };
  business.coreConfigStore = { listInspectionTemplates: async () => [replacementTemplate] };
  const capability = { code: "camera_compatibility", implementationVersion: "cam-1.0", configVersion: "2", config: { mode: "warning" } };
  business.capabilities = { snapshotEnabled: async () => [capability] };
  const priced = { rateSnapshot: [{ unit: "day_24h", baseAmount: 200 }], ruleSnapshot: {}, calendarSnapshot: [] };
  const captured = await business.captureExchangeExecutionBasis("tenant", { category }, "replacement_current_price", basis.effectiveFrom, priced);
  assert.equal(captured.categoryVersionId, "v2");
  assert.equal(captured.adoptionRevision, 2);
  assert.deepEqual(captured.inspectionTemplateSnapshots, [replacementTemplate]);
  replacementTemplate.fields[0].label = "later config edit";
  capability.config.mode = "block";
  priced.rateSnapshot[0].baseAmount = 999;
  assert.equal(captured.inspectionTemplateSnapshots[0].fields[0].label, "Replacement field");
  assert.equal(captured.capabilitySnapshot[0].config.mode, "warning");
  assert.equal(captured.rateSnapshot[0].baseAmount, 200);
  business.categoryResolver.forWorkspace = async () => ({ definition: { ...category, name: "another version" } });
  await assert.rejects(business.captureExchangeExecutionBasis("tenant", { category }, "original_order_price", basis.effectiveFrom, priced), /已变化/u);
  business.categoryResolver.forWorkspace = async () => ({ definition: category });
  business.coreConfigStore.listInspectionTemplates = async () => [{ ...replacementTemplate, tenantId: "other-tenant" }];
  await assert.rejects(business.captureExchangeExecutionBasis("tenant", { category }, "original_order_price", basis.effectiveFrom, priced), /租户或品类不一致/u);
  business.coreConfigStore = {};
  await assert.rejects(business.captureExchangeExecutionBasis("tenant", { category }, "original_order_price", basis.effectiveFrom, priced), /不能伪造空检查依据/u);
  business.coreConfigStore.listInspectionTemplates = async () => [];
  const empty = await business.captureExchangeExecutionBasis("tenant", { category }, "original_order_price", basis.effectiveFrom,
    { ...priced, rateSnapshot: [{ unit: "hour", baseAmount: 10 }], ruleSnapshot: { pricing: { hourToDayEnabled: true } } });
  assert.deepEqual(empty.inspectionTemplateSnapshots, [], "真实空目录与读取失败必须区分");
  assert.deepEqual(empty.pricingStrategies.map((row) => row.unit).sort(), ["day_24h", "hour"]);

  const core = Object.create(RentalCoreService.prototype);
  core.logger = { warn: () => {} };
  core.state = () => ({ profile: { categoryCode: "camera" }, inspectionTemplates: [] });
  core.lockedOrder = async () => structuredClone(order);
  core.categoryResolver = { forVersion: async () => category };
  let record, hookedOrder;
  core.factStore = { listOrderChanges: async () => changes, listInspections: async () => [{ id: "old-pickup", stage: "pickup", results: { counter: 90000 } }],
    insertInspection: async (value) => { record = value; }, saveOrderAggregate: async () => {} };
  core.runHook = async (_tenant, _point, _ref, payload) => { hookedOrder = payload.order; };
  core.workspaceOf = () => "workspace";
  core.applyPartialReturnItems = async (_tenant, _state, value, items) => {
    const returnedIds = new Map();
    for (const item of items) {
      const allocation = value.allocations.find((row) => row.id === item.allocationId);
      allocation.status = "returned"; allocation.quantity = item.quantity;
      returnedIds.set(item.allocationId, item.allocationId);
    }
    return returnedIds;
  };
  core.hasReturnHold = () => false;
  core.recordReturnDispositions = async () => {};
  core.quarantinedReturnQuantities = () => [];
  core.returnStockTransfers = () => [];
  const selected = templates[1].id;
  await assert.rejects(core.createInspection("tenant", order.id, { templateId: selected, results: { old_required: true }, returnItems: [{ allocationId: "new-resource", quantity: 1 }] }, "operator"), /缺少必填检查项/u);
  await assert.rejects(core.createInspection("tenant", order.id, { templateId: selected, results: { new_required: true, counter: 1000 }, returnItems: [{ allocationId: "old-resource", quantity: 1 }] }, "operator"), /分批/u);
  await assert.rejects(core.createInspection("tenant", order.id, { templateId: selected, results: { new_required: true, counter: 1000 } }, "operator"), /分批/u);
  await core.createInspection("tenant", order.id, { templateId: selected, results: { new_required: true, counter: 1000 }, returnItems: [{ allocationId: "new-resource", quantity: 1 }] }, "operator");
  assert.equal(hookedOrder.categoryVersionId, "v2");
  assert.deepEqual(hookedOrder.allocations.map((row) => row.id), ["new-resource"]);
  assert.deepEqual(hookedOrder.lines.map((row) => row.id), ["line-new"]);
  assert.equal(record.baselineInspectionId, undefined, "替换商品不能冒用旧资产领取读数");
  assert.equal(record.templateId, "new", "落库使用真实模板外键而非投影 ID");
  assert.equal(record.exchangeId, "exchange-one");
  assert.equal(record.usageReadings[0].baseline, undefined);
  assert.equal(record.usageReadings[0].delta, undefined);
  assert.deepEqual(order.inspectionTemplateSnapshots, [oldTemplate]);
  const newPickup = { id: 'new-pickup', tenantId: 'tenant', orderId: order.id, stage: 'pickup', exchangeId: 'exchange-one',
    pickupItems: [{ allocationId: 'new-resource', itemGroupId: 'new-model', quantity: 2 }],
    results: { counter: 100 }, usageReadings: [{ fieldCode: 'counter', current: 120 }] };
  order.allocations.find(row => row.id === 'new-resource').quantity = 1;
  core.factStore.listInspections = async () => [{ id: 'old-pickup', stage: 'pickup', results: { counter: 90000 } }, newPickup];
  await core.createInspection('tenant', order.id, { templateId: selected, results: { new_required: true, counter: 1000 },
    returnItems: [{ allocationId: 'new-resource', quantity: 1 }] }, 'operator');
  assert.equal(record.baselineInspectionId, 'new-pickup');
  assert.equal(record.usageReadings[0].baseline, 120, 'use corrected current reading from the exact new resource');
  assert.equal(record.usageReadings[0].delta, 880);
  for (const patch of [{ exchangeId: 'different-exchange' }, { pickupItems: [{ allocationId: 'other', itemGroupId: 'new-model', quantity: 2 }] }]) {
    core.factStore.listInspections = async () => [{ ...newPickup, ...patch }];
    await core.createInspection('tenant', order.id, { templateId: selected, results: { new_required: true, counter: 1000 },
      returnItems: [{ allocationId: 'new-resource', quantity: 1 }] }, 'operator');
    assert.equal(record.baselineInspectionId, undefined); assert.equal(record.usageReadings[0].baseline, undefined);
  }
  core.factStore.listInspections = async () => [newPickup, { ...newPickup, id: 'ambiguous' }];
  await assert.rejects(core.createInspection('tenant', order.id, { templateId: selected, results: { new_required: true, counter: 1000 },
    returnItems: [{ allocationId: 'new-resource', quantity: 1 }] }, 'operator'), /基线不唯一/);
  core.factStore.listInspections = async () => [{ id: 'old-pickup', stage: 'pickup', results: { counter: 90000 } }];
  order.allocations.push({ id: "other-original", orderLineId: "line-old", itemGroupId: "old-model", status: "picked_up" });
  await core.createInspection("tenant", order.id, { templateId: oldTemplate.id, results: { old_required: true }, returnItems: [{ allocationId: "old-resource", quantity: 1 }] }, "operator");
  assert.deepEqual(hookedOrder.allocations.map((row) => row.id), ["old-resource"], "原商品模板同样只把本批归还资源交给 Hook");
  console.log("Exchange inspection evidence passed: frozen policy/prices/templates/capabilities, scoped originals/replacements, missing evidence fail-closed, required fields, mixed-batch rejection, scoped Hook and no fabricated pickup readings.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
