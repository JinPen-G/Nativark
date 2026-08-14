const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");

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
  const core = new RentalCoreService(repository);
  await core.onModuleInit();
  assert.equal(core.getProfile("tenant_camera_db").categoryCode, "camera", "database tenant profile must initialize the right category");
  core.saveOperator("tenant_camera_db", { code: "PARTNER", name: "摄影合作商", type: "partner", settlementMode: "monthly" });
  await core.persist("tenant_camera_db");

  const business = new RentalBusinessService(repository);
  const context = () => {
    const profile = core.getProfile("tenant_camera_db");
    return { profile, category: core.listCategories().find((item) => item.code === profile.categoryCode), settings: core.getBusinessSettings("tenant_camera_db"), groups: core.listItemGroups("tenant_camera_db"), couponTemplates: core.listCouponTemplates("tenant_camera_db") };
  };
  business.listPricingPlans("tenant_camera_db", context());
  await business.persist("tenant_camera_db");

  const restoredCore = new RentalCoreService(repository);
  const restoredBusiness = new RentalBusinessService(repository);
  await Promise.all([restoredCore.onModuleInit(), restoredBusiness.onModuleInit()]);
  assert.equal(restoredCore.listOperators("tenant_camera_db").some((item) => item.code === "PARTNER"), true, "core state must survive service restart");
  const restoredProfile = restoredCore.getProfile("tenant_camera_db");
  const restoredContext = { profile: restoredProfile, category: restoredCore.listCategories().find((item) => item.code === restoredProfile.categoryCode), settings: restoredCore.getBusinessSettings("tenant_camera_db"), groups: restoredCore.listItemGroups("tenant_camera_db"), couponTemplates: restoredCore.listCouponTemplates("tenant_camera_db") };
  assert.equal(restoredBusiness.listPricingPlans("tenant_camera_db", restoredContext)[0].categoryCode, "camera", "business state must survive service restart");
  console.log("Rental state persistence test passed: tenant category, core aggregate and business aggregate survive restart.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
