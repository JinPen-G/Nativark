"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net"), dns = require("node:dns/promises");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node" } });
const { parseOutboundUrl, assertOutboundUrl, validateProviderOutboundUrls, UnsafeOutboundUrlError } = require("../apps/api/src/common/outbound-url");
const f = require("./fixtures/ai-native/outbound-differential.cjs");
const original = { connect: net.Socket.prototype.connect, fetch: global.fetch, lookup: dns.lookup,
  nodeEnv: process.env.NODE_ENV, privateEndpoints: process.env.INTEGRATION_ALLOW_PRIVATE_ENDPOINTS };
const attempts = [], queries = [];
let addresses = [{ address: "8.8.8.8", family: 4 }], dnsError;
function restoreEnv(key, value) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("No network"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("No external requests"); };
  dns.lookup = async (hostname, options) => {
    queries.push({ hostname, options }); if (dnsError) throw dnsError; return structuredClone(addresses);
  };
});
test.beforeEach(() => {
  process.env.NODE_ENV = "production"; process.env.INTEGRATION_ALLOW_PRIVATE_ENDPOINTS = "false";
  queries.length = 0; addresses = [{ address: "8.8.8.8", family: 4 }]; dnsError = undefined;
});
test.after(() => {
  net.Socket.prototype.connect = original.connect; global.fetch = original.fetch; dns.lookup = original.lookup;
  restoreEnv("NODE_ENV", original.nodeEnv); restoreEnv("INTEGRATION_ALLOW_PRIVATE_ENDPOINTS", original.privateEndpoints);
  assert.deepEqual(attempts, []);
});
for (const url of f.privateUrls) {
  test(`actual production validator rejects private/normalized URL ${url}`, async () => {
    await assert.rejects(() => assertOutboundUrl(url, "Synthetic endpoint"), error => error instanceof UnsafeOutboundUrlError && /本机|内网/u.test(error.message));
    assert.equal(queries.length, 0);
  });
}
for (const { url, error } of f.malformed) {
  test(`actual production parser rejects disallowed syntax ${url}`, () => {
    assert.throws(() => parseOutboundUrl(url, "Synthetic endpoint"), error);
    assert.equal(queries.length, 0);
  });
}
test("actual DNS validator rejects domain with mixed public/private addresses", async () => {
  addresses.push({ address: "10.0.0.1", family: 4 });
  await assert.rejects(() => assertOutboundUrl("https://public.example.test/", "Synthetic"), /不能解析到/u);
  assert.deepEqual(queries, [{ hostname: "public.example.test", options: { all: true, verbatim: true } }]);
});
test("actual DNS validator rejects private IPv6 result and DNS failure", async () => {
  addresses = [{ address: "fd00::1", family: 6 }];
  await assert.rejects(() => assertOutboundUrl("https://public.example.test/", "Synthetic"), /不能解析到/u);
  dnsError = new Error("Controlled DNS failure");
  await assert.rejects(() => assertOutboundUrl("https://public.example.test/", "Synthetic"), /无法安全解析/u);
});
test("actual validator accepts controlled public DNS without fetching endpoint", async () => {
  const result = await assertOutboundUrl("https://public.example.test/endpoint", "Synthetic");
  assert.equal(result.pathname, "/endpoint"); assert.equal(queries.length, 1);
  assert.equal(attempts.length, 0); // DNS result is synthetic, not real public DNS evidence.
});
test("actual production allowlist rejects lookalike host and credential disguise before DNS", async () => {
  const options = { productionHosts: ["openapi.alipay.com"] };
  await assert.rejects(() => assertOutboundUrl("https://openapi.alipay.com.attacker.example.test/", "Synthetic", options), /不是允许/u);
  await assert.rejects(() => assertOutboundUrl("https://openapi.alipay.com@attacker.example.test/", "Synthetic", options), /内嵌账号/u);
  assert.equal(queries.length, 0);
});
test("actual provider validation allows callback query but rejects query in gateway", async () => {
  await validateProviderOutboundUrls("payment", "alipay", { gatewayUrl: "https://openapi.alipay.com/gateway.do", notifyUrl: "https://notify.example.test/callback?synthetic=1" });
  assert.deepEqual(queries.map(row => row.hostname), ["openapi.alipay.com", "notify.example.test"]);
  queries.length = 0;
  await assert.rejects(() => validateProviderOutboundUrls("payment", "alipay", { gatewayUrl: "https://openapi.alipay.com/gateway.do?synthetic=1" }), /查询参数/u);
  assert.equal(queries.length, 0);
});
test("actual object-storage validation applies private endpoint rejection", async () => {
  for (const provider of ["aliyun_oss", "s3_compatible"]) {
    await assert.rejects(() => validateProviderOutboundUrls("file", provider, { endpoint: "https://169.254.169.254/" }), /本机|内网/u);
  }
  assert.equal(queries.length, 0);
});
test("tenant settings cannot opt in to private endpoints; explicit deployment opt-in is a separate boundary", async () => {
  await assert.rejects(() => validateProviderOutboundUrls("file", "s3_compatible", { endpoint: "https://10.0.0.1/", INTEGRATION_ALLOW_PRIVATE_ENDPOINTS: true }), /本机|内网/u);
  process.env.INTEGRATION_ALLOW_PRIVATE_ENDPOINTS = "true";
  const result = await assertOutboundUrl("https://10.0.0.1/", "Synthetic");
  assert.equal(result.hostname, "10.0.0.1"); assert.equal(queries.length, 0);
});
test("development default allows private URL but explicit strict option rejects it", async () => {
  process.env.NODE_ENV = "development";
  assert.equal((await assertOutboundUrl("http://127.0.0.1/", "Synthetic")).hostname, "127.0.0.1");
  await assert.rejects(() => assertOutboundUrl("http://127.0.0.1/", "Synthetic", { allowPrivateInDevelopment: false }), /本机|内网/u);
  assert.equal(queries.length, 0);
});
