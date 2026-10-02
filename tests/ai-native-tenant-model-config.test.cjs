"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { TenantModelConfigService } = require("../apps/api/src/modules/ai-native/tenant-model-config.service");
const { SecretBox } = require("../apps/api/src/common/secret-box");
const { ModelGatewayService } = require("../apps/api/src/modules/ai-native/model-gateway.service");
const { ChatCompletionsAdapter } = require("../apps/api/src/modules/ai-native/chat-completions.adapter");
const originalConnect = net.Socket.prototype.connect, originalFetch = global.fetch, external = [];
test.before(() => {
  net.Socket.prototype.connect = function () { external.push("socket"); throw new Error("No external calls"); };
  global.fetch = async () => { external.push("fetch"); throw new Error("No external calls"); };
});
test.after(() => { net.Socket.prototype.connect = originalConnect; global.fetch = originalFetch; assert.deepEqual(external, []); });
const context = { tenantId: "synthetic-tenant", workspaceId: "synthetic-space", actorId: "synthetic-admin" };
const input = () => ({ protocol: "openai_chat_completions", baseUrl: "https://synthetic-model.example.test/v1/", model: "custom-org/custom-model", apiKey: "synthetic-key-not-real", expectedRevision: 0 });
function harness() {
  const rows = new Map(), actions = [];
  const ports = { authorize: async (scope, action) => actions.push([scope.tenantId, action]), repository: {
    read: async tenant => rows.get(tenant) ?? null,
    compareAndSwap: async (tenant, revision, next) => {
      if ((rows.get(tenant)?.revision ?? 0) !== revision) return false;
      rows.set(tenant, structuredClone(next)); return true;
    }
  } };
  const secrets = new SecretBox({ get: name => name === "INTEGRATION_ENCRYPTION_KEY" ? "synthetic-encryption-test-only" : "production" });
  return { rows, ports, actions, secrets, service: new TenantModelConfigService(ports, secrets) };
}
const rejects = (op, code) => assert.rejects(op, e => e.code === code && e.message === code);

test("tenant selects arbitrary model and URL; key is encrypted and never returned", async () => {
  const h = harness(), result = await h.service.save(context, input());
  assert.equal(result.model, "custom-org/custom-model"); assert.equal(result.enabled, false);
  assert.equal(result.baseUrl, "https://synthetic-model.example.test/v1"); assert.equal(result.keyConfigured, true);
  assert.equal(JSON.stringify(result).includes(input().apiKey), false);
  const row = h.rows.get(context.tenantId);
  assert.match(row.credentialsEncrypted, /^v1:/); assert.equal(JSON.stringify(row).includes(input().apiKey), false);
  assert.deepEqual(await h.service.get(context), result);
});
test("missing config is null for settings and disabled for invocation", async () => {
  const h = harness(); assert.equal(await h.service.get(context), null);
  await rejects(() => h.service.profile(context), "DISABLED");
});
test("initial key required; fixed supplier names and extra fields are rejected", async () => {
  const h = harness(), { apiKey, ...withoutKey } = input();
  await rejects(() => h.service.save(context, withoutKey), "CREDENTIAL_UNAVAILABLE");
  await rejects(() => h.service.save(context, { ...input(), protocol: "fixed-vendor" }), "CONFIG_INVALID");
  await rejects(() => h.service.save(context, { ...input(), tenantId: "forged" }), "CONFIG_INVALID");
  assert.equal(h.rows.size, 0);
});
for (const baseUrl of ["http://public.example.test/v1", "https://127.0.0.1/v1", "https://[::1]/v1", "https://169.254.169.254/v1", "https://localhost/v1", "https://user:pass@example.test/v1", "https://example.test/v1?key=secret", "https://example.test/v1#fragment"]) {
  test(`unsafe endpoint rejected before storage: ${baseUrl}`, async () => {
    const h = harness(); await rejects(() => h.service.save(context, { ...input(), baseUrl }), "CONFIG_INVALID"); assert.equal(h.rows.size, 0);
  });
}
test("same endpoint may retain key; changed endpoint cannot silently forward it", async () => {
  const h = harness(); await h.service.save(context, input());
  const { apiKey, ...retained } = input();
  await h.service.save(context, { ...retained, expectedRevision: 1, enabled: true, model: "another/model" });
  const profile = await h.service.profile(context);
  assert.equal(await h.service.credential(profile.credentialRef, context), apiKey);
  await rejects(() => h.service.save(context, { ...retained, expectedRevision: 2, baseUrl: "https://different.example.test/v1" }), "CREDENTIAL_UNAVAILABLE");
  assert.equal(h.rows.get(context.tenantId).revision, 2);
});
test("rotation invalidates old references, disabled credentials cannot be obtained", async () => {
  const h = harness(); await h.service.save(context, { ...input(), enabled: true });
  const old = await h.service.profile(context);
  await h.service.save(context, { ...input(), expectedRevision: 1, enabled: true, apiKey: "synthetic-rotated-key" });
  await rejects(() => h.service.credential(old.credentialRef, context), "CREDENTIAL_UNAVAILABLE");
  const current = await h.service.profile(context);
  assert.equal(await h.service.credential(current.credentialRef, context), "synthetic-rotated-key");
  await h.service.save(context, { ...input(), expectedRevision: 2, enabled: false });
  await rejects(() => h.service.credential(current.credentialRef, context), "CREDENTIAL_UNAVAILABLE");
});
test("tenant credential refs cannot be reused in a different tenant", async () => {
  const h = harness(), other = { ...context, tenantId: "synthetic-other" };
  await h.service.save(context, { ...input(), enabled: true });
  await h.service.save(other, { ...input(), enabled: true, apiKey: "synthetic-other-key" });
  const profile = await h.service.profile(context);
  await rejects(() => h.service.credential(profile.credentialRef, other), "CREDENTIAL_UNAVAILABLE");
  h.rows.get(other.tenantId).credentialsEncrypted = h.rows.get(context.tenantId).credentialsEncrypted;
  await rejects(() => h.service.get(other), "CREDENTIAL_UNAVAILABLE");
});
test("concurrent saves compare-and-swap rather than overwriting", async () => {
  const h = harness(), results = await Promise.allSettled([h.service.save(context, input()), h.service.save(context, { ...input(), model: "other/model" })]);
  assert.equal(results.filter(v => v.status === "fulfilled").length, 1);
  assert.equal(results.filter(v => v.status === "rejected" && v.reason.code === "CONFIG_INVALID").length, 1);
  assert.equal(h.rows.get(context.tenantId).revision, 1);
});
test("authorization denies all settings and invocation entrypoints before reading or saving", async () => {
  const h = harness(); h.ports.authorize = async () => { throw new Error("private detail"); };
  for (const op of [() => h.service.get(context), () => h.service.save(context, input()), () => h.service.profile(context), () => h.service.credential("forged", context)]) await rejects(op, "FORBIDDEN");
  assert.equal(h.rows.size, 0);
});
test("encrypted record destination or repository tenant tampering fails closed", async () => {
  const h = harness(); await h.service.save(context, input());
  const row = h.rows.get(context.tenantId); row.settings.baseUrl = "https://tampered.example.test/v1";
  await rejects(() => h.service.get(context), "CREDENTIAL_UNAVAILABLE");
  row.tenantId = "different-tenant"; await rejects(() => h.service.get(context), "FORBIDDEN");
});
test("tenant configuration connects to real gateway without model/endpoint request overrides", async () => {
  const h = harness(); await h.service.save(context, { ...input(), enabled: true });
  let dispatched = 0;
  const gateway = new ModelGatewayService({ authorize: async () => {}, profile: scope => h.service.profile(scope), credential: (ref, scope) => h.service.credential(ref, scope),
    budget: { reserve: async () => "synthetic-reservation", settle: async () => {}, release: async () => {}, reconcile: async () => {} }
  }, [{ provider: "openai_chat_completions", features: [], generate: async (request, key, connection) => {
    dispatched++; assert.equal(key, input().apiKey); assert.equal(connection.baseUrl, "https://synthetic-model.example.test/v1");
    assert.equal(request.model, input().model); return { text: "Synthetic response", usage: { inputTokens: 1, outputTokens: 1 } };
  } }]);
  const request = { callId: "synthetic-call", model: input().model, messages: [{ role: "user", content: "Synthetic" }], maxOutputTokens: 32 };
  assert.equal((await gateway.generate(context, request)).usageState, "reported");
  await rejects(() => gateway.generate(context, { ...request, baseUrl: "https://override.example.test" }), "INVALID_REQUEST");
  await rejects(() => gateway.generate(context, { ...request, model: "not-configured" }), "MODEL_NOT_ALLOWED"); assert.equal(dispatched, 1);
});
test("repository extra settings cannot leak credentials through public summary", async () => {
  const h = harness(); await h.service.save(context, input());
  h.rows.get(context.tenantId).settings.apiKey = "synthetic-leak";
  await rejects(() => h.service.get(context), "CONFIG_INVALID");
});
function adapterHarness(status = 200, response) {
  const calls = [], adapter = new ChatCompletionsAdapter({ post: async value => {
    calls.push(value); return { status, body: response ?? JSON.stringify({ choices: [{ message: { content: "Synthetic reply" }, finish_reason: "stop" }], usage: { prompt_tokens: 2, completion_tokens: 3 } }) };
  } });
  const request = { callId: "synthetic-call", model: input().model, messages: [{ role: "user", content: "Synthetic" }], maxOutputTokens: 32, signal: new AbortController().signal };
  return { calls, adapter, request, run: () => adapter.generate(request, input().apiKey, { baseUrl: input().baseUrl }) };
}
test("protocol adapter serializes tenant destination/model and parses text usage through controlled transport", async () => {
  const h = adapterHarness(), result = await h.run();
  assert.deepEqual(result, { text: "Synthetic reply", usage: { inputTokens: 2, outputTokens: 3 } });
  assert.equal(h.calls[0].url, "https://synthetic-model.example.test/v1/chat/completions");
  assert.equal(h.calls[0].redirects, "error"); assert.equal(h.calls[0].maxResponseBytes, 1048576);
  assert.deepEqual(JSON.parse(h.calls[0].body), { model: input().model, messages: h.request.messages, stream: false, max_completion_tokens: 32 });
});
for (const [status, code] of [[401, "AUTHENTICATION_FAILED"], [403, "AUTHENTICATION_FAILED"], [429, "RATE_LIMITED"], [302, "PROVIDER_FAILED"], [500, "PROVIDER_FAILED"]]) {
  test(`protocol adapter redacts ${status} without retry or redirect`, async () => {
    const h = adapterHarness(status, input().apiKey); await rejects(h.run, code); assert.equal(h.calls.length, 1);
  });
}
for (const [name, body] of [["invalid JSON", "not-json"], ["oversized", "x".repeat(1048577)],
  ["truncated", JSON.stringify({ choices: [{ message: { content: "partial" }, finish_reason: "length" }] })],
  ["tool call", JSON.stringify({ choices: [{ message: { content: "", tool_calls: [{}] }, finish_reason: "tool_calls" }] })],
  ["key echo", JSON.stringify({ choices: [{ message: { content: input().apiKey }, finish_reason: "stop" }] })],
  ["negative usage", JSON.stringify({ choices: [{ message: { content: "Synthetic" }, finish_reason: "stop" }], usage: { prompt_tokens: -1, completion_tokens: 1 } })]]) {
  test(`protocol adapter rejects ${name} without fabricated success`, async () => { const h = adapterHarness(200, body); await rejects(h.run, "INVALID_RESPONSE"); });
}
test("missing vendor usage stays absent, never manufactured as zero", async () => {
  const h = adapterHarness(200, JSON.stringify({ choices: [{ message: { content: "Synthetic" }, finish_reason: "stop" }] }));
  assert.equal((await h.run()).usage, undefined);
});
test("protocol adapter refuses unsupported features and cancellation before transport", async () => {
  const h = adapterHarness(); h.request.features = ["tools"]; await rejects(h.run, "CAPABILITY_UNSUPPORTED");
  delete h.request.features; const stop = new AbortController(); stop.abort(); h.request.signal = stop.signal;
  await rejects(h.run, "CANCELLED"); assert.equal(h.calls.length, 0);
});
