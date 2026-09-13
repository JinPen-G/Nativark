const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repo = path.resolve(__dirname, "..");
const outbound = require(path.join(repo, "apps", "api", "dist", "common", "outbound-url.js"));

process.env.NODE_ENV = "production";
assert.throws(() => outbound.parseOutboundUrl("http://example.com", "网关"), /HTTPS/);
assert.throws(() => outbound.parseOutboundUrl("https://127.0.0.1:9000", "Endpoint"), /本机/);
assert.throws(() => outbound.parseOutboundUrl("https://[::ffff:127.0.0.1]", "Endpoint"), /本机/);
assert.throws(() => outbound.parseOutboundUrl("https://example.com/path?secret=1", "Endpoint"), /查询参数/);
assert.throws(() => outbound.parseOutboundUrl("https://example.com@public.example", "Endpoint"), /账号或密码/);
assert.throws(() => outbound.parseOutboundUrl("https://custom.example/gateway", "支付宝网关", { productionHosts: ["openapi.alipay.com"] }), /允许的生产平台/);
assert.doesNotThrow(() => outbound.parseOutboundUrl("https://openapi.alipay.com/gateway.do", "支付宝网关", { productionHosts: ["openapi.alipay.com"] }));

const paymentSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "payment.runtime.service.ts"), "utf8");
const fileSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "file-storage.runtime.service.ts"), "utf8");
const smsSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "integrations", "tenant-integration.runtime.service.ts"), "utf8");
const authSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "modules", "client", "client-auth.service.ts"), "utf8");
const guardSource = fs.readFileSync(path.join(repo, "apps", "api", "src", "common", "api-auth.guard.ts"), "utf8");

assert.match(paymentSource, /decrypted\.mchid/);
assert.match(paymentSource, /decrypted\.appid/);
assert.match(paymentSource, /provider_eventId/);
assert.match(paymentSource, /FOR UPDATE/);
assert.match(paymentSource, /TransactionIsolationLevel\.Serializable/);
assert.match(paymentSource, /redirect: "error"/);
assert.match(paymentSource, /status: \{ in: \["pending", "verified_pending_funding"\] \}/);
assert.match(paymentSource, /微信支付回调格式无效/);
assert.match(paymentSource, /rental_orders[\s\S]{0,260}FOR UPDATE/);
assert.match(paymentSource, /相同退款幂等键已用于不同金额或原因/);
assert.match(paymentSource, /funding_pending/);
assert.match(paymentSource, /SUCCESS_AMOUNT_MISMATCH/);
assert.match(paymentSource, /paymentIntentId: intentId, idempotencyHash/);
assert.match(paymentSource, /status: \{ in: \["pending", "accepted", "funding_pending"\] \}/);
assert.match(fileSource, /content-length/);
assert.match(fileSource, /actualType === expectedType/);
assert.match(fileSource, /redirect: "error"/);
assert.match(fileSource, /this\.presign\(config, "HEAD", storageKey/);
assert.match(fileSource, /safeObjectPrefix/);
assert.match(fileSource, /safeBucket/);
assert.match(smsSource, /redirect: "error"/);
assert.match(smsSource, /assertOutboundUrl/);
assert.match(authSource, /CHALLENGE_COOLDOWN_SECONDS/);
assert.match(authSource, /identifierHash/);
assert.match(authSource, /SELECT id FROM business_workspaces/);
assert.match(authSource, /FOR UPDATE/);
assert.match(guardSource, /path\.startsWith\("\/platform\/integrations"\)/);

console.log("integration security probes passed: SSRF, callback binding, payment race, upload verification, SMS cooldown and route permission");
