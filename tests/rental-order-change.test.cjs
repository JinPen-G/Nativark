const assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { RentalCoreOrderStatus, RentalInventoryMode, RentalReservationStatus } = require('@rental-os/shared');
const stores = require('./helpers/absorbing-config-store.cjs');

let passed = 0;
const pass = label => { passed += 1; console.log('PASS', label); };
const clone = structuredClone;
const tenant = 'tenant_002';

(async () => {
  const facts = stores.createAbsorbingFactStore();
  const releasedServiceReservations = [];
  const partiallyReleasedServiceReservations = [];
  const core = new RentalCoreService(
    stores.createAbsorbingConfigStore(),
    facts,
    undefined,
    undefined,
    undefined,
    {
      releaseForOccurrence: async (...args) => releasedServiceReservations.push(args),
      releaseQuantityForOccurrence: async (...args) => partiallyReleasedServiceReservations.push(args)
    }
  );
  const business = new RentalBusinessService(
    stores.createAbsorbingBusinessConfigStore(),
    stores.createAbsorbingBusinessFactStore(),
    stores.createAbsorbingConfigStore()
  );
  await core.onApplicationBootstrap();
  await business.onApplicationBootstrap();
  const profile = core.getProfile(tenant);
  const ctx = {
    profile,
    category: core.listCategories().find(item => item.code === profile.categoryCode),
    settings: core.getBusinessSettings(tenant),
    groups: core.listItemGroups(tenant),
    pricingGroups: core.listPricingGroups(tenant),
    locations: core.listLocations(tenant),
    couponTemplates: core.listCouponTemplates(tenant),
    operators: core.listOperators(tenant)
  };
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], tenant, 'ws_tenant_002', ctx);
  const groups = ctx.groups.filter(item => item.status === 'enabled' && item.inventoryMode === RentalInventoryMode.Quantity);
  const location = ctx.locations.find(item => item.status === 'enabled');
  assert.ok(groups.length >= 2 && location, '需要至少两个可租商品和一个启用地点');

  const start = new Date(Date.now() + 3 * 86400000).toISOString();
  const end = new Date(Date.parse(start) + 2 * 3600000).toISOString();
  const quote = await business.createQuote(tenant, ctx, {
    customerType: 'personal',
    customerName: '订单变更测试',
    fulfillmentMode: 'store_pickup_return',
    fulfillmentLocationId: location.id,
    startAt: start,
    endAt: end,
    lines: groups.slice(0, 2).map((group, index) => ({ itemGroupId: group.id, quantity: index === 0 ? 2 : 1 }))
  });
  business.getQuote = () => quote;
  business.factStore.findQuote = async (tenantId, id) => tenantId === tenant && id === quote.id ? clone(quote) : undefined;

  const requests = quote.request.lines;
  const orderLines = requests.map((request, index) => ({
    id: `change-line-${index + 1}`,
    itemGroupId: request.itemGroupId,
    pricingGroupId: request.pricingGroupId,
    pricingGroupCode: request.pricingGroupCode,
    pricingGroupName: request.pricingGroupName,
    pricingGroupMemberItemGroupIds: request.pricingGroupMemberItemGroupIds,
    itemGroupCode: groups[index].code,
    itemGroupName: groups[index].name,
    inventoryMode: 'quantity',
    quantity: request.quantity,
    cancelledQuantity: 0,
    unitPrice: quote.rateSnapshot[index].baseAmount,
    amount: quote.rentalLineAmounts?.[request.pricingGroupId ?? request.itemGroupId] ?? quote.rateSnapshot[index].baseAmount,
    note: undefined
  }));
  const cancellationOrder = {
    id: 'order-change-test',
    tenantId: tenant,
    orderNo: 'TEST-CHANGE-001',
    quoteId: quote.id,
    startAt: start,
    endAt: end,
    effectiveEndAt: undefined,
    status: RentalCoreOrderStatus.Reserved,
    customerType: 'personal',
    fulfillmentMode: 'store_pickup_return',
    fulfillmentLocationId: location.id,
    returnLocationId: location.id,
    depositAmount: quote.depositAmount,
    preAuthAmount: quote.preAuthAmount,
    payableAmount: quote.payableAmount,
    adjustmentAmount: 0,
    finalPayableAmount: quote.payableAmount,
    totalAmount: quote.payableAmount,
    taxRate: 0,
    taxAmount: 0,
    currency: quote.currency,
    ruleVersion: quote.ruleVersion,
    ruleSnapshot: clone(quote.ruleSnapshot),
    lines: orderLines,
    chargeLines: clone(quote.chargeLines),
    reservations: orderLines.map((line, index) => ({
      id: `change-reservation-${index + 1}`,
      orderId: 'order-change-test',
      orderLineId: line.id,
      itemGroupId: line.itemGroupId,
      locationId: location.id,
      quantity: line.quantity,
      releasedQuantity: 0,
      status: RentalReservationStatus.Confirmed,
      startAt: start,
      endAt: end,
      createdAt: start
    })),
    allocations: orderLines.map((line, index) => ({
      id: `change-allocation-${index + 1}`,
      orderId: 'order-change-test',
      orderLineId: line.id,
      itemGroupId: line.itemGroupId,
      assetId: undefined,
      assetNo: undefined,
      quantity: line.quantity,
      status: 'locked',
      metadata: { reservationId: `change-reservation-${index + 1}` }
    })),
    serviceSnapshots: [],
    updatedAt: '2026-09-14T00:00:00.000Z',
    createdAt: start,
    createdBy: 'test'
  };

  const priced = await business.quoteOrderLineCancellation(tenant, ctx, {
    order: cancellationOrder,
    lines: [{ ...orderLines[0], quantity: 1 }, orderLines[1]],
    appliedAt: new Date().toISOString(),
    fulfillmentMode: cancellationOrder.fulfillmentMode,
    locationIds: [location.id],
    customerType: 'personal'
  });
  assert.ok(priced.pricingSnapshot.differenceAmount < 0, '取消一条等价商品应产生负差额');
  assert.equal(priced.payableAmount, 0);
  assert.equal(cancellationOrder.lines[0].cancelledQuantity, 0, '试算不能改写订单行');
  pass('部分取消复用原价格与优惠快照，负差额不被转成补款');

  let savedOrder;
  let savedChange;
  let savedAssets;
  facts.lockOrder = async () => undefined;
  facts.findOrder = async () => clone(cancellationOrder);
  facts.listOrderChanges = async () => [];
  facts.listAssets = async () => [{ id: 'asset-1', status: 'reserved' }];
  facts.allocatedAssetIds = async () => new Set();
  facts.saveOrderAggregate = async (order, assetChanges) => { savedOrder = clone(order); savedAssets = clone(assetChanges); };
  facts.insertOrderChange = async change => { savedChange = clone(change); };

  const applied = await core.applyPartialLineCancellation(
    tenant,
    cancellationOrder.id,
    priced,
    {
      type: 'partial_line_cancel',
      items: [{ lineId: orderLines[0].id, quantity: 1 }],
      reason: '客户减少一项商品',
      customerConfirmed: true,
      expectedUpdatedAt: cancellationOrder.updatedAt
    },
    'order-change-test-key',
    '测试操作员',
    {}
  );
  assert.equal(applied.change.status, 'applied');
  assert.equal(savedOrder.lines[0].cancelledQuantity, 1);
  assert.equal(savedOrder.reservations[0].status, RentalReservationStatus.Confirmed);
  assert.equal(savedOrder.reservations[0].releasedQuantity, 1);
  assert.equal(savedOrder.allocations[0].status, 'locked');
  assert.equal(savedOrder.allocations[0].quantity, 1);
  assert.equal(savedAssets.length, 0, '数量库存不应伪造资产状态变更');
  assert.equal(savedChange.diff.items[0].lineId, orderLines[0].id);
  assert.equal(savedChange.diff.items[0].quantity, 1);
  assert.ok(savedChange.refundAmount > 0);
  pass('应用部分取消只追加变更记录，并释放对应预占而不改原始金额');

  cancellationOrder.serviceSnapshots = [{
    serviceId: 'service-change-test', serviceCode: 'CLEANING', serviceName: '清洁服务', serviceType: 'other',
    serviceVersion: '1.0', workspaceId: 'workspace_test', billingUnit: 'per_order', selectionMode: 'optional',
    requiredByRule: false, unitPrice: 100, quantity: 1, billingUnits: 1, amount: 100,
    formula: '100 × 1 × 1', termsVersion: '1.0', terms: '清洁服务条款', eligibility: [],
    insuredDisplayable: false, requiresCapacity: true, scheduledStartAt: start, scheduledEndAt: end,
    serviceLocationId: location.id, capacityQuantity: 1, discountAllocatedAmount: 10, couponAllocatedAmount: 5,
    occurrenceId: 'service-occurrence-change-test', origin: 'order', executionStatus: 'not_started',
    executedQuantity: 0, executionSegments: [], refundStatus: 'none', reservationKey: 'service-reservation-change-test'
  }, {
    serviceId: 'service-quantity-change-test', serviceCode: 'STAFF', serviceName: '现场服务', serviceType: 'other',
    serviceVersion: '1.0', workspaceId: 'workspace_test', billingUnit: 'per_person', selectionMode: 'optional',
    requiredByRule: false, unitPrice: 100, quantity: 3, billingUnits: 1, amount: 300,
    formula: '100 × 3 × 1', termsVersion: '1.0', terms: '现场服务条款', eligibility: [],
    insuredDisplayable: false, requiresCapacity: true, scheduledStartAt: start, scheduledEndAt: end,
    serviceLocationId: location.id, capacityQuantity: 3, discountAllocatedAmount: 30, couponAllocatedAmount: 15,
    occurrenceId: 'service-occurrence-quantity-change-test', origin: 'order', executionStatus: 'not_started',
    executedQuantity: 0, executionSegments: [], refundStatus: 'none', reservationKey: 'service-reservation-quantity-change-test'
  }];
  const partialServicePriced = await business.quoteOrderServiceCancellation(tenant, ctx, {
    order: cancellationOrder,
    serviceItems: [{ occurrenceId: 'service-occurrence-quantity-change-test', quantity: 1 }]
  });
  assert.equal(partialServicePriced.payableAmount, -85, '数量型服务部分取消应按订单快照按比例计算客户净支付');
  const partialServiceApplied = await core.applyPartialLineCancellation(
    tenant,
    cancellationOrder.id,
    partialServicePriced,
    {
      type: 'service_cancel',
      serviceItems: [{ occurrenceId: 'service-occurrence-quantity-change-test', quantity: 1 }],
      reason: '客户减少一份现场服务',
      customerConfirmed: true,
      expectedUpdatedAt: cancellationOrder.updatedAt
    },
    'service-quantity-change-test-key',
    '测试操作员',
    {}
  );
  const partiallyCancelled = savedOrder.serviceSnapshots.find(row => row.occurrenceId === 'service-occurrence-quantity-change-test');
  assert.equal(partialServiceApplied.change.type, 'service_cancel');
  assert.equal(partiallyCancelled.quantity, 2);
  assert.equal(partiallyCancelled.cancelledQuantity, 1);
  assert.equal(partiallyCancelled.amount, 200);
  assert.equal(partiallyCancelled.capacityQuantity, 2);
  assert.equal(partialServiceApplied.change.refundAmount, 85);
  assert.equal(partiallyReleasedServiceReservations.length, 1, '部分取消服务必须只释放本次数量');
  assert.equal(partiallyReleasedServiceReservations[0][2], 'service-reservation-quantity-change-test');
  assert.equal(partiallyReleasedServiceReservations[0][3], 1);
  pass('数量型增值服务可按数量取消，并同步缩减快照与容量预留');

  const servicePriced = await business.quoteOrderServiceCancellation(tenant, ctx, {
    order: cancellationOrder,
    serviceOccurrenceIds: ['service-occurrence-change-test']
  });
  assert.equal(servicePriced.payableAmount, -85, '服务取消应按订单快照扣除优惠后的客户净支付');
  const serviceApplied = await core.applyPartialLineCancellation(
    tenant,
    cancellationOrder.id,
    servicePriced,
    {
      type: 'service_cancel',
      serviceOccurrenceIds: ['service-occurrence-change-test'],
      reason: '客户取消未开始的清洁服务',
      customerConfirmed: true,
      expectedUpdatedAt: cancellationOrder.updatedAt
    },
    'service-change-test-key',
    '测试操作员',
    {}
  );
  assert.equal(serviceApplied.change.type, 'service_cancel');
  const fullyCancelled = savedOrder.serviceSnapshots.find(row => row.occurrenceId === 'service-occurrence-change-test');
  assert.equal(fullyCancelled.executionStatus, 'cancelled');
  assert.equal(fullyCancelled.refundStatus, 'included_in_order_change');
  assert.equal(fullyCancelled.refundAmount, 85);
  assert.equal(serviceApplied.change.refundAmount, 85);
  assert.equal(serviceApplied.change.diff.services[0].refundAmount, 85);
  assert.equal(releasedServiceReservations.length, 1, '取消服务必须释放对应的容量预留');
  assert.equal(releasedServiceReservations[0][2], 'service-reservation-change-test');
  pass('取消未开始增值服务按客户净支付退款，并追加服务变更快照');

  facts.findOrder = async () => clone({ ...cancellationOrder, serviceSnapshots: [] });
  await assert.rejects(
    () => core.applyPartialLineCancellation(tenant, cancellationOrder.id, priced, {
      type: 'partial_line_cancel',
      items: [
        { lineId: orderLines[0].id, quantity: orderLines[0].quantity },
        { lineId: orderLines[1].id, quantity: orderLines[1].quantity }
      ],
      reason: '不能整单取消',
      customerConfirmed: true,
      expectedUpdatedAt: cancellationOrder.updatedAt
    }, 'second-key', '测试操作员', {}),
    /整单取消/
  );
  pass('整单取消不从部分取消入口绕过订单取消流程');
  console.log(`ORDER_CHANGE_PASS=${passed}`);
})().catch(error => { console.error(error); process.exitCode = 1; });
