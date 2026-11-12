"use strict";
const assert = require("node:assert/strict");
const { test, before, after } = require("node:test");
const { adoptionFixture } = require("./fixtures/category-adoption-fixture.cjs");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { RentalCategoryResolver } = require("../apps/api/dist/modules/rental-core/rental-category-resolver.service.js");
const { RentalBusinessConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-business-config.repository.js");
const { RentalBusinessService } = require("../apps/api/dist/modules/rental-core/rental-business.service.js");
const flags = ["NODE_ENV", "RENTAL_CATEGORY_GOVERNANCE_PREVIEW", "RENTAL_CATEGORY_ADOPTION"];
const original = Object.fromEntries(flags.map(key => [key, process.env[key]]));
before(() => { process.env.NODE_ENV = "test"; process.env.RENTAL_CATEGORY_GOVERNANCE_PREVIEW = "true"; process.env.RENTAL_CATEGORY_ADOPTION = "true"; });
after(() => { for (const key of flags) if (original[key] === undefined) delete process.env[key]; else process.env[key] = original[key]; });
function fixture() {
  const f = adoptionFixture(), at = new Date("2026-11-09T00:00:00Z");
  Object.assign(f.state.configurations.rentalTenantBusinessSettings[0].settings,
    { updatedAt: at.toISOString(), updatedBy: "fixture" });
  const originalQuery = f.db.$queryRaw.bind(f.db);
  // Business reads also take the original shared Tenant parent fence. Keep the
  // existing Auth fixture's exclusive principal-lock assertions for its queries.
  f.db.$queryRaw = async query => {
    if (query.sql === "SELECT id FROM Tenant WHERE id=? LOCK IN SHARE MODE") {
      assert.deepEqual(query.values, ["tenant"]);
      return [{ id: "tenant" }];
    }
    // R0 quote preparation reads the same fixture's persisted profile/settings
    // and scoped collections. It does not reconstruct them from the Core cache.
    if (query.sql.includes("AS profileVersion") && query.sql.includes("FROM business_workspaces AS w")) {
      assert.deepEqual(query.values.slice(-2), ["tenant", "space"]);
      const settings = f.state.configurations.rentalTenantBusinessSettings[0]?.settings;
      assert.ok(settings);
      return [{ tenantId: "tenant", workspaceId: "space", categoryCode: f.state.workspace.categoryCode,
        settingsCategoryCode: settings.categoryCode, configVersion: settings.configVersion, settings: structuredClone(settings),
        profileVersion: profile.configVersion, profileCategoryCode: profile.categoryCode, capabilities: structuredClone(profile.capabilities),
        terminology: structuredClone(profile.terminology), initializedAt: at, profileUpdatedAt: at }];
    }
    if (query.sql.includes("FROM rental_fulfillment_locations AS l")) {
      assert.deepEqual(query.values.filter(value => typeof value === "string"), ["tenant", "space"]);
      return structuredClone(f.state.configurations.rentalFulfillmentLocation);
    }
    if (query.sql.includes("FROM rental_coupon_templates AS c")) {
      assert.deepEqual(query.values.filter(value => typeof value === "string"), ["tenant", "space"]);
      return structuredClone(f.state.configurations.rentalCouponTemplate);
    }
    if (query.sql.includes("FROM rental_item_groups AS g") && query.sql.includes("AS attributes")) {
      assert.deepEqual(query.values.slice(0, 3), [32768, "tenant", "space"]);
      assert.equal(query.values.at(-1), 101);
      const ids = query.values.slice(3, -1);
      assert.ok(ids.every(id => f.state.groups.some(row => row.id === id)));
      return structuredClone(f.state.groups.filter(row => ids.includes(row.id)));
    }
    return originalQuery(query);
  };
  f.state.workspace.defaultMarker = "default";
  for (const group of f.state.groups) Object.assign(group, { unit: "件", description: null, createdAt: at });
  const profile = Object.create(RentalCoreService.prototype).seedState("tenant", "camera", "space", "CNY", f.source).profile;
  f.db.tenantRentalProfile = { findUnique: async ({ where }) => {
    assert.equal(where.tenantId, "tenant");
    return { ...structuredClone(profile), initializedAt: at, updatedAt: at };
  } };
  const repository = new RentalCoreConfigRepository(f.db);
  const facts = new Proxy({}, { get: (_, method) => async () => assert.fail("context reads must not write or seed facts: " + String(method)) });
  const createCore = () => new RentalCoreService(repository, facts, undefined, undefined, undefined,
    undefined, undefined, undefined, new RentalCategoryResolver(f.db));
  return { f, repository, first: createCore(), second: createCore(), createCore };
}
test("two independent Core instances read the newly adopted committed definition and attributes while old contexts stay frozen", async () => {
  const { f, first, second } = fixture();
  const oldFirst = await f.within(() => first.readBusinessContext("tenant"));
  const oldSecond = await f.within(() => second.readBusinessContext("tenant"));
  assert.equal(oldFirst.categoryVersionId, "v1"); assert.equal(oldFirst.groups[0].attributes.edition, "old");
  await f.adopt();
  const [newFirst, newSecond] = await Promise.all([f.within(() => first.readBusinessContext("tenant")), f.within(() => second.readBusinessContext("tenant"))]);
  assert.equal(newFirst.categoryVersionId, "v2"); assert.equal(newSecond.categoryVersionId, "v2");
  assert.equal(newFirst.categoryAdoptionRevision, 2); assert.equal(newFirst.groups[0].attributes.newField, "retained");
  assert.deepEqual(newFirst, newSecond);
  assert.equal(oldFirst.groups[0].attributes.edition, "old"); assert.equal(oldSecond.groups[0].attributes.newField, undefined);
  const current = await f.within(() => first.getProfile("tenant"));
  assert.equal(current.categoryVersionId, "v2"); assert.equal(current.categoryAdoptionRevision, 2);
});
test("a context read cannot create samples, and actual empty collections replace any old local sample arrays", async () => {
  const { f, first } = fixture();
  await f.within(() => first.readBusinessContext("tenant"));
  f.state.groups = []; f.state.preparation = null;
  const context = await f.within(() => first.readBusinessContext("tenant"));
  assert.deepEqual(context.groups, []);
  await f.within(() => first.factContext("tenant"));
  assert.deepEqual(first.states.get("space").sampleAssets, []); assert.deepEqual(first.states.get("space").sampleStockBalances, []);
});
test("a saved Core context cannot be paired with business configuration from a later adoption", async () => {
  const { f, first, repository } = fixture();
  const previous = await f.within(() => first.readBusinessContext("tenant"));
  await f.adopt();
  const business = new RentalBusinessService(new RentalBusinessConfigRepository(f.db), {}, repository);
  await assert.rejects(f.within(() => business.createQuote("tenant", previous, {})), /版本已变化/);
  assert.equal(f.state.receipts.length, 1);
});
test("snapshot readers reject space-external component/member IDs without querying their private records", async () => {
  const { f, first } = fixture();
  f.state.groups[0].bundleComponents = [{ id: "foreign-component", componentItemGroupId: "another-space", quantity: 1, optional: false }];
  await assert.rejects(f.within(() => first.readBusinessContext("tenant")), /空间外/);
  f.state.groups[0].bundleComponents = [];
  f.state.configurations.rentalPricingGroup = [{ id: "p", tenantId: "tenant", workspaceId: "space", members: [{ itemGroupId: "another-space" }] }];
  await assert.rejects(f.within(() => first.readBusinessContext("tenant")), /空间外/);
});
test("missing actual business settings stay unavailable and are never replaced with current defaults", async () => {
  const { f, first } = fixture();
  f.state.configurations.rentalTenantBusinessSettings = [];
  await assert.rejects(f.within(() => first.readBusinessContext("tenant")), /尚未持久化/);
  await assert.rejects(f.within(() => first.getBusinessSettings("tenant")), /尚未持久化/);
});
test("the committed business context preserves the current authorized location projection", async () => {
  const { f, first } = fixture();
  f.state.configurations.rentalFulfillmentLocation = ["allowed", "private"].map(id => ({ id, tenantId: "tenant", workspaceId: "space",
    code: id, name: id, type: "store", status: "enabled", capabilities: [], latitude: null, longitude: null }));
  f.access.identity.locationScope = { mode: "selected", locationIds: ["allowed"] };
  const context = await f.within(() => first.readBusinessContext("tenant"));
  assert.deepEqual(context.locations.map(row => row.id), ["allowed"]);
  assert.deepEqual(f.within(() => first.listLocations("tenant")).map(row => row.id), ["allowed"]);
});
test("AI consumes the committed Core snapshot after adoption without combining independent getters", async () => {
  const { f, first } = fixture();
  const { AiGuardedQuoteCoreContextSource } = require("../apps/api/dist/modules/ai-native/tools/quote-route.composition.js");
  const expected = { kind: "workspace", tenantId: "tenant", workspaceId: "space" };
  // This route substitute supplies only the original scope; it does not prove
  // Guard acceptance, which remains covered by the existing AI authority tests.
  const source = new AiGuardedQuoteCoreContextSource(first, { withRead: async (_route, _input, consume) => consume({ scope: expected }) });
  for (const method of ["getProfile", "getWorkspaceCategory", "getBusinessSettings", "listItemGroups", "listPricingGroups", "listCouponTemplates", "listLocations", "listOperators"])
    first[method] = () => assert.fail("AI must consume one committed Core context: " + method);
  const before = await f.within(() => source.current(expected));
  await f.adopt();
  const after = await f.within(() => source.current(expected));
  assert.equal(before.categoryVersionId, "v1"); assert.equal(after.categoryVersionId, "v2");
  assert.equal(after.groups[0].attributes.newField, "retained"); assert.equal(before.groups[0].attributes.newField, undefined);
});
