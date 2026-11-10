"use strict";
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { adoptionFixture } = require("./fixtures/category-adoption-fixture.cjs");
const { AdoptRentalCategoryDto } = require("../apps/api/dist/modules/rental-core/category-adoption-request.dto.js");
const { plainToInstance } = require("class-transformer");
const { validateSync } = require("class-validator");
const flags = ["NODE_ENV", "RENTAL_CATEGORY_GOVERNANCE_PREVIEW", "RENTAL_CATEGORY_ADOPTION"];
const original = Object.fromEntries(flags.map(flag => [flag, process.env[flag]]));
before(() => { process.env.NODE_ENV = "test"; process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW = "true"; process.env.RENTAL_CATEGORY_ADOPTION = "true"; });
after(() => { for (const flag of flags) if (original[flag] === undefined) delete process.env[flag]; else process.env[flag] = original[flag]; });

test("two real preparation batches can accumulate 1001 entities and atomically adopt the new required/enum/unique combination", async () => {
  const f = adoptionFixture({ entityCount: 1001, prepared: false }), historical = structuredClone(f.state.history);
  const batch = (id, revision, patches) => ({ batchId: id, expectedSourceVersionId: "v1", expectedSourceRevision: 1,
    expectedPreparationRevision: revision, operation: "upgrade", reason: "prepare", patches });
  await f.within(() => f.preparations.saveBatch(f.user, "v2", batch("batch-first", 0, f.patches.slice(0, 1000))));
  assert.equal(f.state.workspace.categoryVersionId, "v1"); assert.equal(f.state.groups[0].attributes.edition, "old");
  await f.within(() => f.preparations.saveBatch(f.user, "v2", batch("batch-second", 1, f.patches.slice(1000))));
  const staged = structuredClone(f.state.preparation);
  const request = { ...f.request, expectedPreparationRevision: 2 };
  assert.deepEqual(validateSync(plainToInstance(AdoptRentalCategoryDto, request), { whitelist: true, forbidNonWhitelisted: true }), []);
  const result = await f.adopt(request);
  assert.equal(result.outcome, "adopted"); assert.equal(result.adoptionRevision, 2);
  assert.equal(f.state.groups.length, 1001); assert.ok(f.state.groups.every(row => row.attributes.edition === "new" && row.attributes.newField === "retained"));
  assert.equal(f.state.claims.length, 1001); assert.equal(f.state.audits.length, 1); assert.equal(f.state.receipts.length, 1);
  assert.deepEqual(f.state.preparation, staged); assert.deepEqual(f.state.history, historical);
  const writes = f.state.writes;
  assert.deepEqual(await f.adopt(request), result); assert.equal(f.state.writes, writes);
  assert.deepEqual(await f.read(), { outcome: "adopted", result });
});

test("concurrent original-key requests return one audit and one receipt without rerunning patches", async () => {
  const f = adoptionFixture();
  const [first, second] = await Promise.all([f.adopt(), f.adopt()]);
  assert.deepEqual(first, second); assert.equal(f.state.audits.length, 1); assert.equal(f.state.receipts.length, 1);
  assert.equal(f.state.workspace.categoryAdoptionRevision, 2);
  await assert.rejects(f.adopt({ ...f.request, reason: "changed" }), /内容已变化/);
  assert.equal(f.state.audits.length, 1);
});

test("restoring the old version preserves new fields and history, and old receipt remains readable after later adoption", async () => {
  const f = adoptionFixture(), upgraded = await f.adopt();
  const historical = structuredClone(f.state.history);
  f.state.preparation = { id: "prep-restore", tenantId: "tenant", workspaceId: "space", targetVersionId: "v1", revision: 1, sourceRevision: 2,
    patches: { formatVersion: 2, sourceVersionId: "v2", operation: "restore", reason: "restore",
      items: f.state.groups.map(row => ({ entityType: "item_group", entityId: row.id, expectedUpdatedAt: row.updatedAt.toISOString(), values: { edition: "old" } })), capabilityPatches: [] } };
  const restored = await f.adopt({ ...f.request, expectedSourceVersionId: "v2", expectedSourceRevision: 2, operation: "restore", idempotencyKey: "restore-one", reason: "explicit restore" }, "v1");
  assert.equal(restored.adoptionRevision, 3); assert.equal(f.state.workspace.categoryVersionId, "v1");
  assert.ok(f.state.groups.every(row => row.attributes.edition === "old" && row.attributes.newField === "retained"));
  assert.deepEqual(f.state.history, historical); assert.equal(f.state.claims.length, 0);
  f.state.policies.get("v2").upgradeScope = "none";
  assert.deepEqual(await f.read("adoption-one"), { outcome: "adopted", result: upgraded });
});

test("policy revisions, source/preparation revisions and concurrent entity changes are rechecked before commit", async () => {
  for (const [change, reason] of [
    [f => { f.state.policies.get("v2").revision = 1; }, /政策修订/],
    [f => { f.state.policies.get("v2").upgradeScope = "none"; }, /采用范围/],
    [f => { f.state.workspace.categoryAdoptionRevision = 2; }, /版本已变化/],
    [f => { f.state.preparation.revision = 2; }, /预备资料/],
    [f => { f.state.groups[0].updatedAt = new Date("2026-11-09T01:00:00Z"); }, /来源实体已修改/],
    [f => { f.state.groups.push({ ...structuredClone(f.state.groups[0]), id: "after-preparation", attributes: { identity: "extra", edition: "old" } }); }, /不能为空|选项/]
  ]) {
    const f = adoptionFixture(); change(f); const before = structuredClone(f.state);
    await assert.rejects(f.adopt(), reason); assert.deepEqual(f.state, before);
  }
});

test("claim failure or receipt failure rolls back entities, constraints, binding and audits, while preserving preparation", async () => {
  for (const failure of ["claims", "receipt"]) {
    const f = adoptionFixture(); const before = structuredClone(f.state);
    if (failure === "claims") f.controls.failClaimAfter = 1; else f.controls.failReceipt = true;
    await assert.rejects(f.adopt(), /结果尚待核对/);
    assert.deepEqual(f.state, before); assert.deepEqual(await f.read(), { outcome: "unknown" });
    f.controls.failClaimAfter = 0; f.controls.failReceipt = false;
    // The substitute above proves its rollback; same original intent is retained.
    assert.equal((await f.adopt()).outcome, "adopted");
    assert.equal(f.state.audits.length, 1); assert.equal(f.state.receipts.length, 1);
  }
});

test("unreadable settings, ambiguous rules and unsupported or unknown resource size never produce an adopted receipt", async () => {
  for (const change of [
    f => { f.state.configurations.rentalTenantBusinessSettings[0].settings.payment.enabledMethods = ["invented"]; },
    f => { f.state.configurations.rentalRuleVersion.push({ ...structuredClone(f.state.configurations.rentalRuleVersion[0]), id: "ambiguous" }); },
    f => { f.controls.countOverrides.rentalPricingGroup = 10001; },
    f => { f.controls.missingBytes = true; }
  ]) {
    const f = adoptionFixture(); change(f); const before = structuredClone(f.state);
    await assert.rejects(f.adopt()); assert.deepEqual(f.state, before);
    assert.equal(f.state.receipts.length, 0);
  }
});

test("an original receipt needs current actor access and its original persisted audit, and cannot be repaired by rerunning", async () => {
  const f = adoptionFixture(); await f.adopt(); const writes = f.state.writes;
  f.access.state.member.isActive = false;
  await assert.rejects(f.read(), /撤销/); assert.equal(f.state.writes, writes);
  f.access.state.member.isActive = true;
  f.state.audits = [];
  await assert.rejects(f.read(), /原采用审计缺失/);
  await assert.rejects(f.adopt(), /原采用审计缺失/); assert.equal(f.state.writes, writes);
});

test("write flag closure leaves original receipts readable, and production cannot enable this test entry", async () => {
  const f = adoptionFixture(), result = await f.adopt();
  process.env.RENTAL_CATEGORY_ADOPTION = "false";
  try {
    await assert.rejects(f.adopt(), /尚未开放/);
    assert.deepEqual(await f.read(), { outcome: "adopted", result });
    process.env.RENTAL_CATEGORY_ADOPTION = "true"; process.env.NODE_ENV = "production";
    await assert.rejects(f.adopt(), /尚未开放/);
  } finally { process.env.NODE_ENV = "test"; process.env.RENTAL_CATEGORY_ADOPTION = "true"; }
});

test("HTTP and application input reject scope fields and malformed original keys before any write", async () => {
  const f = adoptionFixture();
  for (const body of [{ ...f.request, workspaceId: "foreign" }, { ...f.request, idempotencyKey: "adoption-one\n" },
    { ...f.request, expectedPreparationRevision: 0 }, { ...f.request, expectedTargetPolicyRevision: -1 }]) {
    assert.ok(validateSync(plainToInstance(AdoptRentalCategoryDto, body), { whitelist: true, forbidNonWhitelisted: true }).length);
    await assert.rejects(f.adopt(body), /采用请求/);
    assert.equal(f.state.writes, 0);
  }
});
