const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalCoreFactRepository } = require("../apps/api/src/modules/rental-core/rental-core-fact.repository");
let passed = 0;
const ok = (message) => { passed += 1; console.log(`  PASS  ${message}`); };
const now = "2040-01-01T10:00:00.000Z";
const order = () => ({ id: "order_1", tenantId: "tenant_1", status: "settling", ruleSnapshot: { fulfillment: { returnBufferMinutes: 60 } }, reservations: [{ id: "res_1", itemGroupId: "group_q", locationId: "loc_1", quantity: 2, releasedQuantity: 2 }] });
function dispositionStore() { const rows = []; return { rows, listStockDispositions: async () => rows, upsertStockDisposition: async (row) => { const index = rows.findIndex((item) => item.dedupeKey === row.dedupeKey); if (index >= 0) rows[index] = { ...rows[index], ...row }; else rows.push(row); }, saveOrderAggregate: async () => {}, insertInspection: async () => {} }; }
void (async () => {
  const facts = dispositionStore(); const service = Object.create(RentalCoreService.prototype); service.factStore = facts; service.state = () => ({ itemGroups: [{ id: "group_q", inventoryMode: "quantity" }] });
  await RentalCoreService.prototype.recordReturnDispositions.call(service, "tenant_1", order(), "inspection_1", "batch_1", new Map([["res_1", 0]]), undefined, {});
  assert.equal(facts.rows.length, 1); assert.equal(facts.rows[0].quantity, 2); assert.equal(facts.rows[0].status, "buffered"); assert.equal(Date.parse(facts.rows[0].bufferUntil) - Date.parse(facts.rows[0].receivedAt), 60 * 60 * 1000); ok("正常归还按实际收到时间加周转缓冲落处置事实");
  await RentalCoreService.prototype.recordReturnDispositions.call(service, "tenant_1", order(), "inspection_1", "batch_1", new Map([["res_1", 0]]), "damage", {}); assert.equal(facts.rows.length, 1); assert.equal(facts.rows[0].status, "blocked"); ok("同批重试幂等，异常归还进入阻断而不重复隔离");
  const repo = Object.create(RentalCoreFactRepository.prototype); repo.prisma = {};
  const original = { ...facts.rows[0], status: "buffered", restoredQuantity: 0, bufferUntil: "2020-01-01T00:00:00.000Z" };
  const tx = { businessWorkspace: { findFirst: async () => ({ id: "ws_1" }) }, rentalStockDisposition: { findFirst: async () => ({ ...original, bufferUntil: new Date(original.bufferUntil), receivedAt: new Date(now), createdAt: new Date(now), updatedAt: new Date(now), restoredAt: null, inspectionId: "inspection_1", assetId: null, blockReason: null, restoredBy: null }), update: async ({ data }) => ({ ...original, ...data, bufferUntil: new Date(original.bufferUntil), receivedAt: new Date(now), createdAt: new Date(now), updatedAt: new Date(now), restoredAt: new Date(), inspectionId: "inspection_1", assetId: null, blockReason: null, restoredBy: data.restoredBy }) } };
  const restored = await RentalCoreFactRepository.prototype.restoreStockDisposition.call(repo, "tenant_1", "disp_1", "运营", tx); assert.equal(restored.status, "restored"); assert.equal(restored.restoredQuantity, 2); ok("周转缓冲结束后才能通过受控入口恢复处置数量"); console.log(`\n库存处置专项：${passed} 项全部通过`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
