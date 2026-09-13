const assert = require("node:assert/strict");
const { PaymentRuntimeService } = require("../apps/api/dist/modules/integrations/payment.runtime.service.js");

const intentRows = [
  { id: "intent-paid", orderId: "order-1", status: "pending", updatedAt: new Date("2026-09-14T00:00:00Z") },
  { id: "intent-funding", orderId: "order-2", status: "funding_failed", updatedAt: new Date("2026-09-14T00:01:00Z") },
  { id: "intent-funding-status", orderId: "order-3", status: "funding_failed", updatedAt: new Date("2026-09-14T00:01:30Z") }
];
const refundRows = [
  { id: "refund-pending", paymentIntentId: "intent-paid", orderId: "order-1", status: "funding_pending", updatedAt: new Date("2026-09-14T00:02:00Z") }
];
const calls = [];
const prisma = {
  rentalPaymentIntent: {
    findMany: async (args) => {
      calls.push({ kind: "intent", args });
      return intentRows;
    }
  },
  rentalPaymentRefund: {
    findMany: async (args) => {
      calls.push({ kind: "refund", args });
      return refundRows;
    }
  }
};

async function main() {
  const service = new PaymentRuntimeService(prisma, {}, {});
  service.refreshPaymentIntent = async (_tenantId, _workspaceId, _orderId, intentId) => {
    if (intentId === "intent-funding") throw new Error("provider timeout");
    if (intentId === "intent-funding-status") return { status: "funding_failed" };
    return { status: "paid" };
  };
  service.refreshPaymentRefund = async () => ({ status: "succeeded" });

  const result = await service.reconcileCurrentWorkspace("tenant-1", "workspace-1", 10);
  assert.equal(result.scanned, 4);
  assert.equal(result.processed, 4);
  assert.equal(result.paid, 1);
  assert.equal(result.refunded, 1);
  assert.equal(result.failed, 2, "funding_failed 必须计入失败待恢复数");
  assert.equal(result.pending, 0);
  assert.equal(result.results.find((row) => row.id === "intent-funding").status, "reconcile_error");
  assert.equal(result.results.find((row) => row.id === "intent-funding").error, "provider timeout");
  assert.equal(result.results.find((row) => row.id === "intent-funding-status").status, "funding_failed");
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.args.where.tenantId, "tenant-1");
    assert.equal(call.args.where.workspaceId, "workspace-1");
    assert.equal(call.args.take, 10);
  }

  const limited = await service.reconcileCurrentWorkspace("tenant-1", "workspace-1", 1);
  assert.equal(limited.scanned, 1, "批量对账必须受 limit 约束");
  console.log("payment reconciliation tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
