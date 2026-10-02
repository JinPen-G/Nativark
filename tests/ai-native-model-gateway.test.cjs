"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
require("ts-node").register({ transpileOnly: false, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { ModelGatewayService } = require("../apps/api/src/modules/ai-native/model-gateway.service");
const { ModelGatewayModule } = require("../apps/api/src/modules/ai-native/model-gateway.module");
const { ModelAdapterError, ModelGatewayError } = require("../apps/api/src/modules/ai-native/model-gateway.ports");
const originalConnect = net.Socket.prototype.connect, originalFetch = global.fetch, external = [];
test.before(() => {
  net.Socket.prototype.connect = function () { external.push("socket"); throw new Error("No external calls"); };
  global.fetch = async () => { external.push("fetch"); throw new Error("No external calls"); };
});
test.after(() => { net.Socket.prototype.connect = originalConnect; global.fetch = originalFetch; assert.deepEqual(external, []); });
const context = { tenantId: "synthetic-tenant", workspaceId: "synthetic-space", actorId: "synthetic-actor" };
const request = () => ({ callId: "synthetic-call", model: "synthetic-model", messages: [{ role: "user", content: "Synthetic input only" }], maxOutputTokens: 100 });
function harness() {
  const calls = [], secret = "synthetic-secret-never-external";
  const profile = { enabled: true, provider: "synthetic", allowedModels: ["synthetic-model"], credentialRef: "vault:synthetic", timeoutMs: 1000, maxConcurrent: 1, maxOutputTokens: 200 };
  const ports = {
    authorize: async scope => { calls.push(["authorize", scope]); }, profile: async () => profile,
    credential: async reference => { calls.push(["credential", reference]); return secret; },
    budget: {
      reserve: async (...args) => { calls.push(["reserve", ...args]); return "reservation:synthetic"; },
      settle: async (...args) => { calls.push(["settle", ...args]); }, release: async (...args) => { calls.push(["release", ...args]); },
      reconcile: async (...args) => { calls.push(["reconcile", ...args]); }
    }
  };
  const adapter = { provider: "synthetic", features: [], generate: async (input, credential) => {
    assert.equal(credential, secret); calls.push(["generate", input]);
    return { text: "Synthetic answer", usage: { inputTokens: 5, outputTokens: 3 } };
  } };
  const gateway = new ModelGatewayService(ports, [adapter]);
  return { calls, secret, profile, ports, adapter, gateway, run: (input = request(), signal) => gateway.generate(context, input, signal) };
}
const rejects = (operation, code) => assert.rejects(operation, error => error instanceof ModelGatewayError && error.code === code && error.message === code);
const count = (h, kind) => h.calls.filter(row => row[0] === kind).length;

test("tenant concurrency quota is isolated even when tenants use the same protocol", async () => {
  const h = harness(); let finish;
  h.adapter.generate = () => new Promise(resolve => { finish = () => resolve({ text: "Synthetic", usage: { inputTokens: 1, outputTokens: 1 } }); });
  const first = h.run();
  while (!finish) await new Promise(resolve => setImmediate(resolve));
  await rejects(h.run, "RATE_LIMITED");
  h.adapter.generate = async () => ({ text: "Other tenant", usage: { inputTokens: 1, outputTokens: 1 } });
  assert.equal((await h.gateway.generate({ ...context, tenantId: "other-tenant" }, request())).text, "Other tenant");
  finish(); await first;
});
test("gateway executes authorized request through vault and budget and returns reported usage without credentials", async () => {
  const h = harness(), result = await h.run();
  assert.equal(result.text, "Synthetic answer"); assert.deepEqual(result.usage, { inputTokens: 5, outputTokens: 3 });
  assert.equal(result.usageState, "reported"); assert.equal(JSON.stringify(result).includes(h.secret), false);
  assert.deepEqual(h.calls.map(row => row[0]), ["authorize", "credential", "reserve", "generate", "settle"]);
  assert.equal(count(h, "release"), 0);
});
test("module explicitly wires gateway but declares no controllers or automatic providers", () => {
  const h = harness(), definition = ModelGatewayModule.register(h.ports, [h.adapter]);
  assert.equal(definition.controllers, undefined); assert.equal(definition.providers[0].provide, ModelGatewayService);
  assert.ok(definition.providers[0].useFactory() instanceof ModelGatewayService);
});
for (const [name, patch] of [["URL override", { baseUrl: "https://untrusted.example.test" }], ["secret override", { apiKey: "forged" }], ["actor override", { actorId: "forged" }]]) {
  test(`gateway rejects request ${name} before authorization or any side effect`, async () => {
    const h = harness(); await rejects(() => h.run({ ...request(), ...patch }), "INVALID_REQUEST"); assert.deepEqual(h.calls, []);
  });
}
test("gateway denies missing scope and authorization failure before vault/provider", async () => {
  const h = harness(); await rejects(() => h.gateway.generate({ ...context, workspaceId: "" }, request()), "INVALID_REQUEST");
  h.ports.authorize = async () => { throw new Error("synthetic private auth detail"); };
  await rejects(h.run, "FORBIDDEN"); assert.equal(count(h, "generate"), 0); assert.equal(count(h, "credential"), 0);
});
test("gateway is disabled by profile and rejects unapproved models/output limits", async () => {
  const h = harness(); h.profile.enabled = false; await rejects(h.run, "DISABLED");
  h.profile.enabled = true; await rejects(() => h.run({ ...request(), model: "not-approved" }), "MODEL_NOT_ALLOWED");
  await rejects(() => h.run({ ...request(), maxOutputTokens: 201 }), "MODEL_NOT_ALLOWED");
  assert.equal(count(h, "generate"), 0); assert.equal(count(h, "reserve"), 0);
});
test("gateway rejects unsupported capability and absent provider without fake success", async () => {
  const h = harness(); await rejects(() => h.run({ ...request(), features: ["tools"] }), "CAPABILITY_UNSUPPORTED");
  h.profile.provider = "missing"; await rejects(h.run, "PROVIDER_UNAVAILABLE"); assert.equal(count(h, "generate"), 0);
});
test("credential failure is redacted and does not reserve budget or dispatch", async () => {
  const h = harness(); h.ports.credential = async () => { throw new Error(h.secret); };
  await rejects(h.run, "CREDENTIAL_UNAVAILABLE"); assert.equal(count(h, "reserve"), 0); assert.equal(count(h, "generate"), 0);
});
test("budget rejection prevents dispatch and slots are reusable", async () => {
  const h = harness(), reserve = h.ports.budget.reserve;
  h.ports.budget.reserve = async () => { throw new Error(h.secret); };
  await rejects(h.run, "BUDGET_UNAVAILABLE"); assert.equal(count(h, "generate"), 0);
  h.ports.budget.reserve = reserve; assert.equal((await h.run()).usageState, "reported");
});
test("missing usage retains reservation for reconciliation, not zero-cost release", async () => {
  const h = harness(); h.adapter.generate = async () => ({ text: "Synthetic", usage: undefined });
  const result = await h.run(); assert.equal(result.usage, null); assert.equal(result.usageState, "reconciliation_required");
  assert.equal(count(h, "settle"), 0); assert.equal(count(h, "release"), 0); assert.equal(count(h, "reconcile"), 1);
});
for (const code of ["AUTHENTICATION_FAILED", "RATE_LIMITED", "PROVIDER_FAILED"]) {
  test(`adapter ${code} maps to safe error and reconciliation without retry`, async () => {
    const h = harness(); let attempts = 0;
    h.adapter.generate = async () => { attempts++; throw new ModelAdapterError(code); };
    await rejects(h.run, code); assert.equal(attempts, 1); assert.equal(count(h, "reconcile"), 1); assert.equal(count(h, "release"), 0);
  });
}
test("raw provider errors and credential echo are never returned", async () => {
  const h = harness(); h.adapter.generate = async () => { throw new Error(h.secret); }; await rejects(h.run, "PROVIDER_FAILED");
  h.adapter.generate = async () => ({ text: h.secret, usage: { inputTokens: 1, outputTokens: 1 } });
  await rejects(h.run, "INVALID_RESPONSE");
});
test("forged adapter error code cannot smuggle secret text into safe gateway errors", async () => {
  const h = harness(); h.adapter.generate = async () => { throw new ModelGatewayError(h.secret); };
  await rejects(h.run, "PROVIDER_FAILED");
});
test("adapter abort rejection cannot overwrite timeout classification", async () => {
  const h = harness(); h.profile.timeoutMs = 5;
  h.adapter.generate = input => new Promise((_, reject) => input.signal.addEventListener("abort", () => reject(new Error(h.secret)), { once: true }));
  await rejects(h.run, "TIMEOUT"); assert.equal(count(h, "reconcile"), 1);
});
test("invalid server profile cannot provide a raw secret or unapproved request endpoint", async () => {
  const h = harness(); h.profile.apiKey = h.secret;
  await rejects(h.run, "CONFIG_INVALID"); assert.equal(count(h, "generate"), 0);
});
test("invalid usage triggers reconciliation not fabricated reported usage", async () => {
  const h = harness(); h.adapter.generate = async () => ({ text: "Synthetic", usage: { inputTokens: -1, outputTokens: 2 } });
  await rejects(h.run, "INVALID_RESPONSE"); assert.equal(count(h, "settle"), 0);
});
test("budget settlement failure is accounting pending and does not resend model request", async () => {
  const h = harness(); h.ports.budget.settle = async () => { throw new Error(h.secret); };
  await rejects(h.run, "ACCOUNTING_PENDING"); assert.equal(count(h, "generate"), 1); assert.equal(count(h, "reconcile"), 1);
});
test("reconciliation failure preserves safe accounting-pending error", async () => {
  const h = harness(); h.adapter.generate = async () => { throw new Error(h.secret); };
  h.ports.budget.reconcile = async () => { throw new Error(h.secret); };
  await rejects(h.run, "ACCOUNTING_PENDING"); assert.equal(count(h, "release"), 0);
});
test("pre-cancelled request does not access vault or provider", async () => {
  const h = harness(), cancel = new AbortController(); cancel.abort();
  await rejects(() => h.run(request(), cancel.signal), "CANCELLED"); assert.deepEqual(h.calls, []);
});
test("cancellation during reservation releases before dispatch", async () => {
  const h = harness(), cancel = new AbortController(), reserve = h.ports.budget.reserve;
  h.ports.budget.reserve = async (...args) => { const id = await reserve(...args); cancel.abort(); return id; };
  await rejects(() => h.run(request(), cancel.signal), "CANCELLED"); assert.equal(count(h, "release"), 1); assert.equal(count(h, "generate"), 0);
});
for (const code of ["TIMEOUT", "CANCELLED"]) {
  test(`in-flight ${code} aborts adapter and reconciles; adapter ignoring abort keeps concurrency slot`, async () => {
    const h = harness(), cancel = new AbortController(); h.profile.timeoutMs = 10;
    let finish, signal;
    h.adapter.generate = async input => { signal = input.signal; return new Promise(resolve => { finish = resolve; }); };
    const pending = h.run(request(), cancel.signal);
    if (code === "CANCELLED") setTimeout(() => cancel.abort(), 1);
    await rejects(() => pending, code); assert.equal(signal.aborted, true); assert.equal(count(h, "reconcile"), 1);
    await rejects(h.run, "RATE_LIMITED");
    finish({ text: "Late ignored response", usage: { inputTokens: 1, outputTokens: 1 } });
    await new Promise(resolve => setImmediate(resolve));
    h.adapter.generate = async () => ({ text: "Next response", usage: { inputTokens: 1, outputTokens: 1 } });
    assert.equal((await h.run()).text, "Next response");
    assert.equal(count(h, "settle"), 1); // Late result never changes reconciliation into settled success.
  });
}
