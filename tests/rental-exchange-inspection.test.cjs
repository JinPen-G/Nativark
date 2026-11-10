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

// AIN-A13 exercises the real narrow producer and the same Core applicability
// function; the persistence leaf is synthetic, not native SQL/Guard evidence.
const { test } = require('node:test');
const { RentalCoreFactRepository } = require('../apps/api/dist/modules/rental-core/rental-core-fact.repository');
const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/dist/common/request-identity');
function inspectionBasisHarness(options = {}) {
  const at = new Date('2026-11-06T09:00:00Z'), queries = [], orm = [];
  const original = { id: 'old', tenantId: 'tenant', code: 'RETURN_OLD', stage: 'return', version: '1', enabled: true };
  const replacement = { ...original, id: 'new', code: 'RETURN_NEW', version: '2' };
  const rows = [
    { id: 'old-resource', orderId: 'order', orderLineId: 'line-old', orderLine: { orderId: 'order' }, itemGroupId: 'old-model', status: 'picked_up', quantity: 1, updatedAt: at },
    { id: 'new-resource', orderId: 'order', orderLineId: 'line-new', orderLine: { orderId: 'order' }, itemGroupId: 'new-model', status: 'locked', quantity: 1, updatedAt: at }
  ];
  const projection = refs => ({ templatesType: 'ARRAY', templateCount: refs.length,
    templates: refs.length ? refs.map((row, index) => ({ ...row, ordinality: index + 1 })) : null });
  let parentReads = 0, allocationReads = 0;
  const prisma = {
    businessWorkspace: { findFirst: async args => { assert.deepEqual(args.where, { id: 'workspace', tenantId: 'tenant' }); return { id: 'workspace' }; } },
    rentalOrder: { findFirst: async args => {
      orm.push(args); ++parentReads;
      assert.deepEqual(args.select, { id: true, updatedAt: true });
      assert.equal(args.where.tenantId, 'tenant'); assert.equal(args.where.workspaceId, 'workspace');
      assert.ok(args.where.AND.some(row => row.OR.some(item => item.createdBy === 'operator')));
      assert.ok(args.where.AND.some(row => row.OR.some(item => item.fulfillmentLocationId?.in.includes('allowed-location'))));
      return options.denied ? null : { id: 'order', updatedAt: options.parentChanged && parentReads > 1 ? new Date(at.getTime() + 1) : at };
    } },
    rentalAllocation: { findMany: async args => {
      orm.push(args); ++allocationReads; assert.equal(args.take, 201);
      assert.equal(args.select.metadata, undefined); assert.equal(args.select.assetId, undefined);
      assert.deepEqual(args.select.orderLine, { select: { orderId: true } });
      if (options.overflow) return Array.from({ length: 201 }, (_, i) => ({ ...rows[0], id: 'allocation-' + i }));
      const values = structuredClone(rows);
      if (options.crossLine) values[0].orderLine.orderId = 'another-order';
      if (options.allocationChanged && allocationReads > 1) values[0].quantity = 2;
      return values;
    } },
    $queryRaw: async query => {
      const sql = query.sql; queries.push({ sql, values: query.values });
      assert.doesNotMatch(sql, /SELECT\s+(?:a\.metadata|c\.diff|o\.inspectionTemplateSnapshots)(?:\s|,)/iu);
      assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|fields|results|rateSnapshot|calendarSnapshot|assetNo)\b/iu);
      if (/FROM rental_orders o WHERE/u.test(sql)) return [options.missing ? { templatesType: null, templateCount: null, templates: null }
        : options.templateOverflow ? { templatesType: 'ARRAY', templateCount: 51, templates: null } : projection(options.empty ? [] : [original])];
      if (/FROM rental_allocations a/u.test(sql)) return rows.map(row => ({ id: row.id, updatedAt: at,
        metadataType: 'OBJECT', exchangeType: row.id === 'new-resource' ? (options.malformedLink ? 'BOOLEAN' : 'STRING') : null,
        exchangeId: row.id === 'new-resource' ? 'exchange-one' : null }));
      assert.match(sql, /c.type = 'post_pickup_exchange' AND c.status = 'applied'/u);
      if (options.revoke) getRequestIdentity().permissions = [];
      return options.cancelled ? [] : [{ id: 'exchange-one', type: 'post_pickup_exchange', status: 'applied',
        ...(options.missingExchange ? { templatesType: null, templateCount: null, templates: null }
          : projection(options.empty ? [] : [{ ...replacement, tenantId: options.foreignTemplate ? 'foreign' : 'tenant' }])) }];
    }
  };
  const repository = new RentalCoreFactRepository(prisma);
  const core = Object.create(RentalCoreService.prototype);
  core.state = () => { throw Error('no state or mutable config fallback'); };
  core.factStore = { readOrderFacts: async () => ({ id: 'order', tenantId: 'tenant', workspaceId: 'workspace', updatedAt: at.toISOString() }),
    readOrderInspectionBasis: repository.readOrderInspectionBasis.bind(repository) };
  const identity = { userId: 'operator', tenantId: 'tenant', workspaceId: 'workspace', audience: 'operator', isSaasAdmin: false,
    permissions: ['rental:order:view'], dataScope: 'own', locationScope: { mode: 'selected', locationIds: ['allowed-location'] } };
  return { core, queries, orm, original, replacement,
    read: () => runWithRequestIdentity(identity, () => core.readOrderInspectionBasis('tenant', 'order')) };
}

test('AIN-A13 frozen references preserve original/replacement resource scope and real template IDs', async () => {
  const h = inspectionBasisHarness(), value = await h.read();
  assert.equal(value.contractVersion, 'rental-order-inspection-basis-1');
  assert.deepEqual(value.originalTemplateRefs, [h.original]);
  assert.deepEqual(value.applicableTemplateRefs.map(row => [row.id, row.sourceTemplateId, row.allocationIds, row.exchangeId]),
    [['old', 'old', ['old-resource'], undefined], ['exchange:new-resource:new', 'new', ['new-resource'], 'exchange-one']]);
  assert.deepEqual(value.exchanges[0].templateRefs, [h.replacement]);
  assert.equal(value.recordResourceCoverage, 'not_projected');
  assert.equal(value.semantics, 'frozen_template_applicability_not_inspection_or_execution_authority');
  assert.doesNotMatch(JSON.stringify(value), /fields|results|assetId|assetNo|pricing|attachments|customer|name/u);
  assert.equal(h.queries.length, 3); assert.ok(h.queries[0].sql.includes('JSON_LENGTH'));
});
test('AIN-A13 missing order/exchange snapshots and cancelled links never use current templates', async () => {
  for (const options of [{ missing: true }, { missingExchange: true }, { cancelled: true }])
    await assert.rejects(inspectionBasisHarness(options).read(), /缺少|不能套用/u);
  const empty = await inspectionBasisHarness({ empty: true }).read();
  assert.deepEqual(empty.originalTemplateRefs, []); assert.deepEqual(empty.exchanges[0].templateRefs, []);
  assert.deepEqual(empty.applicableTemplateRefs, []);
});
test('AIN-A13 complete population bounds, foreign refs and malformed/cross-order links fail closed', async () => {
  for (const options of [{ overflow: true }, { templateOverflow: true }, { foreignTemplate: true }, { malformedLink: true }, { crossLine: true }])
    await assert.rejects(inspectionBasisHarness(options).read(), /上限|无效/u);
});
test('AIN-A13 current parent visibility, allocation version and authorization are rechecked', async () => {
  for (const options of [{ denied: true }, { parentChanged: true }, { allocationChanged: true }, { revoke: true }])
    await assert.rejects(inspectionBasisHarness(options).read(), /不可读|变化/u);
});
test('AIN-A13 composition carries the original bound Core receiver and preserves absent port', async () => {
  const { setup: orderSetup } = require('./fixtures/ai-native/order-facts.cjs');
  const { setup: businessSetup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
  const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
  const order = await orderSetup(), business = await businessSetup();
  const bind = () => composeAiAuthorizedBusinessTools({ core: order.core, guard: order.guard, credentials: order.credentials,
    business: business.business, reports: business.reports, memberships: business.memberships }).orderExplanation('order-a');
  const sentinel = Object.freeze({ bindingOnly: true });
  order.core.readOrderInspectionBasis = function (tenantId, orderId) {
    assert.equal(this, order.core); assert.equal(tenantId, 'tenant-a'); assert.equal(orderId, 'order-a'); return sentinel;
  };
  const consumer = bind();
  assert.equal(await consumer.inspections.core.readOrderInspectionBasis('tenant-a', 'order-a'), sentinel);
  order.core.readOrderInspectionBasis = undefined;
  assert.equal(bind().inspections.core.readOrderInspectionBasis, undefined);
});

test('AIN-A13 missing bounded Core port never invokes the aggregate or current catalog', async () => {
  const h = inspectionBasisHarness(); delete h.core.factStore.readOrderInspectionBasis;
  await assert.rejects(h.read(), /端口不可用/u);
  await assert.rejects(runWithRequestIdentity({ userId: 'operator', tenantId: 'tenant', isSaasAdmin: false },
    () => h.core.readOrderInspectionBasis('tenant', 'order')), /缺少当前租户及空间/u);
});
