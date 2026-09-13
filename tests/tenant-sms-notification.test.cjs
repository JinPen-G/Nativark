const assert = require("node:assert/strict");
const path = require("node:path");

require("ts-node").register({
  transpileOnly: true,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { NotificationDeliveryUnknownError, TenantIntegrationRuntimeService } = require(path.join(
  __dirname,
  "../apps/api/src/modules/integrations/tenant-integration.runtime.service"
));

const logs = [];
const configs = new Map([
  ["aliyun_sms", {
    id: "sms-alipay-test",
    capability: "sms",
    provider: "aliyun_sms",
    settings: { region: "cn-hangzhou", signName: "测试签名", verificationTemplateCode: "SMS_VERIFY" },
    credentials: { accessKeyId: "ak-test", accessKeySecret: "secret-test" }
  }],
  ["tencent_sms", {
    id: "sms-tencent-test",
    capability: "sms",
    provider: "tencent_sms",
    settings: { region: "ap-guangzhou", smsSdkAppId: "1400000000", signName: "测试签名", verificationTemplateId: "SMS_VERIFY" },
    credentials: { secretId: "secret-id-test", secretKey: "secret-key-test" }
  }]
]);

const integrations = {
  active: "aliyun_sms",
  runtimeConfig: async () => configs.get(integrations.active)
};
const prisma = {
  externalAdapterLog: {
    create: async (input) => { logs.push(input); }
  }
};
const runtime = new TenantIntegrationRuntimeService(prisma, integrations);
const originalFetch = global.fetch;

void (async () => {
  global.fetch = async (url) => ({
    ok: true,
    status: 200,
    text: async () => String(url).includes("dysmsapi.aliyuncs.com")
      ? JSON.stringify({ Code: "OK", RequestId: "aliyun-request" })
      : JSON.stringify({ Response: { RequestId: "tencent-request" } })
  });

  const aliyun = await runtime.sendNotificationSms(
    "tenant-test",
    "13800001111",
    "SMS_ORDER_001",
    { orderNo: "ORDER-SECRET", customerName: "客户-SECRET" },
    ["orderNo", "customerName"],
    "notification:test-aliyun"
  );
  assert.deepEqual(aliyun, { configured: true, provider: "aliyun_sms", externalRequestId: "aliyun-request" });
  assert.equal(logs.length, 1);
  assert.equal(logs[0].data.requestJson.phone, "138****1111");
  assert.deepEqual(logs[0].data.requestJson.variableKeys, ["orderNo", "customerName"]);
  assert.equal(JSON.stringify(logs[0].data.requestJson).includes("ORDER-SECRET"), false);
  assert.equal(JSON.stringify(logs[0].data.requestJson).includes("客户-SECRET"), false);

  integrations.active = "tencent_sms";
  const tencent = await runtime.sendNotificationSms(
    "tenant-test",
    "+8613800002222",
    "123456",
    { first: "A", second: "B" },
    ["first", "second"],
    "notification:test-tencent"
  );
  assert.deepEqual(tencent, { configured: true, provider: "tencent_sms", externalRequestId: "tencent-request" });
  assert.equal(logs.length, 2);
  assert.deepEqual(logs[1].data.requestJson.variableKeys, ["first", "second"]);

  global.fetch = async () => { throw new Error("simulated network timeout"); };
  await assert.rejects(
    () => runtime.sendNotificationSms(
      "tenant-test",
      "13800003333",
      "SMS_ORDER_001",
      { orderNo: "ORDER-NETWORK-SECRET" },
      ["orderNo"],
      "notification:test-unknown"
    ),
    (error) => error instanceof NotificationDeliveryUnknownError
  );
  console.log("tenant SMS notification adapter tests passed");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(() => {
  global.fetch = originalFetch;
});
