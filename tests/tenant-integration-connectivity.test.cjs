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
      missingFields: mode === "missing" ? ["accessKeyId"] : [],
      configurationError: mode === "configuration-error" ? "平台地址无法安全使用" : undefined
    }),
    claimLiveTest: async () => claim,
    recordTestResult: async (input) => { recorded.push(input); return true; }
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

void (async () => {
  await runAdapterChecks();
  await runOrchestratorChecks();
  console.log("tenant integration connectivity tests passed: read-only probes, no-send/no-write boundaries, safe failures and atomic cooldown");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = originalFetch;
});
