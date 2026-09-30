"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalBusinessConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-business-config.repository.js");
const { RentalBusinessService } = require("../apps/api/dist/modules/rental-core/rental-business.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const calls = [];
let stored;
const binding = { categoryVersionId: "v2", adoptionRevision: 2 };
const client = {
  $transaction: async (write) => { calls.push("transaction"); return write(client); },
  businessWorkspace: { findFirst: async () => ({ id: "ws" }) },
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2, status: "ACTIVE" }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("version"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } },
  rentalRuleVersion: {
    findUnique: async () => stored,
    findFirst: async ({ where }) => where.id === "rule" ? stored : null,
    upsert: async () => { calls.push("rule"); }
  },
  rentalRuleVersionAudit: { create: async () => { calls.push("audit"); } }
};
const repo = new RentalBusinessConfigRepository(client);
const scope = (fn) => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, fn);
const rule = { id: "rule", tenantId: "t", categoryCode: "camera", version: "1.0", status: "draft", config: { example: true }, createdAt: "2030-01-01T00:00:00Z", changeReason: "fixture" };
const published = { ...rule, status: "pending", effectiveFrom: "2030-01-02T00:00:00Z" };
const audit = { id: "audit", tenantId: "t", workspaceId: "ws", ruleVersionId: "rule", version: "1.0", action: "publish", fromStatus: "draft", toStatus: "pending", reason: "fixture", at: rule.createdAt };
(async () => {
  const old = { ...binding, adoptionRevision: 1 };
  await assert.rejects(scope(() => repo.upsertRuleVersion(rule, old)), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  await assert.rejects(scope(() => repo.writeRuleVersionWithAudit(published, audit, [], old)), /版本已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  await scope(() => repo.upsertRuleVersion(rule, binding));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rule"]);
  stored = { tenantId: "t", workspaceId: "ws", status: "published", config: rule.config };
  await assert.rejects(scope(() => repo.upsertRuleVersion({ ...rule, config: {} }, binding)), /不可覆盖/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"]);
  await assert.rejects(scope(() => repo.upsertRuleVersion(rule, binding)), /不可覆盖/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"], "陈旧草稿即使正文相同也不能把已发布版本退回草稿");
  stored = { ...stored, status: "draft", config: {} };
  await assert.rejects(scope(() => repo.writeRuleVersionWithAudit(published, audit, [], binding)), /正文已变化/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"]);
  for (const key of ["tenantId", "workspaceId", "ruleVersionId", "version", "toStatus"]) {
    await assert.rejects(scope(() => repo.writeRuleVersionWithAudit(published, { ...audit, [key]: "foreign" }, [], binding)), /不一致/);
    assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"]);
  }
  stored = { ...stored, config: rule.config };
  await scope(() => repo.writeRuleVersionWithAudit(published, audit, [], binding));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rule", "audit"]);
  stored = undefined;
  const restored = { ...rule, id: "restored", version: "2.0", restoredFromVersion: "1.0", config: { preservedHistoricalField: true } };
  await scope(() => repo.writeRuleVersionWithAudit(restored, { ...audit, action: "restore", ruleVersionId: restored.id, version: "2.0", toStatus: "draft" }, [], binding));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "rule", "audit"], "历史恢复仅创建新草稿，不把历史配置静默改成现版本默认值");
  stored = { tenantId: "t", workspaceId: "ws", status: "superseded", config: rule.config };
  await assert.rejects(scope(() => repo.writeRuleVersionWithAudit({ ...rule, status: "void" }, { ...audit, action: "void", toStatus: "void" }, [], binding)), /不可作废/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"]);
  await assert.rejects(scope(() => repo.writeRuleVersionWithAudit(restored, { ...audit, action: "restore", ruleVersionId: restored.id, version: "2.0", toStatus: "draft" }, [], binding)), /历史规则正文不可覆盖|建立新草稿/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"]);
  const service = Object.create(RentalBusinessService.prototype);
  service.workspaceOf = () => "ws";
  service.categoryResolver = { forWorkspace: async () => ({ definition, categoryVersionId: "v2", adoptionRevision: 2 }) };
  const context = { profile: { categoryCode: "camera" }, category: structuredClone(definition) };
  assert.deepEqual(await service.categoryConfigurationBinding("t", context), binding);
  context.category.name = "old definition";
  await assert.rejects(service.categoryConfigurationBinding("t", context), /准备期间已变化/);
  console.log("category-rule-write: 规则绑定修订、历史正文保护、陈旧草稿发布拒绝、审计范围及服务上下文一致性通过（替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
