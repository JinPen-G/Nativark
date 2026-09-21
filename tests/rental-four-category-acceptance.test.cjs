const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const {
  RENTAL_CATEGORY_DEFINITIONS,
  RENTAL_FULFILLMENT_MODES,
  RENTAL_LOCATION_TYPES,
  RENTAL_PRICING_UNIT_CODES,
  RentalInventoryMode
} = require("@rental-os/shared");
const {
  createAbsorbingConfigStore,
  createAbsorbingFactStore,
  createAbsorbingBusinessConfigStore,
  createAbsorbingBusinessFactStore
} = require("./helpers/absorbing-config-store.cjs");

const cases = [
  {
    categoryCode: "camera", workspaceId: "ws_accept_camera",
    pricingUnits: ["hour", "day_24h", "calendar_day", "week"],
    inventoryModes: ["serialized", "quantity", "bundle"],
    fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "locker_pickup_return", "delivery"],
    locationTypes: ["store", "warehouse", "locker", "delivery_hub"],
    supportsUsagePricing: false, supportsPreauthorization: true, supportsQualificationReview: false
  },
  {
    categoryCode: "camping", workspaceId: "ws_accept_camping",
    pricingUnits: ["calendar_day", "night", "week"],
    inventoryModes: ["serialized", "quantity", "consumable", "bundle"],
    fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "warehouse_pickup_return", "delivery"],
    locationTypes: ["store", "warehouse", "delivery_hub"],
    supportsUsagePricing: false, supportsPreauthorization: false, supportsQualificationReview: false
  },
  {
    categoryCode: "vehicle", workspaceId: "ws_accept_vehicle",
    pricingUnits: ["hour", "day_24h", "calendar_day", "week", "month", "usage"],
    inventoryModes: ["serialized"],
    fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "delivery"],
    locationTypes: ["store", "station", "warehouse", "delivery_hub"],
    supportsUsagePricing: true, supportsPreauthorization: true, supportsQualificationReview: true
  },
  {
    categoryCode: "construction", workspaceId: "ws_accept_construction",
    pricingUnits: ["hour", "shift", "calendar_day", "week", "month", "usage"],
    inventoryModes: ["serialized", "quantity", "bundle"],
    fulfillmentModes: ["warehouse_pickup_return", "delivery", "onsite_delivery", "partner_pickup_return"],
    locationTypes: ["warehouse", "delivery_hub", "project_site"],
    supportsUsagePricing: true, supportsPreauthorization: true, supportsQualificationReview: true
  }
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
    // 模拟升级前已经落库的宽口径设置。读取路径必须按当前品类重新收敛，
    // 否则即使新定义改对了，老空间页面仍会继续显示旧的全量选项。
    const rawState = core.state(tenantId);
    rawState.businessSettings.pricing.enabledUnits = [...RENTAL_PRICING_UNIT_CODES];
    rawState.businessSettings.pricing.defaultUnit = "package";
    rawState.businessSettings.fulfillment.enabledModes = [...RENTAL_FULFILLMENT_MODES];
    const ctx = context(core);
    const definition = ctx.category;
    const itemGroups = ctx.groups;
    const pricingGroups = core.listPricingGroups(tenantId);
    const locations = ctx.locations;
    const pricingPlans = business.listPricingPlans(tenantId, ctx);

    assert.equal(ctx.profile.categoryCode, item.categoryCode, `${item.categoryCode}: 空间必须绑定正确品类`);
    assert.deepEqual(definition.businessModel.pricingUnits, item.pricingUnits, `${item.categoryCode}: 计价单位必须符合品类基线`);
    assert.deepEqual(definition.supportedInventoryModes, item.inventoryModes, `${item.categoryCode}: 库存形态必须符合品类基线`);
    assert.deepEqual(definition.businessModel.fulfillmentModes, item.fulfillmentModes, `${item.categoryCode}: 履约方式必须符合品类基线`);
    assert.deepEqual(definition.businessModel.locationTypes, item.locationTypes, `${item.categoryCode}: 地点类型必须符合品类基线`);
    assert.equal(definition.businessModel.supportsUsagePricing, item.supportsUsagePricing, `${item.categoryCode}: 使用量计价开关必须符合品类基线`);
    assert.equal(definition.businessModel.supportsPreauthorization, item.supportsPreauthorization, `${item.categoryCode}: 预授权能力必须符合品类基线`);
    assert.equal(definition.businessModel.supportsQualificationReview, item.supportsQualificationReview, `${item.categoryCode}: 资质审核能力必须符合品类基线`);
    assert.equal(definition.businessModel.pricingUnits.includes("package"), false, `${item.categoryCode}: 套装库存不能误作整包计价单位`);
    assert.equal(definition.businessModel.pricingUnits.includes("usage"), definition.businessModel.supportsUsagePricing, `${item.categoryCode}: 使用量计价声明必须自洽`);
    assert.deepEqual(ctx.settings.pricing.enabledUnits, item.pricingUnits, `${item.categoryCode}: 存量经营设置必须剔除不适用计价单位`);
    assert.equal(ctx.settings.pricing.defaultUnit, definition.businessModel.defaultPricingUnit, `${item.categoryCode}: 已失效默认单位必须回落到品类默认值`);
    assert.deepEqual(ctx.settings.fulfillment.enabledModes, item.fulfillmentModes, `${item.categoryCode}: 存量经营设置必须剔除不适用履约方式`);
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

    const unsupportedUnit = RENTAL_PRICING_UNIT_CODES.find((unit) => !item.pricingUnits.includes(unit));
    await assert.rejects(
      () => core.saveBusinessSettings(tenantId, {
        ...ctx.settings,
        pricing: { ...ctx.settings.pricing, enabledUnits: [...ctx.settings.pricing.enabledUnits, unsupportedUnit] }
      }, "category-acceptance"),
      /不支持的计价单位/u,
      `${item.categoryCode}: 服务端必须拒绝绕过页面写入不适用计价单位`
    );
    await assert.rejects(
      () => core.savePricingGroup(tenantId, {
        ...pricingGroups[0],
        memberItemGroupIds: pricingGroups[0].memberItemGroupIds,
        defaultPricingUnit: unsupportedUnit
      }),
      /已启用的计价单位/u,
      `${item.categoryCode}: 定价分组不得绕过品类设置选择不适用单位`
    );

    const unsupportedMode = RENTAL_FULFILLMENT_MODES.find((mode) => !item.fulfillmentModes.includes(mode));
    await assert.rejects(
      () => core.saveBusinessSettings(tenantId, {
        ...ctx.settings,
        fulfillment: { enabledModes: [...ctx.settings.fulfillment.enabledModes, unsupportedMode] }
      }, "category-acceptance"),
      /不支持的履约方式/u,
      `${item.categoryCode}: 服务端必须拒绝绕过页面写入不适用履约方式`
    );

    const unsupportedLocation = RENTAL_LOCATION_TYPES.find((type) => !item.locationTypes.includes(type));
    await assert.rejects(
      () => core.saveLocation(tenantId, {
        code: `INVALID-${item.categoryCode}`, name: "不适用品类地点", type: unsupportedLocation,
        operatorId: ctx.operators[0].id, capabilities: ["pickup"]
      }),
      /不支持该履约地点类型/u,
      `${item.categoryCode}: 服务端必须拒绝不适用地点类型`
    );

    const unsupportedInventoryMode = Object.values(RentalInventoryMode).find((mode) => !item.inventoryModes.includes(mode));
    await assert.rejects(
      () => core.saveItemGroup(tenantId, {
        code: `INVALID-${item.categoryCode}`, name: "不适用品类库存", inventoryMode: unsupportedInventoryMode
      }),
      /不支持该库存模式/u,
      `${item.categoryCode}: 服务端必须拒绝不适用库存形态`
    );
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
