'use strict';
const assert = require('node:assert/strict'), { test } = require('node:test');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const { RentalAllocationService } = require('../apps/api/src/modules/rental-core/rental-allocation.service');
const { RentalCoreConfigRepository } = require('../apps/api/src/modules/rental-core/rental-core-config.repository');
const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const { fulfillmentAdmissionFixture, bindFulfillmentAdmission } = require('./helpers/fulfillment-admission-fixture.cjs');
const stores = require('./helpers/absorbing-config-store.cjs');
const scope = work => runWithRequestIdentity({ tenantId: 't', workspaceId: 'w', userId: 'operator', audience: 'operator', dataScope: 'all' }, work);
function facts() {
  return { locations: [{ id: 'loc', tenantId: 't', code: 'LOC', name: 'Current location', type: 'store',
    operatorId: 'op', capabilities: ['pickup', 'return', 'delivery', 'storage'], status: 'enabled' }],
    operators: [{ id: 'op', tenantId: 't', code: 'OP', name: 'Current operator', type: 'self_operated', status: 'enabled' }] };
}
function order(status = 'renting') {
  return { id: 'o', tenantId: 't', status, fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'loc',
    returnLocationId: 'loc', fulfillmentLocationName: 'Original location', fulfillmentLocationSnapshot: { name: 'Original location' },
    ruleSnapshot: { qualification: { required: false }, fulfillment: { pickupInspectionRequired: false, returnInspectionRequired: false } },
    startAt: '2098-01-01T00:00:00Z', endAt: '2099-01-01T00:00:00Z', lines: [],
    reservations: [{ itemGroupId: 'g', locationId: 'loc', quantity: 1, releasedQuantity: 0, status: 'fulfilled' }], allocations: [] };
}
function core(source) {
  const fixture = fulfillmentAdmissionFixture('t', 'w', source);
  const service = Object.create(RentalCoreService.prototype);
  service.resolveWorkspaceId = () => 'w';
  service.configStore = { readFulfillmentAdmission: fixture.read };
  service.state = () => ({ profile: { categoryCode: 'camera' }, locations: facts().locations, operators: facts().operators,
    itemGroups: [{ id: 'g', name: 'Group', inventoryMode: 'quantity' }] });
  return { service, fixture };
}

test('two Core instances reject current disabled location/operator, removed capability and stopped workspace without trusting cached flags', async () => scope(async () => {
  const source = facts(), a = core(source), b = core(source), original = order();
  await a.service.assertOrderFulfillmentAdmission('t', original, a.fixture.tx);
  await b.service.assertOrderFulfillmentAdmission('t', original, b.fixture.tx);
  source.locations[0].status = 'disabled';
  for (const instance of [a, b]) await assert.rejects(instance.service.assertOrderFulfillmentAdmission('t', original, instance.fixture.tx), /已停用/);
  source.locations[0].status = 'enabled'; source.operators[0].status = 'disabled';
  await assert.rejects(b.service.assertOrderFulfillmentAdmission('t', original, b.fixture.tx), /经营主体已停用/);
  source.operators[0].status = 'enabled'; source.locations[0].capabilities = ['return'];
  await assert.rejects(b.service.assertOrderFulfillmentAdmission('t', original, b.fixture.tx), /不支持领取/);
  source.locations[0].capabilities = ['pickup', 'return']; source.workspaceStatus = 'DISABLED';
  await assert.rejects(b.service.assertOrderFulfillmentAdmission('t', original, b.fixture.tx), /经营空间不可用/);
  source.workspaceStatus = 'ACTIVE';
  await assert.rejects(b.service.assertOrderFulfillmentAdmission('t', { ...original, fulfillmentMode: 'partner_pickup_return' }, b.fixture.tx), /合作经营主体/);
  const missing = Object.create(RentalCoreService.prototype);
  await assert.rejects(missing.assertOrderFulfillmentAdmission('t', original, {}), /权威读取不可用/);
  assert.equal(original.fulfillmentLocationSnapshot.name, 'Original location');
  assert.ok(b.fixture.trace.every(sql => /FOR UPDATE/.test(sql)), 'explicit current locking reads, not cache or snapshot reads');
}));

test('original location/operator writers take the same workspace lock before changing admission facts', async () => scope(async () => {
  const source = facts(), fixture = fulfillmentAdmissionFixture('t', 'w', source);
  const definition = require('@rental-os/shared').RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'camera');
  const tx = { ...fixture.tx, $queryRaw: async query => {
    const rows = await fixture.tx.$queryRaw(query);
    if (query.sql.includes('business_workspaces')) return [{ status: 'ACTIVE', categoryCode: 'CAMERA', categoryVersionId: 'v1', categoryAdoptionRevision: 0 }];
    return rows;
  }, rentalCategoryVersion: { findUnique: async () => ({ categoryCode: 'CAMERA', status: 'published', structureVersion: 1, definition }) },
    rentalFulfillmentOperator: { findUnique: async () => ({ tenantId: 't', workspaceId: 'w' }),
      findFirst: async () => ({ id: 'op' }), upsert: async ({ update }) => { assert.ok(fixture.trace.at(-1).includes('business_workspaces'));
        Object.assign(source.operators[0], update); } },
    rentalFulfillmentLocation: { findUnique: async () => ({ tenantId: 't', workspaceId: 'w' }),
      upsert: async ({ update }) => { assert.ok(fixture.trace.at(-1).includes('business_workspaces')); Object.assign(source.locations[0], update); } } };
  const repo = new RentalCoreConfigRepository({ ...tx, $transaction: async work => work(tx) });
  await repo.upsertOperator({ ...source.operators[0], status: 'disabled', createdAt: '2026-10-31', updatedAt: '2026-10-31' }, tx);
  await assert.rejects(repo.readFulfillmentAdmission('t', 'w', [{ locationId: 'loc', capability: 'pickup' }], tx), /经营主体已停用/);
  source.operators[0].status = 'enabled';
  await repo.upsertLocation({ ...source.locations[0], status: 'disabled' }, tx);
  await assert.rejects(repo.readFulfillmentAdmission('t', 'w', [{ locationId: 'loc', capability: 'pickup' }], tx), /已停用/);
}));

test('configuration change during the shared workspace-lock wait is observed before inventory or pickup writes', async () => scope(async () => {
  const source = facts(); let waiting = true;
  const fixture = fulfillmentAdmissionFixture('t', 'w', source, query => {
    if (waiting && query.sql.includes('business_workspaces')) { waiting = false; source.operators[0].status = 'disabled'; }
  });
  const { service } = core(source); service.configStore.readFulfillmentAdmission = fixture.read;
  let inventoryLocks = 0, writes = 0;
  service.factStore = { lockInventoryTargets: async () => { inventoryLocks++; }, saveOrderAggregate: async () => { writes++; } };
  await assert.rejects(service.assertAvailabilityWithLocks('t', { locationId: 'loc', startAt: '2098-01-01', endAt: '2098-01-02',
    lines: [{ itemGroupId: 'g', quantity: 1 }] }, fixture.tx), /经营主体已停用/);
  const target = order('ready_for_pickup'); service.lockedOrder = async () => target;
  service.assertAllocatedPickupReady = async () => { throw Error('must reject before inventory readiness'); };
  await assert.rejects(service.completeHandoverWithoutInspection('t', 'o', 'pickup', 0, fixture.tx), /经营主体已停用/);
  target.status = 'renting';
  await assert.rejects(service.assertOrderExtensionAvailable('t', target, '2099-01-02', fixture.tx), /经营主体已停用/);
  assert.equal(inventoryLocks, 0); assert.equal(writes, 0); assert.equal(target.status, 'renting');
}));

test('partial preassignment is gated, but resource release remains reachable after disable', async () => scope(async () => {
  const source = facts(); source.locations[0].status = 'disabled';
  const { service: original, fixture } = core(source), allocation = Object.create(RentalAllocationService.prototype);
  const target = { ...order('reserved'), assignment: { revision: 0 }, reservations: [] };
  allocation.core = { assertCarrierOrderResourcesMutable: async () => {},
    assertOrderFulfillmentAdmission: original.assertOrderFulfillmentAdmission.bind(original) };
  allocation.facts = { lockOrder: async () => {}, findOrder: async () => target };
  await assert.rejects(allocation.manage('t', 'o', { action: 'preassign', expectedRevision: 0 }, fixture.tx, 'Operator'), /已停用/);
  allocation.core.listItemGroups = () => { throw Error('release reached existing resource workflow'); };
  await assert.rejects(allocation.manage('t', 'o', { action: 'release', expectedRevision: 0, reason: 'location disabled' }, fixture.tx, 'Operator'), /release reached/);
}));

test('new order creation binds current creation facts in the transaction and rejects revocation after preparation before any inventory write', async () => scope(async () => {
  const source = facts(), { service: original, fixture } = core(source);
  const target = order('draft');
  await original.bindOrderCreationFulfillment('t', target, fixture.tx);
  assert.equal(target.fulfillmentLocationSnapshot.name, 'Current location');
  assert.equal(target.fulfillmentLocationSnapshot.operator.name, 'Current operator');
  source.locations[0].name = 'Later name';
  await original.assertOrderFulfillmentAdmission('t', target, fixture.tx);
  assert.equal(target.fulfillmentLocationSnapshot.name, 'Current location', 'later admission never refreshes history');
  const input = { quoteId: 'q', customerName: 'Customer', fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'loc', returnLocationId: 'loc',
    startAt: target.startAt, endAt: target.endAt, lines: [{ itemGroupId: 'g', quantity: 1 }] };
  const quote = { id: 'q', tenantId: 't', request: input, expiresAt: '2099-12-01',
    sourceSnapshot: { version: 'rental-quote-source-1', tenantId: 't', workspaceId: 'w', actor: { kind: 'user', id: 'operator' }, audience: 'operator' } };
  const confirmation = Object.create(RentalOrderConfirmationService.prototype);
  confirmation.normalizeOrderInput = value => value;
  confirmation.idempotency = { find: async () => undefined };
  confirmation.core = { resolveWorkspaceId: () => 'w', prepareOrder: async () => {
    source.operators[0].status = 'disabled'; return order('draft');
  }, bindOrderCreationFulfillment: original.bindOrderCreationFulfillment.bind(original),
    assertAvailabilityWithLocks: async () => { throw Error('must reject before inventory'); } };
  confirmation.businessFacts = { findQuote: async () => quote };
  confirmation.business = { assertOrderDaysOpenForConfirmation: () => {}, validateCouponForOrder: () => undefined };
  confirmation.prisma = { $transaction: async work => work(fixture.tx) };
  await assert.rejects(confirmation.createOrder('t', input, 'Operator', {}), /经营主体已停用/);
}));

test('actual quote creation precheck reads current facts on each instance and rejects absent authority', async () => {
  const tenant = 'tenant_002', coreService = new RentalCoreService(stores.createAbsorbingConfigStore(), stores.createAbsorbingFactStore());
  await coreService.onApplicationBootstrap();
  const profile = coreService.getProfile(tenant), ctx = { profile, category: coreService.listCategories().find(row => row.code === profile.categoryCode),
    settings: coreService.getBusinessSettings(tenant), groups: coreService.listItemGroups(tenant), pricingGroups: coreService.listPricingGroups(tenant),
    locations: coreService.listLocations(tenant), operators: coreService.listOperators(tenant), couponTemplates: [] };
  const source = structuredClone(ctx), services = [0, 1].map(() => new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(),
    stores.createAbsorbingBusinessFactStore(), stores.createAbsorbingConfigStore()));
  bindFulfillmentAdmission(services, tenant, 'ws_tenant_002', source);
  for (const service of services) await service.onApplicationBootstrap();
  const input = { customerType: 'personal', customerName: 'Fixture', fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: ctx.locations[0].id,
    startAt: new Date(Date.now() + 3 * 86400000).toISOString(), endAt: new Date(Date.now() + 4 * 86400000).toISOString(),
    lines: [{ itemGroupId: ctx.groups[0].id, quantity: 1 }] };
  await services[0].createQuote(tenant, ctx, input);
  source.locations[0].status = 'disabled';
  for (const service of services) await assert.rejects(service.createQuote(tenant, ctx, input), /已停用/);
  delete services[0].coreConfigStore.readFulfillmentAdmission;
  await assert.rejects(services[0].createQuote(tenant, ctx, input), /权威读取不可用/);
});

test('quote persistence rechecks current admission at original create commit, while original receipts remain readable after disable', async () => scope(async () => {
  const source = facts(), fixture = fulfillmentAdmissionFixture('t', 'w', source); let row, creates = 0;
  const tx = { ...fixture.tx, rentalQuote: { findFirst: async () => row ?? null, findUnique: async () => row ?? null,
    create: async ({ data }) => { creates++; const { Prisma } = require('@prisma/client');
      row = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value === Prisma.DbNull ? null : value]));
    }, update: async ({ data }) => Object.assign(row, data) } };
  const db = { ...tx, $transaction: async work => work(tx) }, repo = new RentalBusinessFactRepository(db);
  const q = { id: 'q', tenantId: 't', quoteNo: 'RQ', categoryCode: 'camera', request: { fulfillmentLocationId: 'loc', fulfillmentMode: 'store_pickup_return' },
    rentalAmount: 100, discountAmount: 0, couponAmount: 0, serviceAmount: 0, fulfillmentAmount: 0, depositAmount: 0, preAuthAmount: 0,
    receivableAmount: 100, payableAmount: 100, appliedDiscountPlanIds: [], rateSnapshot: [], calendarSnapshot: [], calendarWarnings: [], ruleSnapshot: {},
    pricingPlanVersion: '1', ruleVersion: '1', createdAt: '2026-10-31', expiresAt: '2099-01-01' };
  source.operators[0].status = 'disabled';
  await assert.rejects(repo.upsertQuote(q), /经营主体已停用/); assert.equal(creates, 0);
  source.operators[0].status = 'enabled'; await repo.upsertQuote(q); assert.equal(creates, 1);
  source.operators[0].status = 'disabled';
  await repo.upsertQuote({ ...q, consumedAt: '2026-10-31T01:00:00Z', consumedOrderId: 'o' });
  assert.equal(creates, 1); assert.equal((await repo.findQuote('t', 'q')).consumedOrderId, 'o');
}));

test('physical return does not consult current enabled flags or rewrite historical fulfillment snapshots', async () => scope(async () => {
  const target = order(), original = structuredClone(target.fulfillmentLocationSnapshot), service = Object.create(RentalCoreService.prototype);
  service.state = () => ({}); service.lockedOrder = async () => target;
  service.assertOrderFulfillmentAdmission = async () => { throw Error('return must not run new-business admission'); };
  service.runHook = async () => {};
  service.finishReturn = value => { value.status = 'pending_settlement'; };
  service.createReturnDispositions = async () => ({ quarantines: [], transfers: [] });
  service.voidPendingExtensions = async () => {};
  service.factStore = { saveOrderAggregate: async () => {} };
  await service.completeHandoverWithoutInspection('t', 'o', 'return', 0, {});
  assert.equal(target.status, 'pending_settlement'); assert.deepEqual(target.fulfillmentLocationSnapshot, original);
}));
