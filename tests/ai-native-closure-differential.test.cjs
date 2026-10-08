"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const f = require("./fixtures/ai-native/closure-differential.cjs");
const attempts = [], connect = net.Socket.prototype.connect, fetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("External connection forbidden"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("External call forbidden"); };
});
test.after(() => { net.Socket.prototype.connect = connect; global.fetch = fetch; assert.deepEqual(attempts, []); });

function harness({ order = f.order(), inspections = [], extensions = [], hookFails = false } = {}) {
  const calls = [], tx = {}, core = Object.create(RentalCoreService.prototype);
  const record = (kind, tenant, id, transaction) => {
    assert.equal(tenant, "synthetic-tenant"); assert.equal(id, "synthetic-order"); assert.equal(transaction, tx);
    calls.push(kind);
  };
  core.factStore = {
    lockOrder: async (...args) => record("lock", ...args),
    findOrder: async (...args) => { record("read", ...args); return order; },
    listExtensions: async (...args) => { record("extensions", ...args); return extensions; },
    listInspections: async (...args) => { record("inspections", ...args); return inspections; },
    cancelExtensions: async (tenant, ids, transaction) => { assert.equal(transaction, tx); calls.push({ kind: "cancel", tenant, ids }); },
    saveOrderAggregate: async (value, assets, transaction) => { assert.equal(value, order); assert.equal(transaction, tx); assert.deepEqual(assets, []); calls.push("save"); }
  };
  core.runHook = async (...args) => {
    assert.equal(args[1], "settlement"); assert.equal(args[4], tx); calls.push("hook");
    if (hookFails) throw new Error("Controlled capability unavailable");
  };
  core.orderHookInstances = () => []; // Controlled capability-list dependency, not category execution proof.
  const close = () => core.settleOrder("synthetic-tenant", "synthetic-order", tx, "Synthetic operator");
  async function reject(error) {
    const before = structuredClone(order);
    await assert.rejects(close, error); assert.deepEqual(order, before);
    assert.equal(calls.includes("save"), false); assert.equal(calls.some(row => row?.kind === "cancel"), false);
  }
  return { order, calls, close, reject };
}
for (const example of f.blockers) {
  test(`actual locked settlement rejects ${example.name} before hook/extension cancellation/write`, async () => {
    const h = harness({ inspections: example.rows, extensions: [{ id: "pending-extension", status: "pending_payment" }] });
    await h.reject(example.error);
    assert.deepEqual(h.calls, ["lock", "read", "extensions", "inspections"]);
  });
}

test("actual closure stops before inspection when an effective extension refund review remains pending", async () => {
  const h = harness({ extensions: [{ id: "extension", status: "effective", pricingSnapshot: { refundReview: { status: "pending" } } }] });
  await h.reject(/续租差额退款待审核/u); assert.deepEqual(h.calls, ["lock", "read", "extensions"]);
});
test("actual closure stops on pending fee review without silently waiving fees", async () => {
  const h = harness({ order: f.order({ feeReviews: [{ status: "pending" }] }) });
  await h.reject(/费用审核单待处理/u); assert.deepEqual(h.calls, ["lock", "read", "extensions"]);
});
for (const executionStatus of [undefined, "not_started", "in_progress"]) {
  test(`actual closure blocks an occurrence with execution status ${executionStatus}`, async () => {
    const h = harness({ order: f.order({ serviceSnapshots: [{ occurrenceId: "occurrence", executionStatus }] }) });
    await h.reject(/增值服务未收口/u); assert.deepEqual(h.calls, ["lock", "read", "extensions"]);
  });
}
test("actual closure accepts historical service without occurrence ID and zero/rejected exceptions", async () => {
  const h = harness({ order: f.order({ serviceSnapshots: [{ executionStatus: "not_started" }] }),
    inspections: [{ exceptions: [f.exception({ approvedChargeAmount: 0, customerResponseStatus: undefined }), { reviewStatus: "rejected" }] }] });
  await h.close(); assert.equal(h.order.status, "completed"); assert.equal(h.calls.filter(row => row === "save").length, 1);
  // Existing legacy exception policy, not proof that a real service was fulfilled or paid.
});
test("actual closure confirms all inspection rows then cancels pending extensions and saves once", async () => {
  const h = harness({ inspections: [{ exceptions: [f.exception()] }, { exceptions: [] }],
    extensions: [{ id: "pending", status: "pending_payment" }, { id: "effective", status: "effective" }] });
  await h.close(); assert.equal(h.order.status, "completed"); assert.ok(Number.isFinite(Date.parse(h.order.completedAt)));
  assert.deepEqual(h.calls, ["lock", "read", "extensions", "inspections", "hook", "extensions",
    { kind: "cancel", tenant: "synthetic-tenant", ids: ["pending"] }, "save"]);
  const length = h.calls.length;
  await assert.rejects(h.close, /只有已归还待结算/u);
  assert.deepEqual(h.calls.slice(length), ["lock", "read"]);
});
test("actual closure does not ignore a later inspection blocker after an earlier confirmed row", async () => {
  const h = harness({ inspections: [{ exceptions: [f.exception()] }, { exceptions: [f.exception({ customerResponseStatus: "disputed" })] }] });
  await h.reject(/待客户确认/u); assert.equal(h.calls.includes("hook"), false);
});
test("actual closure hook failure stops before status mutation, extension cancellation and save", async () => {
  const h = harness({ inspections: [{ exceptions: [f.exception()] }], hookFails: true });
  await h.reject(/Controlled capability unavailable/u); assert.equal(h.order.status, "settling");
  assert.deepEqual(h.calls, ["lock", "read", "extensions", "inspections", "hook"]);
});
