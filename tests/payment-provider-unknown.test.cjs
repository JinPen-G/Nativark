const assert = require("node:assert/strict");
const { PaymentRuntimeService, PaymentProviderUnknownError } = require("../apps/api/dist/modules/integrations/payment.runtime.service.js");

function makeHarness(providerError) {
  const updates = [];
  const intent = {
    id: "intent-provider-unknown",
    tenantId: "tenant-1",
    workspaceId: "workspace-1",
    orderId: "order-1",
    instrument: "rental",
    provider: "alipay",
    method: "alipay",
    amount: 12.34,
    currency: "CNY",
    merchantOrderNo: "RO-UNKNOWN-1",
    status: "pending",
    checkoutUrl: null,
    externalTransactionId: null,
    failureReason: null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    paidAt: null
  };
  const prisma = {
    rentalPaymentIntent: {
      findUnique: async () => null,
      update: async ({ data }) => {
        updates.push(data);
        Object.assign(intent, data);
        return intent;
      }
    },
    externalAdapterLog: { create: async () => undefined },
    $transaction: async () => ({ intent, orderNo: "ORDER-1", amount: 12.34, replayed: false })
  };
  const integrations = {
    runtimeConfig: async () => ({
      id: "integration-1",
      capability: "payment",
      provider: "alipay",
      settings: {},
      credentials: {}
    })
  };
  const service = new PaymentRuntimeService(prisma, integrations, {});
  service.createAlipayIntent = async () => { throw providerError; };
  return { service, updates, intent };
}

async function main() {
  const unknown = makeHarness(new PaymentProviderUnknownError());
  await assert.rejects(
    () => unknown.service.createPaymentIntent("tenant-1", "workspace-1", "order-1", {
      instrument: "rental",
      method: "alipay",
      idempotencyKey: "payment-unknown-1"
    }),
    PaymentProviderUnknownError
  );
  assert.equal(unknown.updates.at(-1).status, "pending", "未知结果不能被记成失败");
  assert.match(unknown.updates.at(-1).failureReason, /结果未知/u);

  const rejected = makeHarness(new Error("HTTP 400: invalid parameter"));
  await assert.rejects(
    () => rejected.service.createPaymentIntent("tenant-1", "workspace-1", "order-1", {
      instrument: "rental",
      method: "alipay",
      idempotencyKey: "payment-rejected-1"
    }),
    /支付平台调用失败/u
  );
  assert.equal(rejected.updates.at(-1).status, "failed", "明确拒绝可以记成失败");

  console.log("payment provider unknown-result tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
