"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const ts = require("typescript");
const { test } = require("node:test");
function load(file, dependencies = {}) {
  const source = fs.readFileSync(`apps/admin/src/features/settings/governance/${file}.ts`, "utf8");
  const result = {}, javascript = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("exports", "require", "window", javascript)(result, name => dependencies[name] ?? require(name), dependencies.window);
  return result;
}
const helpers = load("categoryAdoptionPending");
const request = { expectedSourceVersionId: "v1", expectedSourceRevision: 1, expectedPreparationRevision: 2, expectedTargetPolicyRevision: 3,
  operation: "upgrade", idempotencyKey: "original-one", reason: "not stored free-form reason" };
const result = { outcome: "adopted", operation: "upgrade", categoryCode: "camera", sourceVersionId: "v1", sourceRevision: 1,
  targetVersionId: "v2", adoptionRevision: 2, preparationRevision: 2, targetPolicyRevision: 3, auditId: "audit-one", adoptedAt: "2026-11-10T00:00:00.000Z" };
function storage() {
  const rows = new Map();
  return { rows, getItem: key => rows.get(key) ?? null, setItem: (key, value) => rows.set(key, value), removeItem: key => rows.delete(key) };
}
function harness(api, current = () => true, onAdopted = async () => undefined, store = storage()) {
  const states = [], cleanups = [];
  const react = { useRef: value => ({ current: value }), useState: value => [value, next => states.push(next)], useEffect: setup => cleanups.push(setup()) };
  const hooks = load("useCategoryAdoption", { react, window: { sessionStorage: store }, "./categoryAdoptionPending": helpers,
    "./useCategoryPreparationSave": { preparationErrorMessage: error => error.message }, "@/api/categoryPreparation": { categoryPreparationApi: api } });
  return { hook: hooks.useCategoryAdoption("actor-space", current, onAdopted), states, store, unmount: () => cleanups.forEach(cleanup => cleanup?.()) };
}
test("recovery metadata retains the original basis, is scoped and excludes reasons or cached success", () => {
  const store = storage(); helpers.rememberCategoryAdoption(store, "one", "v2", request);
  const raw = [...store.rows.values()][0];
  assert.ok(!raw.includes(request.reason)); assert.ok(!raw.includes("audit-one"));
  assert.equal(helpers.readPendingCategoryAdoption(store, "one").idempotencyKey, request.idempotencyKey);
  assert.equal(helpers.readPendingCategoryAdoption(store, "another"), undefined);
  assert.throws(() => helpers.rememberCategoryAdoption(store, "one", "v2", { ...request, idempotencyKey: "another-one" }), /上一笔/);
  helpers.forgetCategoryAdoption(store, "one"); assert.equal(store.rows.size, 0);
});
test("unknown dispatch and unknown receipt stay locked across remount; recovery never sends another adoption", async () => {
  let writes = 0, reads = 0;
  const api = { adopt: async () => { writes++; throw new Error("disconnected"); }, readOriginal: async () => { reads++; return { outcome: "unknown" }; } };
  const first = harness(api);
  await assert.rejects(first.hook.start("v2", request), /disconnected/); assert.ok(first.states.includes("unknown"));
  await assert.rejects(first.hook.start("v2", { ...request, idempotencyKey: "replacement-one" }), /上一笔/);
  first.unmount();
  const restored = harness(api, () => true, undefined, first.store);
  await assert.rejects(restored.hook.reconcile(), /尚未查到/);
  assert.equal(writes, 1); assert.equal(reads, 1); assert.equal(restored.store.rows.size, 1);
  assert.equal("retry" in restored.hook, false);
});
test("a verified original receipt clears metadata only after the current view successfully refreshes", async () => {
  let writes = 0, refreshes = 0, failRefresh = true;
  const h = harness({ adopt: async () => { writes++; return result; }, readOriginal: async () => ({ outcome: "adopted", result }) }, () => true,
    async () => { refreshes++; if (failRefresh) throw new Error("refresh failed"); });
  await assert.rejects(h.hook.start("v2", request), /refresh failed/);
  assert.ok(h.states.includes("adopted_unread")); assert.equal(h.store.rows.size, 1);
  failRefresh = false; await h.hook.reconcile();
  assert.equal(writes, 1); assert.equal(refreshes, 2); assert.equal(h.store.rows.size, 0);
});
test("late success cannot update the new session and old scope metadata remains available for later read", async () => {
  let finish, current = true, refreshes = 0;
  const h = harness({ adopt: () => new Promise(resolve => { finish = resolve; }) }, () => current, async () => { refreshes++; });
  const sending = h.hook.start("v2", request); current = false; h.unmount(); finish(result);
  await assert.rejects(sending, /会话或经营空间/);
  assert.equal(refreshes, 0); assert.equal(h.store.rows.size, 1);
});
test("a definite first-request rejection retains editable inputs while a mismatched receipt stays unknown", async () => {
  const original = structuredClone(request);
  const denied = harness({ adopt: async () => { const error = new Error("denied"); error.response = { status: 403 }; throw error; } });
  await assert.rejects(denied.hook.start("v2", request), /denied/); assert.equal(denied.store.rows.size, 0);
  assert.deepEqual(request, original);
  const mismatch = harness({ adopt: async () => ({ ...result, targetVersionId: "foreign" }) });
  await assert.rejects(mismatch.hook.start("v2", request), /回执/); assert.equal(mismatch.store.rows.size, 1); assert.ok(mismatch.states.includes("unknown"));
});
test("stored metadata cannot establish success and malformed metadata is retained instead of authorizing a new key", async () => {
  const store = storage(); store.setItem("rental:category-adoption:actor-space", "not-json");
  const h = harness({ adopt: async () => assert.fail("must not dispatch") }, () => true, undefined, store);
  await assert.rejects(h.hook.start("v2", request), /标识无法读取/); assert.equal(store.rows.size, 1);
});
test("adoption readiness requires a saved current basis and a complete server compatibility result", () => {
  const preview = { adoptionImplemented: true, stale: false, validation: { valid: true }, businessCompatibility: { valid: true, complete: true },
    commercialContext: { newBusinessAllowed: true }, sourceVersionId: "v1", sourceRevision: 1, targetPolicyRevision: 3,
    preparation: { revision: 2, sourceRevision: 1, patches: { sourceVersionId: "v1" } } };
  assert.equal(helpers.canAdoptPreparedCategory(preview, false), true);
  for (const changed of [{ ...preview, adoptionImplemented: false }, { ...preview, stale: true }, { ...preview, targetPolicyRevision: undefined },
    { ...preview, businessCompatibility: { valid: true, complete: false } }, { ...preview, preparation: { ...preview.preparation, sourceRevision: 2 } }]) {
    assert.equal(helpers.canAdoptPreparedCategory(changed, false), false);
  }
  assert.equal(helpers.canAdoptPreparedCategory(preview, true), false);
});
