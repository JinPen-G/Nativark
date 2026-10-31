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
  if (value === undefined) return true;
  if (key === 'OR') return value.some(clause => matches(row, clause));
  if (value && typeof value === 'object' && 'not' in value) return row[key] !== value.not;
  if (value instanceof Date) return row[key]?.getTime() === value.getTime();
  if (key === "id" && value && typeof value === "object" && "not" in value) return row.id !== value.not;
  if (value && typeof value === "object" && "in" in value) return value.in.includes(row[key]);
  return row[key] === value;
});
const clone = (row) => row ? { ...row, settings: { ...row.settings }, secretFields: [...row.secretFields] } : null;
const fakeClient = {
  $queryRaw: async (query) => {
    const [queryTenantId, capability, provider] = query.values ?? [];
    const row = [...rows.values()].find((item) => item.tenantId === queryTenantId && item.capability === capability && item.provider === provider);
    return row ? [clone(row)] : [];
  },
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
    create: async ({ data }) => fakeClient.tenantIntegrationConfig.upsert({
      where: { tenantId_capability_provider: { tenantId: data.tenantId, capability: data.capability, provider: data.provider } }, create: data, update: data }),
    update: async ({ where, data }) => { const row = [...rows.values()].find(row => row.id === where.id && row.tenantId === where.tenantId);
      return fakeClient.tenantIntegrationConfig.upsert({ where: { tenantId_capability_provider: { tenantId: row.tenantId, capability: row.capability, provider: row.provider } }, create: data, update: data }); },
    upsert: async ({ where, create, update }) => {
      const key = `${where.tenantId_capability_provider.tenantId}:${where.tenantId_capability_provider.capability}:${where.tenantId_capability_provider.provider}`;
      const previous = rows.get(key);
      const saved = {
        ...(previous ?? { id: `cfg_${where.tenantId_capability_provider.provider}`, createdAt: now() }),
        ...(previous ? update : create),
        updatedAt: (previous ? update : create).updatedAt ?? now()
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
  rentalTenantBusinessSettings: {
    // 默认无经营空间业务设置 → resolveTenantSettlementCurrency 回落 CNY(境内),
    // 本套用例的支付宝/微信均支持 CNY,币种门禁对它们放行。
    findFirst: async () => null
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
  notificationLogs.push({ tenantId, channel: "sms", provider: "sms_pending", status: "queued" });
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

  // Original identities remain available for every historical paid/refund row,
  // not only rows that happen to be pending at the time settings are edited.
  paymentIntents.push({ tenantId, provider: 'alipay', status: 'paid' });
  const beforeMerchant = (await service.catalog(tenantId)).configs.find(row => row.provider === 'alipay');
  await assert.rejects(() => service.save('payment', 'alipay', { ...alipay, enabled: false, isDefault: false,
    settings: { ...alipay.settings, appId: 'another-merchant' } }, user), /原商户配置/);
  assert.equal((await service.catalog(tenantId)).configs.find(row => row.provider === 'alipay').settings.appId, beforeMerchant.settings.appId);
  await service.save('payment', 'alipay', { ...alipay, enabled: false, isDefault: false, credentials: { appPrivateKey: 'same-app-rotated-key' } }, user);
  assert.equal((await service.catalog(tenantId)).configs.find(row => row.provider === 'alipay').settings.appId, 'app-test', 'same explicit app identity permits credential rotation without guessing a new merchant');
  paymentIntents.length = 0;
  await service.save('file', 'aliyun_oss', { enabled: true, isDefault: true,
    settings: { region: 'oss-cn-hangzhou', endpoint: 'https://oss-cn-hangzhou.aliyuncs.com', bucket: 'rental-os-test' }, credentials: {} }, user);
  fileAssets.push({ tenantId, storageProvider: 'aliyun_oss', status: 'active' });
  await assert.rejects(() => service.save('file', 'aliyun_oss', { enabled: true, isDefault: true,
    settings: { bucket: 'different-storage' }, credentials: {} }, user), /原文件或上传/);
  fileAssets[0].status = 'ai_erasure_pending';
  await assert.rejects(() => service.save('file', 'aliyun_oss', { enabled: true, isDefault: true,
    settings: { endpoint: 'https://other-storage.example' }, credentials: {} }, user), /原文件或上传/);
  fileAssets.length = 0;
  fileUploadSessions.push({ tenantId, provider: 'aliyun_oss', status: 'failed', cleanupError: 'original cleanup unknown' });
  await assert.rejects(() => service.save('file', 'aliyun_oss', { enabled: true, isDefault: true,
    settings: { bucket: 'different-storage' }, credentials: {} }, user), /原文件或上传/);
  fileUploadSessions.length = 0;
  await service.save('file', 'aliyun_oss', { enabled: true, isDefault: true, settings: { bucket: 'different-storage' }, credentials: {} }, user);
  assert.equal((await service.catalog(tenantId)).configs.find(row => row.provider === 'aliyun_oss').settings.bucket, 'different-storage');
  const beforeConcurrent = rows.get(`${tenantId}:file:aliyun_oss`).settings.bucket;
  const originalTransaction = fakeClient.$transaction;
  fakeClient.$transaction = async work => { const row = rows.get(`${tenantId}:file:aliyun_oss`);
    row.settings = { ...row.settings, objectPrefix: 'concurrent-write' }; return originalTransaction(work); };
  await assert.rejects(() => service.save('file', 'aliyun_oss', { enabled: true, isDefault: true, settings: { bucket: 'stale-overwrite' }, credentials: {} }, user), /其他操作修改/);
  assert.equal(rows.get(`${tenantId}:file:aliyun_oss`).settings.bucket, beforeConcurrent);
  assert.equal(rows.get(`${tenantId}:file:aliyun_oss`).settings.objectPrefix, 'concurrent-write');
  fakeClient.$transaction = originalTransaction;
  const configRow = rows.get(`${tenantId}:file:aliyun_oss`);
  configRow.lastTestStatus = 'passed'; configRow.lastTestMode = 'live';
  const runtimeConfig = await service.runtimeConfig('file', tenantId, 'aliyun_oss');
  await service.assertEnabledInTransaction(fakeClient, tenantId, 'file', 'aliyun_oss', { configRevision: runtimeConfig.revision });
  configRow.settings = { ...configRow.settings, bucket: 'changed-after-read' };
  await assert.rejects(() => service.assertEnabledInTransaction(fakeClient, tenantId, 'file', 'aliyun_oss', { configRevision: runtimeConfig.revision }), /旧配置创建业务/);
  const stripeRow = { ...clone(configRow), id: 'cfg-stripe', capability: 'payment', provider: 'stripe', enabled: false,
    credentialsEncrypted: JSON.stringify({ secretKey: 'original-account-key' }) };
  paymentIntents.push({ tenantId, provider: 'stripe', status: 'closed' });
  await assert.rejects(() => service.assertOriginalProviderIdentity(fakeClient, stripeRow, 'payment', 'stripe', stripeRow.settings,
    { secretKey: 'unverified-other-account-key' }), /原商户配置/);
  paymentIntents.length = 0;
  console.log('original provider identity tests passed: paid-history merchant, pending file/erasure/cleanup, same-merchant credential rotation and concurrent settings');
  console.log("tenant integration default invariant tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
