const assert = require("node:assert/strict");
const { createSign, generateKeyPairSync, X509Certificate } = require("node:crypto");
const {
  PaymentRuntimeService,
  PaymentProviderDefinitiveError,
  PaymentProviderUnknownError,
  alipayFailure,
  refundFailureDisposition,
  alipayExpireTime,
  wechatExpireTime
} = require("../apps/api/dist/modules/integrations/payment.runtime.service.js");
const { PaymentWebhookRateLimiter } = require("../apps/api/dist/modules/integrations/payment-webhook-rate-limit.js");
const { PaymentWebhookController } = require("../apps/api/dist/modules/integrations/payment-webhook.controller.js");
const { TenantIntegrationService } = require("../apps/api/dist/modules/integrations/tenant-integration.service.js");
const { toCents } = require("../apps/api/dist/modules/integrations/payment-money.js");

const noopLog = { externalAdapterLog: { create: async () => undefined } };

function refundHarness(initial = {}) {
  const refund = {
    id: "refund-1", tenantId: "tenant-1", workspaceId: "workspace-1", orderId: "order-1", paymentIntentId: "intent-1",
    provider: "alipay", method: "alipay", amount: 10, currency: "CNY", merchantRefundNo: "RR-1", reason: "测试",
    status: "pending", externalRefundId: null, externalStatus: null, responseJson: null, failureReason: null,
    acceptedAt: null, succeededAt: null, fundedAt: null, createdAt: new Date(), updatedAt: new Date(), ...initial
  };
  const prisma = {
    ...noopLog,
    rentalPaymentRefund: {
      findFirst: async () => refund,
      updateMany: async ({ where, data }) => {
        if (where.status && (typeof where.status === "string" ? where.status !== refund.status : !where.status.in.includes(refund.status))) return { count: 0 };
        const { revision, ...fields } = data;
        Object.assign(refund, fields);
        if (revision?.increment) refund.revision = (refund.revision ?? 0) + revision.increment;
        return { count: 1 };
      }
    }
  };
  return { refund, service: new PaymentRuntimeService(prisma, {}, {}) };
}

async function testDefinitiveMapping() {
  // 1. Alipay code mapping
  assert.ok(alipayFailure({ code: "40004", sub_code: "ACQ.TRADE_HAS_CLOSE", sub_msg: "closed" }, "x") instanceof PaymentProviderDefinitiveError);
  assert.ok(alipayFailure({ code: "40004", sub_code: "ACQ.TRADE_NOT_EXIST" }, "x") instanceof PaymentProviderDefinitiveError);
  assert.ok(alipayFailure({ code: "40004", sub_code: "ACQ.REFUND_AMT_NOT_EQUAL_TOTAL" }, "x") instanceof PaymentProviderDefinitiveError);
  assert.ok(alipayFailure({ code: "40006", sub_code: "isv.insufficient-isv-permissions" }, "x") instanceof PaymentProviderDefinitiveError);
  const balance = alipayFailure({ code: "40004", sub_code: "ACQ.SELLER_BALANCE_NOT_ENOUGH" }, "x");
  assert.ok(!(balance instanceof PaymentProviderDefinitiveError), "余额不足必须可重试");
  const busy = alipayFailure({ code: "20000", sub_code: "aop.unknow-error" }, "x");
  assert.ok(!(busy instanceof PaymentProviderDefinitiveError), "20000 服务不可用必须可重试");

  // 2. disposition: 409 stays pending, 400 definitive, NOT_ENOUGH retryable
  assert.equal(refundFailureDisposition(new Error("HTTP 409: FREQUENCY_LIMITED")).definitive, false, "409 不能判失败");
  assert.equal(refundFailureDisposition(new Error("HTTP 400: PARAM_ERROR")).definitive, true);
  assert.equal(refundFailureDisposition(new Error("HTTP 503: down")).definitive, false);
  assert.equal(refundFailureDisposition(new PaymentProviderUnknownError()).definitive, false);
  assert.deepEqual(refundFailureDisposition(new PaymentProviderDefinitiveError("ACQ.TRADE_HAS_CLOSE", "m")), { definitive: true, providerCode: "ACQ.TRADE_HAS_CLOSE" });

  // 3. definitive rejection → failed with provider code stored; quota released
  const definitive = refundHarness();
  const result = await definitive.service.markRefundProviderCallPending("tenant-1", "workspace-1", "order-1", "refund-1", new PaymentProviderDefinitiveError("ACQ.TRADE_HAS_CLOSE", "ACQ.TRADE_HAS_CLOSE: 交易已关闭"));
  assert.equal(result.status, "failed");
  assert.equal(definitive.refund.externalStatus, "ACQ.TRADE_HAS_CLOSE");
  assert.equal(definitive.refund.responseJson.providerCode, "ACQ.TRADE_HAS_CLOSE");
  assert.match(definitive.refund.failureReason, /交易已关闭/u);

  // 4. 409 stays pending
  const conflict = refundHarness();
  const pendingResult = await conflict.service.markRefundProviderCallPending("tenant-1", "workspace-1", "order-1", "refund-1", new Error("HTTP 409: FREQUENCY_LIMITED"));
  assert.equal(pendingResult.status, "pending");
  assert.equal(conflict.refund.status, "pending");

  // 5. quota released: pending refunds counted, failed not
  const pendingRows = [{ amount: 10, status: "pending", paymentIntentId: "intent-1" }];
  const failedRows = [];
  const quota = (rows) => rows.filter((row) => ["pending", "accepted", "funding_pending"].includes(row.status)).reduce((sum, row) => sum + row.amount, 0);
  assert.equal(quota(pendingRows), 10);
  assert.equal(quota(failedRows), 0);
}

async function testRefundNotFoundOverdue() {
  const stale = refundHarness({ createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000) });
  let captured;
  const svc = stale.service;
  // simulate an Alipay query response w/o refund_status via private method patch: call queryAlipayRefund with fetch stub
  global.fetch = async () => ({ ok: true, status: 200, text: async () => JSON.stringify({ alipay_trade_fastpay_refund_query_response: { code: "10000", msg: "Success" } }) });
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const config = { provider: "alipay", capability: "payment", settings: { appId: "app", gatewayUrl: "https://openapi.alipay.com/gateway.do" }, credentials: { appPrivateKey: privateKey.export({ type: "pkcs8", format: "pem" }) } };
  await assert.rejects(
    () => svc.queryAlipayRefund(config, { merchantOrderNo: "RO-1", externalTransactionId: "t1" }, stale.refund, 0),
    (error) => { captured = error; return error instanceof PaymentProviderDefinitiveError && error.providerCode === "REFUND_NOT_FOUND"; },
    "24 小时后仍查不到的退款必须判定失败"
  );
  assert.ok(captured);
  const fresh = refundHarness();
  const outcome = await svc.queryAlipayRefund(config, { merchantOrderNo: "RO-1", externalTransactionId: "t1" }, fresh.refund, 0);
  assert.equal(outcome.status, "accepted", "24 小时内查不到保持 accepted");
  delete global.fetch;
}

async function testStripeRefundWithoutReceipt() {
  const config = { provider: "stripe", capability: "payment", settings: {}, credentials: {} };
  for (const ageHours of [1, 25, 720]) {
    const { service, refund } = refundHarness({ provider: "stripe", method: "stripe", currency: "USD",
      revision: 1, createdAt: new Date(Date.now() - ageHours * 60 * 60 * 1000) });
    let queries = 0;
    service.stripeRequest = async () => { queries++; throw new Error("不得凭空查询或重新派发"); };
    let unknown;
    await assert.rejects(() => service.queryStripeRefund(config, refund), error => {
      unknown = error;
      return error instanceof PaymentProviderUnknownError;
    });
    assert.equal(refundFailureDisposition(unknown).definitive, false);
    const result = await service.markRefundProviderCallPending("tenant-1", "workspace-1", "order-1", "refund-1", unknown);
    assert.equal(result.status, "pending", "任何等待时长都不能释放原退款占用");
    assert.equal(refund.externalRefundId, null);
    assert.equal(refund.externalStatus, null);
    assert.equal(queries, 0);
  }
  const { service, refund } = refundHarness({ provider: "stripe", currency: "USD", externalRefundId: "re_original" });
  service.stripeRequest = async (_config, method, route) => {
    assert.equal(method, "GET");
    assert.equal(route, "/v1/refunds/re_original");
    return { id: "re_original", status: "succeeded", amount: 1000, payment_intent: "pi_original", currency: "usd" };
  };
  assert.equal((await service.queryStripeRefund(config, refund, "pi_original")).status, "succeeded", "已有原退款号仍可按原回执查询");
}

async function testLateRefundFundingFailure() {
  const { service, refund } = refundHarness({ revision: 1, status: "accepted", updatedAt: new Date() });
  let patches = 0;
  const outcome = { status: "succeeded", externalRefundId: "original-refund", responseJson: { status: "SUCCESS" } };
  const mutate = service.prisma.rentalPaymentRefund.updateMany;
  service.prisma.rentalPaymentRefund.updateMany = async (args) => {
    if (args.where.revision !== refund.revision || args.where.status !== refund.status
      || (args.where.fundedAt === null && refund.fundedAt)) return { count: 0 };
    patches++;
    return mutate(args);
  };
  service.prisma.$transaction = async () => {
    Object.assign(refund, { revision: 3, status: "succeeded", externalRefundId: "original-refund", fundedAt: new Date(), failureReason: null });
    throw new Error("late transaction response failure");
  };
  assert.equal((await service.applyProviderRefundOutcome("tenant-1", "workspace-1", "order-1", "refund-1", outcome)).status, "succeeded");
  assert.equal(patches, 0, "已入账退款不能被迟到异常改回 funding_pending");
  refund.fundedAt = null;
  refund.status = "accepted";
  service.prisma.$transaction = async () => { throw new Error("funding write unavailable"); };
  const find = service.prisma.rentalPaymentRefund.findFirst;
  service.prisma.rentalPaymentRefund.findFirst = async () => ({ ...await find() });
  const pending = service.prisma.rentalPaymentRefund.updateMany;
  service.prisma.rentalPaymentRefund.updateMany = async (args) => {
    refund.revision++;
    refund.status = "succeeded";
    refund.fundedAt = new Date();
    return pending(args);
  };
  assert.equal((await service.applyProviderRefundOutcome("tenant-1", "workspace-1", "order-1", "refund-1", outcome)).status, "succeeded");
  assert.equal(patches, 0, "异常补记前并发入账也必须受原revision及fundedAt保护");
  refund.fundedAt = null;
  refund.status = "accepted";
  service.prisma.rentalPaymentRefund.updateMany = pending;
  assert.equal((await service.applyProviderRefundOutcome("tenant-1", "workspace-1", "order-1", "refund-1", outcome)).status, "funding_pending");
  assert.equal(patches, 1, "未入账且版本未变时仍保存原成功收据供恢复");
  assert.equal(refund.externalRefundId, "original-refund");
}

async function testRefundTxLocksProviderConfig() {
  const calls = [];
  const intent = { id: "intent-1", tenantId: "tenant-1", workspaceId: "workspace-1", orderId: "order-1", method: "alipay", provider: "alipay", status: "paid", externalTransactionId: "t1", amount: 100, currency: "CNY", merchantOrderNo: "RO-1" };
  const tx = {
    $queryRaw: async () => [],
    rentalPaymentIntent: { findFirst: async () => intent },
    rentalPaymentRefund: { findFirst: async () => null, findMany: async () => [], create: async ({ data }) => ({ id: "refund-new", createdAt: new Date(), updatedAt: new Date(), ...data }) }
  };
  const prisma = {
    ...noopLog,
    rentalPaymentIntent: { findFirst: async () => intent },
    rentalPaymentRefund: { findFirst: async () => null, updateMany: async () => ({ count: 1 }), update: async (args) => ({ ...args.data }) },
    $transaction: async (callback) => callback(tx)
  };
  const integrations = {
    runtimeConfig: async () => ({ provider: "alipay", capability: "payment", settings: {}, credentials: {} }),
    assertEnabledInTransaction: async (_tx, tenantId, capability, provider) => { calls.push({ tenantId, capability, provider }); throw new Error("provider disabled"); }
  };
  const funding = { listEvents: async () => ({ rental: { balance: -100, pendingExtensionAmount: 0 } }) };
  const service = new PaymentRuntimeService(prisma, integrations, funding);
  await assert.rejects(() => service.createPaymentRefund("tenant-1", "workspace-1", "order-1", "intent-1", { amount: 10, reason: "r", idempotencyKey: "k1" }), /provider disabled/u);
  assert.deepEqual(calls, [{ tenantId: "tenant-1", capability: "payment", provider: "alipay" }], "退款事务必须锁配置行");
}

async function testExpiredPendingAutoClosedOnCreate() {
  const closedUpdates = [];
  const expired = { id: "intent-old", status: "pending", method: "alipay", merchantOrderNo: "RO-OLD", expiresAt: new Date(Date.now() - 60_000) };
  let created;
  const tx = {
    $queryRaw: async () => [{ id: "order-1", orderNo: "ORD-1", finalPayableAmount: 100, currency: "CNY" }],
    rentalPaymentIntent: {
      findUnique: async () => null,
      findFirst: async () => expired,
      updateMany: async ({ where, data }) => { closedUpdates.push({ where, data }); return { count: 1 }; },
      create: async ({ data }) => { created = { id: "intent-new", createdAt: new Date(), ...data }; return created; }
    }
  };
  const providerCalls = [];
  const prisma = {
    ...noopLog,
    rentalPaymentIntent: {
      findUnique: async () => null,
      findFirst: async () => created,
      updateMany: async ({ where, data }) => {
        if (where.status !== created.status) return { count: 0 };
        Object.assign(created, data);
        return { count: 1 };
      }
    },
    $transaction: async (callback) => callback(tx)
  };
  const integrations = {
    runtimeConfig: async () => ({ provider: "alipay", capability: "payment", settings: { appId: "a", gatewayUrl: "https://openapi.alipay.com/gateway.do", notifyUrl: "https://example.com/n" }, credentials: { appPrivateKey: "k" } }),
    assertEnabledInTransaction: async () => undefined
  };
  const funding = { listEvents: async () => ({ rental: { balance: 100, pendingExtensionAmount: 0 } }) };
  const service = new PaymentRuntimeService(prisma, integrations, funding);
  service.closeAlipayIntent = async (_config, merchantOrderNo) => { providerCalls.push(`close:${merchantOrderNo}`); };
  service.createAlipayIntent = async (_config, intent) => {
    assert.ok(intent.expiresAt instanceof Date);
    return { checkoutUrl: "https://qr", responseCode: "10000", responseJson: {} };
  };
  const response = await service.createPaymentIntent("tenant-1", "workspace-1", "order-1", { instrument: "rental", method: "alipay", idempotencyKey: "new-key" });
  assert.equal(response.status, "pending");
  assert.equal(closedUpdates.length, 1);
  assert.equal(closedUpdates[0].where.id, "intent-old");
  assert.deepEqual(closedUpdates[0].data, { status: "closed", failureReason: "expired" });
  assert.deepEqual(providerCalls, ["close:RO-OLD"], "平台侧关单是尽力而为但必须尝试");

  // not-yet-expired pending still blocks
  expired.expiresAt = new Date(Date.now() + 60_000);
  await assert.rejects(() => service.createPaymentIntent("tenant-1", "workspace-1", "order-1", { instrument: "rental", method: "alipay", idempotencyKey: "another" }), /待完成的支付/u);

  // verified_pending_funding is never treated as expired even if past expiresAt
  expired.expiresAt = new Date(Date.now() - 60_000);
  expired.status = "verified_pending_funding";
  await assert.rejects(() => service.createPaymentIntent("tenant-1", "workspace-1", "order-1", { instrument: "rental", method: "alipay", idempotencyKey: "third" }), /待完成的支付/u);
}

async function testExpireStaleJob() {
  const intents = [
    { id: "i-unpaid", tenantId: "t", workspaceId: "w", orderId: "o1", method: "alipay", provider: "alipay", merchantOrderNo: "RO-A", amount: 10, status: "pending", expiresAt: new Date(Date.now() - 1000) },
    { id: "i-paid", tenantId: "t", workspaceId: "w", orderId: "o2", method: "wechat_pay", provider: "wechat_pay", merchantOrderNo: "RO-B", amount: 20, status: "pending", expiresAt: new Date(Date.now() - 1000) }
  ];
  const updates = [];
  const settled = [];
  const closed = [];
  const prisma = {
    ...noopLog,
    rentalPaymentIntent: {
      findMany: async ({ where, take }) => { assert.equal(where.status, "pending"); assert.ok(where.expiresAt.lt instanceof Date); assert.equal(take, 50); return intents; },
      updateMany: async ({ where, data }) => { updates.push({ where, data }); return { count: 1 }; }
    }
  };
  const integrations = { runtimeConfig: async (_c, _t, method, options) => { assert.equal(options.requireLiveTest, false); return { provider: method, capability: "payment", settings: {}, credentials: {} }; } };
  const service = new PaymentRuntimeService(prisma, integrations, {});
  service.queryAlipayIntent = async () => ({ state: "WAIT_BUYER_PAY", paid: false, closed: false, amount: 0, externalTransactionId: "" });
  service.queryWechatIntent = async () => ({ state: "SUCCESS", paid: true, closed: false, amount: 20, externalTransactionId: "wx-1" });
  service.closeAlipayIntent = async (_c, no) => { closed.push(no); };
  service.settleVerifiedPayment = async (input) => { settled.push(input); };
  const summary = await service.expireStalePaymentIntents("t", "w");
  assert.equal(summary.scanned, 2);
  assert.equal(summary.closed, 1);
  assert.equal(summary.paid, 1);
  assert.deepEqual(summary.errors, []);
  assert.deepEqual(closed, ["RO-A"]);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].where.id, "i-unpaid");
  assert.equal(settled.length, 1);
  assert.equal(settled[0].intentId, "i-paid");
  assert.equal(settled[0].externalTransactionId, "wx-1");
  assert.equal(service.expireStalePaymentIntents.length, 2, "签名 (tenantId, workspaceId, take = 50)");
}

async function testCloseAllowsResetLiveTest() {
  const options = [];
  const intent = { id: "i", tenantId: "t", workspaceId: "w", orderId: "o", status: "pending", method: "alipay", merchantOrderNo: "RO", expiresAt: new Date(), amount: 1, currency: "CNY", provider: "alipay" };
  const prisma = { ...noopLog, rentalPaymentIntent: { findFirst: async () => intent, updateMany: async ({ data }) => { Object.assign(intent, data); return { count: 1 }; } } };
  const service = new PaymentRuntimeService(prisma, { runtimeConfig: async (_c, _t, _m, opts) => { options.push(opts); return { provider: "alipay", capability: "payment", settings: {}, credentials: {} }; } }, {});
  service.closeAlipayIntent = async () => undefined;
  const response = await service.closePaymentIntent("t", "w", "o", "i");
  assert.equal(response.status, "closed");
  assert.deepEqual(options, [{ requireLiveTest: false }], "关单只要求 enabled，不要求 live 测试");
}

async function testWebhookRateLimit() {
  let now = 0;
  const limiter = new PaymentWebhookRateLimiter({ limitPerMinute: 3, now: () => now });
  assert.equal(limiter.allow("1.1.1.1"), true);
  assert.equal(limiter.allow("1.1.1.1"), true);
  assert.equal(limiter.allow("1.1.1.1"), true);
  assert.equal(limiter.allow("1.1.1.1"), false, "第 4 次应被拒");
  assert.equal(limiter.allow("2.2.2.2"), true, "不同 IP 独立");
  now = 20_001; // 1/3 minute → 1 token refilled
  assert.equal(limiter.allow("1.1.1.1"), true);
  assert.equal(limiter.allow("1.1.1.1"), false);
  now = 10 * 60 * 1000; // prune after idle TTL
  limiter.allow("3.3.3.3");
  assert.equal(limiter.size, 1, "闲置桶应被清理");
  assert.equal(new PaymentWebhookRateLimiter({ limitPerMinute: 0 }).allow("x"), true, "0 = 关闭");

  const controller = new PaymentWebhookController({ handleAlipayCallback: async () => "success" });
  controller.rateLimiter = new PaymentWebhookRateLimiter({ limitPerMinute: 1 });
  assert.equal(await controller.alipay({ body: {}, headers: {}, ip: "9.9.9.9" }), "success");
  await assert.rejects(async () => controller.alipay({ body: {}, headers: {}, ip: "9.9.9.9" }), (error) => error.getStatus() === 429);
}

async function testCallbackRequiresLiveTest() {
  const wheres = [];
  const svc = new TenantIntegrationService({ tenantIntegrationConfig: { findMany: async ({ where }) => { wheres.push(where); return []; } } }, {}, {});
  await svc.runtimeConfigsForCallback("alipay");
  assert.equal(wheres[0].enabled, true);
  assert.equal(wheres[0].lastTestStatus, "passed");
  assert.equal(wheres[0].lastTestMode, "live");

  // 30s cache in the runtime service
  let loads = 0;
  const payments = new PaymentRuntimeService({}, { runtimeConfigsForCallback: async () => { loads += 1; return []; } }, {});
  await assert.rejects(() => payments.handleAlipayCallback({ app_id: "x" }), /商户不存在/u);
  await assert.rejects(() => payments.handleAlipayCallback({ app_id: "x" }), /商户不存在/u);
  assert.equal(loads, 1, "30 秒内只加载一次");
  payments.clearCallbackConfigCache();
  await assert.rejects(() => payments.handleAlipayCallback({ app_id: "x" }), /商户不存在/u);
  assert.equal(loads, 2);

  // WeChat skew check runs before configs are loaded
  let wechatLoads = 0;
  const wechat = new PaymentRuntimeService({}, { runtimeConfigsForCallback: async () => { wechatLoads += 1; return []; } }, {});
  await assert.rejects(() => wechat.handleWechatCallback({ rawBody: Buffer.from("{}"), headers: { "wechatpay-timestamp": "1", "wechatpay-serial": "S" } }), /已过期/u);
  assert.equal(wechatLoads, 0, "时间戳偏差过大时不得加载配置");
}

// 自签测试证书（无私钥、无用途），仅供解析与序列号比对；序列号 38C7FD5D8C5545C87549670ADC5721DCE5BB4E76。
const TEST_PLATFORM_CERT = `-----BEGIN CERTIFICATE-----
MIIC4zCCAcugAwIBAgIUOMf9XYxVRch1SWcK3Fch3OW7TnYwDQYJKoZIhvcNAQEL
BQAwADAgFw0yNjA5MTkwNTAwMTdaGA8yMTI2MDgyNjA1MDAxN1owADCCASIwDQYJ
KoZIhvcNAQEBBQADggEPADCCAQoCggEBAJ2aOypSja4Bt4I479iCkkNlLzbSrkMz
nroJP1EtJxscJMVsZiio+FIg0cfr0R3CLePPsl2fyet4fIuN7WhgOTdXPo4Jk57x
T62lmxtBPfbKSXLPWbbMXbhxHVTOIP4gmmEL3XCfU7aSyNojGu3+LW97xyc1+MKJ
yWy6Rk9VHaLUEOhILQpqo5eWopdxwsqw2meJqxu/AOntj8QPoX/4G7ORqa0RKwvh
0FvHNIkZVgcNG7PADgrYFXu+zywqs//aSfmRpj5imLsRzYKZExeqMHNvnb9+zwhy
YRA7kXDZFhMX/NGM5qRiwLv2ZbOes+ZgsYCRP+jKTb45dWhZVV7u30ECAwEAAaNT
MFEwHQYDVR0OBBYEFCSQHigkIMGljkVbSXptIxAN6TPcMB8GA1UdIwQYMBaAFCSQ
HigkIMGljkVbSXptIxAN6TPcMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQEL
BQADggEBAEahUgnLD2ZwW6yKcNzj+ZinaFfYOwvPX1Fj48NP7yD6shD6MEP1hQ8b
uzuY6tLWDQr4guX5oo8T7g0coswfKq2rGtiAvSOEemjRxvvKg+VV5sk0M0av/5xC
BsrN6EIrfm72FrouICYGlEsmKA+w0NG6J+byUfmT0KE/9T0Gggu1RUV+AY5D5kRd
O0B1cb65JCfbL1gAkHsBldWcuZwoH3Os8jvf4V71mKDVuRCfIse4XjrTTUU/4J9f
RtOin+j1h63NrbqsHhG0EiiQA58DEyBg02OXrZzVSLg6IDblCPrBZ7D6MIostoJ6
hOCodgEKpnrBojRFlliH/1Z21eyqS2Q=
-----END CERTIFICATE-----`;

async function testWechatLiveTestValidation() {
  const service = new PaymentRuntimeService(noopLog, {}, {});
  const key32 = "01234567890123456789012345678901";
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const bad = { provider: "wechat_pay", settings: { platformCertificateSerial: "AB" }, credentials: { apiV3Key: "short", wechatPlatformCertificate: privateKey.export({ type: "pkcs8", format: "pem" }) } };
  assert.throws(() => service.assertWechatCallbackMaterial(bad), /32 字节/u);
  bad.credentials.apiV3Key = key32;
  assert.throws(() => service.assertWechatCallbackMaterial(bad), /无法解析/u, "非证书 PEM 必须被拒绝");
  const serial = new X509Certificate(TEST_PLATFORM_CERT).serialNumber;
  const ok = { provider: "wechat_pay", settings: { platformCertificateSerial: serial.toLowerCase() }, credentials: { apiV3Key: key32, wechatPlatformCertificate: TEST_PLATFORM_CERT } };
  service.assertWechatCallbackMaterial(ok);
  ok.settings.platformCertificateSerial = "DEADBEEF";
  assert.throws(() => service.assertWechatCallbackMaterial(ok), /序列号不一致/u);
  // testConnection must run the local check before any network call
  let queried = 0;
  service.queryWechatIntent = async () => { queried += 1; return {}; };
  await assert.rejects(() => service.testConnection({ ...ok, credentials: { ...ok.credentials, apiV3Key: "short" } }), /32 字节/u);
  assert.equal(queried, 0, "本地材料校验失败时不得发起网络请求");
  ok.settings.platformCertificateSerial = serial;
  assert.match(await service.testConnection(ok), /响应验签材料/u);
  assert.equal(queried, 1);

  const { privateKey: signingKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const publicKeyConfig = {
    provider: "wechat_pay",
    tenantId: "tenant-public-key",
    settings: { platformPublicKeyId: "PUB_KEY_ID_123456" },
    credentials: {
      apiV3Key: key32,
      wechatPlatformPublicKey: publicKey.export({ type: "spki", format: "pem" }).toString()
    }
  };
  service.assertWechatCallbackMaterial(publicKeyConfig);
  assert.throws(() => service.assertWechatCallbackMaterial({ ...publicKeyConfig, settings: { platformPublicKeyId: "wrong" } }), /公钥 ID/u);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = "response-nonce";
  const body = JSON.stringify({ code: "SUCCESS" });
  const signedMessage = `${timestamp}\n${nonce}\n${body}\n`;
  const signer = createSign("RSA-SHA256");
  signer.update(signedMessage);
  signer.end();
  const signature = signer.sign(signingKey, "base64");
  assert.equal(service.verifyWechatSignedMessage(publicKeyConfig, "PUB_KEY_ID_123456", timestamp, nonce, signature, body), true);
  assert.equal(service.verifyWechatSignedMessage(publicKeyConfig, "PUB_KEY_ID_123457", timestamp, nonce, signature, body), false, "公钥 ID 不匹配时不得尝试其他密钥");
  assert.doesNotThrow(() => service.verifyWechatApiResponse(publicKeyConfig, new Response(body, { headers: {
    "Wechatpay-Timestamp": timestamp,
    "Wechatpay-Nonce": nonce,
    "Wechatpay-Signature": signature,
    "Wechatpay-Serial": "PUB_KEY_ID_123456"
  } }), body));
  assert.throws(() => service.verifyWechatApiResponse(publicKeyConfig, new Response(body, { headers: {
    "Wechatpay-Timestamp": timestamp,
    "Wechatpay-Nonce": nonce,
    "Wechatpay-Signature": signature,
    "Wechatpay-Serial": "PUB_KEY_ID_123457"
  } }), body), /验签失败/u);

  const rawBody = Buffer.from(JSON.stringify({ resource: { nonce: "x" } }));
  const callbackTimestamp = String(Math.floor(Date.now() / 1000));
  const callbackNonce = "callback-nonce";
  const callbackSigner = createSign("RSA-SHA256");
  callbackSigner.update(`${callbackTimestamp}\n${callbackNonce}\n${rawBody.toString("utf8")}\n`);
  callbackSigner.end();
  const callbackSignature = callbackSigner.sign(signingKey, "base64");
  service.callbackConfigs = async () => [publicKeyConfig];
  await assert.rejects(() => service.handleWechatCallback({ rawBody, headers: {
    "wechatpay-timestamp": callbackTimestamp,
    "wechatpay-nonce": callbackNonce,
    "wechatpay-signature": callbackSignature,
    "wechatpay-serial": "PUB_KEY_ID_123456"
  } }), /商户身份不匹配/u, "签名合法的公钥回调必须继续走到商户身份/资源校验");
  await assert.rejects(() => service.handleWechatCallback({ rawBody, headers: {
    "wechatpay-timestamp": callbackTimestamp,
    "wechatpay-nonce": callbackNonce,
    "wechatpay-signature": "invalid-signature",
    "wechatpay-serial": "PUB_KEY_ID_123456"
  } }), /验签失败/u);
}

function testFormatting() {
  const date = new Date("2026-09-19T03:04:05Z");
  assert.equal(alipayExpireTime(date), "2026-09-19 11:04:05");
  assert.equal(wechatExpireTime(date), "2026-09-19T11:04:05+08:00");
  assert.equal(toCents(1.005), 101, "toCents 必须与 roundMoney 一致");
  assert.equal(toCents(12.34), 1234);
}

async function main() {
  testFormatting();
  await testDefinitiveMapping();
  await testRefundNotFoundOverdue();
  await testStripeRefundWithoutReceipt();
  await testLateRefundFundingFailure();
  await testRefundTxLocksProviderConfig();
  await testExpiredPendingAutoClosedOnCreate();
  await testExpireStaleJob();
  await testCloseAllowsResetLiveTest();
  await testWebhookRateLimit();
  await testCallbackRequiresLiveTest();
  await testWechatLiveTestValidation();
  console.log("payment refund terminal / intent expiry / webhook hardening tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
