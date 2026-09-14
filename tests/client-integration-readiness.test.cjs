const assert = require("node:assert/strict");

process.env.NODE_ENV = "development";
const { ClientApiService } = require("../apps/api/dist/modules/client/client-api.service.js");
const service = Object.create(ClientApiService.prototype);
const capabilities = (rows) => service.buildPaymentCapabilities(rows);

const unverified = {
  capability: "payment",
  provider: "alipay",
  enabled: true,
  isDefault: true,
  lastTestStatus: "not_tested",
  lastTestMode: "none"
};
assert.deepEqual(capabilities([unverified]), {
  apiVersion: "v1",
  mode: "provider_pending",
  realPaymentEnabled: false,
  methods: ["simulation"],
  instruments: ["rental", "deposit", "preauthorization"]
}, "未通过 live 测试的启用支付配置不得对客户端宣称可真实支付");

const verified = { ...unverified, lastTestStatus: "passed", lastTestMode: "live" };
assert.deepEqual(capabilities([verified]), {
  apiVersion: "v1",
  mode: "provider",
  realPaymentEnabled: true,
  methods: ["alipay"],
  instruments: ["rental"]
}, "通过 live 测试的默认支付配置才可对客户端宣称真实支付");

const nonDefault = { ...verified, isDefault: false, provider: "wechat_pay" };
assert.equal(capabilities([nonDefault]).realPaymentEnabled, false, "非默认支付平台不能被客户端当作当前出口");
console.log("client integration readiness probes passed: payment capability follows live gate");
