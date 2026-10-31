const assert = require("node:assert/strict");
const { createPublicKey, createSign, generateKeyPairSync } = require("node:crypto");
const path = require("node:path");

process.env.NODE_ENV = "test";
require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { FileStorageRuntimeService } = require(path.join(__dirname, "../apps/api/src/modules/integrations/file-storage.runtime.service"));
const { PaymentRuntimeService } = require(path.join(__dirname, "../apps/api/src/modules/integrations/payment.runtime.service"));
const { TenantIntegrationRuntimeService } = require(path.join(__dirname, "../apps/api/src/modules/integrations/tenant-integration.runtime.service"));
const { TenantIntegrationConnectivityService } = require(path.join(__dirname, "../apps/api/src/modules/integrations/tenant-integration.connectivity.service"));
const { TenantIntegrationService } = require(path.join(__dirname, "../apps/api/src/modules/integrations/tenant-integration.service"));

const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
const calls = [];
const originalFetch = global.fetch;

function response(status, body, headers = {}) {
  return { ok: status >= 200 && status < 300, status, headers: new Headers(headers), text: async () => typeof body === "string" ? body : JSON.stringify(body) };
}

const smsConfig = {
  id: "cfg-sms-connectivity",
  capability: "sms",
  provider: "aliyun_sms",
  settings: { region: "cn-hangzhou", signName: "测试签名", verificationTemplateCode: "SMS_VERIFY" },
  credentials: { accessKeyId: "ak-test", accessKeySecret: "secret-test" }
};

const alipayConfig = {
  id: "cfg-alipay-connectivity",
  capability: "payment",
  provider: "alipay",
  settings: { appId: "app-test", gatewayUrl: "https://openapi.alipay.com/gateway.do" },
  credentials: { appPrivateKey: privateKey }
};

const wechatConfig = {
  id: "cfg-wechat-connectivity",
  capability: "payment",
  provider: "wechat_pay",
  settings: { mchid: "mchid-test", gatewayUrl: "https://api.mch.weixin.qq.com", platformPublicKeyId: "PUB_KEY_ID_123456" },
  credentials: {
    merchantPrivateKey: privateKey,
    merchantSerialNo: "merchant-serial",
    apiV3Key: "01234567890123456789012345678901",
    wechatPlatformPublicKey: createPublicKey(privateKey).export({ type: "spki", format: "pem" }).toString()
  }
};

const ossConfig = {
  id: "cfg-oss-connectivity",
  capability: "file",
  provider: "aliyun_oss",
  settings: { region: "oss-cn-hangzhou", endpoint: "https://oss-cn-hangzhou.aliyuncs.com", bucket: "rental-os-test" },
  credentials: { accessKeyId: "ak-test", accessKeySecret: "secret-test" }
};

const smsRuntime = new TenantIntegrationRuntimeService({}, {});
const fileRuntime = new FileStorageRuntimeService({}, {});
const paymentRuntime = new PaymentRuntimeService({}, {}, {});

async function runAdapterChecks() {
  global.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    if (String(url).includes("dysmsapi.aliyuncs.com")) return response(200, { Code: "OK" });
    if (String(url).includes("sms.tencentcloudapi.com")) return response(200, { Response: { RequestId: "query-request" } });
    if (String(url).includes("openapi.alipay.com")) return response(200, { alipay_trade_query_response: { code: "40004" } });
    if (String(url).includes("api.mch.weixin.qq.com")) {
      const body = JSON.stringify({ code: "RESOURCE_NOT_EXISTS" });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const nonce = "wechat-connectivity-response";
      const signer = createSign("RSA-SHA256");
      signer.update(`${timestamp}\n${nonce}\n${body}\n`);
      signer.end();
      return response(404, body, {
        "Wechatpay-Timestamp": timestamp,
        "Wechatpay-Nonce": nonce,
        "Wechatpay-Signature": signer.sign(privateKey, "base64"),
        "Wechatpay-Serial": "PUB_KEY_ID_123456"
      });
    }
    if (String(url).includes("oss-cn-hangzhou.aliyuncs.com")) return response(404, "");
    throw new Error(`unexpected URL ${url}`);
  };

  await smsRuntime.testConnection(smsConfig);
  assert.match(calls.at(-1).url, /Action=QuerySmsTemplateList/u);
  assert.doesNotMatch(calls.at(-1).url, /SendSms/u);

  await smsRuntime.testConnection({
    ...smsConfig,
    provider: "tencent_sms",
    credentials: { secretId: "secret-id", secretKey: "secret-key" },
    settings: { region: "ap-guangzhou" }
  });
  assert.equal(calls.at(-1).init.method, "POST");
  assert.match(calls.at(-1).init.headers["X-TC-Action"], /^DescribeSmsTemplateList$/u);
  assert.doesNotMatch(String(calls.at(-1).init.body), /PhoneNumberSet|TemplateParamSet/u);

  await paymentRuntime.testConnection(alipayConfig);
  assert.match(String(calls.at(-1).init.body), /alipay\.trade\.query/u);
  assert.doesNotMatch(String(calls.at(-1).init.body), /precreate|close/u);

  await paymentRuntime.testConnection(wechatConfig);
  assert.equal(calls.at(-1).init.method, "GET");
  assert.match(calls.at(-1).url, /\/v3\/pay\/transactions\/out-trade-no\//u);
  assert.doesNotMatch(calls.at(-1).url, /\/close/u);

  await fileRuntime.testConnection(ossConfig);
  assert.equal(calls.at(-1).init.method, "HEAD");
  assert.doesNotMatch(calls.at(-1).init.method, /PUT|DELETE/u);
  assert.match(new URL(calls.at(-1).url).searchParams.get("x-oss-credential") ?? "", /\/cn-hangzhou\/oss\/aliyun_v4_request$/u, "legacy oss-cn-* configuration must use OSS V4 signing region cn-*");
}

async function runOrchestratorChecks() {
  let mode = "complete";
  let claim = true;
  let adapterCalls = 0;
  const recorded = [];
  const integrationService = {
    testConfig: async () => ({
      id: "cfg-orchestrator",
      tenantId: "tenant-connectivity",
      capability: "sms",
      provider: "aliyun_sms",
      settings: {},
      credentials: {},
      revision: { updatedAt: new Date('2026-10-31T01:00:00Z'), enabled: true, isDefault: true, settings: {}, credentialsEncrypted: null, secretFields: [] },
      missingFields: mode === "missing" ? ["accessKeyId"] : [],
      configurationError: mode === "configuration-error" ? "平台地址无法安全使用" : undefined
    }),
    claimLiveTest: async (input) => { assert.equal(input.revision.updatedAt.toISOString(), '2026-10-31T01:00:00.000Z'); return claim; },
    recordTestResult: async (input) => { assert.equal(input.revision.updatedAt.toISOString(), '2026-10-31T01:00:00.000Z'); recorded.push(input); return true; }
  };
  const connectivity = new TenantIntegrationConnectivityService(
    integrationService,
    { testConnection: async () => { adapterCalls += 1; return "已验证"; } },
    { testConnection: async () => { adapterCalls += 1; return "已验证"; } },
    { testConnection: async () => { adapterCalls += 1; throw new Error("provider secret leaked"); } }
  );

  mode = "missing";
  let result = await connectivity.test("sms", "aliyun_sms", { tenantId: "tenant-connectivity" });
  assert.equal(result.mode, "configuration");
  assert.equal(result.ok, false);
  assert.equal(adapterCalls, 0);
  assert.equal(recorded.at(-1).mode, "configuration");

  mode = "complete";
  result = await connectivity.test("sms", "aliyun_sms", { tenantId: "tenant-connectivity" });
  assert.equal(result.mode, "live");
  assert.equal(result.ok, true);
  assert.equal(recorded.at(-1).status, "passed");

  claim = false;
  await assert.rejects(
    () => connectivity.test("sms", "aliyun_sms", { tenantId: "tenant-connectivity" }),
    /30 秒/u
  );

  claim = true;
  result = await connectivity.test("payment", "alipay", { tenantId: "tenant-connectivity" });
  assert.equal(result.ok, false);
  assert.equal(result.mode, "live");
  assert.doesNotMatch(result.message, /provider secret leaked/u);
  assert.doesNotMatch(recorded.at(-1).error, /provider secret leaked/u);
}

async function runRevisionChecks() {
  let row = { id: 'cfg-version', tenantId: 'tenant-version', capability: 'sms', provider: 'aliyun_sms', enabled: true, isDefault: true,
    settings: structuredClone(smsConfig.settings), credentialsEncrypted: JSON.stringify(smsConfig.credentials), secretFields: ['accessKeyId', 'accessKeySecret'],
    updatedAt: new Date('2026-10-31T01:00:00Z'), createdAt: new Date('2026-10-31T01:00:00Z'), lastTestAt: null, lastTestStatus: 'not_tested', lastTestMode: 'none' };
  const matches = (where) => Object.entries(where).every(([key, value]) => {
    if (key === 'OR') return value.some(matches);
    if (value instanceof Date) return row[key] instanceof Date && row[key].getTime() === value.getTime();
    if (value && typeof value === 'object') {
      if ('equals' in value) return JSON.stringify(row[key]) === JSON.stringify(value.equals);
      if ('lt' in value) return row[key] && row[key] < value.lt;
    }
    return row[key] === value;
  });
  const service = new TenantIntegrationService({ tenantIntegrationConfig: {
    findUnique: async () => structuredClone(row),
    updateMany: async ({ where, data }) => { if (!matches(where)) return { count: 0 }; Object.assign(row, structuredClone(data)); return { count: 1 }; }
  } }, { decrypt: value => JSON.parse(value) }, { record: async () => undefined });
  const read = () => service.testConfig('sms', 'aliyun_sms', { tenantId: row.tenantId });
  const claim = config => service.claimLiveTest({ tenantId: row.tenantId, configId: row.id, startedAt: new Date(), cooldownMs: 30000, revision: config.revision });
  const stale = await read();
  row.settings.signName = 'new-signature';
  assert.equal(await claim(stale), false, 'read A then save B cannot claim a test of B using A');
  assert.equal(await service.recordTestResult({ tenantId: row.tenantId, configId: row.id, revision: stale.revision,
    status: 'failed', mode: 'configuration', checkedAt: new Date() }), false, 'stale configuration errors cannot replace a new config result');
  const config = await read(), startedAt = new Date();
  assert.equal(await service.claimLiveTest({ tenantId: row.tenantId, configId: row.id, revision: config.revision, startedAt, cooldownMs: 30000 }), true);
  const resultInput = { tenantId: row.tenantId, configId: row.id, revision: config.revision, status: 'passed', mode: 'live', checkedAt: startedAt, startedAt };
  assert.equal(await service.recordTestResult(resultInput), true);
  assert.equal(row.lastTestStatus, 'passed');
  assert.equal(row.updatedAt.getTime(), config.revision.updatedAt.getTime(), 'test bookkeeping must not mutate the tested config version');
  assert.equal(await service.recordTestResult(resultInput), false, 'one claimed result cannot be overwritten by a duplicate late result');
  row.lastTestAt = null;
  const beforeSecretChange = await read();
  assert.equal(await claim(beforeSecretChange), true);
  row.credentialsEncrypted = JSON.stringify({ ...smsConfig.credentials, accessKeySecret: 'rotated-offline-secret' });
  assert.equal(await service.recordTestResult({ ...resultInput, revision: beforeSecretChange.revision, startedAt: row.lastTestAt }), false,
    'same timestamp with changed encrypted credentials still rejects the old probe result');
  assert.equal(row.lastTestStatus, 'not_tested');
  row.lastTestAt = null;
  let adapterCalls = 0;
  const connectivity = new TenantIntegrationConnectivityService(service, { testConnection: async () => {
    adapterCalls += 1;
    row.settings.verificationTemplateCode = 'changed-during-probe';
    return 'offline probe';
  } }, {}, {});
  const staleResult = await connectivity.test('sms', 'aliyun_sms', { tenantId: row.tenantId });
  assert.equal(adapterCalls, 1);
  assert.equal(staleResult.ok, false);
  assert.match(staleResult.message, /未采用旧测试结果/);
  assert.equal(row.lastTestStatus, 'not_tested');
  console.log('integration test revision checks passed: read/claim/probe/result binding, credential change and duplicate result rejection');
}

void (async () => {
  await runAdapterChecks();
  await runRevisionChecks();
  await runOrchestratorChecks();
  console.log("tenant integration connectivity tests passed: read-only probes, no-send/no-write boundaries, safe failures and atomic cooldown");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = originalFetch;
});
