"use strict";
// Offline contract/reader regression. Database constraints, restart persistence and live adoption need their own DB evidence.
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { validateSync } = require("class-validator");
const { RentalCategoryCode, isRentalCategoryCode, RENTAL_CATEGORY_DEFINITIONS, RENTAL_CAPABILITY_MODULES } = require("@rental-os/shared");
const { rentalCategoryStorageCode, readRentalCategoryCode, assertPublishedRentalCategoryIdentities, rentalCategoryIdentityOptions } = require("../apps/api/dist/modules/rental-core/category-identity.js");
const { RentalCategoryResolver, parsePublishedRentalCategory } = require("../apps/api/dist/modules/rental-core/rental-category-resolver.service.js");
const { CategoryGovernanceService } = require("../apps/api/dist/modules/rental-core/category-governance.service.js");
const { assertCategoryAdoptionAllowed } = require("../apps/api/dist/modules/rental-core/category-governance-policy.js");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const { TenantBootstrapDto } = require("../apps/api/dist/modules/platform/platform-request.dto.js");
const { CreateBusinessWorkspaceDto } = require("../apps/api/dist/modules/platform/workspace-request.dto.js");
const { createAbsorbingConfigStore, createAbsorbingFactStore } = require("./helpers/absorbing-config-store.cjs");

function definitionFor(code) {
  const definition = structuredClone(RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === "camera"));
  const universal = new Set(RENTAL_CAPABILITY_MODULES.filter(row => row.applicableCategories === "all").map(row => row.code));
  definition.code = code;
  definition.defaultCapabilities = definition.defaultCapabilities.filter(code => universal.has(code));
  definition.requiredCapabilities = definition.requiredCapabilities.filter(code => universal.has(code));
  return parsePublishedRentalCategory(definition, code);
}

test("open identities preserve builtins and enforce canonical format without granting existence", async () => {
  assert.deepEqual(Object.values(RentalCategoryCode), ["vehicle", "camera", "camping", "construction"]);
  assert.equal(isRentalCategoryCode("studio_equipment"), true);
  assert.equal(rentalCategoryStorageCode("studio_equipment"), "studio_equipment");
  assert.equal(readRentalCategoryCode("CAMERA"), "camera");
  assert.equal(readRentalCategoryCode("studio_equipment"), "studio_equipment");
  assert.throws(() => readRentalCategoryCode("STUDIO_EQUIPMENT"), /兼容解释/);
  for (const invalid of [null, {}, "", "a", "Camera", "camera\n", "camera\r", "camera\u2028", "studio-equipment", "9gear", "constructor", "prototype", "__proto__", "a".repeat(65)]) {
    assert.equal(isRentalCategoryCode(invalid), false);
    assert.throws(() => rentalCategoryStorageCode(invalid), /编码格式/);
  }
  const db = { rentalCategoryDefinition: { count: async ({ where }) => {
    assert.deepEqual(where.versions.some.status.in, ["published", "legacy_baseline"]);
    return where.code.in.filter(code => code === "studio_equipment").length;
  } } };
  await assertPublishedRentalCategoryIdentities(db, ["studio_equipment", "studio_equipment"]);
  await assert.rejects(assertPublishedRentalCategoryIdentities(db, ["unregistered"]), /不存在或未发布/);
  const request = Object.assign(new TenantBootstrapDto(), { categoryCode: "studio_equipment" });
  assert.equal(validateSync(request).some(error => error.property === "categoryCode"), false);
  request.categoryCode = "constructor";
  assert.equal(validateSync(request).some(error => error.property === "categoryCode"), true);
  const workspace = Object.assign(new CreateBusinessWorkspaceDto(), { code: "studio", name: "器材空间", categoryCode: "studio_equipment", categoryVersionId: "v1" });
  assert.deepEqual(validateSync(workspace), []);
  workspace.categoryCode = "invalid-path";
  assert.equal(validateSync(workspace).some(error => error.property === "categoryCode"), true);
});

test("published reader resolves a dynamic identity, preserves historical versions and rejects draft or cross-code references", async () => {
  const code = "studio_equipment", v1 = definitionFor(code), v2 = structuredClone(v1);
  v2.version = "2"; v2.name = "新版器材";
  const rows = new Map([
    ["v1", { categoryCode: code, structureVersion: 1, status: "published", definition: v1 }],
    ["v2", { categoryCode: code, structureVersion: 1, status: "published", definition: v2 }],
    ["draft", { categoryCode: code, structureVersion: 1, status: "draft", definition: v2 }]
  ]);
  const resolver = new RentalCategoryResolver({
    rentalCategoryDefinition: { findFirst: async ({ where }) => {
      assert.equal(where.code, code, "Prisma string reads must not use the removed uppercase enum mapping");
      return { recommendedVersionId: "v2" };
    } },
    rentalCategoryVersion: { findUnique: async ({ where }) => rows.get(where.id) }
  });
  assert.equal((await resolver.forNewWorkspace(code)).name, "新版器材");
  assert.equal((await resolver.forVersion(code, "v1")).name, v1.name);
  await assert.rejects(resolver.forVersion(code, "draft"), /未发布/);
  await assert.rejects(resolver.forVersion("another_equipment", "v1"), /编码不匹配/);
  const forbidden = structuredClone(v1);
  forbidden.defaultCapabilities.push("camera_compatibility");
  assert.throws(() => parsePublishedRentalCategory(forbidden, code), /不适用/);
});

test("new codes retain governance permissions and current create/upgrade policy checks", async () => {
  const code = "studio_equipment";
  const governance = new CategoryGovernanceService({ rentalCategoryDefinition: { findUnique: async ({ where }) => {
    assert.equal(where.code, code); return null;
  } } }, {});
  await assert.rejects(governance.detail(code, { isSaasAdmin: false, permissions: ["*"] }), /SaaS/);
  await assert.rejects(governance.detail(code, { isSaasAdmin: true, permissions: ["*"] }), /不存在/);
  const db = {
    $queryRaw: async (query) => query.strings.join("").includes("FROM rental_category_definitions")
      ? [{ openingScope: "stopped", openingTenantIds: [], recommendedVersionId: "v1" }]
      : [{ createScope: "pilot", createTenantIds: ["pilot"], upgradeScope: "all", upgradeTenantIds: [], restoreScope: "none", restoreTenantIds: [] }],
    rentalCategoryVersion: { findUnique: async () => ({ categoryCode: code, status: "published" }) }
  };
  await assert.rejects(assertCategoryAdoptionAllowed(db, "pilot", code, "v1", "create"), /新开通/);
  await assertCategoryAdoptionAllowed(db, "existing", code, "v1", "upgrade");
  await assert.rejects(assertCategoryAdoptionAllowed(db, "existing", code, "v1", "restore"), /采用范围/);
});

test("persisted dynamic-space startup uses its bound definition and creates no sample business facts", async () => {
  const code = "studio_equipment", tenantId = "tenant_dynamic", workspaceId = "ws_tenant_dynamic";
  const v1 = definitionFor(code), v2 = structuredClone(v1);
  v2.version = "2";
  v2.businessModel.pricingUnits = ["day_24h"];
  v2.businessModel.defaultPricingUnit = "day_24h";
  let active = "v1";
  const resolver = new RentalCategoryResolver({
    businessWorkspace: { findFirst: async ({ where }) => where.tenantId === tenantId && where.id === workspaceId
      ? { categoryCode: code, categoryVersionId: active, categoryAdoptionRevision: active === "v1" ? 1 : 2 } : null },
    rentalCategoryVersion: { findUnique: async ({ where }) => ({ categoryCode: code, structureVersion: 1, status: "published", definition: where.id === "v1" ? v1 : v2 }) }
  });
  const config = createAbsorbingConfigStore(), facts = createAbsorbingFactStore();
  const core = new RentalCoreService(config, facts, undefined, undefined, undefined, undefined, undefined, undefined, resolver);
  const saved = core.seedState(tenantId, code, workspaceId, "CNY", v1);
  config.listWorkspaces = async () => [{ id: workspaceId, tenantId, categoryCode: code, isDefault: true }];
  config.loadAll = async () => [{ tenantId, workspaceId, workspaceCategoryCode: code, hasPersistedConfig: true,
    profile: saved.profile, businessSettings: saved.businessSettings, operators: [], locations: [], itemGroups: [], pricingGroups: [], couponTemplates: [], inspectionTemplates: saved.inspectionTemplates }];
  await core.onApplicationBootstrap();
  assert.equal((await core.getProfile(tenantId)).categoryCode, code);
  assert.deepEqual(core.listItemGroups(tenantId), []);
  assert.deepEqual(core.listLocations(tenantId), []);
  assert.deepEqual(config.writes, []);
  assert.deepEqual(facts.writes, []);
  active = "v2";
  assert.equal((await core.getWorkspaceCategory(tenantId)).version, "2");
  assert.deepEqual((await core.getBusinessSettings(tenantId)).pricing.enabledUnits, ["day_24h"]);
});

test("membership labels expose only published identity names, without governance bodies", async () => {
  const options = await rentalCategoryIdentityOptions({ rentalCategoryDefinition: { findMany: async ({ where }) => {
    assert.deepEqual(where.versions.some.status.in, ["published", "legacy_baseline"]);
    return [{ code: "studio_equipment", name: "原名称", recommendedVersion: { status: "published", definition: { code: "studio_equipment", name: "发布名称", internalPolicy: "private" } } }];
  } } });
  assert.deepEqual(options, [{ code: "studio_equipment", name: "发布名称" }]);
});
