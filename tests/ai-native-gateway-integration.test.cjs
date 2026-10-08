"use strict";
const test = require("node:test"), assert = require("node:assert/strict");
require("./fixtures/ai-native/contract-consumer.cjs").blockNetwork(test);
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const classes = {
  Config: require("../apps/api/src/modules/ai-native/tenant-model-config.service").TenantModelConfigService,
  SecretBox: require("../apps/api/src/common/secret-box").SecretBox,
  Gateway: require("../apps/api/src/modules/ai-native/model-gateway.service").ModelGatewayService,
  Adapter: require("../apps/api/src/modules/ai-native/chat-completions.adapter").ChatCompletionsAdapter,
  Transport: require("../apps/api/src/modules/ai-native/model-egress.transport").ModelEgressTransport
};
const f = require("./fixtures/ai-native/gateway-integration.cjs");
const reject = (op, code) => assert.rejects(op, e => e.code === code && e.message === code);
function unknownUsageInvariant(result, events) {
  assert.equal(result.usage, null); assert.equal(result.usageState, "reconciliation_required");
  assert.equal(events.filter(e => e[0] === "reconcile").length, 1);
  assert.equal(events.some(e => ["release", "settle"].includes(e[0])), false);
}
test("S07 real config -> gateway -> protocol -> pinned transport, synthetic peer only", async () => {
  const h = await f.harness(classes), result = await h.gateway.generate(h.context, h.request);
  assert.equal(result.text, "Synthetic answer"); assert.equal(result.usageState, "reported");
  assert.deepEqual(result.usage, { inputTokens: 3, outputTokens: 4 });
  assert.deepEqual(h.events.map(e => e[0]), ["reserve", "settle"]);
  assert.equal(h.peer.state.options[0].hostname, "synthetic.example.test");
  assert.equal(h.peer.state.options[0].servername, "synthetic.example.test");
  assert.equal(h.peer.state.options[0].rejectUnauthorized, true);
  assert.equal(JSON.parse(h.peer.state.requests[0].body).model, h.settings.model);
  assert.equal(h.peer.state.options[0].headers.Authorization, "Bearer " + h.settings.apiKey);
  assert.equal(JSON.stringify(result).includes(h.settings.apiKey), false);
  assert.equal(h.peer.state.timers.size, 0);
});
test("S07 two tenants retain independent encrypted keys and reservation owners", async () => {
  const h = await f.harness(classes), other = { ...h.context, tenantId: "tenant-other" };
  await h.service.save(other, { ...h.settings, apiKey: "synthetic-other-key" });
  await Promise.all([h.gateway.generate(h.context, h.request), h.gateway.generate(other, { ...h.request, callId: "other-call" })]);
  assert.deepEqual([...h.ledger.values()].map(v => v.tenantId).sort(), ["tenant-other", "tenant-test"]);
  assert.deepEqual(h.peer.state.options.map(v => v.headers.Authorization).sort(), ["Bearer synthetic-key-not-real", "Bearer synthetic-other-key"].sort());
});
test("S07 unknown usage is reconciled, mutation removing reconcile fails invariant", async () => {
  const h = await f.harness(classes, { usage: false });
  const result = await h.gateway.generate(h.context, h.request); unknownUsageInvariant(result, h.events);
  const mutant = await f.harness(classes, { usage: false });
  mutant.ports.budget.reconcile = async () => {}; // Deliberately broken external accounting port.
  const mutatedResult = await mutant.gateway.generate(mutant.context, mutant.request);
  assert.throws(() => unknownUsageInvariant(mutatedResult, mutant.events), assert.AssertionError);
});
for (const [status, code] of [[401, "AUTHENTICATION_FAILED"], [429, "RATE_LIMITED"], [302, "INVALID_RESPONSE"], [500, "PROVIDER_FAILED"]]) test("S07 peer status " + status + " never releases dispatched budget or retries", async () => {
  const h = await f.harness(classes, { egress: { status, headers: { location: "https://different.example.test" }, chunks: [Buffer.from("synthetic-key-not-real private-error")] } });
  await reject(() => h.gateway.generate(h.context, h.request), code);
  assert.deepEqual(h.events.map(e => e[0]), ["reserve", "reconcile"]); assert.equal(h.peer.state.requests.length, 1);
  assert.equal(h.peer.state.timers.size, 0);
});
test("S07 missing budget and unimplemented required feature stop before dispatch", async () => {
  const h = await f.harness(classes, { noBudget: true });
  await reject(() => h.gateway.generate(h.context, h.request), "BUDGET_UNAVAILABLE"); assert.equal(h.peer.state.options.length, 0);
  await reject(() => h.gateway.generate(h.context, { ...h.request, features: ["tools"] }), "CAPABILITY_UNSUPPORTED");
  assert.equal(h.peer.state.options.length, 0); assert.equal(h.events.length, 0);
});
test("S07 repository tenant substitution is denied before credentials and reservation", async () => {
  const h = await f.harness(classes); h.rows.get(h.context.tenantId).tenantId = "tenant-other";
  await reject(() => h.gateway.generate(h.context, h.request), "CONFIG_INVALID");
  assert.equal(h.peer.state.options.length, 0); assert.equal(h.events.length, 0);
});
test("S07 adapter falsely advertising/stripping required tools fails no-dispatch oracle", async () => {
  class MutatedAdapter extends classes.Adapter {
    features = ["tools"];
    generate(input, key, connection) { return super.generate({ ...input, features: [] }, key, connection); }
  }
  const h = await f.harness({ ...classes, Adapter: MutatedAdapter });
  await h.gateway.generate(h.context, { ...h.request, features: ["tools"] });
  assert.throws(() => assert.equal(h.peer.state.options.length, 0), assert.AssertionError);
});
test("S07 selected platform without integrated router fails closed; BYOK retained", async () => {
  const h = await f.harness(classes), old = h.rows.get(h.context.tenantId).credentialsEncrypted;
  await h.service.changeMode(h.context, { mode: "platform_managed", expectedRevision: 1 });
  await reject(() => h.gateway.generate(h.context, h.request), "CONFIG_INVALID");
  assert.equal(h.peer.state.options.length, 0); assert.equal(h.rows.get(h.context.tenantId).credentialsEncrypted, old);
});
test("S07 cancellation after reservation releases only undispatched reservation", async () => {
  const controller = new AbortController(), h = await f.harness(classes, { onReserve: async () => controller.abort() });
  await reject(() => h.gateway.generate(h.context, h.request, controller.signal), "CANCELLED");
  assert.deepEqual(h.events.map(e => e[0]), ["reserve", "release"]); assert.equal(h.peer.state.options.length, 0);
});
test("S07 settlement failure is accounting pending and conservatively reconciled", async () => {
  const h = await f.harness(classes, { settleFailure: true });
  await reject(() => h.gateway.generate(h.context, h.request), "ACCOUNTING_PENDING");
  assert.deepEqual(h.events.map(e => e[0]), ["reserve", "settle", "reconcile"]);
});
test("S06 revision changes during budget await reject stale dispatch and release reservation", async () => {
  const h = await f.harness(classes, { onReserve: async state => state.service.changeMode({ tenantId: "tenant-test", workspaceId: "workspace-test", actorId: "operator-test" }, { mode: "platform_managed", expectedRevision: 1 }) });
  await reject(() => h.gateway.generate(h.context, h.request), "CONFIG_INVALID");
  assert.equal((await h.service.selection(h.context)).mode, "platform_managed");
  assert.equal(h.peer.state.options.length, 0); assert.deepEqual(h.events.map(e => e[0]), ["reserve", "release"]);
});
test("S06 authorization revoked during budget await rejects before dispatch", async () => {
  const h = await f.harness(classes, { onReserve: async state => state.revoke() });
  await reject(() => h.gateway.generate(h.context, h.request), "FORBIDDEN");
  assert.equal(h.scopes.length, 2); assert.equal(h.peer.state.options.length, 0);
  assert.deepEqual(h.events.map(e => e[0]), ["reserve", "release"]);
  await reject(() => h.gateway.generate(h.context, h.request), "FORBIDDEN");
});
