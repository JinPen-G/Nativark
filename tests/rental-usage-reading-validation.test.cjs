const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: false, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { optionalUsageReading, usageDelta } = require("../apps/api/src/modules/rental-core/rental-usage-reading");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");

(async () => {
  for (const value of [undefined, null, "", "  "]) assert.equal(optionalUsageReading(value, "里程"), undefined);
  for (const value of [-1, Infinity, NaN, true, [], {}, "abc"]) assert.throws(() => optionalUsageReading(value, "工时"), /数字/u);
  assert.equal(optionalUsageReading(0, "里程"), 0);
  assert.equal(optionalUsageReading("123.5", "工时"), 123.5);
  assert.equal(usageDelta(101.5, 100), 1.5);
  assert.equal(usageDelta(100, undefined), undefined);
  assert.throws(() => usageDelta(99, 100), /归还读数不能小于/u);
  assert.throws(() => usageDelta(100, NaN), /数字/u);

  const repository = new RentalCoreFactRepository({});
  let row = { id: "inspection-return", tenantId: "tenant", orderId: "order", stage: "return", createdAt: new Date(),
    results: { usage_reading: 120, __r1InspectionMeta: { baselineInspectionId: "pickup", usageReadings: [
      { fieldCode: "usage_reading", baseline: 100, current: 120, delta: 20 }
    ], usageCorrections: [] } }
  };
  let writes = 0;
  let dependentReturns = [];
  const tx = {
    businessWorkspace: { findFirst: async () => ({ id: "workspace" }) },
    rentalInspectionRecord: {
      findFirst: async () => row,
      findMany: async ({ where }) => { assert.equal(where.tenantId, "tenant"); assert.equal(where.workspaceId, "workspace"); return dependentReturns; },
      update: async ({ data }) => { writes++; row = { ...row, ...data }; return row; }
    }
  };
  await assert.rejects(() => repository.correctInspectionUsage("tenant", "order", row.id, {
    fieldCode: "usage_reading", correctedCurrent: 90, reason: "录入错误"
  }, "operator", tx), /归还读数不能小于/u);
  assert.equal(writes, 0);
  const updated = await repository.correctInspectionUsage("tenant", "order", row.id, {
    fieldCode: "usage_reading", correctedCurrent: 130, reason: "核对仪表照片", evidenceAttachments: ["photo-reference"]
  }, "operator", tx);
  assert.equal(updated.results.usage_reading, 120, "原始检查事实必须保留");
  assert.equal(updated.usageReadings[0].current, 130);
  assert.equal(updated.usageReadings[0].delta, 30);
  assert.equal(updated.usageCorrections[0].from, 120);
  assert.equal(updated.usageCorrections[0].to, 130);

  row = { ...row, id: "pickup", stage: "pickup", results: { usage_reading: 100, __r1InspectionMeta: {
    usageReadings: [{ fieldCode: "usage_reading", current: 100 }]
  } } };
  dependentReturns = [{ results: { __r1InspectionMeta: { baselineInspectionId: "pickup" } } }];
  await assert.rejects(() => repository.correctInspectionUsage("tenant", "order", "pickup", {
    fieldCode: "usage_reading", correctedCurrent: 110, reason: "调整基线"
  }, "operator", tx), /已有归还记录引用/u);
  assert.equal(writes, 1, "不能单独改动已被归还记录引用的基线");
  dependentReturns = [];
  const baseline = await repository.correctInspectionUsage("tenant", "order", "pickup", {
    fieldCode: "usage_reading", correctedCurrent: 110, reason: "调整基线"
  }, "operator", tx);
  assert.equal(baseline.usageReadings[0].current, 110);
  dependentReturns = [row];
  const inspected = await repository.listInspections("tenant", "order", tx);
  assert.equal(inspected[0].id, "pickup", "事务内检查查询不能回退到根 Prisma 客户端");
  const pickupItems = [{ allocationId: 'replacement-allocation', itemGroupId: 'replacement-model', assetId: 'replacement-asset', quantity: 1 }];
  let inserted;
  tx.rentalInspectionRecord.create = async ({ data }) => { inserted = { ...data }; return inserted; };
  await repository.insertInspection({ id: 'replacement-pickup', tenantId: 'tenant', orderId: 'order', stage: 'pickup',
    templateId: 'pickup-template', templateCode: 'PICKUP', templateVersion: '2', exchangeId: 'exchange-original',
    pickupItems, customerConfirmedAt: '2026-11-01T00:00:00Z', results: { usage_reading: 100 },
    usageReadings: [{ fieldCode: 'usage_reading', current: 100 }], exceptions: [], attachments: [], operator: 'operator',
    createdAt: '2026-11-01T00:00:00Z' }, tx);
  dependentReturns = [inserted];
  const [savedPickup] = await repository.listInspections('tenant', 'order', tx);
  assert.deepEqual(savedPickup.pickupItems, pickupItems); assert.equal(savedPickup.exchangeId, 'exchange-original');
  assert.equal(savedPickup.customerConfirmedAt, '2026-11-01T00:00:00Z');
  assert.equal(savedPickup.results.__r1InspectionMeta, undefined);
  assert.deepEqual(savedPickup.usageReadings, [{ fieldCode: 'usage_reading', current: 100 }]);
  console.log("usage reading validation passed: optional blanks, finite readings, nonnegative delta, immutable originals, correction history and dependent baseline guard");
})().catch((error) => { console.error(error); process.exitCode = 1; });
