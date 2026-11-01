const assert = require('node:assert/strict');
const { test } = require('node:test');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalCoreFactRepository } = require('../apps/api/src/modules/rental-core/rental-core-fact.repository');
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { RentalIdempotencyRepository } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
const { RentalIdempotentActionService } = require('../apps/api/src/modules/rental-core/rental-idempotent-action.service');
const { StaffOfflinePaymentService } = require('../apps/api/src/modules/rental-core/staff-offline-payment.service');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const inScope = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', dataScope: 'all' }, work);
const template = { id: 'tpl', code: 'RETURN', version: '1', stage: 'return', enabled: true, fields: [] };
const groups = [{ id: 'old', code: 'OLD', name: 'Old', inventoryMode: 'quantity' },
  { id: 'new', code: 'NEW', name: 'New', inventoryMode: 'quantity' }];
function orderFixture() {
  return { id: 'o', tenantId: 't', currency: 'CNY', orderNo: 'ORDER', status: 'renting', categoryCode: 'camera',
    startAt: '2026-10-01T00:00:00Z', endAt: '2099-10-10T00:00:00Z', updatedAt: 'revision',
    fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'loc', returnLocationId: 'future-return',
    ruleSnapshot: { qualification: { required: false }, fulfillment: { returnBufferMinutes: 30, pickupBufferMinutes: 15 } },
    inspectionTemplateSnapshots: [template],
    lines: [{ id: 'line', itemGroupId: 'old', itemGroupCode: 'OLD', quantity: 3, amount: 100, inventoryMode: 'quantity' }],
    allocations: [{ id: 'alloc', orderId: 'o', orderLineId: 'line', itemGroupId: 'old', quantity: 3, status: 'picked_up' }],
    reservations: [{ id: 'reservation', orderId: 'o', orderLineId: 'line', itemGroupId: 'old', locationId: 'loc', quantity: 3, releasedQuantity: 0, status: 'fulfilled' }],
    chargeLines: [], finalPayableAmount: 100, payableAmount: 100, adjustmentAmount: 0, serviceSnapshots: [] };
}
function coreFixture(order) {
  const captured = { inspections: [], dispositions: [], workOrders: [], changes: [], writes: 0 };
  const service = Object.create(RentalCoreService.prototype);
  const state = { profile: { categoryCode: 'camera' }, itemGroups: groups, pricingGroups: [], inspectionTemplates: [template] };
  service.state = () => state;
  service.factContext = async () => state;
  service.lockedOrder = async () => order;
  service.resolveWorkspaceId = () => 'w';
  service.configStore = {};
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([service], 't', 'w', {
    locations: [{ id: 'loc', name: 'Original location', status: 'enabled', capabilities: ['pickup', 'return'], operatorId: 'op' }],
    operators: [{ id: 'op', status: 'enabled', type: 'self_operated' }]
  });
  service.getWorkspaceCategory = async () => ({ code: 'camera' });
  service.runHook = async () => undefined;
  service.orderHookInstances = () => [];
  service.loadInventorySnapshot = async () => ({ assets: [], reservations: [], stockBalances: [] });
  service.availableQuantity = (_s, _i, _g, _l, start, end) => { captured.period = { start, end }; return 5; };
  service.validateAllocationEquipment = async (_t, target, allocations) => { captured.equipment = { target, allocations }; };
  service.factStore = {
    listAssets: async () => [], listInspections: async () => [], listExtensions: async () => [],
    lockInventoryTargets: async () => undefined, listOrderChanges: async () => [],
    insertInspection: async record => { captured.inspections.push(structuredClone(record)); },
    upsertStockDisposition: async row => { captured.dispositions.push(structuredClone(row)); return row; },
    upsertWorkOrder: async row => { captured.workOrders.push(structuredClone(row)); },
    insertOrderChange: async row => { captured.changes.push(row); },
    saveOrderAggregate: async (_o, assets, _tx, quarantines) => { captured.writes++; captured.assets = assets; captured.quarantines = quarantines; }
  };
  return { service, captured, state };
}

test('partial quantity return remaps inspection and quarantine to returned allocation, not remaining stock', async () => inScope(async () => {
  const order = orderFixture(); order.ruleSnapshot.fulfillment.returnBufferMinutes = 0;
  const { service, captured } = coreFixture(order);
  await service.createInspection('t', 'o', { templateId: 'tpl', results: {}, returnBatchNo: 'batch-1',
    returnItems: [{ allocationId: 'alloc', quantity: 1 }],
    exceptions: [{ allocationId: 'alloc', code: 'damage', description: 'damaged', chargeAmount: 10 }] }, 'Operator', {}, {});
  const returned = order.allocations.find(row => row.status === 'returned');
  assert.ok(returned); assert.notEqual(returned.id, 'alloc');
  assert.equal(order.allocations.find(row => row.id === 'alloc').quantity, 2);
  assert.equal(returned.metadata.reservationId, 'reservation');
  assert.equal(captured.inspections[0].returnedItems[0].allocationId, returned.id);
  assert.equal(captured.inspections[0].exceptions[0].allocationId, returned.id);
  assert.equal(captured.dispositions.length, 1); assert.equal(captured.dispositions[0].status, 'blocked');
  assert.equal(captured.quarantines[0].quantity, 1);
}));

test('exchange creates original inspection and blocked old-goods disposition with a real work order', async () => inScope(async () => {
  const order = orderFixture(), { service, captured } = coreFixture(order);
  const input = { type: 'post_pickup_exchange', orderLineId: 'line', allocationId: 'alloc', replacementItemGroupId: 'new',
    priceBasis: 'original_order_price', originalDisposition: 'return_to_warehouse', reason: 'fault', customerConfirmed: true,
    expectedUpdatedAt: 'revision', inspectionSnapshot: { customerConfirmed: true, condition: 'damaged',
      exceptions: [{ code: 'damage', description: 'inspect before re-rental', chargeAmount: 20 }] } };
  const effectiveFrom = new Date().toISOString();
  const units = Math.ceil((Date.parse(order.endAt) - Date.parse(order.startAt)) / 86400000);
  const source = { orderLineId: 'line', itemGroupId: 'old', quantity: 3, startAt: order.startAt, endAt: order.endAt,
    source: { kind: 'quote', id: 'quote-original', priceVersion: '1' }, rate: { itemGroupId: 'old', unit: 'day_24h' },
    context: { timeZone: 'UTC', calendars: [], legacyDayTypeMultipliers: false }, ruleSnapshot: order.ruleSnapshot,
    calendarSnapshot: [], applyMinimumUnits: true, selectedUnitAmount: 100 / units / 3,
    billableUnits: units, billedHours: units * 24, amount: 100 };
  const replacement = { ...structuredClone(source), itemGroupId: 'new' };
  const priced = { currency: order.currency, differenceAmount: 0, depositDelta: 0, preAuthDelta: 0, exchange: {
    ...input, originalAmount: 100, replacementAmount: 100, executionBasis: { effectiveFrom, priceBasis: input.priceBasis,
      ruleSnapshot: order.ruleSnapshot, categoryVersionId: 'v1', capabilitySnapshot: [], linePricing: {
        version: 1, orderLineId: 'line', originalAmount: 100, replacementAmount: 100,
        previousSegments: [source], segments: [replacement], overdueBasis: replacement }
    }
  } };
  await service.applyPostPickupExchange('t', 'o', priced, input, 'original-key', 'Operator', {});
  assert.equal(captured.inspections.length, 1);
  assert.equal(captured.inspections[0].exceptions[0].reviewStatus, 'pending');
  assert.equal(captured.inspections[0].exceptions[0].allocationId, 'alloc');
  assert.equal(captured.dispositions[0].inspectionId, captured.inspections[0].id);
  assert.equal(captured.dispositions[0].status, 'blocked');
  assert.equal(captured.dispositions[0].restoredQuantity, 0);
  assert.equal(captured.dispositions[0].locationId, 'loc');
  assert.equal(captured.workOrders[0].dispositionId, captured.dispositions[0].id);
  assert.equal(captured.quarantines[0].quantity, 3);
  assert.equal(captured.equipment.allocations[0].itemGroupId, 'new');
  const newAllocation = order.allocations.find(row => row.itemGroupId === 'new');
  assert.equal(newAllocation.metadata.reservationId, order.reservations.find(row => row.itemGroupId === 'new').id);
  assert.equal(captured.changes[0].beforeSnapshot.reservations[0].releasedQuantity, 0);
  assert.ok(Date.parse(captured.period.start) > Date.parse(order.startAt));
  assert.equal(Date.parse(captured.period.end), Date.parse(order.endAt) + 30 * 60000);
}));

test('membership relation is re-read even when the order has no document requirement', async () => {
  const service = Object.create(MembershipService.prototype);
  service.requireWorkspace = async () => undefined;
  service.resolveBookingIdentity = async () => { throw Error('relationship revoked'); };
  await assert.rejects(service.assertBookingQualificationForAction('t', 'w', { personalCustomerId: 'p', bookingIdentity: 'corporate' },
    { required: false }, 'extension', {}), /relationship revoked/);
});

test('physical quarantine accepts serial future reservations and records their peak rather than sum', async () => {
  const repo = new RentalCoreFactRepository({});
  const at = '2099-01-01T00:00:00Z';
  repo.activeReservations = async () => [
    { itemGroupId: 'g', locationId: 'loc', quantity: 1, startAt: at, endAt: '2099-01-02T00:00:00Z' },
    { itemGroupId: 'g', locationId: 'loc', quantity: 1, startAt: '2099-01-03T00:00:00Z', endAt: '2099-01-04T00:00:00Z' }
  ];
  let ledger;
  const tx = { $queryRaw: async () => [{ id: 'b', onHandQuantity: 2, maintenanceQuantity: 0 }],
    rentalStockBalance: { updateMany: async () => ({ count: 1 }) },
    rentalStockLedgerEntry: { findFirst: async () => null, create: async ({ data }) => { ledger = data; } } };
  await repo.applyStockMaintenanceDelta(tx, 't', 'w', { itemGroupId: 'g', locationId: 'loc', quantity: 1,
    sourceOrderId: 'o', sourceOrderNo: 'O', batchNo: 'return', idempotencyKey: 'k', reason: 'actual damage' }, 1, 'maintenance_quarantine');
  assert.equal(ledger.maintenanceQuantity, 1); assert.equal(ledger.reservedQuantity, 1);
});

test('disposition restore never overrides independent disabled or manually-maintained asset status', async () => inScope(async () => {
  for (const [status, source, shouldRestore] of [['disabled', 'manual', false], ['inspection', 'manual', false], ['maintenance', 'manual', false], ['maintenance', 'order', true]]) {
    const disposition = { id: 'd', tenantId: 't', workspaceId: 'w', orderId: 'o', assetId: 'a', quantity: 1,
      restoredQuantity: 0, status: 'buffered', receivedAt: new Date(0), bufferUntil: new Date(0), createdAt: new Date(0), updatedAt: new Date(0) };
    let updated = false;
    const tx = { $queryRaw: async query => {
        if (/rental_allocations/.test(query.sql)) return [];
        if (/rental_orders/.test(query.sql)) return [{ id: 'o', workspaceId: 'w' }];
        if (/SELECT \* FROM rental_stock_dispositions/.test(query.sql)) return [{ ...disposition }];
        if (/rental_asset_status_history/.test(query.sql)) return [{ source, sourceId: 'o', toStatus: status }];
        if (/rental_stock_dispositions|rental_work_orders/.test(query.sql)) return [];
        return [{ id: 'a', assetNo: 'A', status }];
      },
      businessWorkspace: { findFirst: async () => ({ id: 'w', tenantId: 't' }) },
      rentalStockDisposition: { findFirst: async () => disposition, count: async () => 0,
        updateMany: async ({ data }) => { Object.assign(disposition, data); return { count: 1 }; } },
      rentalWorkOrder: { count: async () => 0 },
      rentalAsset: { findFirst: async () => { throw Error('restore must read locked current asset state'); }, updateMany: async ({ where }) => {
        assert.equal(where.status, 'MAINTENANCE'); updated = true; return { count: 1 }; } },
      rentalAssetStatusHistory: { findFirst: async () => { throw Error('restore must read current hold source'); }, create: async () => undefined }
    };
    await new RentalCoreFactRepository({}).restoreStockDispositionInClient(tx, 't', 'd', 'Operator');
    assert.equal(updated, shouldRestore);
    assert.equal(disposition.status, 'restored');
  }
}));

test('the last disposition can release an earlier same-asset order hold only after all sources are closed', async () => inScope(async () => {
  for (const [source, otherBlocks, otherWork, restoredSource, expected] of [
    ['order', 0, 0, 1, true], ['order', 1, 0, 1, false], ['order', 0, 1, 1, false],
    ['order', 0, 0, 0, false], ['manual', 0, 0, 1, false]
  ]) {
    const disposition = { id: 'last', tenantId: 't', workspaceId: 'w', orderId: 'later-order', assetId: 'a', quantity: 1,
      restoredQuantity: 0, status: 'buffered', bufferUntil: new Date(0), receivedAt: new Date(0), createdAt: new Date(0), updatedAt: new Date(0) };
    let restored = false;
    const tx = { businessWorkspace: { findFirst: async () => ({ id: 'w', tenantId: 't' }) },
      rentalStockDisposition: { findFirst: async () => disposition, count: async ({ where }) => where.status === 'restored' ? restoredSource : otherBlocks,
        updateMany: async ({ data }) => { Object.assign(disposition, data); return { count: 1 }; } },
      rentalWorkOrder: { count: async ({ where }) => where.dispositionId ? 0 : otherWork },
      $queryRaw: async query => {
        if (/rental_allocations/.test(query.sql)) return [];
        if (/rental_orders/.test(query.sql)) return [{ id: 'later-order', workspaceId: 'w' }];
        if (/SELECT \* FROM rental_stock_dispositions/.test(query.sql)) return [{ ...disposition }];
        if (/rental_asset_status_history/.test(query.sql)) return [{ source, sourceId: 'earlier-order', toStatus: 'maintenance' }];
        if (/rental_stock_dispositions/.test(query.sql)) return Array.from({ length: /status = 'restored'/.test(query.sql) ? restoredSource : otherBlocks }, () => ({ id: 'd' }));
        if (/rental_work_orders/.test(query.sql)) return Array.from({ length: /dispositionId =/.test(query.sql) ? 0 : otherWork }, () => ({ id: 'w' }));
        return [{ assetNo: 'A', status: 'maintenance' }];
      },
      rentalAsset: { updateMany: async () => { restored = true; return { count: 1 }; } },
      rentalAssetStatusHistory: { create: async () => {} } };
    const restore = () => new RentalCoreFactRepository({}).restoreStockDispositionInClient(tx, 't', 'last', 'Operator');
    if (otherWork) {
      await assert.rejects(restore(), /独立养护工单/); assert.equal(disposition.status, 'buffered');
    } else await restore();
    assert.equal(restored, expected, '全部本资产处置关闭后才解除原订单维护；不丢人工或独立工单限制');
  }
}));

test('later order return cannot erase an independent manual asset hold', async () => inScope(async () => {
  for (const status of ['disabled', 'maintenance', 'inspection']) {
    for (const next of ['available', 'maintenance']) {
      const order = { ...orderFixture(), lines: [], reservations: [], allocations: [], rentalAmount: 100,
        discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0,
        preAuthAmount: 0, totalAmount: 100, createdBy: 'operator' };
      const asset = { id: 'a', assetNo: 'A', status, locationId: 'loc' };
      let latest = { source: 'manual', sourceId: null, toStatus: status };
      const tx = {
        businessWorkspace: { findFirst: async () => ({ id: 'w', tenantId: 't' }) },
        rentalOrder: { findUnique: async () => ({ tenantId: 't', workspaceId: 'w', inspectionTemplateSnapshots: order.inspectionTemplateSnapshots }), update: async () => {} },
        rentalAllocation: { deleteMany: async () => {} },
        $queryRaw: async query => /rental_allocations/.test(query.sql) ? []
          : /rental_orders/.test(query.sql) ? [{ id: 'o', workspaceId: 'w' }] : [{ ...asset }],
        rentalAsset: { findMany: async () => [{ ...asset }], findFirst: async () => ({ ...asset }),
          updateMany: async ({ where, data }) => {
            assert.equal(where.status, status.toUpperCase()); Object.assign(asset, { ...data, status: data.status.toLowerCase() }); return { count: 1 }; } },
        rentalStockDisposition: { count: async () => 0 },
        rentalAssetStatusHistory: { findFirst: async () => ({ ...latest }), create: async ({ data }) => { latest = data; } }
      };
      await new RentalCoreFactRepository({}).saveOrderAggregate(order, [{ assetId: 'a', status: next }], tx);
      assert.equal(asset.status, status, '归还只释放本单占用，不能覆盖独立停用/维护');
      assert.equal(latest.source, 'manual', '不能把人工维护改记成本单归还来源后自动恢复');
    }
  }
}));

test('order asset updates use locked current state and retain remaining disposition or work-order holds', async () => inScope(async () => {
  for (const [dispositions, workOrders, expected] of [[0, 0, 'AVAILABLE'], [1, 0, 'MAINTENANCE'], [0, 1, 'MAINTENANCE']]) {
    const order = { ...orderFixture(), lines: [], reservations: [], allocations: [], rentalAmount: 100,
      discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0,
      preAuthAmount: 0, totalAmount: 100, createdBy: 'operator' };
    const asset = { id: 'a', assetNo: 'A', status: 'rented', locationId: 'loc' }; let locked = false, history;
    const tx = { businessWorkspace: { findFirst: async () => ({ id: 'w', tenantId: 't' }) },
      rentalOrder: { findUnique: async () => ({ tenantId: 't', workspaceId: 'w', inspectionTemplateSnapshots: order.inspectionTemplateSnapshots }), update: async () => {} },
      rentalAllocation: { deleteMany: async () => {} },
      $queryRaw: async query => {
        if (/rental_allocations/.test(query.sql)) return [];
        if (/rental_orders/.test(query.sql)) return [{ id: 'o', workspaceId: 'w' }];
        if (/rental_stock_dispositions/.test(query.sql)) { assert.equal(locked, true); assert.match(query.sql, /FORCE INDEX \(rental_stock_dispositions_asset_status_idx\)/); return Array.from({ length: dispositions }, () => ({ id: 'd' })); }
        if (/rental_work_orders/.test(query.sql)) { assert.equal(locked, true); assert.match(query.sql, /FORCE INDEX \(rental_work_orders_asset_status_idx\)/); return Array.from({ length: workOrders }, () => ({ id: 'w' })); }
        assert.match(query.sql, /rental_assets.*?FOR UPDATE/s); locked = true; return [{ ...asset }];
      },
      rentalAsset: { findMany: async () => { throw Error('must not use stale snapshot state'); },
        updateMany: async ({ where, data }) => { assert.equal(locked, true); assert.equal(where.status, 'RENTED'); Object.assign(asset, data); return { count: 1 }; } },
      rentalStockDisposition: { count: async () => dispositions }, rentalWorkOrder: { count: async () => workOrders },
      rentalAssetStatusHistory: { create: async ({ data }) => { history = data; } } };
    await new RentalCoreFactRepository({}).saveOrderAggregate(order, [{ assetId: 'a', status: 'available', locationId: 'returned-loc' }], tx);
    assert.equal(asset.status, expected); assert.equal(asset.locationId, 'returned-loc'); assert.equal(history.toStatus, expected);
  }
}));

test('work-order creation rechecks the original disposition under the same order/asset locks as restoration', async () => inScope(async () => {
  const repo = new RentalCoreFactRepository({});
  const work = { id: 'work', tenantId: 't', workspaceId: 'w', orderId: 'o', dispositionId: 'd', assetId: 'a',
    workNo: 'WO', itemGroupId: 'g', locationId: 'loc', quantity: 1, type: 'repair', status: 'pending',
    reason: '原归还养护', attachments: [], createdBy: 'operator', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
  for (const status of ['restored', 'written_off', 'buffered', 'blocked']) {
    const trace = []; let writes = 0, assetStatus = 'available';
    const tx = { businessWorkspace: { findFirst: async () => ({ id: 'w' }) },
      $queryRaw: async query => {
        if (/rental_allocations/.test(query.sql)) return [{ assetId: 'a' }];
        if (/rental_orders/.test(query.sql)) { trace.push('order'); return [{ id: 'o', workspaceId: 'w' }]; }
        if (/rental_assets/.test(query.sql)) { trace.push('asset'); return [{ id: 'a', assetNo: 'A', locationId: 'loc', status: assetStatus }]; }
        if (/rental_stock_dispositions/.test(query.sql)) { trace.push('disposition'); return [{ orderId: 'o', assetId: 'a', itemGroupId: 'g', locationId: 'loc', status }]; }
        if (/rental_work_orders/.test(query.sql)) return [];
        throw Error(`Unexpected SQL: ${query.sql}`);
      },
      rentalWorkOrder: { findUnique: async () => null, create: async ({ data }) => { trace.push('work'); writes++; return data; } },
      rentalAsset: { updateMany: async ({ where, data }) => { assert.equal(where.status, 'AVAILABLE'); assetStatus = data.status.toLowerCase(); return { count: 1 }; } },
      rentalAssetStatusHistory: { create: async () => {} } };
    if (['restored', 'written_off'].includes(status)) {
      await assert.rejects(repo.upsertWorkOrder(work, tx), /已结束的库存处置/); assert.equal(writes, 0); assert.equal(assetStatus, 'available');
    } else {
      const result = await repo.upsertWorkOrder(work, tx);
      assert.equal(result.status, 'pending'); assert.equal(writes, 1); assert.equal(assetStatus, 'maintenance');
      assert.ok(trace.indexOf('order') < trace.indexOf('asset'));
      assert.ok(trace.indexOf('asset') < trace.indexOf('disposition'));
      assert.ok(trace.indexOf('disposition') < trace.indexOf('work'));
    }
  }
}));

test('restoration rechecks current disposition and its active work before any terminal write', async () => inScope(async () => {
  for (const newer of ['blocked', 'restored', 'active-work']) {
    const visible = { id: 'd', tenantId: 't', workspaceId: 'w', orderId: 'o', assetId: 'a', itemGroupId: 'g', locationId: 'loc',
      quantity: 1, restoredQuantity: 0, status: 'buffered', bufferUntil: new Date(0) };
    let writes = 0; const trace = [];
    const tx = { businessWorkspace: { findFirst: async () => ({ id: 'w' }) },
      rentalStockDisposition: { findFirst: async () => ({ ...visible }), updateMany: async () => { writes++; return { count: 1 }; } },
      $queryRaw: async query => {
        if (/rental_allocations/.test(query.sql)) return [{ assetId: 'a' }];
        if (/rental_orders/.test(query.sql)) { trace.push('order'); return [{ id: 'o', workspaceId: 'w' }]; }
        if (/rental_assets/.test(query.sql)) { trace.push('asset'); return [{ id: 'a', assetNo: 'A', status: 'maintenance' }]; }
        if (/SELECT \* FROM rental_stock_dispositions/.test(query.sql)) { trace.push('disposition'); return [{ ...visible,
          ...(newer === 'blocked' ? { status: 'blocked' } : newer === 'restored' ? { status: 'restored', restoredQuantity: 1 } : {}) }]; }
        if (/rental_work_orders/.test(query.sql)) { trace.push('work'); return newer === 'active-work' ? [{ id: 'new-work' }] : []; }
        throw Error(`Unexpected SQL: ${query.sql}`);
      } };
    await assert.rejects(new RentalCoreFactRepository({}).restoreStockDispositionInClient(tx, 't', 'd', 'operator'), /阻断|已经恢复|尚未完成/);
    assert.equal(writes, 0); assert.ok(trace.indexOf('order') < trace.indexOf('asset'));
    assert.ok(trace.indexOf('asset') < trace.indexOf('disposition'));
    if (newer === 'active-work') assert.ok(trace.indexOf('disposition') < trace.indexOf('work'));
  }
}));

test('create-versus-restore commit order retains the original restoration entry until all work is closed', async () => inScope(async () => {
  for (const createFirst of [false, true]) {
    const disposition = { id: 'd', tenantId: 't', workspaceId: 'w', orderId: 'o', assetId: 'a', itemGroupId: 'g', locationId: 'loc',
      quantity: 1, restoredQuantity: 0, status: 'buffered', receivedAt: new Date(0), bufferUntil: new Date(0), createdAt: new Date(0), updatedAt: new Date(0) };
    const state = { asset: { id: 'a', assetNo: 'A', status: 'maintenance', locationId: 'loc' }, work: undefined };
    const staleInput = { id: 'work', tenantId: 't', workspaceId: 'w', orderId: 'o', dispositionId: 'd', assetId: 'a',
      itemGroupId: 'g', locationId: 'loc', type: 'repair', quantity: 1, status: 'pending', workNo: 'WO', reason: '养护',
      attachments: [], createdBy: 'operator', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const tx = { businessWorkspace: { findFirst: async () => ({ id: 'w' }) },
      $queryRaw: async query => {
        if (/rental_allocations/.test(query.sql)) return [{ assetId: 'a' }];
        if (/rental_orders/.test(query.sql)) return [{ id: 'o', workspaceId: 'w' }];
        if (/rental_assets/.test(query.sql)) return [{ ...state.asset }];
        if (/rental_asset_status_history/.test(query.sql)) return [{ source: 'order', sourceId: 'o', toStatus: 'maintenance' }];
        if (/rental_stock_dispositions/.test(query.sql)) return /status IN/.test(query.sql) ? [] : [{ ...disposition }];
        if (/SELECT \* FROM rental_work_orders/.test(query.sql)) return state.work ? [{ ...state.work }] : [];
        if (/rental_work_orders/.test(query.sql)) return state.work && ['pending', 'in_progress', 'pending_review'].includes(state.work.status) ? [{ id: state.work.id }] : [];
        throw Error(`Unexpected SQL: ${query.sql}`);
      },
      rentalStockDisposition: { findFirst: async () => ({ ...disposition }), updateMany: async ({ data }) => { Object.assign(disposition, data); return { count: 1 }; } },
      rentalWorkOrder: { findUnique: async () => state.work ?? null, findFirst: async () => state.work ? { ...state.work } : null,
        create: async ({ data }) => { state.work = { ...data }; return data; }, updateMany: async ({ data }) => { Object.assign(state.work, data); return { count: 1 }; } },
      rentalAsset: { updateMany: async ({ where, data }) => { assert.equal(where.status, state.asset.status.toUpperCase()); state.asset.status = data.status.toLowerCase(); return { count: 1 }; } },
      rentalAssetStatusHistory: { create: async () => {} }, operationLog: { create: async () => {} } };
    const repo = new RentalCoreFactRepository({});
    const restore = () => repo.restoreStockDispositionInClient(tx, 't', 'd', 'operator');
    if (createFirst) {
      await repo.upsertWorkOrder(staleInput, tx);
      await assert.rejects(restore(), /养护工单尚未完成/);
      assert.equal(disposition.status, 'buffered'); assert.equal(state.asset.status, 'maintenance');
      await repo.transitionWorkOrder('t', 'work', 'start', 'operator', {}, tx);
      await repo.transitionWorkOrder('t', 'work', 'submit', 'operator', { result: '已完成' }, tx);
      await repo.transitionWorkOrder('t', 'work', 'review', 'reviewer', { decision: 'approved', reason: '通过' }, tx);
      await restore();
      assert.equal(state.work.status, 'completed');
    } else {
      await restore();
      await assert.rejects(repo.upsertWorkOrder(staleInput, tx), /已结束的库存处置/);
      assert.equal(state.work, undefined, '创建在锁前读过buffered也不得越过已提交恢复');
    }
    assert.equal(disposition.status, 'restored'); assert.equal(state.asset.status, 'available');
  }
}));

test('order lock includes historical exchange assets before any return disposition or allocation rewrite', async () => inScope(async () => {
  const trace = [];
  const tx = { $queryRaw: async query => {
    if (/rental_orders/.test(query.sql)) { trace.push('order'); return [{ id: 'o', workspaceId: 'w' }]; }
    if (/rental_allocations/.test(query.sql)) { trace.push('allocation-read'); return [{ assetId: 'b' }, { assetId: 'a' }, { assetId: 'b' }]; }
    assert.match(query.sql, /WHERE id = \?/); trace.push(query.values[0]);
    return [{ id: query.values[0], assetNo: query.values[0], status: 'rented', locationId: 'loc' }];
  } };
  await new RentalCoreFactRepository({}).lockOrder('t', 'o', tx);
  assert.deepEqual(trace, ['order', 'allocation-read', 'a', 'b'], '含已归还的历史换货资产，逐主键按稳定ID取锁');
}));

test('old operation identities survive startup and cannot be deleted by age alone', async () => {
  let deleted = false;
  const repository = new RentalIdempotencyRepository({ rentalOrderIdempotencyRecord: { deleteMany: async () => { deleted = true; } } });
  await new RentalIdempotentActionService({}, repository).onApplicationBootstrap();
  await assert.rejects(repository.deleteOlderThan(new Date()), /禁止仅按年龄/);
  assert.equal(deleted, false);
});

test('confirmed offline receipt can be recovered after completion without a second money event', async () => {
  const registration = { id: 'reg', tenantId: 't', workspaceId: 'w', orderId: 'o', status: 'confirmed', fundingEventId: 'event',
    instrument: 'rental', amount: 10, registeredAt: new Date(), confirmedAt: new Date(), paymentMethod: 'offline_cash' };
  const event = { id: 'event', amount: 10, instrument: 'rental', provider: 'offline', idempotencyKey: 'staff-offline:reg' };
  const tx = { $queryRaw: async () => [], rentalOfflinePaymentRegistration: { findFirst: async () => registration },
    rentalOrder: { findFirst: async () => ({ id: 'o', status: 'COMPLETED' }) } };
  const service = new StaffOfflinePaymentService({ $transaction: work => work(tx) }, {
    listEvents: async () => ({ events: [event] }), recordEvent: async () => { throw Error('must not collect again'); }
  }, {});
  const result = await service.confirm('t', 'w', 'operator', 'Name', 'reg', { mode: 'all', locationIds: [] });
  assert.equal(result.fundingEvent, event);
  registration.fundingEventId = 'missing';
  await assert.rejects(service.confirm('t', 'w', 'operator', 'Name', 'reg', { mode: 'all', locationIds: [] }), /缺少一致的资金收据/);
});

test('unpaid expiry rejects collected money and original pending payments before cancellation', async () => {
  for (const [collected, pending] of [[10, null], [0, { id: 'payment' }], [0, null]]) {
    const order = { ...orderFixture(), status: 'draft', reservations: [{ status: 'soft', expiresAt: '2020-01-01T00:00:00Z' }] };
    const { service } = coreFixture(order);
    service.funding = { listEvents: async () => ({ rental: { collected }, deposit: { collected: 0 }, preauthorization: { frozen: 0 } }) };
    let cancelled = false; service.cancelOrder = async () => { cancelled = true; return order; };
    const tx = { $queryRaw: async query => {
      assert.match(query.sql, /LOCK IN SHARE MODE/);
      return query.sql.includes('rental_payment_intents') && pending ? [pending] : [];
    } };
    const run = () => service.expirePendingOrder('t', 'o', tx, 'system', '2026-10-30T00:00:00Z');
    if (collected || pending) await assert.rejects(run(), /已有收款或待核对资金/); else await run();
    assert.equal(cancelled, !collected && !pending);
  }
});
