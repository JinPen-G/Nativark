"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { PaymentRuntimeService, PaymentProviderDefinitiveError, refundFailureDisposition } = require("../apps/api/src/modules/integrations/payment.runtime.service");
const f = require("./fixtures/ai-native/refund-differential.cjs");
const attempts = [], connect = net.Socket.prototype.connect, fetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("External connections forbidden"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("External calls forbidden"); };
});
test.after(() => { net.Socket.prototype.connect = connect; global.fetch = fetch; assert.deepEqual(attempts, []); });

function harness(overrides = {}) {
  let row = f.row(overrides), failFunding = false;
  const calls = { reads: [], writes: [], funding: [], transactions: 0 };
  const table = {
    findFirst: async ({ where }) => { calls.reads.push(structuredClone(where)); return row && structuredClone(row); },
    update: async ({ data }) => { calls.writes.push(structuredClone(data)); Object.assign(row, data); return structuredClone(row); },
    updateMany: async ({ where, data }) => {
      // Controlled conditional write substitute, not database isolation evidence.
      if (!row || (where.status && !where.status.in.includes(row.status))) return { count: 0 };
      calls.writes.push(structuredClone(data)); Object.assign(row, data); return { count: 1 };
    }
  };
  const prisma = { rentalPaymentRefund: table, $transaction: async callback => {
    calls.transactions++; const before = structuredClone(row);
    try { return await callback({ rentalPaymentRefund: table }); }
    catch (error) { row = before; throw error; }
  } };
  const funding = { recordEvent: async (...args) => {
    calls.funding.push(args);
    if (failFunding) throw new Error("Controlled ledger outage");
  } };
  const service = new PaymentRuntimeService(prisma, {}, funding);
  const args = [row.tenantId, row.workspaceId, row.orderId, row.id];
  return { service, calls, args, row: () => structuredClone(row),
    failFunding: value => { failFunding = value; }, removeRow: () => { row = null; } };
}

for (const state of f.protectedStates) {
  for (const incoming of ["accepted", "failed"]) {
    test(`actual refund method preserves ${state} after ${incoming} observation`, async () => {
      const h = harness({ status: state, externalRefundId: "external-a", succeededAt: new Date("2026-01-02T00:00:00Z") });
      const before = h.row();
      const result = await h.service.applyProviderRefundOutcome(...h.args, f.outcome(incoming));
      assert.equal(result.status, state); assert.deepEqual(h.row(), before);
      assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.funding.length, 0);
    });
  }
  test(`actual pending-error method cannot downgrade ${state} on definitive provider rejection`, async () => {
    const h = harness({ status: state });
    const before = h.row();
    const result = await h.service.markRefundProviderCallPending(...h.args, new PaymentProviderDefinitiveError("REJECTED", "Synthetic rejection"));
    assert.equal(result.status, state); assert.deepEqual(h.row(), before);
    assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.funding.length, 0);
  });
}

test("actual successful-result replay does not invoke funding twice once fundedAt exists", async () => {
  const h = harness();
  const first = await h.service.applyProviderRefundOutcome(...h.args, f.outcome("succeeded"));
  assert.equal(first.status, "succeeded"); assert.ok(h.row().fundedAt instanceof Date);
  const writes = h.calls.writes.length;
  const second = await h.service.applyProviderRefundOutcome(...h.args, f.outcome("succeeded"));
  assert.equal(second.status, "succeeded"); assert.equal(h.calls.funding.length, 1);
  assert.equal(h.calls.writes.length, writes);
  assert.equal(h.calls.funding[0][3].idempotencyKey, `payment-refund:${h.args[3]}`);
});

test("actual ledger recovery retries internal funding with same key and never submits a provider refund", async () => {
  const h = harness(); h.failFunding(true);
  const first = await h.service.applyProviderRefundOutcome(...h.args, f.outcome("succeeded"));
  assert.equal(first.status, "funding_pending"); assert.equal(h.row().fundedAt, null);
  h.failFunding(false);
  const second = await h.service.applyProviderRefundOutcome(...h.args, f.outcome("succeeded"));
  assert.equal(second.status, "succeeded"); assert.ok(h.row().fundedAt instanceof Date);
  assert.equal(h.calls.funding.length, 2);
  assert.equal(h.calls.funding[0][3].idempotencyKey, h.calls.funding[1][3].idempotencyKey);
  // Actual internal method only: no refresh/create/refund provider boundary exercised.
});

for (const status of ["succeeded", "accepted", "failed"]) {
  test(`actual ${status} outcome with conflicting external refund ID rejects without funding or write`, async () => {
    const h = harness({ externalRefundId: "external-original" });
    const before = h.row();
    await assert.rejects(() => h.service.applyProviderRefundOutcome(...h.args, f.outcome(status)), /已绑定其他第三方退款编号/u);
    assert.deepEqual(h.row(), before); assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.funding.length, 0);
  });
}

for (const example of f.failures) {
  test(`actual failure disposition and pending method characterize ${example.message}`, async () => {
    const h = harness(), error = new Error(example.message);
    assert.equal(refundFailureDisposition(error).definitive, example.definitive);
    const result = await h.service.markRefundProviderCallPending(...h.args, error);
    assert.equal(result.status, example.definitive ? "failed" : "pending");
    assert.equal(h.calls.funding.length, 0);
    // Plain error classification is legacy behavior, not authenticated provider evidence.
  });
}

test("actual refund lookup requires scoped query and missing row rejects, not fabricated success", async () => {
  const h = harness(); h.removeRow();
  await assert.rejects(() => h.service.applyProviderRefundOutcome(...h.args, f.outcome("succeeded")), /退款单不存在/u);
  assert.deepEqual(h.calls.reads[0], { id: h.args[3], tenantId: h.args[0], workspaceId: h.args[1], orderId: h.args[2] });
  assert.equal(h.calls.writes.length, 0); assert.equal(h.calls.funding.length, 0);
  // Query-shape evidence only; substitute does not authorize or filter cross-tenant records.
});
