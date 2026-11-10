const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { target: "es2022", lib: ["es2022", "dom"], module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
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
    fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "locker_pickup_return", "delivery", "carrier_shipping"],
    locationTypes: ["store", "warehouse", "locker", "delivery_hub"],
    deliveryDestination: "customer_address",
    supportsUsagePricing: false, supportsPreauthorization: true, supportsQualificationReview: false
  },
  {
    categoryCode: "camping", workspaceId: "ws_accept_camping",
    pricingUnits: ["calendar_day", "night", "week"],
    inventoryModes: ["serialized", "quantity", "consumable", "bundle"],
    fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "warehouse_pickup_return", "delivery", "carrier_shipping"],
    locationTypes: ["store", "warehouse", "delivery_hub"],
    deliveryDestination: "customer_address",
    supportsUsagePricing: false, supportsPreauthorization: false, supportsQualificationReview: false
  },
  {
    categoryCode: "vehicle", workspaceId: "ws_accept_vehicle",
    pricingUnits: ["hour", "day_24h", "calendar_day", "week", "month", "usage"],
    inventoryModes: ["serialized"],
    fulfillmentModes: ["store_pickup_return", "partner_pickup_return", "delivery"],
    locationTypes: ["store", "station", "warehouse", "delivery_hub"],
    deliveryDestination: "tenant_location",
    supportsUsagePricing: true, supportsPreauthorization: true, supportsQualificationReview: true
  },
  {
    categoryCode: "construction", workspaceId: "ws_accept_construction",
    pricingUnits: ["hour", "shift", "calendar_day", "week", "month", "usage"],
    inventoryModes: ["serialized", "quantity", "bundle"],
    fulfillmentModes: ["warehouse_pickup_return", "delivery", "onsite_delivery", "partner_pickup_return"],
    locationTypes: ["warehouse", "delivery_hub", "project_site"],
    deliveryDestination: "customer_address",
    supportsUsagePricing: true, supportsPreauthorization: true, supportsQualificationReview: true
  }
];
const tenantId = "tenant_001";

async function context(core) {
  const profile = await core.getProfile(tenantId);
  return {
    profile,
    category: RENTAL_CATEGORY_DEFINITIONS.find((item) => item.code === profile.categoryCode),
    settings: await core.getBusinessSettings(tenantId),
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
    // 读取真实 Core 初始化检查模板；仍不模拟事实仓储或事务。
    coreConfig.listInspectionTemplates = () => core.listInspectionTemplates(tenantId);
    // 模拟升级前已经落库的宽口径设置。读取路径必须按当前品类重新收敛，
    // 否则即使新定义改对了，老空间页面仍会继续显示旧的全量选项。
    const rawState = core.state(tenantId);
    rawState.businessSettings.pricing.enabledUnits = [...RENTAL_PRICING_UNIT_CODES];
    rawState.businessSettings.pricing.defaultUnit = "package";
    rawState.businessSettings.fulfillment.enabledModes = [...RENTAL_FULFILLMENT_MODES];
    const ctx = await context(core);
    require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenantId, item.workspaceId, ctx);
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
    assert.equal(definition.businessModel.deliveryDestination, item.deliveryDestination, `${item.categoryCode}: 配送目的地策略必须符合品类基线`);
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
    const quoteInput = {
      customerType: "personal",
      fulfillmentMode: mode,
      fulfillmentLocationId: locations[0].id,
      startAt,
      endAt,
      lines: [{ itemGroupId: itemGroups[0].id, quantity: 1 }]
    };
    let quote = await business.createQuote(tenantId, ctx, quoteInput);
    const promotedQuote = quote.discountAmount > 0 ? structuredClone(quote) : undefined;
    if (promotedQuote) {
      // Keep the original promoted quote for the unsupported segmented-discount case.
      // Produce a separate ordinary quote through configuration + Core; never erase a saved discount.
      for (const plan of business.listDiscountPlans(tenantId, ctx).filter(row => row.status === "enabled")) {
        await business.saveDiscountPlan(tenantId, ctx, { ...plan, status: "disabled", changeReason: "无优惠价格来源矩阵夹具" });
      }
      quote = await business.createQuote(tenantId, ctx, quoteInput);
      assert.equal(quote.discountAmount, 0, "普通价格矩阵使用另行报价，保留原优惠报价");
    }
    assert.ok(quote.rentalAmount > 0, `${item.categoryCode}: 相同报价链必须算出正租金`);
    assert.equal(quote.categoryCode, item.categoryCode, `${item.categoryCode}: 报价快照不得串品类`);
    assert.equal(quote.request.lines[0].itemGroupId, itemGroups[0].id, `${item.categoryCode}: 报价必须引用本空间商品`);

    business.factStore.findQuote = async (tenant, id) => {
      const source = [quote, promotedQuote].find(row => row?.id === id);
      return tenant === tenantId && source ? structuredClone(source) : undefined;
    };
    // 服务级矩阵：四品类均使用同一续租入口，并各自保留原单位与执行依据。
    // 这里只验试算契约，不把替身仓储当作库存冲突/真实订单状态验收。
    const newEndAt = new Date(Date.parse(endAt) + 24 * 60 * 60 * 1000).toISOString();
    const renewalArgs = {
      order: { id: `renewal_${item.categoryCode}`, quoteId: quote.id, startAt, endAt,
        depositAmount: quote.depositAmount, preAuthAmount: quote.preAuthAmount },
      lines: quote.request.lines.map((line) => ({ itemGroupId: line.itemGroupId,
        pricingGroupId: line.pricingGroupId, quantity: line.quantity })),
      newEndAt, appliedAt: new Date(Date.parse(startAt) + 3600000).toISOString(),
      settlementMode: "immediate", fulfillmentMode: mode, locationIds: [locations[0].id], customerType: "personal"
    };
    for (const pricingMode of ["original_total", "incremental"]) {
      // 显式构造两种原订单规则快照，不能因某品类默认值只验证一种续租口径。
      quote.ruleSnapshot.extension = { enabled: true, forceImmediateWhenOverdue: true, pricingMode };
      const frozenQuote = structuredClone(quote);
      const renewed = await business.quoteOrderExtension(tenantId, ctx, renewalArgs);
      assert.equal(renewed.originalEndAt, endAt);
      assert.equal(renewed.newEndAt, newEndAt);
      assert.ok(renewed.rentalAmount > 0, `${item.categoryCode}/${pricingMode}: 新增一天应有租金`);
      assert.equal(renewed.executionBasis.pricingMode, pricingMode);
      assert.equal(renewed.executionBasis.categoryCode, item.categoryCode);
      assert.equal(renewed.executionBasis.policySource, pricingMode === "original_total" ? "original_quote" : "current_workspace");
      assert.ok(renewed.executionBasis.pricingStrategies.length > 0);
      assert.deepEqual(renewed.rateSnapshot.map((row) => row.unit), quote.rateSnapshot.map((row) => row.unit),
        `${item.categoryCode}/${pricingMode}: 续租不能静默切换原计价单位`);
      assert.ok(renewed.depositDelta >= 0 && renewed.preAuthDelta >= 0);
      if (pricingMode === "original_total") {
        assert.equal(renewed.pricingSnapshot.method, "original_version_difference");
        assert.equal(renewed.ruleVersion, quote.ruleVersion);
        assert.deepEqual(renewed.rateSnapshot, quote.rateSnapshot);
        assert.equal(renewed.rentalAmount, renewed.pricingSnapshot.recalculatedRentalAmount - quote.rentalAmount);
      }
      assert.deepEqual(quote, frozenQuote, `${item.categoryCode}/${pricingMode}: 试算不能改写原报价`);
      await assert.rejects(() => business.quoteOrderExtension(tenantId, ctx, { ...renewalArgs, newEndAt: endAt }),
        /新的归还时间必须晚于当前归还时间/u);
      console.log(`PASS four-category renewal ${item.categoryCode}/${pricingMode}: units, execution basis, immutable quote, end boundary`);
    }

    // 独立目标型号和价格，避免两种价格来源碰巧同价而造成假阳性。
    const originalLine = quote.request.lines[0];
    const originalTarget = originalLine.pricingGroupId ?? originalLine.itemGroupId;
    const originalRate = quote.rateSnapshot.find((row) =>
      (row.pricingGroupId ?? row.itemGroupId) === originalTarget &&
      (!originalLine.pricingUnit || row.unit === originalLine.pricingUnit));
    assert.ok(originalRate);
    const replacement = await core.saveItemGroup(tenantId, {
      code: `EXCHANGE-${item.categoryCode}`, name: "专项换货目标",
      inventoryMode: itemGroups[0].inventoryMode,
      attributes: { ...itemGroups[0].attributes, model: `Exchange-${item.categoryCode}` }
    });
    const exchangeContext = { ...ctx, groups: core.listItemGroups(tenantId), pricingGroups };
    const replacementPlan = await business.savePricingPlan(tenantId, exchangeContext, {
      code: `EXCHANGE-PRICE-${item.categoryCode}`, name: "专项换货现价", status: "enabled",
      effectiveFrom: new Date().toISOString(), changeReason: "四品类换货价格来源验收",
      rates: [{ ...originalRate, itemGroupId: replacement.id, pricingGroupId: undefined,
        baseAmount: originalRate.baseAmount * 3, tiers: [], maxAmount: undefined }]
    });
    const order = { ...renewalArgs.order, serviceSnapshots: [], lines: [{
      id: `exchange-line-${item.categoryCode}`, itemGroupId: itemGroups[0].id,
      itemGroupCode: itemGroups[0].code, itemGroupName: itemGroups[0].name,
      pricingGroupId: originalLine.pricingGroupId, quantity: 1,
      inventoryMode: itemGroups[0].inventoryMode, amount: quote.rentalAmount, unitPrice: originalRate.baseAmount
    }] };
    const exchangeArgs = { order, previousExtensions: [], orderLineId: order.lines[0].id,
      replacementItemGroupId: replacement.id, appliedAt: renewalArgs.appliedAt,
      fulfillmentMode: mode, locationIds: [locations[0].id], customerType: "personal" };
    const frozenExchangeQuote = structuredClone(quote);
    const frozenOrder = structuredClone(order);
    // The absorbing store has legacy plans, not published price-version rows.
    // First assert that this absence is rejected; then supply an explicit immutable
    // price-reader fixture to exercise the pricing/basis matrix. This is not DB publication evidence.
    await assert.rejects(business.quotePostPickupExchange(tenantId, exchangeContext,
      { ...exchangeArgs, priceBasis: "replacement_current_price" }), /缺少已发布价格版本/u);
    const currentRates = await business.resolveSpaceRates(tenantId, exchangeContext, exchangeArgs.appliedAt);
    const priceReaderFixture = { versionId: `fixture-published-${item.categoryCode}`, version: "2", rates: structuredClone(currentRates.rates) };
    business.resolveSpaceRates = async () => structuredClone(priceReaderFixture);
    if (promotedQuote) {
      const frozenPromotion = structuredClone(promotedQuote);
      await assert.rejects(business.quotePostPickupExchange(tenantId, exchangeContext,
        { ...exchangeArgs, order: { ...order, quoteId: promotedQuote.id }, priceBasis: "replacement_current_price" }), /原优惠的已用与剩余逐段分摊尚不可核实/u);
      assert.deepEqual(promotedQuote, frozenPromotion, "不能为通过现价换货而抹除旧报价优惠");
    }
    for (const priceBasis of ["original_order_price", "replacement_current_price"]) {
      const exchanged = await business.quotePostPickupExchange(tenantId, exchangeContext, { ...exchangeArgs, priceBasis });
      assert.equal(exchanged.originalTarget, originalTarget);
      assert.equal(exchanged.target, replacement.id);
      assert.equal(exchanged.replacementGroup.id, replacement.id);
      assert.equal(exchanged.priced.newEndAt, endAt);
      assert.equal(exchanged.priced.ruleVersion, quote.ruleVersion);
      assert.equal(exchanged.priced.rateSnapshot[0].unit, originalRate.unit);
      assert.equal(exchanged.priced.rateSnapshot[0].baseAmount,
        priceBasis === "original_order_price" ? originalRate.baseAmount : replacementPlan.rates[0].baseAmount);
      assert.equal(Boolean(exchanged.currentVersion), priceBasis === "replacement_current_price");
      if (exchanged.currentVersion) assert.equal(exchanged.currentVersion.versionId, priceReaderFixture.versionId,
        "现价换货保留实际读取的价格版本来源，不能冒充原报价来源");
      assert.ok(Number.isFinite(exchanged.priced.pricingSnapshot.recalculatedPayableAmount));
      assert.ok(exchanged.replacementAmount > 0);
      assert.equal(exchanged.originalAmount, quote.rentalAmount);
      if (priceBasis === "original_order_price") {
        assert.equal(exchanged.replacementAmount, exchanged.originalAmount, "原价换货应保留该行全租期租金");
      } else {
        assert.ok(exchanged.replacementAmount > exchanged.originalAmount, "三倍目标现价必须反映在换货重算租金中");
      }
      const basis = await business.captureExchangeExecutionBasis(tenantId, exchangeContext,
        priceBasis, exchangeArgs.appliedAt, exchanged.priced);
      assert.equal(basis.categoryCode, item.categoryCode);
      assert.equal(basis.priceBasis, priceBasis);
      assert.equal(basis.effectiveFrom, exchangeArgs.appliedAt);
      assert.deepEqual(basis.rateSnapshot, exchanged.priced.rateSnapshot);
      assert.ok(basis.inspectionTemplateSnapshots.length > 0);
      // 操作执行依据独立冻结，不能与可变试算对象共享引用。
      const frozenBasis = structuredClone(basis);
      exchanged.priced.rateSnapshot[0].baseAmount += 1;
      assert.deepEqual(basis, frozenBasis);
      assert.deepEqual(quote, frozenExchangeQuote, "换货试算不得改写原报价");
      assert.deepEqual(order, frozenOrder, "换货试算不得提前改写订单行");
      console.log(`PASS four-category exchange ${item.categoryCode}/${priceBasis}: target, rate source, immutable quote and order`);
    }
    await assert.rejects(() => business.quotePostPickupExchange(tenantId, exchangeContext,
      { ...exchangeArgs, priceBasis: "original_order_price", replacementItemGroupId: itemGroups[0].id }), /不能与原商品相同/u);
    await assert.rejects(() => business.quotePostPickupExchange(tenantId, exchangeContext,
      { ...exchangeArgs, priceBasis: "original_order_price", orderLineId: "missing-line" }), /换货订单行不存在/u);
    // This timestamp precedes the rental itself. The period gate must reject it;
    // absent published-price provenance is tested separately above at a valid rental time.
    await assert.rejects(() => business.quotePostPickupExchange(tenantId, exchangeContext,
      { ...exchangeArgs, priceBasis: "replacement_current_price",
        appliedAt: new Date(Date.parse(replacementPlan.effectiveFrom) - 1000).toISOString() }), /必须在实际租期内/u);
    await assert.rejects(() => business.quotePostPickupExchange(tenantId,
      { ...exchangeContext, groups: exchangeContext.groups.map((group) => group.id === replacement.id
        ? { ...group, inventoryMode: group.inventoryMode === "serialized" ? "quantity" : "serialized" } : group) },
      { ...exchangeArgs, priceBasis: "original_order_price" }), /库存方式必须一致/u);

    // 非配送/自取履约不接受收货地址：带了必须报错（core 统一校验，两端与后台一致）。
    await assert.rejects(
      () => business.createQuote(tenantId, ctx, {
        customerType: "personal",
        fulfillmentMode: mode,
        fulfillmentLocationId: locations[0].id,
        deliveryAddressId: "addr_should_be_rejected",
        startAt,
        endAt,
        lines: [{ itemGroupId: itemGroups[0].id, quantity: 1 }]
      }),
      /当前履约方式不接受收货地址/u,
      `${item.categoryCode}: 非配送履约不接受收货地址`
    );

    const deliveryLocation = locations.find((location) =>
      location.status === "enabled" && location.capabilities.includes("delivery")
    );
    assert.ok(deliveryLocation, `${item.categoryCode}: 配送方式必须存在可用地点`);
    const deliveryInput = {
      customerType: "personal",
      fulfillmentMode: "delivery",
      fulfillmentLocationId: deliveryLocation.id,
      startAt,
      endAt,
      lines: [{ itemGroupId: itemGroups[0].id, quantity: 1 }]
    };
    if (item.deliveryDestination === "customer_address") {
      const draft = {
        recipient: "测试收件人",
        phone: "+86 13800008000",
        countryCode: "CN",
        province: "上海市",
        city: "上海市",
        district: "徐汇区",
        detail: "测试路 8 号"
      };
      const deliveryQuote = await business.createQuote(tenantId, ctx, {
        ...deliveryInput,
        deliveryAddressDraft: draft
      });
      draft.detail = "地址簿变更后的新地址";
      assert.equal(deliveryQuote.deliveryAddressSnapshot.recipient, "测试收件人");
      assert.equal(deliveryQuote.deliveryAddressSnapshot.phone, "+86 13800008000");
      assert.notEqual(deliveryQuote.deliveryAddressSnapshot.phoneMasked, "+86 13800008000");
      assert.equal(deliveryQuote.deliveryAddressSnapshot.detail, "测试路 8 号", "报价地址快照不得跟随输入对象或地址簿后续修改");
      await assert.rejects(
        () => business.createQuote(tenantId, ctx, deliveryInput),
        /配送订单必须选择已保存地址或填写本单收货地址/u,
        `${item.categoryCode}: 客户地址型配送必须提供收货地址`
      );
    } else {
      const deliveryQuote = await business.createQuote(tenantId, ctx, deliveryInput);
      assert.equal(deliveryQuote.deliveryAddressSnapshot, undefined, "车辆送车到租户据点不应虚构客户收货地址");
      await assert.rejects(
        () => business.createQuote(tenantId, ctx, {
          ...deliveryInput,
          deliveryAddressDraft: {
            recipient: "不应使用",
            phone: "13800008000",
            province: "上海",
            city: "上海",
            detail: "不应使用"
          }
        }),
        /当前履约方式不接受收货地址/u,
        "车辆地点交付不得被误解成客户地址配送"
      );
    }

    const rule = business.currentRule(tenantId, ctx).config;
    assert.equal(
      rule.qualification.required,
      definition.businessModel.supportsQualificationReview,
      `${item.categoryCode}: 资质门禁必须由品类定义驱动`
    );
    const qualificationDraft = await business.saveRuleVersion(tenantId, ctx, {
      config: {
        ...structuredClone(rule),
        qualification: { required: false, documentTypes: ["不适用证件"], minimumValidityDays: 30 }
      },
      changeReason: "四品类资质适用性验收"
    }, "category-acceptance");
    if (item.supportsQualificationReview) {
      assert.deepEqual(
        qualificationDraft.config.qualification,
        { required: false, documentTypes: ["不适用证件"], minimumValidityDays: 30 },
        `${item.categoryCode}: 支持资质审核的品类应保留资质规则配置`
      );
    } else {
      assert.deepEqual(
        qualificationDraft.config.qualification,
        { required: false, documentTypes: [], minimumValidityDays: 0 },
        `${item.categoryCode}: 不支持资质审核的品类不得保存无效资质字段`
      );
      await assert.rejects(
        () => business.saveRuleVersion(tenantId, ctx, {
          config: {
            ...structuredClone(rule),
            qualification: { required: true, documentTypes: ["不适用证件"], minimumValidityDays: 30 }
          },
          changeReason: "不支持品类不应启用资质门槛"
        }, "category-acceptance"),
        /当前品类不支持资质审核/u,
        `${item.categoryCode}: API 必须拒绝为不支持的品类启用订单资质门槛`
      );
    }
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
