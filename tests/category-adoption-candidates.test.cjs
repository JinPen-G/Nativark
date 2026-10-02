"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { CategoryAdoptionPreparationService } = require("../apps/api/dist/modules/rental-core/category-adoption-preparation.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const user = { tenantId: "tenant-a", isSaasAdmin: false, permissions: ["rental-os:category:adopt"] };
const identity = { tenantId: user.tenantId, workspaceId: "session-space", dataScope: "all", locationScope: { mode: "all", locationIds: [] } };
const definition = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera");
const base = { categoryCode: "CAMERA", versionLabel: "label", status: "legacy_baseline", structureVersion: 1, definition: structuredClone(definition) };
const rows = [
  { ...base, id: "pilot", policy: { upgradeScope: "pilot", upgradeTenantIds: ["tenant-a"], restoreScope: "none" } },
  { ...base, id: "outside", policy: { upgradeScope: "pilot", upgradeTenantIds: ["tenant-b"], restoreScope: "none" } },
  { ...base, id: "restore", policy: { upgradeScope: "none", restoreScope: "all" } },
  { ...base, id: "unsupported", structureVersion: 2, policy: { upgradeScope: "all", restoreScope: "none" } },
  { ...base, id: "missing-policy", policy: null }
];
let calls = 0;
const db = {
  businessWorkspace: { findFirst: async (args) => {
    calls++;
    assert.deepEqual(args.where, { id: "session-space", tenantId: "tenant-a", status: "ACTIVE" });
    return { categoryCode: "CAMERA", categoryVersionId: "current", categoryAdoptionRevision: 7 };
  } },
  rentalCategoryVersion: { findMany: async (args) => {
    assert.deepEqual(args.where, { categoryCode: "CAMERA", status: { in: ["published", "legacy_baseline"] }, id: { not: "current" } });
    return rows;
  } }
};
const service = new CategoryAdoptionPreparationService(db);
const call = (operation, candidate = user, context = identity) => runWithRequestIdentity(context, () => service.candidates(candidate, operation));
(async () => {
  const result = await call("upgrade");
  assert.deepEqual(result.versions.map((row) => row.id), ["pilot", "unsupported"]);
  assert.deepEqual(result.versions[0], { id: "pilot", versionLabel: "label", definitionExecutable: true });
  assert.equal(result.versions[1].definitionExecutable, false);
  assert.match(result.versions[1].unavailableReason, /结构版本/);
  assert.equal(result.sourceRevision, 7);
  assert.deepEqual((await call("restore")).versions.map((row) => row.id), ["restore"]);
  const before = calls;
  await assert.rejects(() => call("create"));
  await assert.rejects(() => call("upgrade", { ...user, isSaasAdmin: true, permissions: ["*"] }));
  await assert.rejects(() => call("upgrade", user, { ...identity, workspaceId: undefined }));
  assert.equal(calls, before, "未认证范围或平台越权必须在读库前拒绝");
  console.log("category-adoption-candidates: 会话空间限定、分操作试点资格、最小投影和未知必需结构提示通过（仓储替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
