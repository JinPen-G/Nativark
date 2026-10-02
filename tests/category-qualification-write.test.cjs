"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { MembershipService } = require("../apps/api/dist/modules/platform/membership.service.js");
const definition = RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera");
const calls = [];
let status = "ACTIVE", existing;
const client = {
  businessWorkspace: { findFirst: async () => ({ id: "ws", categoryCode: "CAMERA" }) },
  $transaction: async (write, options) => { assert.equal(options.isolationLevel, "ReadCommitted"); return write(client); },
  $queryRaw: async () => { calls.push("space-lock"); return [{ status, categoryCode: "CAMERA", categoryVersionId: "v2", categoryAdoptionRevision: 2 }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("definition"); return { categoryCode: "CAMERA", structureVersion: 1, status: "published", definition }; } },
  customerMembershipQualificationType: {
    findFirst: async ({ where }) => { calls.push("existing"); assert.deepEqual(where, { tenantId: "t", workspaceId: "ws", id: "q" }); return existing; },
    create: async ({ data }) => { calls.push("create"); assert.equal(data.workspaceId, "ws"); assert.equal(data.categoryCode, "CAMERA"); return { id: "q" }; },
    update: async () => { calls.push("update"); return { id: "q" }; }
  }
};
const service = new MembershipService(client, {});
service.listQualificationTypes = async () => [{ id: "q" }];
const input = { code: "license", name: "资格证", status: "enabled" };
(async () => {
  await service.saveQualificationType("t", "ws", input);
  assert.deepEqual(calls.splice(0), ["space-lock", "definition", "create"]);
  existing = { id: "q" };
  await service.saveQualificationType("t", "ws", { ...input, id: "q", status: "disabled" });
  assert.deepEqual(calls.splice(0), ["space-lock", "definition", "existing", "update"]);
  existing = null;
  await assert.rejects(service.saveQualificationType("t", "ws", { ...input, id: "q" }), /不存在/);
  assert.deepEqual(calls.splice(0), ["space-lock", "definition", "existing"]);
  status = "PAUSED";
  await assert.rejects(service.saveQualificationType("t", "ws", input), /不可用/);
  assert.deepEqual(calls.splice(0), ["space-lock"]);
  console.log("category-qualification-write: RC/空间锁先于证件读取、新增/启停同锁、失效空间拒绝通过（执行替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
