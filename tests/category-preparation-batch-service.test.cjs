"use strict";
const assert = require("node:assert/strict");
const { RENTAL_CATEGORY_DEFINITIONS } = require("@rental-os/shared");
const { CategoryAdoptionPreparationService } = require("../apps/api/dist/modules/rental-core/category-adoption-preparation.service.js");
const { WorkspaceCapabilityService } = require("../apps/api/dist/modules/rental-core/workspace-capability.service.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const { SaveCategoryPreparationBatchDto } = require("../apps/api/dist/modules/rental-core/category-adoption-request.dto.js");
const { plainToInstance } = require("class-transformer");
const { validateSync } = require("class-validator");
const { categoryWorkspaceAuth } = require("./fixtures/category-workspace-auth.cjs");

function fixture() {
  const source = structuredClone(RENTAL_CATEGORY_DEFINITIONS[0]);
  const target = structuredClone(source);
  target.businessModel.assetFields = [
    { scope: "asset", code: "code", label: "编号", type: "string", required: true, unique: true },
    { scope: "asset", code: "condition", label: "状态", type: "select", options: ["good"], required: true }
  ];
  const timestamp = new Date("2026-11-09T00:00:00.000Z");
  const state = {
    preparation: null, batches: [], writes: 0, failAfterWrite: false, failReceiptWrite: false, allowed: true,
    workspace: { id: "space", tenantId: "tenant", categoryCode: "CAMERA", status: "ACTIVE", categoryVersionId: "v1", categoryAdoptionRevision: 1 },
    assets: ["a", "b"].map(id => ({ id, assetNo: id, updatedAt: timestamp, serialNo: `SN-${id}`, attributes: { historical: "unchanged" } }))
  };
  const versions = new Map([
    ["v1", { id: "v1", categoryCode: "CAMERA", status: "published", structureVersion: 1, definition: source }],
    ["v2", { id: "v2", categoryCode: "CAMERA", status: "published", structureVersion: 1, definition: target }],
    ["v3", { id: "v3", categoryCode: "CAMERA", status: "published", structureVersion: 1, definition: source }]
  ]);
  const db = {
    $queryRaw: async query => {
      if (query.sql.includes("rental_category_definitions")) return [{ openingScope: "stopped", openingTenantIds: [], recommendedVersionId: "v1" }];
      if (query.sql.includes("rental_category_version_policies")) return [{ upgradeScope: state.allowed ? "all" : "none", upgradeTenantIds: [], restoreScope: "all", restoreTenantIds: [] }];
      if (query.sql.includes("business_workspaces")) return [{ id: "space" }];
      throw new Error("unexpected query");
    },
    businessWorkspace: { findFirst: async ({ where }) => where.id === "space" && where.tenantId === "tenant" ? structuredClone(state.workspace) : null },
    rentalCategoryVersion: { findUnique: async ({ where }) => structuredClone(versions.get(where.id) ?? null) },
    rentalItemGroup: { findMany: async () => [], count: async () => 0 },
    rentalAsset: {
      findMany: async ({ where, take }) => {
        assert.equal(where.tenantId, "tenant"); assert.equal(where.workspaceId, "space");
        const rows = state.assets.filter(row => !where.id?.gt || row.id > where.id.gt)
          .filter(row => !where.OR || where.OR.some(condition => (condition.assetNo && row.assetNo.includes(condition.assetNo.contains)) || (condition.serialNo && row.serialNo.includes(condition.serialNo.contains))))
          .sort((a, b) => a.id.localeCompare(b.id));
        return structuredClone(take ? rows.slice(0, take) : rows);
      },
      count: async ({ where }) => {
        assert.equal(where.tenantId, "tenant"); assert.equal(where.workspaceId, "space");
        return state.assets.filter(row => !where.OR || where.OR.some(condition => (condition.assetNo && row.assetNo.includes(condition.assetNo.contains)) || (condition.serialNo && row.serialNo.includes(condition.serialNo.contains)))).length;
      }
    },
    workspaceCapabilityInstance: { findMany: async () => [] },
    rentalCategoryPreparationBatch: {
      findFirst: async ({ where }) => {
        assert.equal(where.tenantId, "tenant"); assert.equal(where.workspaceId, "space");
        return structuredClone(state.batches.find(row =>
          (where.preparationId === undefined || row.preparationId === where.preparationId) && row.batchId === where.batchId &&
          (where.actorId === undefined || row.actorId === where.actorId) &&
          (where.preparation === undefined || state.preparation?.targetVersionId === where.preparation.targetVersionId)) ?? null);
      },
      create: async ({ data }) => {
        assert.equal(data.tenantId, "tenant"); assert.equal(data.workspaceId, "space");
        assert.equal(data.preparationId, state.preparation.id);
        assert.ok(!state.batches.some(row => row.preparationId === data.preparationId && row.batchId === data.batchId));
        state.batches.push(structuredClone(data));
        if (state.failReceiptWrite) throw new Error("injected receipt failure");
        return structuredClone(data);
      }
    },
    rentalCategoryAdoptionPreparation: {
      findUnique: async ({ where }) => {
        assert.deepEqual(where.workspaceId_targetVersionId, { workspaceId: "space", targetVersionId: "v2" });
        return structuredClone(state.preparation);
      },
      create: async ({ data }) => {
        assert.equal(state.preparation, null);
        state.preparation = structuredClone(data); state.writes++;
        if (state.failAfterWrite) throw new Error("injected persistence failure");
        return structuredClone(state.preparation);
      },
      updateMany: async ({ where, data }) => {
        assert.equal(where.tenantId, "tenant"); assert.equal(where.workspaceId, "space");
        if (!state.preparation || where.id !== state.preparation.id || where.revision !== state.preparation.revision) return { count: 0 };
        state.preparation = { ...state.preparation, ...structuredClone(data), revision: state.preparation.revision + data.revision.increment };
        state.writes++;
        if (state.failAfterWrite) throw new Error("injected persistence failure");
        return { count: 1 };
      }
    }
  };
  // A transactional repository substitute verifies service-level rollback and
  // revision behavior. It is not evidence of real MySQL locking or throughput.
  let queue = Promise.resolve();
  db.$transaction = callback => {
    const pending = queue.then(async () => {
      const before = structuredClone(state.preparation), batches = structuredClone(state.batches), writes = state.writes;
      try { return await callback(db); }
      catch (error) { state.preparation = before; state.batches = batches; state.writes = writes; throw error; }
    });
    queue = pending.catch(() => undefined);
    return pending;
  };
  const user = { id: "operator", tenantId: "tenant", isSaasAdmin: false, permissions: ["rental-os:category:adopt"] };
  const access = categoryWorkspaceAuth(db, { tenantId: "tenant", userId: "operator", workspaceId: "space" });
  const identity = access.identity;
  const service = new CategoryAdoptionPreparationService(db, new WorkspaceCapabilityService({}), { registeredVersions: () => [] }, {}, access.auth);
  const body = (batchId, expectedPreparationRevision, entityId, values) => ({
    batchId, expectedSourceVersionId: state.workspace.categoryVersionId, expectedSourceRevision: state.workspace.categoryAdoptionRevision,
    expectedPreparationRevision, operation: "upgrade", reason: "prepare", patches: entityId ? [{ entityType: "asset", entityId, expectedUpdatedAt: timestamp.toISOString(), values }] : []
  });
  const call = (request, candidate = user, scope = identity) => runWithRequestIdentity(scope, () => service.saveBatch(candidate, "v2", request));
  return { state, user, identity, service, call, body, access };
}

void (async () => {
  const f = fixture(), originalAssets = structuredClone(f.state.assets);
  const first = f.body("batch-one", 0, "a", { code: "A" });
  const dto = plainToInstance(SaveCategoryPreparationBatchDto, first);
  assert.deepEqual(validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }), [], "the HTTP DTO must retain all batch and inherited request fields");
  assert.ok(validateSync(plainToInstance(SaveCategoryPreparationBatchDto, { ...first, tenantId: "forged" }), { whitelist: true, forbidNonWhitelisted: true }).length);
  const saved = await f.call(first);
  assert.equal(saved.revision, 1); assert.equal(saved.preparedOnly, true); assert.equal(saved.adoptionImplemented, false);
  assert.equal(f.state.preparation.patches.items[0].values.code, "A");
  assert.equal(f.state.writes, 1);
  const firstPage = await runWithRequestIdentity(f.identity, () => f.service.entities(f.user, "v2", { entityType: "asset", limit: 1 }));
  assert.equal(firstPage.total, 2); assert.equal(firstPage.rows.length, 1); assert.equal(firstPage.nextCursor, "a");
  assert.equal(firstPage.rows[0].prepared.values.code, "A"); assert.equal(firstPage.rows[0].preparationStale, false);
  const secondPage = await runWithRequestIdentity(f.identity, () => f.service.entities(f.user, "v2", { entityType: "asset", limit: 1, after: firstPage.nextCursor }));
  assert.equal(secondPage.rows[0].id, "b"); assert.equal(secondPage.nextCursor, undefined);
  const searchedPage = await runWithRequestIdentity(f.identity, () => f.service.entities(f.user, "v2", { entityType: "asset", search: "SN-b" }));
  assert.equal(searchedPage.total, 1); assert.equal(searchedPage.rows[0].id, "b");
  await assert.rejects(runWithRequestIdentity(f.identity, () => f.service.entities(f.user, "v2", { entityType: "asset", limit: 101 })), /分页参数/);
  await assert.rejects(runWithRequestIdentity(f.identity, () => f.service.entities({ ...f.user, tenantId: "other" }, "v2", { entityType: "asset" })), /操作人与经营空间/);
  const replay = await f.call(first);
  assert.equal(replay.replayed, true); assert.equal(replay.revision, 1); assert.equal(f.state.writes, 1);
  await assert.rejects(f.call({ ...first, reason: "different" }), /不同操作人或内容/);
  await assert.rejects(f.call(first, { ...f.user, id: "another" }), /操作人与经营空间/);
  await assert.rejects(f.call(first, { ...f.user, permissions: [] }), /仅获授权/);
  await assert.rejects(f.call(first, f.user, { ...f.identity, dataScope: "own" }), /受限数据范围/);
  await assert.rejects(f.call(first, { ...f.user, isSaasAdmin: true }), /仅获授权/);
  f.state.allowed = false;
  await assert.rejects(f.call(first), /采用范围/, "a replay must recheck the current target policy");
  const ownReceipt = await runWithRequestIdentity(f.identity, () => f.service.readBatch(f.user, "v2", first.batchId));
  assert.equal(ownReceipt.outcome, "saved", "current read permission can retrieve an original receipt after adoption eligibility changes");
  assert.equal(ownReceipt.result.revision, 1);
  await assert.rejects(runWithRequestIdentity(f.identity, () => f.service.readBatch(f.user, undefined, first.batchId)), /目标版本或批次/);
  assert.deepEqual(await runWithRequestIdentity(f.identity, () => f.service.readBatch(f.user, "v3", first.batchId)), { outcome: "unknown" });
  assert.deepEqual(await runWithRequestIdentity(f.identity, () => f.service.readBatch(f.user, "v2", "batch-not-received")), { outcome: "unknown" });
  await assert.rejects(runWithRequestIdentity(f.identity, () => f.service.readBatch({ ...f.user, id: "another" }, "v2", first.batchId)), /操作人与经营空间/);
  f.state.allowed = true;

  const second = f.body("batch-two", 1, "b", { code: "B", condition: "good" });
  await f.call(second);
  assert.equal(f.state.preparation.patches.items.length, 2);
  const lateReplay = await f.call(first);
  assert.equal(lateReplay.revision, 1, "return the original receipt, not a made-up current save result");
  assert.equal(f.state.preparation.revision, 2);
  await assert.rejects(f.call(f.body("batch-old", 0, "a", { condition: "good" })), /准备集合已变化/);
  await assert.rejects(runWithRequestIdentity(f.identity, () => f.service.save(f.user, "v2", { ...second, expectedPreparationRevision: 2 })), /旧版整份保存/);

  f.state.failAfterWrite = true;
  const third = f.body("batch-three", 2, "a", { condition: "good" });
  await assert.rejects(f.call(third), /persistence failure/);
  assert.equal(f.state.preparation.revision, 2);
  assert.equal(f.state.batches.length, 2, "failed persistence cannot leave a success receipt");
  f.state.failAfterWrite = false;
  await f.call(third);
  const withdrawal = { ...f.body("batch-withdraw", 3), removals: [{ entityType: "asset", entityId: "a", fieldCodes: ["condition"] }] };
  await f.call(withdrawal);
  assert.deepEqual(f.state.preparation.patches.items.find(row => row.entityId === "a").values, { code: "A" });
  assert.equal(f.state.preparation.patches.items.find(row => row.entityId === "b").values.condition, "good");
  assert.deepEqual(f.state.assets, originalAssets);

  f.state.workspace.categoryVersionId = "v3"; f.state.workspace.categoryAdoptionRevision = 2;
  const renewed = f.body("batch-new-source", 4, "b", { code: "B", condition: "good" });
  await assert.rejects(f.call(renewed), /须明确重建/);
  await f.call({ ...renewed, resetPreparation: true });
  assert.equal(f.state.preparation.patches.items.length, 1);
  assert.equal(f.state.batches.length, 5, "reset must not discard idempotency evidence");
  assert.deepEqual(f.state.assets, originalAssets);

  const concurrent = fixture();
  const results = await Promise.allSettled([
    concurrent.call(concurrent.body("batch-parallel-a", 0, "a", { code: "A" })),
    concurrent.call(concurrent.body("batch-parallel-b", 0, "b", { code: "B" }))
  ]);
  assert.equal(results.filter(row => row.status === "fulfilled").length, 1);
  assert.equal(concurrent.state.preparation.revision, 1);
  assert.equal(concurrent.state.preparation.patches.items.length, 1);
  const receiptFailure = fixture();
  receiptFailure.state.failReceiptWrite = true;
  const retryable = receiptFailure.body("batch-receipt-failure", 0, "a", { code: "A" });
  await assert.rejects(receiptFailure.call(retryable), /receipt failure/);
  assert.equal(receiptFailure.state.preparation, null, "a receipt failure must roll back even a newly-created preparation");
  assert.equal(receiptFailure.state.batches.length, 0);
  receiptFailure.state.failReceiptWrite = false;
  assert.equal((await receiptFailure.call(retryable)).revision, 1, "the same original request can succeed after a proven transaction rollback");
  const reasonOnly = fixture();
  const reasonResult = await reasonOnly.call(reasonOnly.body("batch-reason-only", 0));
  assert.equal(reasonResult.entityCount, 0); assert.equal(reasonResult.preparedOnly, true);
  assert.equal(reasonOnly.state.preparation.patches.reason, "prepare", "a preparation reason can be saved before entity fields are complete");
  console.log("category-preparation-batch-service: guarded partial save, original-key replay, revision conflict, rollback, explicit reset and legacy overwrite rejection passed (repository substitute)");
})().catch(error => { console.error(error); process.exitCode = 1; });
