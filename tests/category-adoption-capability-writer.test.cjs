"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { WorkspaceCapabilityService } = require("../apps/api/dist/modules/rental-core/workspace-capability.service.js");
const { writePreparedCategoryCapabilities: write } = require("../apps/api/dist/modules/rental-core/category-adoption-capability-writer.js");
const target = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const runtime = { capabilities: new WorkspaceCapabilityService({}), registeredVersions: ["camera_compatibility@cam-1.0"] };
const expected = { categoryVersionId: "source", adoptionRevision: 1 };
const base = { id: "c", code: "camera_compatibility", status: "enabled", revision: 1, implementationVersion: "cam-1.0", configVersion: "v1", config: { relations: [] } };
function fixture(change = {}, count = 1) {
  const row = { ...structuredClone(base), ...change }; const writes = []; const audits = [];
  const tx = {
    $queryRaw: async () => [{ categoryCode: "CAMERA", status: "ACTIVE", categoryVersionId: "source", categoryAdoptionRevision: 1 }],
    rentalCategoryVersion: { findUnique: async () => ({ id: "source", categoryCode: "CAMERA", status: "published", structureVersion: 1, definition: target }) },
    rentalItemGroup: { findMany: async () => [] }, rentalAsset: { findMany: async () => [] },
    workspaceCapabilityInstance: { findMany: async () => [row], updateMany: async (query) => { writes.push(query); return { count }; } },
    workspaceCapabilityAuditEntry: { create: async (query) => { audits.push(query); return {}; } }
  };
  const run = (config) => write(tx, "t", "w", expected, target, [{ code: row.code, expectedRevision: row.revision, expectedImplementationVersion: row.implementationVersion, config }], "actor", "reason", runtime);
  return { row, run, writes, audits };
}
(async () => {
  const noOp = fixture();
  assert.deepEqual(await noOp.run({ relations: [] }), { changedCapabilityCodes: [] });
  assert.equal(noOp.writes.length, 0); assert.equal(noOp.audits.length, 0);
  for (const change of [{ configVersion: "legacy" }, { configVersion: "v2147483647" }, { revision: 2147483647 }]) {
    const f = fixture(change); await assert.rejects(f.run({ relations: [], powerMarginPercent: 25 }), /安全递增/);
    assert.equal(f.writes.length, 0); assert.equal(f.audits.length, 0);
  }
  const conflict = fixture({}, 0);
  await assert.rejects(conflict.run({ relations: [], powerMarginPercent: 25 }), /来源已变化/);
  assert.equal(conflict.audits.length, 0);
  const good = fixture(); await good.run({ relations: [], powerMarginPercent: 25 });
  assert.deepEqual(good.writes[0].where, { tenantId: "t", workspaceId: "w", id: "c", code: base.code, status: "enabled", revision: 1, implementationVersion: "cam-1.0", configVersion: "v1" });
  assert.equal(good.writes[0].data.configVersion, "v2");
  assert.equal(good.audits[0].data.action, "configure");
  assert.deepEqual(good.row, base, "不得原地改动读取事实");
  console.log("category-adoption-capability-writer: 无变化不写、版本上溢拒绝、范围CAS及配置审计通过");
})().catch((error) => { console.error(error); process.exitCode = 1; });
