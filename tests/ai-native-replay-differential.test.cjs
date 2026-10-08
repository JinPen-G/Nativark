"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalIdempotencyRepository, requestFingerprint, assertSameRequest } = require("../apps/api/src/modules/rental-core/rental-idempotency.repository");
const { RentalOrderConfirmationService } = require("../apps/api/src/modules/rental-core/rental-order-confirmation.service");
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const { runWithRequestIdentity } = require("../apps/api/src/common/request-identity");
const existing = require("./fixtures/ai-native/authorization-baseline.cjs");
const f = require("./fixtures/ai-native/replay-differential.cjs");
const attempts = [], connect = net.Socket.prototype.connect, fetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("No external connections"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("No external provider"); };
});
test.after(() => { net.Socket.prototype.connect = connect; global.fetch = fetch; assert.deepEqual(attempts, []); });

function harness() {
  const calls = { notifications: [], transaction: 0, orderReads: 0, quoteReads: 0, idempotency: [] };
  const stored = { requestHash: requestFingerprint(f.input()), orderId: "order-a", response: null };
  const core = { getProfile: () => ({}), getWorkspaceCategory: async () => ({}), getBusinessSettings: () => ({}),
    listItemGroups: () => [], listPricingGroups: () => [], listCouponTemplates: () => [], listLocations: () => [], listOperators: () => [],
    persist: async () => undefined, resolveWorkspaceId: () => "workspace-a" };
  const business = { persist: async () => undefined, emitNotificationEvent: async (...args) => { calls.notifications.push(args); return []; },
    consumeQuote: () => { calls.quoteReads++; throw new Error("Controlled missing durable order fallback reached quote revalidation"); } };
  const facts = { findOrder: async () => { calls.orderReads++; return existing.order(); } };
  const idempotency = { find: async (...args) => { calls.idempotency.push(args); return stored; } };
  const app = new RentalOrderConfirmationService({ $transaction: async () => { calls.transaction++; throw new Error("Transaction forbidden by this replay harness"); } },
    core, business, facts, {}, idempotency);
  const controller = new RentalCoreController(core, undefined, business, app);
  const req = { user: existing.user({ permissions: ["rental-os:order:create", "rental-core:capability:override"] }), headers: { "idempotency-key": "synthetic-key" } };
  return { calls, stored, facts, app, controller, req };
}

test("actual fingerprint ignores object key order but retains array order and explicit business changes", () => {
  const first = { b: { y: 2, x: 1 }, a: ["a", "b"] };
  const reordered = { a: ["a", "b"], b: { x: 1, y: 2 } };
  assert.equal(requestFingerprint(first), requestFingerprint(reordered));
  assert.notEqual(requestFingerprint(first), requestFingerprint({ ...first, a: ["b", "a"] }));
  assert.doesNotThrow(() => assertSameRequest({ requestHash: requestFingerprint(first) }, requestFingerprint(reordered)));
  assert.throws(() => assertSameRequest({ requestHash: requestFingerprint(first) }, requestFingerprint({ ...first, a: ["b", "a"] })), /不同的请求内容/u);
});

test("actual application replay excludes regenerated actor/permission/time without dropping business exception reason", async () => {
  const h = harness();
  for (const actor of ["first actor", "later actor"]) {
    const submitted = { ...f.input(), capabilityExceptions: [{ ...f.input().capabilityExceptions[0],
      confirmedBy: actor, confirmedWithPermission: "synthetic-server-permission", confirmedAt: actor === "first actor" ? "2026-01-01" : "2026-02-01" }] };
    const before = structuredClone(submitted);
    const result = await h.app.createOrder("tenant-a", submitted, actor, {}, "synthetic-key");
    assert.equal(result.replayed, true);
    assert.deepEqual(submitted, before);
  }
  assert.equal(h.calls.quoteReads, 0); assert.equal(h.calls.transaction, 0);
});

test("real controller and real application replay skip notification while actor is regenerated", async () => {
  const h = harness();
  const first = await h.controller.createOrder(h.req, f.input());
  h.req.user.displayName = "Another server-side display name";
  const second = await h.controller.createOrder(h.req, f.input());
  assert.equal(first.id, "order-a"); assert.equal(second.id, "order-a");
  assert.equal(h.calls.notifications.length, 0); assert.equal(h.calls.transaction, 0);
  assert.equal(h.calls.orderReads, 2);
});

for (const { name, patch } of f.mutations) {
  test(`real application rejects same-key changed ${name} before replay resource read or side effect`, async () => {
    const h = harness();
    await assert.rejects(() => h.controller.createOrder(h.req, { ...f.input(), ...patch }), /不同的请求内容/u);
    assert.equal(h.calls.orderReads, 0); assert.equal(h.calls.quoteReads, 0);
    assert.equal(h.calls.transaction, 0); assert.equal(h.calls.notifications.length, 0);
  });
}

test("controller rechecks capability override before committed replay lookup", async () => {
  const h = harness(); h.req.user.permissions = ["rental-os:order:create"];
  await assert.rejects(() => h.controller.createOrder(h.req, f.input()), /能力风险例外确认/u);
  assert.equal(h.calls.idempotency.length, 0); assert.equal(h.calls.notifications.length, 0);
  // This is controller-specific extra permission, NOT actual Guard dynamic authorization.
});

test("missing durable order does not return fabricated committed replay; next real branch revalidates quote", async () => {
  const h = harness(); h.facts.findOrder = async () => undefined;
  await assert.rejects(() => h.app.createOrder("tenant-a", f.input(), "Synthetic", {}, "synthetic-key"), /fallback reached quote revalidation/u);
  assert.equal(h.calls.quoteReads, 1); assert.equal(h.calls.transaction, 0); assert.equal(h.calls.notifications.length, 0);
  // Error is deliberately from a dependency substitute; NOT a production missing-order domain error.
});

test("actual idempotency repository scopes identical key by authenticated tenant and workspace", async () => {
  const queries = [];
  const repository = new RentalIdempotencyRepository({
    businessWorkspace: { findFirst: async ({ where }) => ({ id: where.id }) },
    rentalOrderIdempotencyRecord: { findFirst: async ({ where }) => { queries.push(where); return null; } }
  });
  for (const workspaceId of ["workspace-a", "workspace-b"]) {
    await runWithRequestIdentity(existing.identity({ workspaceId }), () => repository.find("tenant-a", "rental.order.create", "same-key"));
  }
  assert.deepEqual(queries, ["workspace-a", "workspace-b"].map(workspaceId => ({ tenantId: "tenant-a", workspaceId, action: "rental.order.create", idempotencyKey: "same-key" })));
  // Query shape under controlled lookup, NOT proof that a real database isolates rows.
});

test("actual repository records using supplied transaction dependency and refuses invalid scope lookup", async () => {
  const writes = [];
  const repository = new RentalIdempotencyRepository({ rentalOrderIdempotencyRecord: { create: async () => assert.fail("outside supplied transaction") } });
  const tx = { businessWorkspace: { findFirst: async () => ({ id: "workspace-a" }) },
    rentalOrderIdempotencyRecord: { create: async ({ data }) => { writes.push(data); return data; } } };
  const input = { tenantId: "tenant-a", action: "rental.order.create", key: "same-key", requestHash: requestFingerprint(f.input()), orderId: "order-a", response: null };
  await runWithRequestIdentity(existing.identity(), () => repository.record(input, tx));
  assert.equal(writes[0].workspaceId, "workspace-a"); assert.equal(writes[0].tenantId, "tenant-a");
  tx.businessWorkspace.findFirst = async () => null;
  await assert.rejects(() => runWithRequestIdentity(existing.identity({ workspaceId: "foreign" }), () => repository.record(input, tx)), /不属于目标租户/u);
  assert.equal(writes.length, 1);
  // Supplied tx object verified, not MySQL transaction atomicity or uniqueness.
});
