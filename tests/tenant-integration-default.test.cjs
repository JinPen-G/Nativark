const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node" }
});

const { TenantIntegrationService } = require("../apps/api/src/modules/integrations/tenant-integration.service");

const tenantId = "tenant_integration_default";
const rows = new Map();
const paymentIntents = [];
const paymentRefunds = [];
const notificationLogs = [];
const fileAssets = [];
const fileUploadSessions = [];
const now = () => new Date();
const matches = (row, where) => Object.entries(where).every(([key, value]) => {
  if (key === "id" && value && typeof value === "object" && "not" in value) return row.id !== value.not;
  if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
  return row[key] === value;
});
const clone = (row) => row ? { ...row, settings: { ...row.settings }, secretFields: [...row.secretFields] } : null;
const fakeClient = {
  rentalPaymentIntent: {
    findFirst: async ({ where }) => paymentIntents.find((row) => matches(row, where)) ?? null
  },
  rentalPaymentRefund: {
    findFirst: async ({ where }) => paymentRefunds.find((row) => matches(row, where)) ?? null
  },
  rentalNotificationLog: {
    findFirst: async ({ where }) => notificationLogs.find((row) => matches(row, where)) ?? null
  },
  fileAsset: {
    findFirst: async ({ where }) => fileAssets.find((row) => matches(row, where)) ?? null
  },
  fileUploadSession: {
    findFirst: async ({ where }) => fileUploadSessions.find((row) => matches(row, where)) ?? null
  },
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
  await assert.rejects(
    () => service.save("sms", "aliyun_sms", {
      enabled: true,
      isDefault: false,
      settings: { region: "cn-hangzhou", signName: "测试", verificationTemplateCode: "SMS_TEST" },
      credentials: { accessKeyId: "access-key", accessKeySecret: "secret" }
    }, user),
    /首个启用的平台必须设为该能力默认平台/u
  );
  assert.equal((await service.catalog(tenantId)).configs.some((row) => row.capability === "sms"), false, "首个平台未设默认时不得留下半配置记录");

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

  paymentIntents.push({ tenantId, provider: "alipay", status: "pending" });
  await assert.rejects(
    () => service.save("payment", "alipay", { ...alipay, enabled: false, isDefault: false }, user),
    /仍有未完成的支付或退款事实/u
  );
  paymentIntents.length = 0;
  await service.save("payment", "alipay", { ...alipay, enabled: false, isDefault: false }, user);
  configs = (await service.catalog(tenantId)).configs;
  assert.equal(configs.find((row) => row.provider === "wechat_pay").isDefault, true);
  assert.equal(configs.find((row) => row.provider === "alipay").enabled, false);

  await service.save("sms", "aliyun_sms", {
    enabled: true,
    isDefault: true,
    settings: { region: "cn-hangzhou", signName: "测试", verificationTemplateCode: "SMS_TEST" },
    credentials: { accessKeyId: "access-key", accessKeySecret: "secret" }
  }, user);
  notificationLogs.push({ tenantId, channel: "sms", provider: "aliyun_sms", status: "delivery_uncertain" });
  await assert.rejects(
    () => service.save("sms", "aliyun_sms", {
      enabled: false,
      isDefault: false,
      settings: {},
      credentials: {}
    }, user),
    /仍有未完成或待核对的通知/u
  );
  notificationLogs.length = 0;
  await service.save("sms", "aliyun_sms", {
    enabled: false,
    isDefault: false,
    settings: {},
    credentials: {}
  }, user);

  await service.save("file", "aliyun_oss", {
    enabled: true,
    isDefault: true,
    settings: { region: "oss-cn-hangzhou", endpoint: "https://oss-cn-hangzhou.aliyuncs.com", bucket: "rental-os-test" },
    credentials: { accessKeyId: "access-key", accessKeySecret: "secret" }
  }, user);
  fileAssets.push({ tenantId, storageProvider: "aliyun_oss", status: "active" });
  await assert.rejects(
    () => service.save("file", "aliyun_oss", {
      enabled: false,
      isDefault: false,
      settings: {},
      credentials: {}
    }, user),
    /仍有已存文件或待清理上传/u
  );
  fileAssets.length = 0;
  await service.save("file", "aliyun_oss", {
    enabled: false,
    isDefault: false,
    settings: {},
    credentials: {}
  }, user);

  console.log("tenant integration default invariant tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
