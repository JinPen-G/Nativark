const assert = require("node:assert/strict");

require("ts-node").register({
  transpileOnly: false,
  compilerOptions: { module: "commonjs", moduleResolution: "node", experimentalDecorators: true, emitDecoratorMetadata: true }
});

const { RentalCoreService } = require("../apps/api/src/modules/rental-core/rental-core.service");
const { RentalBusinessService } = require("../apps/api/src/modules/rental-core/rental-business.service");
const { RentalInventoryMode } = require("@rental-os/shared");
const stores = require("./helpers/absorbing-config-store.cjs");

(async () => {
  const tenantId = "tenant_002";
  const core = new RentalCoreService(stores.createAbsorbingConfigStore(), stores.createAbsorbingFactStore());
  const business = new RentalBusinessService(
    stores.createAbsorbingBusinessConfigStore(),
    stores.createAbsorbingBusinessFactStore(),
    stores.createAbsorbingConfigStore()
  );
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();
  const profile = await core.getProfile(tenantId);
  const context = {
    profile,
    category: core.listCategories().find((item) => item.code === profile.categoryCode),
    settings: await core.getBusinessSettings(tenantId),
    groups: core.listItemGroups(tenantId),
    pricingGroups: core.listPricingGroups(tenantId),
    locations: core.listLocations(tenantId),
    couponTemplates: core.listCouponTemplates(tenantId),
    operators: core.listOperators(tenantId)
  };
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenantId, 'ws_tenant_002', context);
  // 原报价要求有界的当前库存对象来源；本用例明确提供配置fixture，不模拟持久化。
  business.coreConfigStore.listItemGroupsPage = async (tenant, workspace, query) => {
    assert.equal(tenant, tenantId);
    assert.equal(workspace, 'ws_tenant_002');
    assert.equal(query.limit, 1);
    return {
      rows: structuredClone(context.groups.filter(row => row.id === query.itemGroupId)),
      nextCursor: null,
      truncated: false,
      configurationVersion: 'fixture-current-configuration',
      source: 'persisted_workspace_configuration'
    };
  };
  const groups = context.groups.filter((item) => item.status === "enabled" && item.inventoryMode === RentalInventoryMode.Quantity);
  const location = context.locations.find((item) => item.status === "enabled");
  assert.ok(groups.length >= 2 && location, "需要两个数量库存商品和一个启用地点");
  const startAt = new Date(Date.now() + 3 * 86400000).toISOString();
  const endAt = new Date(Date.parse(startAt) + 2 * 86400000).toISOString();
  const originalQuote = await business.createQuote(tenantId, context, {
    customerType: "personal",
    customerName: "取货后换货专项",
    fulfillmentMode: "store_pickup_return",
    fulfillmentLocationId: location.id,
    startAt,
    endAt,
    lines: [{ itemGroupId: groups[0].id, quantity: 1 }]
  });
  business.getQuote = () => originalQuote;
  business.factStore.findQuote = async (tenant, id) => tenant === tenantId && id === originalQuote.id ? structuredClone(originalQuote) : undefined;
  const requestLine = originalQuote.request.lines[0];
  const originalRate = originalQuote.rateSnapshot.find((row) => row.itemGroupId === groups[0].id || row.pricingGroupId === requestLine.pricingGroupId);
  assert.ok(originalRate, "原订单必须有价格快照");
  const order = {
    id: "exchange-quote-order",
    quoteId: originalQuote.id,
    startAt,
    endAt,
    effectiveEndAt: undefined,
    depositAmount: originalQuote.depositAmount,
    preAuthAmount: originalQuote.preAuthAmount,
    serviceSnapshots: [],
    lines: [{
      id: "exchange-line-1",
      itemGroupId: groups[0].id,
      itemGroupCode: groups[0].code,
      itemGroupName: groups[0].name,
      pricingGroupId: requestLine.pricingGroupId,
      quantity: 1,
      inventoryMode: RentalInventoryMode.Quantity,
      amount: originalQuote.rentalAmount,
      unitPrice: originalRate.baseAmount
    }]
  };
  const exchangeTransaction = Object.freeze({});
  business.configStore.readServicesForExchange = async (tenant, workspace, transaction) => {
    assert.equal(tenant, tenantId);
    assert.equal(workspace, 'ws_tenant_002');
    assert.equal(transaction, exchangeTransaction);
    return []; // 本fixture明确没有已配置增值服务，不表示真实数据库事务通过。
  };
  const priced = await business.quotePostPickupExchange(tenantId, context, {
    tx: exchangeTransaction,
    order,
    previousExtensions: [],
    orderLineId: "exchange-line-1",
    replacementItemGroupId: groups[1].id,
    priceBasis: "original_order_price",
    appliedAt: new Date(Date.parse(startAt) + 86400000).toISOString(),
    fulfillmentMode: order.fulfillmentMode ?? "store_pickup_return",
    locationIds: [location.id],
    customerType: "personal"
  });
  assert.equal(priced.originalTarget, requestLine.pricingGroupId ?? groups[0].id);
  assert.equal(priced.target, groups[1].id);
  assert.equal(priced.replacementGroup.id, groups[1].id);
  assert.equal(priced.priced.priceVersion, originalQuote.priceVersion ?? originalQuote.pricingPlanVersion);
  assert.ok(Number.isFinite(priced.priced.pricingSnapshot.recalculatedPayableAmount));
  console.log("PASS 取货后换货按原订单价格重算时，原目标与替换目标不会串价");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
