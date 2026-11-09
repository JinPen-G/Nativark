const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const Module = require("node:module");

// Load the real, type-only presentation module without API, environment, database or app startup.
const source = path.resolve(__dirname, "../apps/admin/src/features/workbench/workbenchPresentation.ts");
const loaded = new Module(source, module);
loaded._compile(ts.transpileModule(fs.readFileSync(source, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, source);
const { overviewTodoTarget, overviewActiveTodo, overviewPeriodStart } = loaded.exports;
const todo = (id, overrides = {}) => ({ id, type: "refund", priority: "high", title: id, description: "Pending", href: "https://untrusted.invalid/action", createdAt: "2026-11-09T02:00:00Z", orderId: "order-a", ...overrides });

test("overview links require the matching domain permission and stable object identity", () => {
  const order = todo("refund-a");
  const work = todo("work-a", { type: "work_order", workOrderId: "work-a" });
  assert.equal(overviewTodoTarget(order, { orders: false, workOrders: true }), undefined);
  assert.equal(overviewTodoTarget(work, { orders: true, workOrders: false }), undefined);
  assert.deepEqual(overviewTodoTarget(order, { orders: true, workOrders: false }), { route: "orderDetail", id: "order-a" });
  assert.deepEqual(overviewTodoTarget(work, { orders: false, workOrders: true }), { route: "workOrderDetail", id: "work-a" });
  assert.equal(overviewTodoTarget(todo("missing", { orderId: undefined }), { orders: true, workOrders: true }), undefined);
  assert.equal(overviewTodoTarget(todo("missing-work", { type: "work_order" }), { orders: true, workOrders: true }), undefined);
});

test("removed, filtered or previous-scope pinned records cannot remain in the preview", () => {
  const a = todo("a"), b = todo("b"), nextScope = todo("next-scope");
  assert.equal(overviewActiveTodo([a, b], "a", "b"), a);
  assert.equal(overviewActiveTodo([b], "a", "a"), b);
  assert.equal(overviewActiveTodo([nextScope], "a", "b"), nextScope);
  assert.equal(overviewActiveTodo([], "a", "b"), undefined);
});

test("seven-day and month filters preserve the original local-midnight boundaries without mutating the clock", () => {
  const at = new Date(2026, 10, 9, 17, 35, 20);
  const original = at.getTime();
  assert.equal(overviewPeriodStart("today", at), new Date(2026, 10, 9).toISOString());
  assert.equal(overviewPeriodStart("week", at), new Date(2026, 10, 3).toISOString());
  assert.equal(overviewPeriodStart("month", at), new Date(2026, 10, 1).toISOString());
  assert.equal(at.getTime(), original);
});
