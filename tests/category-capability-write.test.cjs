"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { WorkspaceCapabilityRepository } = require("../apps/api/dist/modules/rental-core/workspace-capability.repository.js");
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const calls = [];
let rows = [];
const client = {
  $transaction: async (write) => { calls.push("transaction"); return write(client); },
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("version"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } },
  workspaceCapabilityInstance: {
    findMany: async () => { calls.push("instances"); return rows; },
    create: async () => { calls.push("write"); },
    createMany: async () => { calls.push("initialize"); return { count: 1 }; },
    findFirst: async () => ({ code: "camera_compatibility", status: "enabled", implementationVersion: "cam-1.0", configVersion: "v1", config: { relations: [] }, revision: 1, createdAt: new Date(), updatedAt: new Date() })
  },
  workspaceCapabilityAuditEntry: { create: async () => { calls.push("audit"); }, createMany: async () => { calls.push("audit"); } }
};
const repo = new WorkspaceCapabilityRepository(client);
const binding = { categoryVersionId: "v2", adoptionRevision: 2 };
const instance = { tenantId: "t", workspaceId: "ws", code: "camera_compatibility", status: "enabled", implementationVersion: "cam-1.0", configVersion: "v1", config: { relations: [] }, revision: 1 };
const audit = { code: "camera_compatibility", action: "enable", toStatus: "enabled", reason: "fixture", at: new Date().toISOString() };
(async () => {
  await assert.rejects(repo.saveInstance(instance, audit, undefined, { ...binding, adoptionRevision: 1 }), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"], "相同版本但修订变更也拒绝，防恢复造成 ABA");
  await repo.saveInstance(instance, audit, undefined, binding);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "instances", "write", "audit"]);
  await assert.rejects(repo.saveInstance({ ...instance, code: "dispatch" }, { ...audit, code: "dispatch" }), /不适用/);
  await assert.rejects(repo.saveInstance(instance, { ...audit, code: "other" }), /审计/);
  definition.defaultCapabilities = definition.defaultCapabilities.filter((code) => code !== "bundle_inventory");
  await assert.rejects(repo.saveInstance({ ...instance, code: "camera_kit_handover" }, { ...audit, code: "camera_kit_handover" }), /依赖/, "声明已失效的依赖由事务内正文解析拒绝");
  definition.defaultCapabilities.push("bundle_inventory");
  rows = [{ code: "camera_kit_handover", status: "enabled" }];
  await assert.rejects(repo.saveInstance({ ...instance, code: "bundle_inventory", status: "paused" }, { ...audit, code: "bundle_inventory" }), /依赖/);
  rows = [];
  definition.requiredCapabilities = [];
  await assert.rejects(repo.initializeInstances([instance], [audit], client), /必选声明已变化/);
  definition.requiredCapabilities = ["camera_compatibility"];
  calls.length = 0;
  await repo.initializeInstances([instance], [audit], client);
  assert.deepEqual(calls.splice(0), ["lock", "version", "initialize", "audit"]);
  console.log("category-capability-write: 绑定/修订冲突、当前声明与依赖复核、实例审计同事务及初始化陈旧声明拒绝通过（仓储替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
