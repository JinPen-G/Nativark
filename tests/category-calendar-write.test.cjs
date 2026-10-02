"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { RentalBusinessConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-business-config.repository.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const calls = [];
let status = "ACTIVE";
let revision = 1;
const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find((row) => row.code === "camera"));
const client = {
  $transaction: async (write) => { calls.push("transaction"); return write(client); },
  businessWorkspace: { findFirst: async () => ({ id: "ws" }) },
  $queryRaw: async () => { calls.push("lock"); return [{ categoryCode: "CAMERA", categoryVersionId: "v", categoryAdoptionRevision: 1, status }]; },
  rentalCategoryVersion: { findUnique: async () => { calls.push("version"); return { categoryCode: "CAMERA", status: "published", structureVersion: 1, definition }; } },
  rentalBusinessCalendar: {
    upsert: async () => { calls.push("calendar"); },
    updateMany: async ({ where }) => { calls.push("conditional"); return { count: where.revision === revision ? 1 : 0 }; },
    findUnique: async () => ({ revision })
  },
  rentalCalendarOverrideAuditEntry: { createMany: async () => { calls.push("audit"); } }
};
const repo = new RentalBusinessConfigRepository(client);
const scope = (fn) => runWithRequestIdentity({ tenantId: "t", workspaceId: "ws" }, fn);
const calendar = { tenantId: "t", year: 2030, region: "CN", version: "1.0", status: "draft", days: [], revision: 2 };
const audit = { date: "2030-01-01", year: 2030, version: "1.0", action: "override", reason: "fixture", at: "2030-01-01T00:00:00Z" };
(async () => {
  await scope(() => repo.upsertCalendar(calendar, 1, [audit]));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "conditional", "audit"]);
  await assert.rejects(scope(() => repo.upsertCalendar(calendar, 0, [audit])), /其他人修改/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "conditional"]);
  for (const invalid of [{ ...audit, year: 2031 }, { ...audit, version: "2.0" }]) {
    await assert.rejects(scope(() => repo.upsertCalendar(calendar, 1, [invalid])), /本次写入/);
    assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"]);
  }
  const next = { ...calendar, version: "2.0", status: "published" };
  for (const invalid of [{ ...calendar, tenantId: "foreign" }, { ...calendar, year: 2031 }, { ...next }]) {
    await assert.rejects(scope(() => repo.publishCalendarVersion(next, invalid)), /本租户同年度/);
    assert.deepEqual(calls.splice(0), ["transaction", "lock", "version"]);
  }
  await scope(() => repo.publishCalendarVersion(next, { ...calendar, status: "superseded" }, { next: 1, superseded: 1 }));
  assert.deepEqual(calls.splice(0), ["transaction", "lock", "version", "conditional", "conditional"]);
  status = "DISABLED";
  await assert.rejects(scope(() => repo.upsertCalendar(calendar)), /不可用/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  await assert.rejects(scope(() => repo.publishCalendarVersion(next)), /不可用/);
  assert.deepEqual(calls.splice(0), ["transaction", "lock"]);
  console.log("category-calendar-write: 编辑/发布同空间锁、审计年度版本一致、发布替代范围与失效空间拒绝通过（仓储替身）");
})().catch((error) => { console.error(error); process.exitCode = 1; });
