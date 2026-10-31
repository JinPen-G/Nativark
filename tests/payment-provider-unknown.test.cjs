const assert = require("node:assert/strict");
const { PaymentRuntimeService, PaymentProviderUnknownError, PaymentProviderDefinitiveError } = require("../apps/api/dist/modules/integrations/payment.runtime.service.js");

function makeHarness(providerError, existingMethod = null) {
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
    idempotencyKey: "payment-unknown-1",
    status: "pending",
    checkoutUrl: null,
    externalTransactionId: null,
    failureReason: null,
    expiresAt: new Date(Date.now() + 15 * 60 * 1000),
    paidAt: null
  };
  const prisma = {
    rentalPaymentIntent: {
      findUnique: async () => existingMethod ? { ...intent, method: existingMethod } : null,
      findFirst: async () => intent,
      updateMany: async ({ where, data }) => {
        if (where.status !== intent.status) return { count: 0 };
        updates.push(data);
        Object.assign(intent, data);
        return { count: 1 };
      }
    },
    externalAdapterLog: { create: async () => undefined },
    $transaction: async () => ({ intent, orderNo: "ORDER-1", amount: 12.34, replayed: false })
  };
  const integrations = {
    assertEnabledInTransaction: async () => undefined,
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

  const rejected = makeHarness(new PaymentProviderDefinitiveError("PARAM_ERROR", "invalid parameter"));
  await assert.rejects(
    () => rejected.service.createPaymentIntent("tenant-1", "workspace-1", "order-1", {
      instrument: "rental",
      method: "alipay",
      idempotencyKey: "payment-rejected-1"
    }),
    /支付平台调用失败/u
  );
  assert.equal(rejected.updates.at(-1).status, "failed", "明确拒绝可以记成失败");

  const mismatchedReplay = makeHarness(null, "wechat_pay");
  await assert.rejects(
    () => mismatchedReplay.service.createPaymentIntent("tenant-1", "workspace-1", "order-1", {
      instrument: "rental",
      method: "alipay",
      idempotencyKey: "payment-unknown-1"
    }),
    (error) => error?.response?.message === "支付幂等键已用于其他支付方式，请更换幂等键",
    "幂等重放不能把支付宝请求静默回放成微信支付单"
  );

  const request = { instrument: "rental", method: "alipay", idempotencyKey: "payment-unknown-1" };
  for (const status of ["paid", "closed", "verified_pending_funding", "funding_failed"]) {
    const late = makeHarness(new PaymentProviderUnknownError());
    late.service.createAlipayIntent = async () => {
      late.intent.status = status;
      late.intent.responseJson = { stripeLiveVerified: true, sessionId: "original" };
      throw new PaymentProviderUnknownError();
    };
    await assert.rejects(() => late.service.createPaymentIntent("tenant-1", "workspace-1", "order-1", request));
    assert.equal(late.intent.status, status, "迟到异常不能降级已推进的支付事实");
    assert.equal(late.updates.length, 0);
  }
  const lateSuccess = makeHarness(null);
  lateSuccess.service.createAlipayIntent = async () => {
    lateSuccess.intent.status = "paid";
    lateSuccess.intent.responseJson = { stripeLiveVerified: true, sessionId: "original" };
    return { checkoutUrl: "https://example.invalid", responseJson: { sessionId: "late" }, responseCode: "ok" };
  };
  assert.equal((await lateSuccess.service.createPaymentIntent("tenant-1", "workspace-1", "order-1", request)).status, "paid");
  assert.deepEqual(lateSuccess.intent.responseJson, { stripeLiveVerified: true, sessionId: "original" });
  lateSuccess.service.log = async () => { throw new Error("log write failed"); };
  await assert.rejects(() => lateSuccess.service.createPaymentIntent("tenant-1", "workspace-1", "order-1", request));
  assert.equal(lateSuccess.intent.status, "paid", "日志失败不能否定已提交的付款");

  console.log("payment provider unknown-result tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
