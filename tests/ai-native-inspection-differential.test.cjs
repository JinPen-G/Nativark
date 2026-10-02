"use strict";
const test = require("node:test"), assert = require("node:assert/strict"), net = require("node:net");
require("ts-node").register({ transpileOnly: true, compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const stores = require("./helpers/absorbing-config-store.cjs");
const factsInput = require("./fixtures/ai-native/fact-baseline.cjs");
const f = require("./fixtures/ai-native/inspection-differential.cjs");
const attempts = [], connect = net.Socket.prototype.connect, fetch = global.fetch;
test.before(() => {
  net.Socket.prototype.connect = function () { attempts.push("socket"); throw new Error("No external connection"); };
  global.fetch = async () => { attempts.push("fetch"); throw new Error("No external call"); };
});
test.after(() => { net.Socket.prototype.connect = connect; global.fetch = fetch; assert.deepEqual(attempts, []); });
async function harness(category) {
  const config = stores.createAbsorbingConfigStore(), facts = stores.createAbsorbingFactStore();
  config.listWorkspaces = async () => [factsInput.workspace(category)];
  const core = new RentalCoreService(config, facts);
  await core.onApplicationBootstrap();
  const order = f.order(category), calls = { corrections: [], orderReads: 0, hooks: 0 };
  core.runHook = async () => { calls.hooks++; throw new Error("Unexpected hook after rejected inspection"); };
  facts.findOrder = async () => { calls.orderReads++; return order; };
  facts.correctInspectionUsage = async (...args) => { calls.corrections.push(args); return { synthetic: true }; };
  async function reject(input, expected) {
    const before = structuredClone(order), writes = facts.writes.length;
    await assert.rejects(() => core.createInspection("tenant_001", order.id, input, "Synthetic operator"), expected);
    assert.deepEqual(order, before); assert.equal(facts.writes.length, writes); assert.equal(calls.hooks, 0);
  }
  return { core, facts, order, calls, reject };
}
for (const category of f.categories) {
  test(`${category}: frozen inspection read filters stage and returns defensive copies`, async () => {
    const h = await harness(category);
    h.order.inspectionTemplateSnapshots.push(f.template("return", { id: "return-frozen", version: "historical-2" }));
    const result = await h.core.listInspectionTemplates("tenant_001", "pickup", h.order);
    assert.equal(result.length, 1); assert.equal(result[0].version, "historical-1");
    result[0].fields[0].label = "Changed display";
    assert.equal(h.order.inspectionTemplateSnapshots[0].fields[0].label, "Synthetic condition");
    await assert.rejects(() => h.core.listInspectionTemplates("tenant_001", "pickup", { ...h.order, tenantId: "other-tenant" }), /不属于当前租户/u);
    assert.equal(h.facts.writes.length, 0);
  });
  test(`${category}: explicit empty frozen basis rejects action rather than using current template`, async () => {
    const h = await harness(category);
    const current = await h.core.listInspectionTemplates("tenant_001", "pickup");
    assert.ok(current.some(row => row.enabled));
    h.order.inspectionTemplateSnapshots = [];
    await h.reject(f.request({ templateId: current.find(row => row.enabled).id }), /检查模板不存在或已停用/u);
  });
  test(`${category}: disabled frozen template cannot be used`, async () => {
    const h = await harness(category); h.order.inspectionTemplateSnapshots[0].enabled = false;
    await h.reject(f.request(), /检查模板不存在或已停用/u);
  });
  test(`${category}: missing and blank required fields fail before persistence; false is not missing`, async () => {
    const h = await harness(category);
    for (const value of [undefined, null, "  "]) await h.reject(f.request({ results: { condition: value } }), /缺少必填检查项/u);
    // Positive validation control stops at the next real stage guard, not a full successful inspection.
    await h.reject(f.request({ results: { condition: false } }), /尚未完成配货/u);
  });
  test(`${category}: pickup rejects reservation/renting/completed rather than advancing status`, async () => {
    const h = await harness(category);
    for (const status of ["reserved", "renting", "completed"]) {
      h.order.status = status; await h.reject(f.request(), /尚未完成配货/u);
    }
  });
  test(`${category}: return rejects ready/completed/cancelled without writing`, async () => {
    const h = await harness(category); h.order.inspectionTemplateSnapshots = [f.template("return")];
    for (const status of ["ready_for_pickup", "completed", "cancelled"]) {
      h.order.status = status; await h.reject(f.request(), /只有租赁中的订单/u);
    }
  });
  test(`${category}: pickup partial-return input and out-of-batch exception fail before hooks/writes`, async () => {
    const h = await harness(category); h.order.status = "ready_for_pickup";
    await h.reject(f.request({ returnItems: [{ allocationId: "outside", quantity: 1 }] }), /只有归还检查/u);
    await h.reject(f.request({ exceptions: [{ code: "synthetic", description: "Synthetic", allocationId: "outside" }] }), /不属于本次检查批次/u);
  });
  test(`${category}: terminal orders cannot delegate usage correction; active order can delegate`, async () => {
    const h = await harness(category), input = { fieldCode: "synthetic", value: 1, reason: "Synthetic correction" };
    for (const status of ["completed", "cancelled"]) {
      h.order.status = status;
      await assert.rejects(() => h.core.correctInspectionUsage("tenant_001", h.order.id, "inspection-a", input, "Synthetic"), /不能修正使用量/u);
    }
    assert.equal(h.calls.corrections.length, 0);
    h.order.status = "renting";
    await h.core.correctInspectionUsage("tenant_001", h.order.id, "inspection-a", input, "Synthetic");
    assert.deepEqual(h.calls.corrections[0].slice(0, 5), ["tenant_001", h.order.id, "inspection-a", input, "Synthetic"]);
    // Delegation only: no repository correction algorithm or audit persistence tested.
    assert.equal(h.facts.writes.length, 0);
  });
}
