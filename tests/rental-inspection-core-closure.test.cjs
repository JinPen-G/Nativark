const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: false, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
(async () => {
  const core = Object.create(RentalCoreService.prototype);
  const order = { id: "order", status: "settling", serviceSnapshots: [], feeReviews: [] };
  let writes = 0;
  let voided = 0;
  let hooks = 0;
  const transaction = {};
  const exception = { reviewStatus: "approved", approvedChargeAmount: 100 };
  core.lockedOrder = async () => order;
  core.factStore = { listExtensions: async () => [],
    listInspections: async (tenant, orderId, tx) => { assert.equal(tenant, "tenant"); assert.equal(orderId, "order"); assert.equal(tx, transaction); return [{ exceptions: [exception] }]; },
    saveOrderAggregate: async () => writes++ };
  core.runHook = async () => hooks++;
  core.orderHookInstances = () => [];
  core.voidPendingExtensions = async () => voided++;
  for (const status of [undefined, "pending", "disputed", "not_required"]) {
    exception.customerResponseStatus = status;
    await assert.rejects(() => core.settleOrder("tenant", "order", transaction, "operator"), /待客户确认/u);
    assert.equal(order.status, "settling");
  }
  assert.equal(writes + voided + hooks, 0, "客户确认闸门失败时不推进任何关单副作用");
  exception.customerResponseStatus = "confirmed";
  await core.settleOrder("tenant", "order", transaction, "operator");
  assert.equal(order.status, "completed");
  assert.equal(writes, 1);
  console.log("core inspection closure passed: transactional checks, missing responses, disputes, no side effects before approval");
})().catch((error) => { console.error(error); process.exitCode = 1; });
