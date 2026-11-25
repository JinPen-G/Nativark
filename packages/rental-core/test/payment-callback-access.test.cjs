"use strict";
/** Original signatures/controllers/runtime and current callback authority, no HTTP/provider/database process. */
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { createCipheriv, createHmac, createSign, generateKeyPairSync } = require("node:crypto");
const { PaymentRuntimeService } = require("../dist/mysql-payment-runtime.js");
const { PaymentWebhookController } = require("../dist/http-payment-webhook.controller.js");
const { createRentalPaymentCallbackAccess, withVerifiedRentalPaymentCallback } = require("../dist/application-payment-callback-access.js");
const { createRentalBusinessTenantFence } = require("../dist/mysql-business-fence.js");
const { createRentalAuthorization } = require("../dist/http-auth.js");
const { compileRentalHttpAccessPolicy } = require("../dist/http-access-policy.js");
const { runWithRequestIdentity } = require("@rental-os/platform-server/request-identity");
const { TenantIntegrationService } = require("@rental-os/platform-server/tenant-integration");
const shared = require("@rental-os/shared");
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicPem = publicKey.export({ type: "spki", format: "pem" });
const apiV3Key = "01234567890123456789012345678901";

function fixture(provider, mode = "enabled") {
  const events = new Map(), trace = [];
  let writes = 0, funds = 0, transaction = 0;
  const intent = { id: "intent", tenantId: "tenant", workspaceId: "workspace", orderId: "order",
    provider, method: provider, instrument: "rental", currency: provider === "stripe" ? "USD" : "CNY",
    amount: 10, merchantOrderNo: "original-payment", status: "pending", externalTransactionId: null,
    responseJson: { sessionId: "cs_original" }, paidAt: null };
  const refund = { id: "refund", tenantId: "tenant", workspaceId: "workspace", orderId: "order",
    provider, method: provider, currency: intent.currency, amount: 10, paymentIntentId: "intent",
    merchantRefundNo: "original-refund", status: "accepted", externalRefundId: null, revision: 1,
    fundedAt: null, reason: "original reason", createdAt: new Date("2026-01-01T00:00:00Z"), updatedAt: new Date("2026-01-01T00:00:00Z") };
  const row = { id: "config", tenantId: "tenant", capability: "payment", provider, enabled: true,
    isDefault: false, updatedAt: new Date("2026-01-01T00:00:00Z"), settings: { appId: "app", mchid: "merchant",
      platformCertificateSerial: "PLATFORM-1" }, credentialsEncrypted: "synthetic", secretFields: [],
    lastTestStatus: "passed", lastTestMode: "live" };
  const config = { tenantId: row.tenantId, id: row.id, capability: "payment", provider, settings: row.settings,
    credentials: { alipayPublicKey: publicPem, wechatPlatformCertificate: publicPem, apiV3Key,
      webhookSecret: "synthetic-offline-secret" },
    revision: structuredClone(Object.fromEntries(["updatedAt", "settings", "credentialsEncrypted", "secretFields", "enabled", "isDefault"].map(k => [k, row[k]]))) };
  if (mode === "stale-config") row.updatedAt = new Date("2026-01-02T00:00:00Z");
  const originalIntegrations = new TenantIntegrationService({}, {}, {});
  const integrations = { runtimeConfigsForCallback: async () => [config],
    assertEnabledInTransaction: originalIntegrations.assertEnabledInTransaction.bind(originalIntegrations) };
  const eventTable = {
    findUnique: async ({ where }) => events.get(`${where.provider_eventId.provider}:${where.provider_eventId.eventId}`) ?? null,
    create: async ({ data }) => { writes++; const value = { id: `${data.provider}:${data.eventId}`, ...data }; events.set(value.id, value); return value; },
    update: async ({ where, data }) => { writes++; const value = events.get(where.id); assert.ok(value); Object.assign(value, data); return value; },
    updateMany: async ({ where, data }) => {
      const value = [...events.values()].find(e => e.id === where.id || e.provider === where.provider && e.eventId === where.eventId);
      if (!value || where.status && value.status !== where.status) return { count: 0 };
      writes++; Object.assign(value, data); return { count: 1 };
    }
  };
  const paymentTable = { findFirst: async () => ({ ...intent }),
    update: async ({ data }) => { writes++; Object.assign(intent, data); return { ...intent }; },
    updateMany: async ({ where, data }) => {
      if (where.status === "pending" && intent.status !== "pending" || where.status?.not === intent.status) return { count: 0 };
      writes++; Object.assign(intent, data); return { count: 1 };
    } };
  const refundTable = { findFirst: async () => ({ ...refund }), findFirstOrThrow: async () => ({ ...refund }), findMany: async () => [],
    aggregate: async () => ({ _sum: { amount: 0 } }),
    update: async ({ data }) => { writes++; const { revision, ...rest } = data; Object.assign(refund, rest); if (revision?.increment) refund.revision += revision.increment; return { ...refund }; },
    updateMany: async ({ where, data }) => { if (where.revision !== undefined && where.revision !== refund.revision) return { count: 0 }; writes++; const { revision, ...rest } = data; Object.assign(refund, rest); if (revision?.increment) refund.revision += revision.increment; return { count: 1 }; }
  };
  const db = { rentalPaymentIntent: paymentTable, rentalPaymentRefund: refundTable, paymentWebhookEvent: eventTable,
    async $transaction(consume) {
      transaction++;
      const tx = { rentalPaymentIntent: paymentTable, rentalPaymentRefund: refundTable, paymentWebhookEvent: eventTable,
        async $queryRaw(query) {
          const text = query.sql;
          if (text.includes("FROM Tenant")) { trace.push("Tenant"); return [{ id: "tenant", status: mode === "frozen-tenant" ? "FROZEN" : "ACTIVE" }]; }
          if (text.includes("platform_core_access_locks")) { trace.push("Core"); return [{ tenantId: "tenant", coreId: "rental" }]; }
          if (text.includes("platform_tenant_core_grants")) return mode === "missing-grant" ? [] : [{ state: mode === "disabled" ? "disabled" : "enabled", revision: 1, operationId: "grant" }];
          if (text.includes("platform_core_bindings")) return [{ bindingId: "binding", revision: 1, dataVersion: "0.1.0", containerType: "rental-workspace", containerId: "workspace" }];
          if (text.includes("FROM rental_orders")) { trace.push("Order"); return [{ id: "order" }]; }
          if (text.includes("business_workspaces")) { trace.push("Workspace"); return [{ id: "workspace", tenantId: "tenant", status: "ACTIVE" }]; }
          if (text.includes("tenant_integration_configs")) { trace.push("Config"); return [row]; }
          if (text.includes("rental_payment_intents")) { trace.push("Intent"); return [{ ...intent, ...(mode === "changed-record" ? { merchantOrderNo: "other" } : {}) }]; }
          if (text.includes("rental_payment_refunds")) { trace.push("Refund"); return [{ ...refund }]; }
          throw new Error(`unexpected SQL ${text}`);
        }
      };
      return consume(tx);
    }
  };
  const access = createRentalPaymentCallbackAccess({ database: db, deploymentForTransaction: () => ({ requireAvailable: async () => {} }) });
  const service = new PaymentRuntimeService(db, integrations, { recordEvent: async (_t, _w, _o, input, _actor, tx) => {
    assert.ok(tx); assert.equal(input.verifiedExternalReceipt, true); assert.equal(input.amount, 10); funds++; return { id: "funding" };
  } }, {});
  const controller = new PaymentWebhookController(service);
  const authorization = createRentalAuthorization(shared), guard = new authorization.Guard({});
  const paths = { alipay: "alipay", wechatPay: "wechat_pay", stripe: "stripe", alipayRefund: "alipay/refund", wechatRefund: "wechat_pay/refund" };
  const run = async (method, input) => {
    const request = { ...input, method: "POST", url: `/api/payments/webhooks/${paths[method]}`, headers: input.headers ?? {}, ip: "127.0.0.1" };
    return runWithRequestIdentity({}, () => access.run(async () => {
      assert.equal(await guard.canActivate({ switchToHttp: () => ({ getRequest: () => request }) }), true);
      return access.withRequest(request, () => controller[method](request));
    }));
  };
  return { run, intent, refund, config, events, trace, get writes() { return writes; }, get funds() { return funds; }, get transactions() { return transaction; } };
}

function alipayBody(refund = false, patch = {}) {
  const body = { app_id: "app", out_trade_no: "original-payment", trade_no: "original-trade", notify_id: "event",
    ...(refund ? { out_request_no: "original-refund", refund_status: "REFUND_SUCCESS", refund_fee: "10.00" }
      : { trade_status: "TRADE_SUCCESS", total_amount: "10.00" }), ...patch };
  const content = Object.keys(body).sort().map(k => `${k}=${body[k]}`).join("&");
  const signer = createSign("RSA-SHA256"); signer.update(content); body.sign = signer.sign(privateKey).toString("base64");
  return { body };
}

function wechatInput(refund = false, patch = {}) {
  const value = { mchid: "merchant", appid: "app", ...(refund
    ? { out_refund_no: "original-refund", refund_id: "original-refund-id", refund_status: "SUCCESS", amount: { refund: 1000 } }
    : { out_trade_no: "original-payment", transaction_id: "original-trade", trade_state: "SUCCESS", amount: { total: 1000 } }), ...patch };
  const nonce = "0123456789ab", aad = "original";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(apiV3Key), Buffer.from(nonce)); cipher.setAAD(Buffer.from(aad));
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  const rawBody = Buffer.from(JSON.stringify({ id: "event", event_type: refund ? "REFUND.SUCCESS" : "TRANSACTION.SUCCESS",
    resource: { algorithm: "AEAD_AES_256_GCM", nonce, associated_data: aad, ciphertext: Buffer.concat([data, cipher.getAuthTag()]).toString("base64") } }));
  const timestamp = String(Math.floor(Date.now() / 1000)), callbackNonce = "callback-nonce";
  const signer = createSign("RSA-SHA256"); signer.update(`${timestamp}\n${callbackNonce}\n${rawBody}\n`);
  return { rawBody, headers: { "wechatpay-timestamp": timestamp, "wechatpay-nonce": callbackNonce,
    "wechatpay-signature": signer.sign(privateKey).toString("base64"), "wechatpay-serial": "PLATFORM-1" } };
}

function stripeInput(type = "checkout.session.completed", patch = {}) {
  const rawBody = Buffer.from(JSON.stringify({ id: "event", type, livemode: true, data: { object: { id: "cs_original",
    livemode: true, client_reference_id: "original-payment", currency: "usd", amount_total: 1000,
    status: "complete", payment_status: "paid", payment_intent: "original-trade", ...patch } } }));
  const timestamp = String(Math.floor(Date.now() / 1000));
  return { rawBody, headers: { "stripe-signature": `t=${timestamp},v1=${createHmac("sha256", "synthetic-offline-secret").update(`${timestamp}.${rawBody}`).digest("hex")}` } };
}

for (const [provider, method, input] of [["alipay", "alipay", () => alipayBody()], ["wechat_pay", "wechatPay", () => wechatInput()],
  ["stripe", "stripe", () => stripeInput()], ["alipay", "alipayRefund", () => alipayBody(true)], ["wechat_pay", "wechatRefund", () => wechatInput(true)]]) {
  test(`${method} 原签名与控制器消费已停用 Core 的原结果，事件回放不重复入账`, async () => {
    const f = fixture(provider, "disabled"), request = input();
    await f.run(method, request); await f.run(method, request);
    assert.equal(f.funds, 1);
    assert.equal(method.includes("Refund") ? f.refund.fundedAt instanceof Date : f.intent.status === "paid", true);
    assert.ok(f.trace.indexOf("Tenant") < f.trace.indexOf("Order"));
    assert.ok(f.trace.indexOf("Order") < f.trace.indexOf("Workspace"));
    assert.ok(f.trace.indexOf("Workspace") < f.trace.indexOf("Config"));
    assert.equal([...f.events.values()][0].status, "processed");
  });
}

test("旧签名缓存、原对象变化、缺授权和冻结租户在任何结果写入前拒绝", async () => {
  for (const mode of ["stale-config", "changed-record", "missing-grant", "frozen-tenant"]) {
    const f = fixture("alipay", mode); await assert.rejects(f.run("alipay", alipayBody()));
    assert.equal(f.writes, 0, mode); assert.equal(f.funds, 0, mode);
  }
});

test("原金额和真实签名失败不能选择事务范围；不会先占回调事件", async () => {
  const amount = fixture("alipay"); await assert.rejects(amount.run("alipay", alipayBody(false, { total_amount: "9.00" })));
  assert.equal(amount.transactions, 0); assert.equal(amount.writes, 0);
  const signature = fixture("alipay"), request = alipayBody(); request.body.sign = "invalid";
  await assert.rejects(signature.run("alipay", request)); assert.equal(signature.transactions, 0);
  const currency = fixture("stripe"); await assert.rejects(currency.run("stripe", stripeInput(undefined, { currency: "eur" })));
  assert.equal(currency.transactions, 0); assert.equal(currency.writes, 0);
});

test("原关闭结果仍走精确对象范围，迟到关闭不覆盖已入账事实", async () => {
  const f = fixture("alipay", "disabled"); await f.run("alipay", alipayBody());
  await f.run("alipay", alipayBody(false, { trade_status: "TRADE_CLOSED" })); assert.equal(f.intent.status, "paid");
  const s = fixture("stripe", "disabled"); await s.run("stripe", stripeInput("checkout.session.expired"));
  assert.equal(s.intent.status, "closed"); assert.equal(s.funds, 0);
});

test("Stripe 原退款绑定和微信非成功通知也只消费原结果，不新建退款", async () => {
  const stripe = fixture("stripe", "disabled"); stripe.intent.externalTransactionId = "original-trade";
  const request = stripeInput("refund.updated", { id: "re_original", amount: 1000, status: "succeeded",
    metadata: { merchantRefundNo: "original-refund" } });
  await stripe.run("stripe", request); await stripe.run("stripe", request);
  assert.equal(stripe.funds, 1); assert.equal(stripe.refund.status, "succeeded");
  for (const refund_status of ["CLOSED", "ABNORMAL"]) {
    const wechat = fixture("wechat_pay", "disabled");
    await wechat.run("wechatRefund", wechatInput(true, { refund_status }));
    assert.equal(wechat.funds, 0); assert.equal(wechat.refund.status, refund_status === "CLOSED" ? "failed" : "accepted");
    assert.equal([...wechat.events.values()][0].status, "processed");
  }
});

test("专用范围仅匹配原五个回调，普通已选择业务不能借用 legacy 回退", async () => {
  const policy = compileRentalHttpAccessPolicy({ controllers: [PaymentWebhookController], authorization: createRentalAuthorization(shared) });
  policy.assertReviewed(); assert.equal(policy.routes.length, 5);
  for (const route of policy.routes) assert.equal(policy.isPaymentCallbackRoute({ method: "POST", url: `/api${route.path}` }), true);
  for (const request of [{ method: "GET", url: "/payments/webhooks/alipay" }, { method: "POST", url: "/payments/webhooks/alipay/extra" },
    { method: "POST", url: "/client/v1/orders" }]) assert.equal(policy.isPaymentCallbackRoute(request), false);
  await assert.rejects(createRentalBusinessTenantFence(async () => {}).run(() => withVerifiedRentalPaymentCallback({}, async () => {}, async () => "invalid")));
});
