const assert = require("node:assert/strict");
require("ts-node").register({ transpileOnly: true, compilerOptions: {
  module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true
} });
const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const stores = require("./helpers/absorbing-config-store.cjs");

(async () => {
  const core = new RentalCoreService(stores.createAbsorbingConfigStore(), stores.createAbsorbingFactStore());
  await core.onApplicationBootstrap();
  const tenantId = "tenant_001", profile = core.getProfile(tenantId);
  const context = { profile, category: core.listCategories().find(row => row.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId), groups: core.listItemGroups(tenantId),
    pricingGroups: core.listPricingGroups(tenantId), locations: core.listLocations(tenantId) };
  for (const method of ["currentRule", "effectiveRuleAt"]) {
    const service = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), stores.createAbsorbingConfigStore());
    await service.onApplicationBootstrap();
    const RealDate = global.Date;
    let clock = RealDate.now();
    // Move time on every implicit clock read, making initialization ordering deterministic.
    global.Date = class extends RealDate {
      constructor(...args) { super(...(args.length ? args : [clock++])); }
    };
    try {
      assert.equal(service[method](tenantId, context).version, "1.0", `${method}: first implicit-now lookup must include newly initialized rules`);
      if (method === "currentRule") assert.throws(() => service[method](tenantId, context, "2000-01-01T00:00:00.000Z"), /没有生效的租赁规则版本/u);
      else assert.equal(service[method](tenantId, context, "2000-01-01T00:00:00.000Z"), undefined);
    } finally { global.Date = RealDate; }
    console.log(`PASS ${method}: initialize before default clock, explicit historical boundary preserved`);
  }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
