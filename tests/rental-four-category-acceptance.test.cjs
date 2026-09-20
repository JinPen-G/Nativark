const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const {
  RENTAL_CATEGORY_DEFINITIONS,
  RENTAL_LOCATION_TYPES
} = require("@rental-os/shared");
const {
  createAbsorbingConfigStore,
  createAbsorbingFactStore,
  createAbsorbingBusinessConfigStore,
  createAbsorbingBusinessFactStore
} = require("./helpers/absorbing-config-store.cjs");

const cases = [
  { categoryCode: "camera", workspaceId: "ws_accept_camera" },
  { categoryCode: "camping", workspaceId: "ws_accept_camping" },
  { categoryCode: "vehicle", workspaceId: "ws_accept_vehicle" },
  { categoryCode: "construction", workspaceId: "ws_accept_construction" }
];
const tenantId = "tenant_001";

function context(core) {
  const profile = core.getProfile(tenantId);
  return {
    profile,
    category: RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    locations: core.listLocations(tenantId),
    operators: core.listOperators(tenantId)
  };
}

void (async () => {
  const startAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const endAt = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString();

  for (const item of cases) {
    const coreConfig = createAbsorbingConfigStore();
    coreConfig.listWorkspaces = () => Promise.resolve([{
      id: item.workspaceId,
      tenantId,
      categoryCode: item.categoryCode,
      isDefault: true
    }]);
    const core = new RentalCoreService(coreConfig, createAbsorbingFactStore());
    const business = new RentalBusinessService(
      createAbsorbingBusinessConfigStore(),
      createAbsorbingBusinessFactStore(),
      coreConfig
    );
    await core.onApplicationBootstrap();
    await business.onApplicationBootstrap();
    const ctx = context(core);
    const definition = ctx.category;
    const itemGroups = ctx.groups;
    const pricingGroups = core.listPricingGroups(tenantId);
    const locations = ctx.locations;
    const pricingPlans = business.listPricingPlans(tenantId, ctx);

    assert.equal(ctx.profile.categoryCode, item.categoryCode, `${item.categoryCode}: 空间必须绑定正确品类`);
    assert.ok(itemGroups.length > 0, `${item.categoryCode}: 必须能维护商品型号`);
    assert.ok(pricingGroups.length > 0, `${item.categoryCode}: 必须有独立定价分组`);
    assert.ok(
      pricingGroups.every((group) => group.memberItemGroupIds.length > 0),
      `${item.categoryCode}: 定价分组必须明确包含商品型号`
    );
    assert.ok(locations.length > 0, `${item.categoryCode}: 必须能维护履约地点`);
    assert.ok(
      locations.every((location) => definition.businessModel.locationTypes.includes(location.type) && RENTAL_LOCATION_TYPES.includes(location.type)),
      `${item.categoryCode}: 地点类型必须同时符合品类定义和共享契约`
    );
    assert.ok(pricingPlans.length > 0, `${item.categoryCode}: 必须能读取基础价格版本`);
    assert.ok(
      pricingPlans.flatMap((plan) => plan.rates).every((rate) => definition.businessModel.pricingUnits.includes(rate.unit)),
      `${item.categoryCode}: 所有费率单位必须属于当前品类`
    );

    const mode = ctx.settings.fulfillment.enabledModes[0];
    assert.ok(definition.businessModel.fulfillmentModes.includes(mode), `${item.categoryCode}: 默认履约方式必须受品类支持`);
    const quote = await business.createQuote(tenantId, ctx, {
      customerType: "personal",
      fulfillmentMode: mode,
      fulfillmentLocationId: locations[0].id,
      startAt,
      endAt,
      lines: [{ itemGroupId: itemGroups[0].id, quantity: 1 }]
    });
    assert.ok(quote.rentalAmount > 0, `${item.categoryCode}: 相同报价链必须算出正租金`);
    assert.equal(quote.categoryCode, item.categoryCode, `${item.categoryCode}: 报价快照不得串品类`);
    assert.equal(quote.request.lines[0].itemGroupId, itemGroups[0].id, `${item.categoryCode}: 报价必须引用本空间商品`);

    const rule = business.currentRule(tenantId, ctx).config;
    assert.equal(
      rule.qualification.required,
      definition.businessModel.supportsQualificationReview,
      `${item.categoryCode}: 资质门禁必须由品类定义驱动`
    );
    assert.ok(definition.businessModel.defaults.inspectionFields.length > 0, `${item.categoryCode}: 必须有领取/归还检查模板`);
  }

  const vehicle = RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === "vehicle");
  assert.equal(vehicle.terminology.navigationLabels.pricingGroups, "车辆定价分组");
  assert.ok(vehicle.businessModel.fulfillmentModes.includes("delivery"), "车辆空间必须与其他品类一样支持配置配送取还");
  assert.equal(vehicle.businessModel.defaults.fulfillment.allowDifferentReturnLocation, true, "车辆空间默认支持异地归还规则");

  console.log("Four-category Rental Core acceptance passed: catalog, pricing groups, locations, pricing, quote and rule contracts.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
