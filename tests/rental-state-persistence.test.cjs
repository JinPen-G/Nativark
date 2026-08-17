const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { createAbsorbingConfigStore, createAbsorbingFactStore, createAbsorbingBusinessConfigStore } = require("./helpers/absorbing-config-store.cjs");

class FakeRepository {
  constructor() { this.core = new Map(); this.business = new Map(); }
  async loadCoreStates() { return [...this.core].map(([tenantId, state]) => ({ tenantId, state: structuredClone(state) })); }
  async loadBusinessStates() { return [...this.business].map(([tenantId, state]) => ({ tenantId, state: structuredClone(state) })); }
  async loadTenantProfiles() { return [{ tenantId: "tenant_camera_db", categoryCode: "CAMERA" }]; }
  async saveCoreState(tenantId, state) { this.core.set(tenantId, structuredClone(state)); }
  async saveBusinessState(tenantId, state) { this.business.set(tenantId, structuredClone(state)); }
}

(async () => {
  const repository = new FakeRepository();
  // 本用例验证的是 JSON 聚合快照的重启恢复，配置落库不在其关注范围，故注入吸收式 store。
  // 注意：阶段 4 把快照正式降级为恢复副本后，本用例的主题即被 mysql-e2e 第 17/18 节取代，应退休。
  const core = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore(), repository);
  await core.onModuleInit();
  assert.equal(core.getProfile("tenant_camera_db").categoryCode, "camera", "database tenant profile must initialize the right category");
  await core.saveOperator("tenant_camera_db", { code: "PARTNER", name: "摄影合作商", type: "partner", settlementMode: "monthly" });
  await core.persist("tenant_camera_db");

  const business = new RentalBusinessService(createAbsorbingBusinessConfigStore(), repository);
  const context = () => {
    const profile = core.getProfile("tenant_camera_db");
    return { profile, category: core.listCategories().find((item) => item.code === profile.categoryCode), settings: core.getBusinessSettings("tenant_camera_db"), groups: core.listItemGroups("tenant_camera_db"), couponTemplates: core.listCouponTemplates("tenant_camera_db") };
  };
  business.listPricingPlans("tenant_camera_db", context());
  await business.persist("tenant_camera_db");

  const restoredCore = new RentalCoreService(createAbsorbingConfigStore(), createAbsorbingFactStore(), repository);
  const restoredBusiness = new RentalBusinessService(createAbsorbingBusinessConfigStore(), repository);
  await Promise.all([restoredCore.onModuleInit(), restoredBusiness.onModuleInit()]);
  assert.equal(restoredCore.listOperators("tenant_camera_db").some((item) => item.code === "PARTNER"), true, "core state must survive service restart");
  const restoredProfile = restoredCore.getProfile("tenant_camera_db");
  const restoredContext = { profile: restoredProfile, category: restoredCore.listCategories().find((item) => item.code === restoredProfile.categoryCode), settings: restoredCore.getBusinessSettings("tenant_camera_db"), groups: restoredCore.listItemGroups("tenant_camera_db"), couponTemplates: restoredCore.listCouponTemplates("tenant_camera_db") };
  assert.equal(restoredBusiness.listPricingPlans("tenant_camera_db", restoredContext)[0].categoryCode, "camera", "business state must survive service restart");
  console.log("Rental state persistence test passed: tenant category, core aggregate and business aggregate survive restart.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
