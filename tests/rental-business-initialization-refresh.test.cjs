const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const stores = require("./helpers/absorbing-config-store.cjs");

(async () => {
  const coreStore = stores.createAbsorbingConfigStore();
  const core = new RentalCoreService(coreStore, stores.createAbsorbingFactStore());
  await core.onApplicationBootstrap();
  const tenantId = "tenant_001", profile = await core.getProfile(tenantId);
  const context = { profile, category: core.listCategories().find(row => row.code === profile.categoryCode),
    settings: await core.getBusinessSettings(tenantId), groups: core.listItemGroups(tenantId),
    pricingGroups: core.listPricingGroups(tenantId), locations: core.listLocations(tenantId) };
  const config = stores.createAbsorbingBusinessConfigStore();
  const service = new RentalBusinessService(config, stores.createAbsorbingBusinessFactStore(), coreStore);
  await service.onApplicationBootstrap();
  service.currentRule(tenantId, context);
  let releasePricing, pricingStarted;
  const paused = new Promise(resolve => { releasePricing = resolve; });
  const started = new Promise(resolve => { pricingStarted = resolve; });
  let snapshot;
  config.upsertPricingPlan = async plan => {
    snapshot = { tenantId, workspaceId: "ws_tenant_001", categoryCode: "camera", hasPersistedConfig: true,
      pricingPlans: [plan], discountPlans: [], services: [], calendars: [], ruleVersions: [], notificationTemplates: [] };
    pricingStarted();
    await paused;
  };
  config.upsertRuleVersion = async rule => { snapshot.ruleVersions.push(structuredClone(rule)); };
  config.loadAll = async () => snapshot ? [structuredClone(snapshot)] : [];
  const persistence = service.persist(tenantId);
  await started;
  const refresh = service.refreshFromDatabase();
  // Let an uncoordinated refresh consume the partial configuration before completing initialization.
  await new Promise(resolve => setTimeout(resolve, 20));
  releasePricing();
  await Promise.all([persistence, refresh]);
  assert.equal(snapshot.ruleVersions.length, 1, "refresh must not erase default rules while initialization is writing them");
  assert.equal(service.currentRule(tenantId, context).version, "1.0");
  // A subsequent authoritative empty persisted ruleset must still fail closed, not be re-seeded.
  snapshot.ruleVersions = [];
  await service.refreshFromDatabase();
  assert.throws(() => service.currentRule(tenantId, context), /没有生效的租赁规则版本/u);
  const { runWithRequestIdentity, getRequestWorkspaceId } = require("../apps/api/src/common/request-identity");
  const scopedConfig = stores.createAbsorbingBusinessConfigStore();
  const scopedService = new RentalBusinessService(scopedConfig, stores.createAbsorbingBusinessFactStore(), coreStore);
  await scopedService.onApplicationBootstrap();
  const writes = [];
  scopedConfig.upsertPricingPlan = async plan => { writes.push({ tenantId: plan.tenantId, workspaceId: getRequestWorkspaceId() }); };
  await Promise.all(["tenant_001", "tenant_002"].map(id => runWithRequestIdentity({ tenantId: id, workspaceId: `ws_${id}` }, async () => {
    const scopedProfile = await core.getProfile(id);
    scopedService.currentRule(id, { ...context, profile: scopedProfile,
      category: core.listCategories().find(row => row.code === scopedProfile.categoryCode), settings: await core.getBusinessSettings(id),
      groups: core.listItemGroups(id), pricingGroups: core.listPricingGroups(id) });
    await scopedService.persist(id);
  })));
  assert.deepEqual(writes, [
    { tenantId: "tenant_001", workspaceId: "ws_tenant_001" },
    { tenantId: "tenant_002", workspaceId: "ws_tenant_002" }
  ], "queued persistence must preserve each caller's workspace identity");
  console.log("PASS initialization/refresh interleaving preserves rules; authoritative missing rules remain fail-closed (in-memory only)");
})().catch(error => { console.error(error); process.exitCode = 1; });
