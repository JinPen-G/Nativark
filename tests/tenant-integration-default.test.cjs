const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const { TenantIntegrationService } = require("../apps/api/src/modules/integrations/tenant-integration.service");

const tenantId = "tenant_integration_default";
const rows = new Map();
const now = () => new Date();
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (key === "id" && value && typeof value === "object" && "not" in value) return row.id !== value.not;
  return row[key] === value;
});
const clone = (row) => row ? { ...row, settings: { ...row.settings }, secretFields: [...row.secretFields] } : null;
const fakeClient = {
  tenantIntegrationConfig: {
    findUnique: async ({ where }) => clone([...rows.values()].find((row) => row.tenantId === where.tenantId_capability_provider.tenantId && row.capability === where.tenantId_capability_provider.capability && row.provider === where.tenantId_capability_provider.provider)),
    findFirst: async ({ where }) => clone([...rows.values()].find((row) => matches(row, where))),
    findMany: async ({ where }) => [...rows.values()].filter((row) => matches(row, where)).map(clone),
    upsert: async ({ where, create, update }) => {
      const key = `${where.tenantId_capability_provider.tenantId}:${where.tenantId_capability_provider.capability}:${where.tenantId_capability_provider.provider}`;
      const previous = rows.get(key);
      const saved = {
        ...(previous ?? { id: `cfg_${where.tenantId_capability_provider.provider}`, createdAt: now() }),
        ...(previous ? update : create),
        updatedAt: now()
      };
      rows.set(key, saved);
      return clone(saved);
    },
    updateMany: async ({ where, data }) => {
      let count = 0;
      for (const [key, row] of rows) {
        if (!matches(row, where)) continue;
        rows.set(key, { ...row, ...data, updatedAt: now() });
        count += 1;
      }
      return { count };
    }
  },
  $transaction: async (callback) => {
    const snapshot = new Map([...rows].map(([key, row]) => [key, { ...row, settings: { ...row.settings }, secretFields: [...row.secretFields] }]));
    try {
      return await callback(fakeClient);
    } catch (error) {
      rows.clear();
      for (const [key, row] of snapshot) rows.set(key, row);
      throw error;
    }
  }
};

const secretBox = {
  encrypt: (value) => JSON.stringify(value),
  decrypt: (value) => JSON.parse(value)
};
const operationLog = { record: async () => undefined };
const service = new TenantIntegrationService(fakeClient, secretBox, operationLog);
const user = { tenantId, account: "admin", displayName: "管理员", isSaasAdmin: false };

const alipay = {
  enabled: true,
  isDefault: true,
  settings: {
    appId: "app-test",
    gatewayUrl: "https://openapi.alipay.com/gateway.do",
    notifyUrl: "https://example.com/alipay/notify"
  },
  credentials: { appPrivateKey: "private", alipayPublicKey: "public" }
};

(async () => {
  await service.save("payment", "alipay", alipay, user);
  await service.save("payment", "wechat_pay", { enabled: false, isDefault: false, settings: {}, credentials: {} }, user);

  await assert.rejects(
    () => service.save("payment", "alipay", { ...alipay, isDefault: false }, user),
    /当前默认平台不能取消默认/u
  );
  assert.equal((await service.catalog(tenantId)).configs.find((row) => row.provider === "alipay").isDefault, true);

  await service.save("payment", "wechat_pay", {
    enabled: true,
    isDefault: true,
    settings: { mchid: "mchid", appId: "wx-app", notifyUrl: "https://example.com/wechat/notify", platformCertificateSerial: "serial" },
    credentials: { merchantPrivateKey: "private", merchantSerialNo: "merchant", wechatPlatformCertificate: "certificate", apiV3Key: "api-v3" }
  }, user);
  let configs = (await service.catalog(tenantId)).configs;
  assert.equal(configs.find((row) => row.provider === "wechat_pay").isDefault, true);
  assert.equal(configs.find((row) => row.provider === "alipay").isDefault, false);

  await service.save("payment", "alipay", { ...alipay, enabled: false, isDefault: false }, user);
  configs = (await service.catalog(tenantId)).configs;
  assert.equal(configs.find((row) => row.provider === "wechat_pay").isDefault, true);
  assert.equal(configs.find((row) => row.provider === "alipay").enabled, false);

  console.log("tenant integration default invariant tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
