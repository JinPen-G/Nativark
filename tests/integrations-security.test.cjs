const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const outbound = require(path.join(repo, "apps", "api", "dist", "common", "outbound-url.js"));

process.env.NODE_ENV = "production";
assert.throws(() => outbound.parseOutboundUrl("http://example.com", "网关"), /HTTPS/);
assert.throws(() => outbound.parseOutboundUrl("https://127.0.0.1:9000", "Endpoint"), /本机/);
assert.throws(() => outbound.parseOutboundUrl("https://[::ffff:127.0.0.1]", "Endpoint"), /本机/);
assert.throws(() => outbound.parseOutboundUrl("https://example.com/path?secret=1", "Endpoint"), /查询参数/);
assert.throws(() => outbound.parseOutboundUrl("https://example.com@public.example", "Endpoint"), /账号或密码/);
assert.throws(() => outbound.parseOutboundUrl("https://custom.example/gateway", "支付宝网关", { productionHosts: ["openapi.alipay.com"] }), /允许的生产平台/);
assert.doesNotThrow(() => outbound.parseOutboundUrl("https://openapi.alipay.com/gateway.do", "支付宝网关", { productionHosts: ["openapi.alipay.com"] }));

const paymentSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "payment.runtime.service.ts"), "utf8");
const fileSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "file-storage.runtime.service.ts"), "utf8");
const smsSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "tenant-integration.runtime.service.ts"), "utf8");
const notificationSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "rental-core", "rental-business.service.ts"), "utf8");
const notificationFactSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "rental-core", "rental-business-fact.repository.ts"), "utf8");
const notificationSchema = fs.readFileSync(path.join(repo, "apps", "api", "prisma", "schema.prisma"), "utf8");
const authSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "client", "client-auth.service.ts"), "utf8");
const guardSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "common", "api-auth.guard.ts"), "utf8");
const openapiSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "contracts", "openapi-document.ts"), "utf8");
const integrationSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "tenant-integration.service.ts"), "utf8");
const integrationsServiceSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "integrations.service.ts"), "utf8");

assert.match(paymentSource, /decrypted\.mchid/);
assert.match(paymentSource, /decrypted\.appid/);
assert.match(paymentSource, /provider_eventId/);
assert.match(paymentSource, /FOR UPDATE/);
assert.match(paymentSource, /TransactionIsolationLevel\.Serializable/);
assert.match(paymentSource, /redirect: "error"/);
assert.match(paymentSource, /status: \{ in: \["pending", "verified_pending_funding"\] \}/);
assert.match(paymentSource, /微信支付回调格式无效/);
assert.match(paymentSource, /rental_orders[\s\S]{0,260}FOR UPDATE/);
assert.match(paymentSource, /相同退款幂等键已用于不同金额或原因/);
assert.match(paymentSource, /funding_pending/);
assert.match(paymentSource, /SUCCESS_AMOUNT_MISMATCH/);
assert.match(paymentSource, /handleWechatRefundCallback/);
assert.match(paymentSource, /handleAlipayRefundCallback/);
assert.match(paymentSource, /eventProvider = `\$\{input\.provider\}_refund`/);
assert.match(paymentSource, /refundNotifyUrl/);
assert.match(paymentSource, /settings\.platformCertificateSerial/);
assert.doesNotMatch(paymentSource, /credentials\.merchantSerialNo\) === serial/);
assert.match(paymentSource, /当前退款金额不足/);
assert.match(paymentSource, /paymentIntentId: intentId, idempotencyHash/);
assert.match(paymentSource, /status: \{ in: \["pending", "accepted", "funding_pending"\] \}/);
assert.match(fileSource, /content-length/);
assert.match(fileSource, /actualType === expectedType/);
assert.match(fileSource, /redirect: "error"/);
assert.match(fileSource, /this\.presign\(config, "HEAD", storageKey/);
assert.match(fileSource, /this\.presign\(config, "DELETE", storageKey/);
assert.match(fileSource, /safeObjectPrefix/);
assert.match(fileSource, /safeBucket/);
assert.match(fileSource, /assertBusinessReference/);
assert.match(fileSource, /cleanup_in_progress/);
assert.match(fileSource, /cleanupExpiredUploadSessions/);
assert.doesNotMatch(fileSource, /return \{ sessionId: session\.id, fileAssetId: asset\.id, provider: session\.provider, mode, status: session\.status, storageKey:/u);
assert.match(smsSource, /redirect: "error"/);
assert.match(smsSource, /assertOutboundUrl/);
assert.match(smsSource, /sendNotificationSms/);
assert.match(smsSource, /variableKeys: names/);
assert.match(notificationSource, /recipientEncrypted/);
assert.match(notificationSource, /先落 queued/);
assert.match(notificationSource, /claimNotificationDelivery/);
assert.match(notificationSource, /notification:\$\{id\}/);
assert.match(notificationSource, /只有真实短信通知支持重试/);
assert.match(notificationFactSource, /attempts: \{ increment: 1 \}/);
assert.match(notificationFactSource, /attempts: current\.attempts/);
assert.match(notificationSchema, /recipientEncrypted\s+String\?\s+@db\.Text/);
assert.match(notificationSchema, /rental_notification_logs_ws_retry_idx/);
assert.match(authSource, /CHALLENGE_COOLDOWN_SECONDS/);
assert.match(authSource, /identifierHash/);
assert.match(authSource, /SELECT id FROM business_workspaces/);
assert.match(authSource, /FOR UPDATE/);
assert.match(guardSource, /path\.startsWith\("\/platform\/integrations"\)/);
assert.match(guardSource, /path\.startsWith\("\/rental\/v1\/notification-templates"\)[\s\S]{0,260}return \["system:integration:manage"\]/u);
assert.doesNotMatch(guardSource, /path\.startsWith\("\/rental\/v1\/notification-templates"\)[\s\S]{0,260}system:params:manage/u);
assert.match(guardSource, /path\.startsWith\("\/files"\)[\s\S]{0,220}return \["system:integration:manage"\]/u);
assert.doesNotMatch(guardSource, /path\.startsWith\("\/files"\)[\s\S]{0,220}system:params:manage/u);
assert.match(openapiSource, /notification-templates[\s\S]{0,220}system:integration:manage/u);
assert.doesNotMatch(openapiSource, /notification-templates[\s\S]{0,220}system:params:manage/u);
assert.match(openapiSource, /backlogOperation\("get", "\/api\/files"[\s\S]{0,150}system:integration:manage/u);
assert.doesNotMatch(openapiSource, /backlogOperation\("(?:get|post)", "\/api\/files"[\s\S]{0,150}system:files:manage/u);
assert.match(integrationSource, /requireLiveTest\?: boolean/u);
assert.match(integrationSource, /requireDefault\?: boolean/u);
assert.match(integrationSource, /options\.requireDefault \? Prisma\.sql`AND isDefault = 1`/u);
assert.match(integrationSource, /row\.lastTestStatus !== "passed"/u);
assert.match(integrationSource, /row\.lastTestMode !== "live"/u);
assert.match(integrationSource, /requireLiveTest !== false/u);
assert.match(fileSource, /requireLiveTest: false/u);
assert.match(paymentSource, /requireLiveTest: false/u);
assert.match(paymentSource, /runtimeConfig\("payment", tenantId, input\.method, \{ requireDefault: true \}\)/u);
assert.match(paymentSource, /assertEnabledInTransaction\(tx, tenantId, "payment", config\.provider, \{ requireDefault: true \}\)/u);
assert.match(smsSource, /requireLiveTest: false/u);
assert.match(smsSource, /hasEnabledProvider/u);
assert.match(notificationSource, /生产环境尚未配置默认短信平台/u);
assert.match(notificationSource, /smsProviderConfigured/u);
assert.match(integrationsServiceSource, /生产环境禁止创建模拟文件资产/u);
assert.match(integrationsServiceSource, /生产环境禁止通过模拟入口记录短信发送/u);
assert.match(integrationsServiceSource, /生产环境禁止调用支付、短信或文件模拟适配器/u);

(async () => {
  const { TenantIntegrationService } = require(path.join(repo, "apps", "api", "dist", "modules", "integrations", "tenant-integration.service.js"));
  const row = {
    id: "cfg_sms_1",
    tenantId: "tenant_1",
    capability: "sms",
    provider: "aliyun_sms",
    enabled: true,
    isDefault: true,
    settings: { region: "cn-hangzhou", signName: "演示", verificationTemplateCode: "SMS_001" },
    credentialsEncrypted: "sealed",
    secretFields: ["accessKeyId", "accessKeySecret"],
    lastTestStatus: "not_tested",
    lastTestMode: "none",
    lastTestAt: null,
    lastTestError: null,
    createdAt: new Date(),
    updatedAt: new Date()
  };
  const service = new TenantIntegrationService(
    { tenantIntegrationConfig: { findFirst: async () => row } },
    { decrypt: () => ({ accessKeyId: "access-key", accessKeySecret: "access-secret" }) },
    { record: async () => undefined }
  );
  await assert.rejects(
    service.runtimeConfig("sms", "tenant_1"),
    /尚未通过真实连接测试/u,
    "未通过 live 测试的启用配置不得进入新的短信发送链"
  );
  const recoveryConfig = await service.runtimeConfig("sms", "tenant_1", undefined, { requireLiveTest: false });
  assert.equal(recoveryConfig?.provider, "aliyun_sms", "既有事实的恢复查询可以显式绕过 live 门禁");
  row.lastTestStatus = "passed";
  row.lastTestMode = "live";
  const verifiedConfig = await service.runtimeConfig("sms", "tenant_1");
  assert.equal(verifiedConfig?.provider, "aliyun_sms", "通过 live 测试后新短信发送链可使用配置");
  const paymentRow = {
    ...row,
    id: "cfg_payment_1",
    capability: "payment",
    provider: "alipay",
    isDefault: false,
    settings: {
      appId: "app_1",
      gatewayUrl: "https://openapi.alipay.com/gateway.do",
      notifyUrl: "https://example.com/payment-notify"
    },
    secretFields: ["appPrivateKey", "alipayPublicKey"]
  };
  let paymentWhere;
  const paymentService = new TenantIntegrationService(
    { tenantIntegrationConfig: { findFirst: async ({ where }) => { paymentWhere = where; return where.isDefault && !paymentRow.isDefault ? null : paymentRow; } } },
    { decrypt: () => ({ appPrivateKey: "private-key", alipayPublicKey: "public-key" }) },
    { record: async () => undefined }
  );
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";
  const nonDefaultPayment = await paymentService.runtimeConfig("payment", "tenant_1", "alipay", { requireDefault: true });
  assert.equal(nonDefaultPayment, undefined, "新建支付不能选择已启用但非默认的支付平台");
  assert.equal(paymentWhere.isDefault, true, "新建支付的配置查询必须限定当前默认平台");
  paymentRow.isDefault = true;
  const defaultPayment = await paymentService.runtimeConfig("payment", "tenant_1", "alipay", { requireDefault: true });
  assert.equal(defaultPayment?.provider, "alipay", "当前默认且已 live 验证的支付平台才可创建新支付");
  process.env.NODE_ENV = previousNodeEnv;
  await assert.rejects(
    service.assertEnabledInTransaction(
      { $queryRaw: async () => [{ id: "cfg_sms_1", enabled: true, lastTestStatus: "failed", lastTestMode: "live" }] },
      "tenant_1",
      "sms",
      "aliyun_sms"
    ),
    /尚未通过真实连接测试/u,
    "进行中事实落库前必须在配置行锁内再次确认 live 门禁"
  );
  const { IntegrationsService } = require(path.join(repo, "apps", "api", "dist", "modules", "integrations", "integrations.service.js"));
  const mockIntegrationService = new IntegrationsService({ get: () => "mysql" }, {});
  await assert.rejects(
    mockIntegrationService.createFile({
      businessModule: "test",
      businessType: "test",
      businessId: "test",
      fileName: "fake.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      uploadScene: "test"
    }),
    /生产环境禁止创建模拟文件资产/u,
    "生产环境不得通过旧元数据接口生成 local_mock 文件资产"
  );
  await assert.rejects(
    mockIntegrationService.sendNotification({ channels: ["SMS"], businessType: "rental_order" }),
    /生产环境禁止通过模拟入口记录短信发送/u,
    "生产环境不得用通用模拟入口伪造短信发送"
  );
  await assert.rejects(
    mockIntegrationService.invokeMockAdapter({ provider: "mock-payment-adapter", capability: "payment", operation: "create" }),
    /生产环境禁止调用支付、短信或文件模拟适配器/u,
    "生产环境不得调用支付模拟适配器"
  );
  assert.match(fileSource, /生产环境禁止完成模拟文件上传/u, "生产环境不得完成 local_mock 上传会话");
  assert.match(fileSource, /生产环境禁止访问未归档的模拟文件/u, "生产环境不得暴露 local_mock 文件下载引用");
  assert.match(fileSource, /生产环境禁止重放模拟文件上传/u, "生产环境不得通过幂等重放返回 local_mock 上传会话");
  console.log("integration security probes passed: SSRF, callback binding, payment race, upload verification, SMS cooldown, runtime gate and route permission");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
