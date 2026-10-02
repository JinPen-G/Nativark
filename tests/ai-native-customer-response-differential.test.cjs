"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreController } = require("../apps/api/src/modules/rental-core/rental-core.controller");
const f = require("./fixtures/ai-native/customer-response-differential.cjs");
const attempts = [], connect = net.Socket.prototype.connect, fetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("No external connection"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("No external call"); };
});
test.after(() => { net.Socket.prototype.connect = connect; global.fetch = fetch; assert.deepEqual(attempts, []); });
function harness(patch = {}) {
  let row = f.row(patch), mode = "run", lockError;
  const calls = [], specifications = [], tx = {};
  const controller = Object.create(RentalCoreController.prototype);
  const read = async ({ where }) => { calls.push({ kind: "read", where }); return structuredClone(row); };
  tx.rentalInspectionRecord = { findFirst: read, update: async ({ where, data }) => {
    calls.push({ kind: "write", where }); row.exceptions = structuredClone(data.exceptions); return structuredClone(row);
  } };
  controller.service = {
    resolveWorkspaceId: tenant => { assert.equal(tenant, "synthetic-tenant"); return "synthetic-workspace"; },
    lockOrderForUpdate: async (tenant, id, transaction) => {
      assert.equal(transaction, tx); calls.push({ kind: "lock", tenant, id }); if (lockError) throw lockError;
      return { id, status: "settling" };
    },
    getOrder: async (tenant, id) => { calls.push({ kind: "order-read", tenant, id }); return { id, status: "settling" }; }
  };
  controller.prisma = { rentalInspectionRecord: { findFirst: read } };
  controller.committed = (tenant, result) => { assert.equal(tenant, "synthetic-tenant"); return result; };
  controller.idempotent = { execute: async specification => {
    specifications.push(specification); return mode === "run" ? specification.run(tx) : specification.replay();
  } };
  const req = { user: { tenantId: "synthetic-tenant", displayName: "Synthetic server operator" }, headers: {} };
  const invoke = (body = f.request(), index = "0") => controller.recordInspectionExceptionCustomerResponse(req, "synthetic-order", "synthetic-inspection", index, body);
  return { invoke, calls, specifications, row: () => structuredClone(row), replay: () => { mode = "replay"; },
    removeRow: () => { row = null; }, failLock: () => { lockError = new Error("Controlled operation lock denial"); } };
}
for (const index of ["-1", "1.5", "not-an-index"]) {
  test(`actual customer response rejects invalid index ${index} before transaction delegate`, async () => {
    const h = harness(); await assert.rejects(() => h.invoke(f.request(), index), /序号无效/u);
    assert.equal(h.specifications.length, 0); assert.deepEqual(h.calls, []);
  });
}
test("actual customer response requires nonblank evidence before delegate", async () => {
  const h = harness(); await assert.rejects(() => h.invoke(f.request({ reason: "   " })), /记录依据/u);
  assert.equal(h.specifications.length, 0); assert.deepEqual(h.calls, []);
});
for (const example of f.deniedStates) {
  test(`actual customer response blocks ${example.name} without updating history`, async () => {
    const h = harness(example.patch), before = h.row();
    await assert.rejects(() => h.invoke(f.request(example.body)), example.error);
    assert.deepEqual(h.row(), before); assert.equal(h.calls.some(row => row.kind === "write"), false);
    assert.deepEqual(h.calls.map(row => row.kind), ["lock", "read"]);
  });
}
test("actual confirmation appends history, trims evidence and uses server operator not extra body actor", async () => {
  const history = [{ decision: "disputed", reason: "Synthetic earlier evidence", operator: "Earlier operator", respondedAt: "2026-01-01T00:00:00Z" }];
  const h = harness({ customerResponseStatus: "disputed", customerResponseHistory: history });
  const result = await h.invoke(f.request({ operator: "Forged input actor", customerRespondedBy: "Forged input actor" }));
  const exception = result.exception;
  assert.equal(exception.customerResponseStatus, "confirmed"); assert.equal(exception.customerResponseReason, "Synthetic customer confirmation evidence");
  assert.equal(exception.customerRespondedBy, "Synthetic server operator"); assert.equal(exception.customerResponseHistory.length, 2);
  assert.deepEqual(exception.customerResponseHistory[0], history[0]);
  assert.equal(exception.customerResponseHistory[1].operator, "Synthetic server operator");
  assert.ok(Number.isFinite(Date.parse(exception.customerResponseHistory[1].respondedAt)));
  assert.deepEqual(h.calls.map(row => row.kind), ["lock", "read", "write"]);
  assert.deepEqual(h.calls[1].where, { id: "synthetic-inspection", tenantId: "synthetic-tenant", workspaceId: "synthetic-workspace", orderId: "synthetic-order" });
  // Direct controller method with synthetic req.user, not proof of Auth/DTO or actual customer consent.
});
test("actual customer response missing inspection or out-of-range exception never writes", async () => {
  const absent = harness(); absent.removeRow();
  await assert.rejects(absent.invoke, /检查记录不存在/u); assert.equal(absent.calls.some(row => row.kind === "write"), false);
  const h = harness(); await assert.rejects(() => h.invoke(f.request(), "100"), /检查异常不存在/u);
  assert.equal(h.calls.some(row => row.kind === "write"), false);
});
test("controlled order-lock failure stops real controller before inspection lookup/update", async () => {
  const h = harness(); h.failLock(); await assert.rejects(h.invoke, /Controlled operation lock denial/u);
  assert.deepEqual(h.calls.map(row => row.kind), ["lock"]);
});
test("actual replay callback reads matching response without appending history", async () => {
  const h = harness(); await h.invoke(); const before = h.row(), writes = h.calls.filter(row => row.kind === "write").length;
  h.replay(); const replayed = await h.invoke();
  assert.equal(replayed.exception.customerResponseStatus, "confirmed"); assert.deepEqual(h.row(), before);
  assert.equal(h.calls.filter(row => row.kind === "write").length, writes);
  // Explicitly select controller replay callback; real idempotency repository/fingerprint NOT executed.
});
test("actual replay callback with different decision returns no reconstructed result", async () => {
  const h = harness(); await h.invoke(); h.replay();
  const result = await h.invoke(f.request({ decision: "disputed" })); assert.equal(result, undefined);
  assert.equal(h.calls.filter(row => row.kind === "write").length, 1);
});
