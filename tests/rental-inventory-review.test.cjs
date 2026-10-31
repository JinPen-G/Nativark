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
  for (const [status, source, shouldRestore] of [['DISABLED', 'manual', false], ['MAINTENANCE', 'manual', false], ['MAINTENANCE', 'order', true]]) {
    const disposition = { id: 'd', tenantId: 't', workspaceId: 'w', orderId: 'o', assetId: 'a', quantity: 1,
      restoredQuantity: 0, status: 'buffered', receivedAt: new Date(0), bufferUntil: new Date(0), createdAt: new Date(0), updatedAt: new Date(0) };
    let updated = false;
    const tx = { $queryRaw: async () => [{ id: 'a' }],
      businessWorkspace: { findFirst: async () => ({ id: 'w', tenantId: 't' }) },
      rentalStockDisposition: { findFirst: async () => disposition, count: async () => 0,
        updateMany: async ({ data }) => { Object.assign(disposition, data); return { count: 1 }; } },
      rentalWorkOrder: { count: async () => 0 },
      rentalAsset: { findFirst: async () => ({ assetNo: 'A', status }), updateMany: async ({ where }) => {
        assert.equal(where.status, 'MAINTENANCE'); updated = true; return { count: 1 }; } },
      rentalAssetStatusHistory: { findFirst: async () => ({ source, sourceId: 'o', toStatus: status }), create: async () => undefined }
    };
    await new RentalCoreFactRepository({}).restoreStockDispositionInClient(tx, 't', 'd', 'Operator');
    assert.equal(updated, shouldRestore);
    assert.equal(disposition.status, 'restored');
  }
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
