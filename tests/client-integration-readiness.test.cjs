const assert = require("node:assert/strict");

process.env.NODE_ENV = "development";
const { ClientApiService } = require("../apps/api/dist/modules/client/client-api.service.js");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const service = Object.create(ClientApiService.prototype);
const capabilities = (rows, methods) => service.buildPaymentCapabilities(rows, methods);

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
  methods: ["offline_cash", "offline_transfer", "simulation"],
  instruments: ["rental", "deposit", "preauthorization"]
}, "未通过 live 测试的启用支付配置不得对客户端宣称可真实支付");

const verified = { ...unverified, lastTestStatus: "passed", lastTestMode: "live" };
assert.deepEqual(capabilities([verified]), {
  apiVersion: "v1",
  mode: "provider",
  realPaymentEnabled: true,
  methods: ["offline_cash", "offline_transfer", "alipay"],
  instruments: ["rental"]
}, "通过 live 测试的默认支付配置才可对客户端宣称真实支付");

const nonDefault = { ...verified, isDefault: false, provider: "wechat_pay" };
assert.equal(capabilities([nonDefault]).realPaymentEnabled, false, "非默认支付平台不能被客户端当作当前出口");
assert.deepEqual(capabilities([verified], ["alipay"]), {
  apiVersion: "v1",
  mode: "provider",
  realPaymentEnabled: true,
  methods: ["alipay"],
  instruments: ["rental"]
}, "经营空间关闭线下方式后，客户端不应继续展示线下收款方式");
const core = Object.create(RentalCoreService.prototype);
core.getBusinessSettings = () => ({ payment: { enabledMethods: ["offline_transfer"] } });
assert.equal(core.resolveOfflinePaymentMethod("tenant", "offline_transfer"), "offline_transfer", "已启用的线下转账应可登记资金事实");
assert.throws(() => core.resolveOfflinePaymentMethod("tenant", "offline_cash"), /尚未在经营空间设置中启用/u, "未启用的线下现金必须由服务端拒绝");
console.log("client integration readiness probes passed: payment capability follows live gate");
