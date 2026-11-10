"use strict";
const assert = require("node:assert/strict");
const { Prisma } = require("@prisma/client");
const { RENTAL_CATEGORY_DEFINITIONS, RENTAL_CORE_CAPABILITY_CODES } = require("@rental-os/shared");
const { categoryWorkspaceAuth } = require("./category-workspace-auth.cjs");
const { CategoryAdoptionApplication } = require("../../apps/api/dist/modules/rental-core/category-adoption.application.js");
const { CategoryAdoptionPreparationService } = require("../../apps/api/dist/modules/rental-core/category-adoption-preparation.service.js");
const { RentalIdempotencyRepository } = require("../../apps/api/dist/modules/rental-core/rental-idempotency.repository.js");
const { WorkspaceCapabilityService } = require("../../apps/api/dist/modules/rental-core/workspace-capability.service.js");
const { CapabilityHookRuntime } = require("../../apps/api/dist/modules/rental-core/capability-hook.runtime.js");
const { CapabilityHookRegistrar } = require("../../apps/api/dist/modules/rental-core/capability-hook.registrar.js");
const { runWithRequestIdentity } = require("../../apps/api/dist/common/request-identity.js");

/** Declared offline database rows with serial transaction rollback. Exercises
 * production services/repositories; does not simulate MySQL locking or latency. */
function adoptionFixture({ entityCount = 2, prepared = true } = {}) {
  const at = new Date("2026-11-09T00:00:00.000Z");
  const source = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === "camera"));
  source.defaultCapabilities = source.defaultCapabilities.filter(code => RENTAL_CORE_CAPABILITY_CODES.includes(code));
  source.requiredCapabilities = [];
  source.businessModel.assetFields = [{ code: "identity", label: "型号身份", scope: "item_group", type: "string", required: true },
    { code: "edition", label: "版本", scope: "item_group", type: "select", required: true, options: ["old"] }];
  source.attributeSchema = { identity: "string", edition: "select" };
  const target = structuredClone(source);
  target.businessModel.assetFields[0].unique = true;
  target.businessModel.assetFields[1].options = ["new"];
  target.businessModel.assetFields.push({ code: "newField", label: "新增必填", scope: "item_group", type: "string", required: true });
  target.attributeSchema.newField = "string";
  const groups = Array.from({ length: entityCount }, (_, index) => ({ id: `g${index}`, tenantId: "tenant", workspaceId: "space", categoryCode: "camera",
    code: `G${index}`, name: `Model ${index}`, inventoryMode: "SERIALIZED", status: "enabled", bundleComponents: [], updatedAt: at,
    attributes: { identity: `identity-${index}`, edition: "old", retired: { proof: false } } }));
  const patches = groups.map(row => ({ entityType: "item_group", entityId: row.id, expectedUpdatedAt: at.toISOString(), values: { edition: "new", newField: "retained" } }));
  const settings = { tenantId: "tenant", categoryCode: "camera", configVersion: "v1",
    pricing: { enabledUnits: ["hour"], defaultUnit: "hour", currency: "CNY", taxIncluded: true, holidayPricingEnabled: false },
    fulfillment: { enabledModes: ["store_pickup_return"] }, payment: { enabledMethods: ["offline_cash"] },
    calendar: { weekendDays: [0, 6], holidayPricingEnabled: false, officialCalendarRegion: "CN" },
    membership: { signupRewardEnabled: false, signupRewardType: "balance", signupRewardAmount: 0, referralRewardEnabled: false,
      referralRewardType: "balance", referrerRewardAmount: 0, inviteeRewardAmount: 0, referralTrigger: "first_order_completed" },
    notifications: { enabledEvents: [], editableChannels: [] } };
  const rule = { pricing: {}, payment: { timing: "order", unpaidHoldMinutes: 15, preauthorizationRequired: false, depositMode: "none" },
    overdue: { feeMode: "none", graceMinutes: 0, feeMultiplier: 0 },
    fulfillment: { pickupInspectionRequired: false, returnInspectionRequired: false, evidenceRequired: false, allowDifferentReturnLocation: false },
    cancellation: { freeBeforeHours: 24, lateFeeType: "none", lateFeeValue: 0, weatherExceptionEnabled: false },
    qualification: { required: false, documentTypes: [], minimumValidityDays: 0 }, damage: { manualReviewRequired: true } };
  const configurations = Object.fromEntries(["rentalFulfillmentLocation", "rentalInspectionTemplate", "workspaceCapabilityInstance", "customerMembershipQualificationType",
    "rentalPriceAdjustmentPlan", "rentalPricingPlan", "rentalValueAddedService", "rentalPricingGroup", "rentalDiscountPlan", "rentalCouponTemplate", "rentalServiceCapacity", "rentalFulfillmentOperator"].map(model => [model, []]));
  configurations.rentalTenantBusinessSettings = [{ tenantId: "tenant", workspaceId: "space", settings }];
  configurations.rentalPriceVersion = [{ id: "price-v1", sequence: 1, effectiveFrom: at,
    rates: groups.map(group => ({ itemGroupId: group.id, unit: "hour", baseAmount: 10, weekendMultiplier: 1, holidayMultiplier: 1, depositAmount: 0, minimumUnits: 1 })) }];
  configurations.rentalRuleVersion = [{ id: "rule-v1", effectiveFrom: at, status: "published", voidedAt: null, config: rule }];
  const policy = { revision: 0, upgradeScope: "all", upgradeTenantIds: [], restoreScope: "all", restoreTenantIds: [] };
  let state = { workspace: { id: "space", tenantId: "tenant", status: "ACTIVE", categoryCode: "camera", categoryVersionId: "v1", categoryAdoptionRevision: 1 },
    groups, assets: [], configurations, versions: new Map([["v1", { id: "v1", categoryCode: "camera", versionLabel: "v1", status: "published", structureVersion: 1, definition: source }],
      ["v2", { id: "v2", categoryCode: "camera", versionLabel: "v2", status: "published", structureVersion: 1, definition: target }]]),
    policies: new Map([["v1", structuredClone(policy)], ["v2", structuredClone(policy)]]),
    preparation: prepared ? { id: "prep-v2", tenantId: "tenant", workspaceId: "space", targetVersionId: "v2", revision: 1, sourceRevision: 1,
      patches: { formatVersion: 2, sourceVersionId: "v1", operation: "upgrade", reason: "prepare", items: patches, capabilityPatches: [] } } : null,
    claims: [], audits: [], receipts: [], batches: [], members: [], writes: 0,
    history: [{ id: "old-quote", categoryVersionId: "v1", ruleSnapshot: structuredClone(rule), rentalAmount: 10 }] };
  const controls = { failReceipt: false, failClaimAfter: 0, countOverrides: {}, missingBytes: false };
  const scope = where => {
    const own = where.pricingGroup?.is ?? where.bundleItemGroup?.is ?? where;
    assert.equal(own.tenantId, "tenant"); assert.equal(own.workspaceId, "space");
  };
  const db = {
    $queryRaw: async query => {
      if (query.sql.includes("OCTET_LENGTH")) {
        if (controls.missingBytes) return [];
        const tableModels = { rental_tenant_business_settings: "rentalTenantBusinessSettings", rental_price_versions: "rentalPriceVersion",
          rental_rule_versions: "rentalRuleVersion", rental_inspection_templates: "rentalInspectionTemplate", workspace_capability_instances: "workspaceCapabilityInstance",
          rental_price_adjustment_plans: "rentalPriceAdjustmentPlan", rental_pricing_plans: "rentalPricingPlan", rental_value_added_services: "rentalValueAddedService",
          rental_discount_plans: "rentalDiscountPlan", rental_coupon_templates: "rentalCouponTemplate" };
        const table = query.sql.match(/FROM `?([a-z_]+)`?/)[1], columns = [...query.sql.matchAll(/OCTET_LENGTH\(`?([A-Za-z]+)`?\)/g)].map(match => match[1]);
        const rows = table === "rental_item_groups" ? state.groups : table === "rental_assets" ? state.assets : state.configurations[tableModels[table]];
        assert.ok(rows); assert.deepEqual(query.values, ["tenant", "space"]);
        const bytes = rows.reduce((sum, row) => sum + columns.reduce((size, column) => size + (row[column] == null ? 0 : Buffer.byteLength(JSON.stringify(row[column]))), 0), 0);
        return [{ bytes: BigInt(bytes) }];
      }
      if (query.sql.includes("rental_category_definitions")) return [{ openingScope: "stopped", openingTenantIds: [], recommendedVersionId: "v1" }];
      if (query.sql.includes("rental_category_version_policies")) return [structuredClone(state.policies.get(query.values[0]))];
      if (query.sql.includes("business_workspaces")) { assert.ok(query.values.includes("tenant")); assert.ok(query.values.includes("space")); return [structuredClone(state.workspace)]; }
      throw new Error("Undeclared query: " + query.sql);
    },
    businessWorkspace: { findFirst: async ({ where }) => where.tenantId === "tenant" && (where.id === "space" || where.defaultMarker === "default") ? structuredClone(state.workspace) : null,
      updateMany: async ({ where, data }) => {
        assert.equal(where.tenantId, "tenant"); assert.equal(where.id, "space");
        if (where.categoryVersionId !== state.workspace.categoryVersionId || where.categoryAdoptionRevision !== state.workspace.categoryAdoptionRevision) return { count: 0 };
        Object.assign(state.workspace, data); state.writes++; return { count: 1 };
      } },
    rentalCategoryVersion: { findUnique: async ({ where }) => structuredClone(state.versions.get(where.id) ?? null) },
    rentalItemGroup: { count: async ({ where }) => { scope(where); return state.groups.length; },
      findMany: async ({ where }) => { scope(where); return structuredClone(state.groups.filter(row => !where.id?.in || where.id.in.includes(row.id))); },
      updateMany: async ({ where, data }) => {
        scope(where); const row = state.groups.find(row => row.id === where.id && row.updatedAt.getTime() === where.updatedAt.getTime());
        if (!row) return { count: 0 }; Object.assign(row, structuredClone(data)); state.writes++; return { count: 1 };
      } },
    rentalAsset: { count: async ({ where }) => { scope(where); return state.assets.length; }, findMany: async ({ where }) => { scope(where); return structuredClone(state.assets); } },
    rentalAttributeUniqueValue: { deleteMany: async ({ where }) => { scope(where); state.claims = state.claims.filter(row => !where.OR.some(condition => condition.entityType === row.entityType && condition.fieldCode.in.includes(row.fieldCode))); },
      create: async ({ data }) => {
        state.claims.push(structuredClone(data)); state.writes++;
        if (controls.failClaimAfter && state.claims.length === controls.failClaimAfter) throw new Error("injected claim failure");
        return data;
      } },
    rentalCategoryAdoptionAudit: { create: async ({ data }) => { const audit = { ...structuredClone(data), id: `audit-${state.audits.length + 1}`, createdAt: at }; state.audits.push(audit); state.writes++; return structuredClone(audit); },
      findFirst: async ({ where }) => structuredClone(state.audits.find(row => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null) },
    rentalOrderIdempotencyRecord: { findFirst: async ({ where }) => { scope(where); return structuredClone(state.receipts.find(row => row.action === where.action && row.idempotencyKey === where.idempotencyKey) ?? null); },
      create: async ({ data }) => {
        if (state.receipts.some(row => row.action === data.action && row.idempotencyKey === data.idempotencyKey)) throw new Prisma.PrismaClientKnownRequestError("duplicate original key", { code: "P2002", clientVersion: "offline" });
        state.receipts.push({ ...structuredClone(data), status: "succeeded" }); state.writes++;
        if (controls.failReceipt) throw new Error("injected receipt failure"); return data;
      } },
    rentalCategoryAdoptionPreparation: { findFirst: async ({ where }) => { scope(where); return state.preparation?.targetVersionId === where.targetVersionId ? structuredClone(state.preparation) : null; },
      findUnique: async ({ where }) => state.preparation?.targetVersionId === where.workspaceId_targetVersionId.targetVersionId ? structuredClone(state.preparation) : null,
      create: async ({ data }) => { state.preparation = structuredClone(data); state.writes++; return data; },
      updateMany: async ({ where, data }) => { scope(where); if (state.preparation?.id !== where.id || state.preparation.revision !== where.revision) return { count: 0 };
        Object.assign(state.preparation, structuredClone(data), { revision: state.preparation.revision + data.revision.increment }); state.writes++; return { count: 1 }; } },
    rentalCategoryPreparationBatch: { findFirst: async ({ where }) => { scope(where); return structuredClone(state.batches.find(row => row.preparationId === where.preparationId && row.batchId === where.batchId) ?? null); },
      create: async ({ data }) => { state.batches.push(structuredClone(data)); state.writes++; return data; } }
  };
  for (const model of Object.keys(configurations)) db[model] = {
    count: async ({ where }) => { scope(where); return controls.countOverrides[model] ?? state.configurations[model].length; },
    findFirst: async ({ where }) => { scope(where); return structuredClone(state.configurations[model][0] ?? null); },
    findMany: async ({ where }) => { scope(where); return structuredClone(state.configurations[model]); }
  };
  db.rentalPricingGroupMember = { count: async ({ where }) => { scope(where); return state.members.length; } };
  db.rentalBundleComponent = { count: async ({ where }) => { scope(where); return 0; } };
  let queue = Promise.resolve();
  db.$transaction = run => {
    const pending = queue.then(async () => { const before = structuredClone(state); try { return await run(db); } catch (error) { state = before; throw error; } });
    queue = pending.catch(() => undefined); return pending;
  };
  const access = categoryWorkspaceAuth(db, { tenantId: "tenant", userId: "operator", workspaceId: "space" });
  const user = { id: "operator", tenantId: "tenant", permissions: ["rental-os:category:adopt"], isSaasAdmin: false };
  const capabilities = new WorkspaceCapabilityService({}), hooks = new CapabilityHookRuntime(capabilities);
  new CapabilityHookRegistrar(hooks).onApplicationBootstrap();
  const subscriptions = { lockCategoryCommercialContext: async (_, tx, features) => { assert.equal(tx, db); return { lockedFeatureCodes: features }; },
    readCategoryCommercialContext: async (_, tx) => { assert.equal(tx, db); return { newBusinessAllowed: true, serviceStatus: "active", revision: 1, entitlements: [], complete: false, scope: "fixture" }; } };
  const app = new CategoryAdoptionApplication(db, new RentalIdempotencyRepository(db), access.auth, capabilities, hooks, subscriptions);
  const preparations = new CategoryAdoptionPreparationService(db, capabilities, hooks, subscriptions, access.auth, app);
  const request = { expectedSourceVersionId: "v1", expectedSourceRevision: 1, expectedPreparationRevision: 1, expectedTargetPolicyRevision: 0,
    operation: "upgrade", idempotencyKey: "adoption-one", reason: "explicit adoption" };
  const within = run => runWithRequestIdentity(access.identity, run);
  return { get state() { return state; }, db, app, access, controls, user, preparations, patches, request, source, target,
    adopt: (body = request, targetId = "v2") => within(() => app.adopt(user, targetId, body)),
    read: (key = request.idempotencyKey) => within(() => app.readOriginal(user, key)), within };
}
module.exports = { adoptionFixture };
