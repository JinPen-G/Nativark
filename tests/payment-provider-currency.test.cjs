const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const {
  paymentProviderSupportsCurrency,
  paymentProvidersForCurrency,
  findTenantIntegrationProvider
} = require("@rental-os/shared");
const { TenantIntegrationService } = require("../apps/api/src/modules/integrations/tenant-integration.service");

// —— 纯函数:按结算币种筛收单平台(唯一事实源) ——
const alipayDef = findTenantIntegrationProvider("payment", "alipay");
const wechatDef = findTenantIntegrationProvider("payment", "wechat_pay");
const smsDef = findTenantIntegrationProvider("sms", "aliyun_sms");

assert.equal(paymentProviderSupportsCurrency(alipayDef, "CNY"), true, "支付宝支持 CNY");
assert.equal(paymentProviderSupportsCurrency(alipayDef, "HKD"), false, "境内支付宝不支持 HKD");
assert.equal(paymentProviderSupportsCurrency(wechatDef, "CNY"), true, "微信支持 CNY");
assert.equal(paymentProviderSupportsCurrency(smsDef, "CNY"), false, "短信平台没有结算币种,不参与筛选");

assert.deepEqual(
  paymentProvidersForCurrency("CNY").map((d) => d.provider).sort(),
  ["alipay", "wechat_pay"],
  "CNY 可用境内支付宝/微信"
);
assert.deepEqual(paymentProvidersForCurrency("HKD").map((d) => d.provider), ["stripe"], "HKD 走跨境 Stripe");
assert.equal(paymentProviderSupportsCurrency(findTenantIntegrationProvider("payment", "stripe"), "CNY"), false, "Stripe 不接 CNY(境内归支付宝/微信)");
assert.deepEqual(paymentProvidersForCurrency("MOP"), [], "MOP 暂无可用收单平台(Stripe 未列入、境内不适用)");

// —— 服务层:目录过滤 + 启用后端强约束 ——
function serviceFor(currency) {
  const client = {
    rentalTenantBusinessSettings: {
      findFirst: async () => (currency ? { settings: { pricing: { currency } } } : null)
    },
    tenantIntegrationConfig: {
      findMany: async () => []
    }
  };
  const secretBox = { encrypt: (v) => JSON.stringify(v), decrypt: (v) => JSON.parse(v) };
  const operationLog = { record: async () => undefined };
  return new TenantIntegrationService(client, secretBox, operationLog);
}

const user = (tenantId) => ({ tenantId, account: "admin", displayName: "管理员", isSaasAdmin: false });

(async () => {
  // 境外(HKD)租户:目录出现跨境 Stripe,但不含境内支付宝/微信;短信照常保留。
  const hkCatalog = await serviceFor("HKD").catalog("tenant_hk");
  assert.deepEqual(
    hkCatalog.providers.filter((p) => p.capability === "payment").map((p) => p.provider).sort(),
    ["stripe"],
    "境外租户支付平台只应有跨境 Stripe"
  );
  assert.equal(hkCatalog.providers.some((p) => p.capability === "sms"), true, "短信平台与币种无关,应保留");

  // 境外租户启用境内支付宝 → 后端强约束拒绝(不能只靠前端隐藏)。
  await assert.rejects(
    () => serviceFor("HKD").save("payment", "alipay", {
      enabled: true,
      isDefault: true,
      settings: { appId: "a", gatewayUrl: "https://openapi.alipay.com/gateway.do", notifyUrl: "https://e.com/n" },
      credentials: { appPrivateKey: "p", alipayPublicKey: "q" }
    }, user("tenant_hk")),
    /不支持当前结算币种/u,
    "境外租户不能启用境内支付宝"
  );

  // 境内(CNY)租户:目录出现境内支付宝/微信。
  const cnCatalog = await serviceFor("CNY").catalog("tenant_cn");
  assert.deepEqual(
    cnCatalog.providers.filter((p) => p.capability === "payment").map((p) => p.provider).sort(),
    ["alipay", "wechat_pay"],
    "境内租户应看到境内支付宝/微信"
  );

  // 未建经营空间(币种缺省)→ 默认 CNY(境内),展示境内平台。
  const defCatalog = await serviceFor(null).catalog("tenant_new");
  assert.equal(defCatalog.providers.some((p) => p.provider === "alipay"), true, "未建空间默认 CNY,展示境内平台");

  console.log("payment provider currency filtering tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});