"use strict";
const assert = require("node:assert/strict");
const { test } = require("node:test");
const { RentalCoreService } = require("../apps/api/dist/modules/rental-core/rental-core.service.js");
const { RentalCoreConfigRepository } = require("../apps/api/dist/modules/rental-core/rental-core-config.repository.js");
const { PlatformService } = require("../apps/api/dist/modules/platform/platform.service.js");
const { PlatformRepository } = require("../apps/api/dist/modules/platform/platform.repository.js");
const { RentalCategoryResolver } = require("../apps/api/dist/modules/rental-core/rental-category-resolver.service.js");
const { categoryCreationTemplates, composeCategoryCreation } = require("../apps/api/dist/modules/rental-core/category-creation-templates.js");
const { runWithRequestIdentity } = require("../apps/api/dist/common/request-identity.js");
const stores = require("./helpers/absorbing-config-store.cjs");

function definition(version = "1.0") {
  const source = categoryCreationTemplates().find(template => template.id === "serialized").definition;
  return composeCategoryCreation(source, { code: "stage_tools", name: `舞台用品 ${version}`, versionLabel: version,
    inventoryModes: source.supportedInventoryModes, pricingUnits: source.businessModel.pricingUnits,
    defaultPricingUnit: source.businessModel.defaultPricingUnit, fulfillmentModes: source.businessModel.fulfillmentModes,
    capabilityCodes: source.defaultCapabilities }).definition;
}
const profile = { tenantId: "new-tenant", categoryCode: "stage_tools", capabilities: [], terminology: definition().terminology,
  configVersion: "1.0", initializedAt: "2026-11-09T00:00:00Z" };

function repositoryFixture() {
  let existing, recommended = "v2", scope = "all";
  const trace = [];
  const versions = new Map(["v1", "v2"].map((id, index) => [id, { id, categoryCode: "stage_tools", status: "published", structureVersion: 1, definition: definition(`${index + 1}.0`) }]));
  const tx = {
    $queryRaw: async query => {
      if (query.sql.includes("FROM tenant_rental_profiles")) {
        assert.deepEqual(query.values, [profile.tenantId]);
        return [{ ...structuredClone(profile), configurationRevision: 1 }];
      }
      if (query.sql.includes("rental_category_version_policies")) { trace.push("policy"); return [{ createScope: scope, createTenantIds: ["another-tenant"] }]; }
      if (query.sql.includes("rental_category_definitions")) { trace.push("category-lock"); return [{ openingScope: "all", openingTenantIds: [] }]; }
      throw new Error("Unexpected initialization query");
    },
    tenantRentalProfile: { upsert: async args => { trace.push(["profile", args]); return args.create; } },
    rentalCategoryDefinition: { findUnique: async () => ({ code: "stage_tools", recommendedVersionId: recommended }) },
    rentalCategoryVersion: { findUnique: async ({ where }) => { trace.push(["version", where.id]); return versions.get(where.id); } },
    businessWorkspace: {
      findUnique: async () => existing ?? null,
      upsert: async args => { trace.push(["space", args]); return existing ?? { ...args.create, categoryAdoptionRevision: 0,
        createdAt: new Date("2026-11-09"), updatedAt: new Date("2026-11-09") }; }
    },
    rentalCategoryAdoptionAudit: { upsert: async args => { trace.push(["audit", args]); return args.create; } },
    user: { findMany: async () => [] }
  };
  return { repository: new RentalCoreConfigRepository(tx), tx, trace,
    existing: row => { existing = row; }, recommend: id => { recommended = id; }, allow: value => { scope = value; } };
}

test("default-space initialization binds the selected eligible version and records its actual actor", async () => {
  const fixture = repositoryFixture();
  await fixture.repository.upsertProfile(profile, fixture.tx, { categoryVersionId: "v1", actorId: "saas-owner" });
  const space = fixture.trace.find(row => Array.isArray(row) && row[0] === "space")[1];
  assert.equal(space.create.categoryVersionId, "v1", "recommendation v2 cannot replace explicit v1");
  assert.equal(space.create.name, "舞台用品 1.0");
  assert.deepEqual(space.update, {});
  const audit = fixture.trace.find(row => Array.isArray(row) && row[0] === "audit")[1].create;
  assert.equal(audit.toVersionId, "v1"); assert.equal(audit.actorId, "saas-owner");
  assert.ok(fixture.trace.indexOf("policy") < fixture.trace.findIndex(row => Array.isArray(row) && row[0] === "space"));
});

test("create policy rejection performs no workspace/adoption write in the supplied transaction", async () => {
  const fixture = repositoryFixture(); fixture.allow("pilot");
  await assert.rejects(fixture.repository.upsertProfile(profile, fixture.tx, { categoryVersionId: "v2" }), /不在目标版本/);
  assert.equal(fixture.trace.some(row => Array.isArray(row) && ["space", "audit"].includes(row[0])), false);
});

test("existing defaults retain their binding even without a recommendation and cannot be upgraded through initialization", async () => {
  const fixture = repositoryFixture();
  fixture.existing({ id: "ws_new-tenant", tenantId: "new-tenant", categoryCode: "stage_tools", categoryVersionId: "v1", categoryAdoptionRevision: 1,
    createdAt: new Date("2026-11-01"), updatedAt: new Date("2026-11-02") });
  fixture.recommend(null); fixture.allow("none");
  await fixture.repository.upsertProfile(profile, fixture.tx);
  assert.deepEqual(fixture.trace.filter(row => Array.isArray(row) && row[0] === "version").map(row => row[1]), ["v1"]);
  assert.equal(fixture.trace.includes("policy"), false);
  await assert.rejects(fixture.repository.upsertProfile(profile, fixture.tx, { categoryVersionId: "v2" }), /正式采用流程/);
});

test("explicit default initialization cannot write through another current workspace", async () => {
  const fixture = repositoryFixture();
  await assert.rejects(runWithRequestIdentity({ tenantId: "new-tenant", workspaceId: "other-space" }, () =>
    fixture.repository.upsertProfile(profile, fixture.tx, { categoryVersionId: "v1" })), /只适用于新建默认空间/);
  assert.equal(fixture.trace.length, 0);
});

test("Core uses the selected body and keeps initialization cache private until its outer transaction commits", async () => {
  const config = stores.createAbsorbingConfigStore(), core = new RentalCoreService(config, stores.createAbsorbingFactStore());
  const trace = [], tx = {};
  const selected = definition();
  config.readDefaultWorkspaceInitialization = async (tenantId, code, client) => {
    assert.equal(tenantId, "new-tenant"); assert.equal(code, "stage_tools"); assert.equal(client, tx);
    return undefined; // This fixture's explicit tenant has no persisted default yet.
  };
  config.upsertProfile = async (value, client, options) => { trace.push([value, client, options]); };
  core.categoryResolver = { forVersion: async (code, version, client) => { assert.equal(code, "stage_tools"); assert.equal(version, "v1"); assert.equal(client, tx); return selected; },
    forNewWorkspace: async () => { throw new Error("Explicit selection cannot read recommendation"); } };
  const initialized = await core.initializeTenant("new-tenant", "stage_tools", tx, "USD", { categoryVersionId: "v1", actorId: "saas-owner" });
  assert.equal(initialized.configVersion, "1.0");
  assert.equal(trace[0][1], tx); assert.deepEqual(trace[0][2], { categoryVersionId: "v1", actorId: "saas-owner" });
  assert.equal(core.states.has("ws_new-tenant"), false);
  const absent = new RentalCoreService(stores.createAbsorbingConfigStore(), stores.createAbsorbingFactStore());
  await assert.rejects(absent.initializeTenant("other", "camera", tx), /持久化品类解析/);
  await assert.rejects(absent.registerWorkspace("new-space", "other", "camera", tx), /持久化品类解析/);
});

test("platform coordinates the same transaction and only warms Core after its repository returns", async () => {
  const platform = Object.create(PlatformService.prototype), trace = [], tx = {};
  let committed = false;
  platform.useMysqlDataSource = () => true;
  platform.getTenantBootstrapPreview = () => ({ roles: [], dictionaries: [], numberRules: [], systemRules: [] });
  platform.systemRulesConfig = {}; platform.dictionaryGroups = []; platform.numberRules = [];
  const request = { tenantCode: "new-tenant", tenantName: "新商户", categoryCode: "stage_tools", categoryVersionId: "v1", currency: "USD", adminAccount: "owner", adminDisplayName: "管理员" };
  const actor = { id: "saas-owner", isSaasAdmin: true };
  platform.rentalCoreService = {
    initializeTenant: async (tenantId, code, client, currency, options) => { assert.equal(client, tx); trace.push([tenantId, code, currency, options]); },
    getWorkspaceCategoryInTransaction: async (tenantId, workspaceId, code, client) => { assert.equal(client, tx); assert.equal(workspaceId, `ws_${tenantId}`); return definition(); },
    onApplicationBootstrap: async () => { assert.equal(committed, true); trace.push("warm-after-commit"); },
    persist: async () => { assert.equal(committed, true); trace.push("persist-after-commit"); }
  };
  platform.platformRepository = { bootstrapTenant: async (_input, _preview, _seed, beforeCommit) => {
    assert.deepEqual(await beforeCommit(tx, "new-tenant-id"), { categoryName: "舞台用品 1.0" }); committed = true;
    return { tenant: { tenantId: "new-tenant-id" } };
  } };
  await platform.bootstrapTenant(request, actor);
  assert.deepEqual(trace[0], ["new-tenant-id", "stage_tools", "USD", { categoryVersionId: "v1", actorId: "saas-owner" }]);
  platform.rentalCoreService = undefined;
  await assert.rejects(platform.bootstrapTenant(request, actor), /初始化服务未装配/);
  const repository = new PlatformRepository({});
  await assert.rejects(repository.bootstrapTenant(request, {}, {}), /初始化回调未装配/);
});

test("opening metadata constructs current create-policy filters and keeps recommendation separate from eligible versions", async () => {
  const queries = [];
  const rows = ["v1", "v2"].map((id, index) => ({ id, categoryCode: "stage_tools", versionLabel: `${index + 1}.0`, status: "published",
    structureVersion: 1, definition: definition(`${index + 1}.0`), category: { recommendedVersionId: "v1" } }));
  const resolver = new RentalCategoryResolver({ tenant: { findUnique: async ({ where }) => where.id === "existing-tenant" ? { id: where.id } : null },
    rentalCategoryVersion: { findMany: async args => { queries.push(args); return rows; } } });
  const options = await resolver.openingOptions({ search: "舞台" });
  assert.equal(options.structureVersion, 1); assert.equal(options.source, "published");
  assert.deepEqual(queries[0].where.category.is.OR, [{ openingScope: "all" }]);
  assert.deepEqual(queries[0].where.policy.is.OR, [{ createScope: "all" }]);
  assert.equal(queries[0].take, 101);
  assert.deepEqual(options.options.map(option => [option.versionId, option.recommended]), [["v1", true], ["v2", false]]);
  assert.equal("definition" in options.options[0], false);
  assert.equal(options.options[0].defaultWorkspaceName, "舞台用品 1.0");
  await resolver.openingOptions({ tenantId: "existing-tenant" });
  assert.deepEqual(queries[1].where.category.is.OR[1], { openingScope: "pilot", openingTenantIds: { array_contains: "existing-tenant" } });
  assert.deepEqual(queries[1].where.policy.is.OR[1], { createScope: "pilot", createTenantIds: { array_contains: "existing-tenant" } });
  await assert.rejects(resolver.openingOptions({ tenantId: "missing-tenant" }), /目标租户不存在/);
  await assert.rejects(resolver.openingOptions({ search: "x".repeat(101) }), /搜索内容过长/);
  assert.equal(queries.length, 2);
});

test("opening metadata exposes a bounded page and an explicit demo source without inventing publication IDs", async () => {
  const rows = Array.from({ length: 101 }, (_, index) => ({ id: `v${index}`, categoryCode: "stage_tools", versionLabel: `${index}.0`, status: "published",
    structureVersion: 1, definition: definition(`${index}.0`), category: { recommendedVersionId: "v0" } }));
  const resolver = new RentalCategoryResolver({ rentalCategoryVersion: { findMany: async () => rows } });
  const result = await resolver.openingOptions({});
  assert.equal(result.options.length, 100); assert.equal(result.truncated, true);
  const core = Object.create(RentalCoreService.prototype);
  await assert.rejects(core.getCategoryOpeningOptions({}), /发布品类目录未装配/);
  const previous = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "test";
    const demo = await core.getCategoryOpeningOptions({}, "builtin_demo");
    assert.equal(demo.source, "builtin_demo"); assert.equal(demo.options.length, 4);
    assert.ok(demo.options.every(option => option.versionId === undefined));
    process.env.NODE_ENV = "production";
    await assert.rejects(core.getCategoryOpeningOptions({}, "builtin_demo"), /生产不能使用演示/);
  } finally { if (previous === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previous; }
});

test("workspace creation initializes its returned object in the original request transaction", async () => {
  const { AsyncLocalStorage } = require("node:async_hooks");
  const { createRentalApplicationAccess } = require("../packages/rental-core/dist/application-access.js");
  const { createRentalAuthorization } = require("../packages/rental-core/dist/http-auth.js");
  const { RentalWorkspaceManagementRepository } = require("../packages/rental-core/dist/mysql-workspace-management.js");
  const { RentalCoreConfigRepository: ConfigurationRepository } = require("../packages/rental-core/dist/mysql-core-configuration.js");
  const { readCreatedRentalWorkspaceConfiguration, resolveScopeWorkspaceId, assertScopedWrite } = require("../packages/rental-core/dist/mysql-workspace-scope.js");
  const { getRequestIdentity, getRequestTenantId, getRequestWorkspaceId, getRequestStaffLocationIds, staffLocationWhere } = require("../packages/platform-server/dist/common/request-identity.js");
  const authorization = createRentalAuthorization(require("../packages/shared/dist/index.js"));
  const selected = definition(), version = { id: "v1", categoryCode: selected.code, status: "published", structureVersion: 1, definition: selected };
  const tenantId = "new-tenant", user = { id: "owner", tenantId, isActive: true, isSaasAdmin: false, isPlatformAdmin: true,
    mustChangePassword: false, permissions: ["*"], dataScope: "all", locationScope: { mode: "all", locationIds: [] } };
  const request = { method: "POST", url: "/platform/workspaces", user };

  async function run(scenario, sessionWorkspaceId = "ws_current") {
    const identity = { tenantId, userId: user.id, audience: "operator", isSaasAdmin: false, isPlatformAdmin: true,
      permissions: user.permissions, dataScope: user.dataScope, locationScope: user.locationScope,
      accessSession: { sessionId: "session", expiresAt: Math.floor(Date.now() / 1000) + 600, workspaceId: sessionWorkspaceId ?? null },
      ...(sessionWorkspaceId ? { workspaceId: sessionWorkspaceId } : {}) };
    const before = { profile: { ...profile, categoryCode: "camera", configurationRevision: 2 }, workspaces: [], settings: [], inspections: [], snapshots: [], audits: [], captures: [] };
    let state = structuredClone(before), transactions = 0, escaped, capturedIdentity, activeTransaction, createdTransaction;
    const assertIdentity = () => assert.equal(getRequestIdentity(), capturedIdentity);
    const tx = {
      async $queryRaw(query) {
        assertIdentity();
        const text = query.sql;
        if (text.includes("FROM Tenant")) return [{ id: tenantId, status: "ACTIVE" }];
        if (text.includes("platform_core_access_locks")) return [{ tenantId, coreId: "rental" }];
        if (text.includes("platform_tenant_core_grants")) return [{ state: "enabled", revision: 1, operationId: "grant" }];
        if (text.includes("platform_member_core_assignments")) return [{ state: "assigned", revision: 1, operationId: "assignment" }];
        if (text.includes("platform_core_bindings")) return [{ bindingId: "binding", revision: 1, dataVersion: "0.1.0", containerType: null, containerId: null }];
        if (text.includes("rental_category_definitions")) return [{ openingScope: "all", openingTenantIds: [] }];
        if (text.includes("rental_category_version_policies")) return [{ createScope: "all", createTenantIds: [] }];
        if (text.includes("FROM business_workspaces")) return state.workspaces.filter(row => query.values.includes(row.id));
        if (text.includes("FROM tenant_rental_profiles")) return [state.profile];
        if (text.includes("FROM rental_core_state_snapshots")) return state.snapshots;
        throw Error(`unexpected creation SQL ${text}`);
      },
      async $executeRaw(query) {
        assertIdentity();
        assert.match(query.sql, /INSERT INTO rental_core_state_snapshots/u);
        const [workspaceId, tenantId, encoded] = query.values;
        state.snapshots.push({ workspaceId, tenantId, state: JSON.parse(encoded) });
        return 1;
      },
      businessWorkspace: {
        async findFirst({ where }) {
          const row = state.workspaces.find(row => Object.entries(where).every(([key, value]) => row[key] === value));
          return row ?? null;
        },
        async create({ data }) {
          assertIdentity();
          const row = { ...data, categoryAdoptionRevision: 0, createdAt: new Date(), updatedAt: new Date() };
          state.workspaces.push(row);
          return structuredClone(row);
        }
      },
      rentalCategoryDefinition: { findUnique: async () => ({ code: selected.code, recommendedVersionId: version.id }) },
      rentalCategoryVersion: { findUnique: async () => version },
      rentalCategoryAdoptionAudit: { create: async ({ data }) => { state.audits.push(data); return data; } },
      tenantRentalProfile: { findUnique: async () => state.profile, upsert: async () => state.profile },
      rentalTenantBusinessSettings: {
        findFirst: async () => state.settings[0] ?? null,
        async upsert({ create }) { assertIdentity(); state.settings.push(create); return { settingsRevision: 1 }; }
      },
      rentalFulfillmentOperator: { findMany: async () => [] }, rentalFulfillmentLocation: { findMany: async () => [] },
      rentalItemGroup: { findMany: async () => [] }, rentalPricingGroup: { findMany: async () => [] }, rentalCouponTemplate: { findMany: async () => [] },
      rentalInspectionTemplate: {
        findMany: async () => [], findUnique: async () => null,
        async upsert({ create }) {
          assertIdentity();
          if (scenario === "write_failure") throw Error("inspection write failed");
          state.inspections.push(create);
        }
      }
    };
    const db = { ...tx, async $transaction(consume) {
      transactions++;
      const saved = structuredClone(state);
      activeTransaction = { ...tx };
      try { return await consume(activeTransaction); }
      catch (error) { state = saved; throw error; }
    } };
    const access = createRentalApplicationAccess({ database: db, authorization,
      memberAuthority: { async lock(transaction) {
        assert.equal(transaction, activeTransaction); assertIdentity();
        return { revalidate: async () => assertIdentity() };
      } },
      term: { requireNewBusiness: async () => assertIdentity() },
      deploymentForTransaction: () => ({ requireAvailable: async () => assertIdentity() }),
      admissionForTransaction: () => ({ requireAccepting: async () => assertIdentity(), readCurrent: async () => ({ coreId: "rental", state: "accepting" }) })
    });
    const config = new ConfigurationRepository(db, { getRequestTenantId, getRequestWorkspaceId, getRequestStaffLocationIds, staffLocationWhere,
      resolveWorkspaceId: resolveScopeWorkspaceId, assertScopedWrite,
      async openingConfiguration(transaction, scope) {
        assert.equal(transaction, activeTransaction); assertIdentity();
        assert.equal(state.settings.length, 1); assert.ok(state.inspections.length > 0);
        if (scenario === "capture_failure") throw Error("opening capture failed");
        state.captures.push(scope);
      } });
    const core = new RentalCoreService(config, stores.createAbsorbingFactStore());
    core.categoryResolver = { forWorkspace: async (_tenantId, _workspaceId, transaction) => {
      assert.equal(transaction, activeTransaction); assertIdentity(); return { definition: selected };
    } };
    const repository = new RentalWorkspaceManagementRepository(db);
    const operation = () => repository.createBusinessWorkspaceForTenant(tenantId,
      { code: "new-space", name: "新空间", categoryCode: selected.code }, async (transaction, workspaceId) => {
        assert.equal(transaction, activeTransaction); assertIdentity();
        createdTransaction = transaction;
        escaped = AsyncLocalStorage.snapshot();
        const targetTenant = scenario === "other_tenant" ? "other-tenant" : tenantId;
        const targetId = scenario === "other_target" ? "other-space" : workspaceId;
        const targetTx = scenario === "other_transaction" ? { ...transaction } : transaction;
        if (scenario === "binding_changed") state.workspaces[0].categoryVersionId = "other-version";
        await core.registerWorkspace(targetId, targetTenant, selected.code, targetTx);
        assert.equal(core.states.has(workspaceId), false);
        if (scenario === "repeat") await core.registerWorkspace(workspaceId, tenantId, selected.code, transaction);
      }, user.id);
    const work = () => runWithRequestIdentity(identity, () => {
      capturedIdentity = getRequestIdentity();
      return access.run(() => access.withRequest(request, operation));
    });
    if (scenario === "success") {
      const row = await work();
      assert.equal(transactions, 2, "admission and original creation each retain their transaction");
      assert.deepEqual(state.profile, before.profile, "new-space configuration preserves the default compatibility profile");
      assert.equal(state.settings[0].workspaceId, row.id);
      assert.ok(state.inspections.every(template => template.workspaceId === row.id));
      assert.equal(state.snapshots[0].state.profile.categoryVersionId, version.id);
      assert.deepEqual(state.captures, [{ tenantId, workspaceId: row.id }]);
      assert.throws(() => escaped(() => readCreatedRentalWorkspaceConfiguration(createdTransaction, tenantId)), /已变化/u);
      await assert.rejects(runWithRequestIdentity(identity, () => core.registerWorkspace(row.id, tenantId, selected.code, createdTransaction)), /只能由本次创建事务/u);
    } else {
      await assert.rejects(work(), /新空间配置|只能由本次创建事务|绑定已变化|inspection write failed|opening capture failed/u);
      assert.deepEqual(state, before, "creation/configuration/audit/capture roll back together");
      assert.equal(core.states.size, 0);
    }
  }
  await run("success");
  await run("success", null);
  for (const scenario of ["other_tenant", "other_target", "other_transaction", "binding_changed", "repeat", "write_failure", "capture_failure"]) await run(scenario);
});
