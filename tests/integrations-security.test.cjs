const assert = require("node:assert/strict");
/** 公共出站URL与当前配置门禁原例；支付/文件/短信业务参加者完整原件由独立 Rental 组合保留。 */
const outbound = require("@rental-os/platform-server/outbound-url");
const originalNodeEnv = process.env.NODE_ENV;

process.env.NODE_ENV = "production";
assert.throws(() => outbound.parseOutboundUrl("http://example.com", "网关"), /HTTPS/);
assert.throws(() => outbound.parseOutboundUrl("https://127.0.0.1:9000", "Endpoint"), /本机/);
assert.throws(() => outbound.parseOutboundUrl("https://[::ffff:127.0.0.1]", "Endpoint"), /本机/);
assert.throws(() => outbound.parseOutboundUrl("https://example.com/path?secret=1", "Endpoint"), /查询参数/);
assert.throws(() => outbound.parseOutboundUrl("https://example.com@public.example", "Endpoint"), /账号或密码/);
assert.throws(() => outbound.parseOutboundUrl("https://custom.example/gateway", "支付宝网关", { productionHosts: ["openapi.alipay.com"] }), /允许的生产平台/);
assert.doesNotThrow(() => outbound.parseOutboundUrl("https://openapi.alipay.com/gateway.do", "支付宝网关", { productionHosts: ["openapi.alipay.com"] }));

(async () => {
  const { TenantIntegrationService } = require("@rental-os/platform-server/tenant-integration");
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
  console.log("public integration security probes passed: outbound URL, live-test requirement, recovery read, default provider and in-transaction gate");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
});
