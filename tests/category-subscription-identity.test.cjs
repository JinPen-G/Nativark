"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { SubscriptionService } = require("../apps/api/dist/modules/subscription/subscription.service.js");
const { TenantSubscriptionController } = require("../apps/api/dist/modules/subscription/subscription.controller.js");
const { rentalCategoryIdentityOptions } = require("../apps/api/dist/modules/rental-core/category-identity.js");
const { plainToInstance } = require("class-transformer");
const { validate } = require("class-validator");
const { SubmitSubscriptionRequestDto, UpsertFeatureCatalogDto } = require("../apps/api/dist/modules/subscription/subscription-request.dto.js");

test("subscription labels expose published Core names and scope tenant choices without exposing governance bodies", async () => {
  const reads = [];
  const db = { rentalCategoryDefinition: { findMany: async args => {
    reads.push(args);
    return [{ code: "studio_kits", name: "原名称", recommendedVersion: { status: "published", definition: { code: "studio_kits", name: "舞台套装", secret: "not projected" } } }];
  } } };
  const service = new SubscriptionService(db);
  assert.deepEqual(await service.rentalCategoryLabels(), [{ code: "studio_kits", name: "舞台套装" }]);
  assert.deepEqual(await service.rentalCategoryLabels("tenant-one"), [{ code: "studio_kits", name: "舞台套装" }]);
  assert.equal("OR" in reads[0].where, false);
  assert.deepEqual(reads[1].where.OR, [{ openingScope: "all" }, { openingScope: "pilot", openingTenantIds: { array_contains: "tenant-one" } }, { workspaces: { some: { tenantId: "tenant-one" } } }]);
  assert.deepEqual(reads[1].where.versions.some.status.in, ["published", "legacy_baseline"]);
  const controller = new TenantSubscriptionController({ rentalCategoryLabels: async tenantId => { assert.equal(tenantId, "authenticated-tenant"); return []; } });
  await controller.categoryLabels({ user: { tenantId: "authenticated-tenant" }, body: { tenantId: "foreign-tenant" } });
  assert.deepEqual(await rentalCategoryIdentityOptions(db, "tenant-one"), [{ code: "studio_kits", name: "舞台套装" }]);
});

function fixture() {
  const events = [], codes = new Set(["camera", "studio_kits"]);
  let pending;
  const tx = {
    $queryRaw: async () => [{ id: "tenant-one" }],
    rentalCategoryDefinition: { count: async ({ where }) => {
      assert.deepEqual(where.versions.some.status.in, ["published", "legacy_baseline"]);
      events.push("identity-check"); return where.code.in.filter(code => codes.has(code)).length;
    } },
    subscriptionFeatureCatalog: { findUnique: async () => null, upsert: async ({ create }) => { events.push("catalog-write"); return create; } },
    subscriptionEvent: { create: async () => { events.push("audit-write"); return { id: "audit" }; } },
    subscriptionRequest: { findUnique: async () => pending ?? null, findFirst: async () => null,
      create: async ({ data }) => { events.push("request-write"); return { id: "request", createdAt: new Date("2026-11-09"), handledAmount: null, handledCurrency: null, handledTaxInclusive: null, ...data }; } }
  };
  const db = { $transaction: async work => work(tx) };
  return { service: new SubscriptionService(db), tx, events, pending: row => { pending = row; } };
}
const catalog = { code: "studio.support", name: "套装支持", module: "rental", categories: ["studio_kits"], defaultOwnership: "pro", currentOwnership: "pro", releaseStatus: "planned" };
const request = { type: "upgrade_consult", targetPlan: "pro", moduleIntent: ["studio_kits"], dedupeKey: "original-request" };

test("catalog updates validate dynamic identities in their existing transaction before writing a feature or audit", async () => {
  const fixtureValue = fixture();
  const saved = await fixtureValue.service.upsertFeatureCatalog(catalog.code, catalog, "owner");
  assert.deepEqual(saved.categories, ["studio_kits"]);
  assert.deepEqual(fixtureValue.events, ["identity-check", "catalog-write", "audit-write"]);
  for (const categories of [["unpublished_code"], ["Invalid_Code"], ["bad/path"]]) {
    const denied = fixture();
    await assert.rejects(denied.service.upsertFeatureCatalog(catalog.code, { ...catalog, categories }));
    assert.equal(denied.events.includes("catalog-write"), false);
    assert.equal(denied.events.includes("audit-write"), false);
  }
});

test("new subscription intent validates published identities while the original pending receipt survives current catalog changes", async () => {
  const value = fixture();
  const saved = await value.service.submitRequest("tenant-one", request);
  assert.deepEqual(saved.moduleIntent, ["studio_kits"]);
  assert.deepEqual(value.events, ["identity-check", "request-write"]);
  const denied = fixture();
  await assert.rejects(denied.service.submitRequest("tenant-one", { ...request, moduleIntent: ["not_published"] }));
  assert.equal(denied.events.includes("request-write"), false);
  const original = fixture();
  original.pending({ id: "old", type: "UPGRADE_CONSULT", status: "PENDING", createdAt: new Date("2026-01-01"), moduleIntent: ["old_catalog_code"], handledAmount: null, handledCurrency: null, handledTaxInclusive: null });
  assert.deepEqual((await original.service.submitRequest("tenant-one", request)).moduleIntent, ["old_catalog_code"]);
  assert.deepEqual(original.events, []);
});

test("subscription DTOs retain dynamic category codes and reject illegal, duplicate and oversized selections", async () => {
  for (const [type, value, field] of [[SubmitSubscriptionRequestDto, request, "moduleIntent"], [UpsertFeatureCatalogDto, catalog, "categories"]]) {
    assert.deepEqual(await validate(plainToInstance(type, value), { whitelist: true, forbidNonWhitelisted: true }), []);
    for (const selection of [["UPPER"], ["bad/path"], ["studio_kits", "studio_kits"], Array.from({ length: 101 }, (_, index) => `category_${index}`)]) {
      assert.ok((await validate(plainToInstance(type, { ...value, [field]: selection }), { whitelist: true, forbidNonWhitelisted: true })).length);
    }
  }
});
