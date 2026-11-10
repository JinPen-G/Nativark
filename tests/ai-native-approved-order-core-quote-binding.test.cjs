'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
const compiler = require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', target: 'es2022', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalOrderConfirmationService } = require('../apps/api/src/modules/rental-core/rental-order-confirmation.service');
const input = { fulfillmentMode: 'pickup', fulfillmentLocationId: 'location-a', returnLocationId: 'location-b', startAt: '2026-10-10T00:00:00Z', endAt: '2026-10-11T00:00:00Z', customerType: 'personal', customerId: 'customer-a', bookingIdentity: { bookingIdentity: 'personal' }, lines: [{ itemGroupId: 'item-a', pricingGroupId: 'price-a', quantity: 2 }] };
const quote = { request: structuredClone(input) };

test('Core original quote storage keeps exact scoped operation through replay and a lost commit reply', { timeout: 30000 }, async () => {
  const b = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup();
  const { createTaskInputStore } = require('./fixtures/ai-native/task-input-store.cjs');
  const { RentalBusinessFactRepository } = require('../apps/api/src/modules/rental-core/rental-business-fact.repository');
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const store = createTaskInputStore({ rentalQuote: [], businessWorkspace: [{ id: 'workspace-a', tenantId: 'tenant_001', status: 'ACTIVE' }] });
  store.db.rentalQuote.update = async ({ where, data }) => {
    await store.db.rentalQuote.updateMany({ where, data });
    return store.db.rentalQuote.findFirst({ where });
  };
  const transaction = store.db.$transaction;
  const { Prisma } = require('../apps/api/node_modules/@prisma/client');
  store.db.$transaction = work => transaction(tx => work({ ...tx,
    rentalQuote: { ...tx.rentalQuote,
      update: async ({ where, data }) => { await tx.rentalQuote.updateMany({ where, data }); return tx.rentalQuote.findFirst({ where }); },
      create: args => tx.rentalQuote.create({ ...args,
        data: Object.fromEntries(Object.entries(args.data).map(([k, v]) => [k, v === Prisma.DbNull ? null : v])) }) },
    $queryRaw: async query => {
      if (query.sql.includes('rental_bundle_components')) {
        const root = b.core.listItemGroups('tenant_001').find(row => query.values.includes(row.id));
        return (root?.bundleComponents ?? []).map(part => ({ componentItemGroupId: part.itemGroupId, quantity: part.quantity,
          optional: Boolean(part.optional), substitutionGroup: part.substitutionGroup ?? null, code: part.itemGroupCode,
          name: part.itemGroupName, tenantId: 'tenant_001', workspaceId: 'workspace-a' }));
      }
      if (query.sql.includes('rental_item_groups')) return b.core.listItemGroups('tenant_001')
        .filter(row => query.values.includes(row.id)).map(row => ({ ...row, workspaceId: 'workspace-a',
          createdAt: new Date(row.createdAt), updatedAt: new Date(row.updatedAt) }));
      if (query.sql.includes('rental_fulfillment_locations')) return b.core.listLocations('tenant_001').map(row => ({ ...row, tenantId: 'tenant_001', workspaceId: 'workspace-a' }));
      if (query.sql.includes('rental_fulfillment_operators')) return b.core.listOperators('tenant_001').map(row => ({ ...row, tenantId: 'tenant_001', workspaceId: 'workspace-a' }));
      return [{ id: 'workspace-a', status: 'ACTIVE', categoryVersionId: null, categoryAdoptionRevision: 0 }];
    } }));
  const repository = new RentalBusinessFactRepository(store.db);
  // Only the storage transport is replaced. Price calculation and Core quote
  // persistence methods are product code; this is not a MySQL lock test.
  b.business.factStore = repository;
  const prepared = await b.tools.quote.candidates.prepare(b.candidate);
  const formal = structuredClone(prepared.request);
  const context = { profile: b.core.getProfile('tenant_001'), category: await b.core.getWorkspaceCategory('tenant_001'),
    settings: b.core.getBusinessSettings('tenant_001'), groups: b.core.listItemGroups('tenant_001'),
    pricingGroups: b.core.listPricingGroups('tenant_001'), couponTemplates: b.core.listCouponTemplates('tenant_001'),
    locations: b.core.listLocations('tenant_001'), operators: b.core.listOperators('tenant_001') };
  const original = { key: requestFingerprint({ tenant: 'tenant_001', workspace: 'workspace-a', actor: 'synthetic-user', operation: 'original-quote' }),
    inputHash: requestFingerprint(formal) };
  await runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: 'synthetic-user',
    audience: 'operator', dataScope: 'all', isSaasAdmin: false }, async () => {
    store.control.loseReply = true;
    await assert.rejects(b.business.createQuoteForOriginalOperation('tenant_001', context, formal, original), /lost COMMIT reply/);
    assert.equal(store.state.rentalQuote.length, 1);
    const restarted = new RentalBusinessFactRepository(store.db);
    const recovered = await restarted.findQuoteForOriginalOperation('tenant_001', original);
    assert.equal(recovered.id, store.state.rentalQuote[0].id);
    assert.equal(recovered.sourceSnapshot.actor.id, 'synthetic-user');
    assert.equal(recovered.sourceSnapshot.workspaceId, 'workspace-a');
    const replay = await b.business.createQuoteForOriginalOperation('tenant_001', context, formal, original);
    assert.equal(replay.id, recovered.id); assert.equal(store.state.rentalQuote.length, 1);
    assert.equal(b.business.getQuote('tenant_001', context, replay.id).id, replay.id);
    assert.equal(replay.payableAmount, recovered.payableAmount);
    await assert.rejects(restarted.findQuoteForOriginalOperation('tenant_001', { ...original, inputHash: 'b'.repeat(64) }), e => e.getStatus() === 409);
    await assert.rejects(b.business.createQuoteForOriginalOperation('tenant_001', context,
      { ...formal, lines: [{ ...formal.lines[0], quantity: 2 }] }, original), e => e.getStatus() === 409);
    await assert.rejects(restarted.findQuoteForOriginalOperation('other-tenant', original), e => e.getStatus() === 403);
    assert.equal(await restarted.findQuoteForOriginalOperation('tenant_001', { ...original, key: 'a'.repeat(64) }), undefined);
    assert.equal(store.state.rentalQuote.length, 1);
    await repository.upsertQuote({ ...recovered, consumedAt: '2026-11-01T00:00:00Z', consumedOrderId: 'original-order' });
    assert.equal((await restarted.findQuoteForOriginalOperation('tenant_001', original)).consumedOrderId, 'original-order');
    await assert.rejects(repository.upsertQuote({ ...recovered, payableAmount: recovered.payableAmount + 1 }), e => e.getStatus() === 409);
    await assert.rejects(repository.upsertQuote({ ...recovered, inventoryBasis: {
      ...recovered.inventoryBasis, workspaceId: 'invented-space' } }), e => e.getStatus() === 409);
    await assert.rejects(repository.upsertQuote({ ...recovered, inventoryBasis: undefined }), e => e.getStatus() === 409);
    const next = { ...original, key: 'c'.repeat(64) };
    const first = { ...recovered, id: 'quote-race-a', quoteNo: 'quote-race-a' };
    const second = { ...recovered, id: 'quote-race-b', quoteNo: 'quote-race-b' };
    const winners = await Promise.all([repository.saveQuoteForOriginalOperation(first, next),
      restarted.saveQuoteForOriginalOperation(second, next)]);
    assert.equal(winners[0].id, winners[1].id); assert.equal(store.state.rentalQuote.length, 2);
    store.control.beforeCommit = () => { throw Error('synthetic quote write rollback'); };
    const rollback = { ...original, key: 'd'.repeat(64) };
    await assert.rejects(repository.saveQuoteForOriginalOperation({ ...first, id: 'rollback-quote' }, rollback), /rollback/);
    store.control.beforeCommit = undefined;
    assert.equal(await restarted.findQuoteForOriginalOperation('tenant_001', rollback), undefined);
    assert.equal(store.state.rentalQuote.length, 2);
  });
});

test('approved snapshot preparation can consume the existing Core validator as a public typed port', () => {
  assert.doesNotThrow(() => compiler.compile(`import { RentalOrderConfirmationService } from '../apps/api/src/modules/rental-core/rental-order-confirmation.service';
    const validate = RentalOrderConfirmationService.prototype.assertOrderMatchesQuote;
    export type QuoteBindingPort = Pick<RentalOrderConfirmationService, 'assertOrderMatchesQuote'>;
    export { validate };`, path.join(__dirname, 'ai-native-approved-order-core-port.ts')));
});
test('Core quote binding remains pure and rejects changed customer, booking identity, locations, dates and pricing groups', () => {
  const validate = RentalOrderConfirmationService.prototype.assertOrderMatchesQuote;
  assert.doesNotThrow(() => validate.call(null, input, quote));
  for (const change of [{ customerId: 'other' }, { bookingIdentity: { bookingIdentity: 'enterprise' } }, { fulfillmentLocationId: 'other' }, { returnLocationId: 'other' }, { fulfillmentMode: 'delivery' }, { startAt: '2026-10-10T12:00:00Z' }, { endAt: '2026-10-12T00:00:00Z' }, { lines: [{ ...input.lines[0], pricingGroupId: 'other' }] }, { lines: [{ ...input.lines[0], quantity: 3 }] }]) {
    assert.throws(() => validate.call(null, { ...input, ...change }, quote), error => error.getStatus() === 400);
  }
  assert.deepEqual(quote.request, input);
});

test('Core confirmation binds the delivery snapshot inside the quote consumption transaction', async () => {
  const h = await require('./fixtures/ai-native/approved-order-composition.cjs').approvedOrderHarness();
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  h.body.fulfillmentMode = 'delivery';
  const stored = h.state.records.quote[0];
  Object.assign(stored.request, { fulfillmentMode: 'delivery', deliveryAddressId: 'address-a' });
  stored.deliveryAddressSnapshot = { addressId: 'address-a', recipient: 'Synthetic customer', phoneMasked: '138****0000',
    countryCode: 'CN', province: 'Synthetic province', city: 'Synthetic city', detail: 'Original destination' };
  const original = structuredClone(stored.deliveryAddressSnapshot);
  let injected = false;
  h.state.onOperation = ({ model, op, records, inTransaction }) => {
    if (inTransaction && model === 'rentalOrder' && op === 'create') {
      injected = true; records.quote[0].deliveryAddressSnapshot.detail = 'Changed destination';
    }
  };
  const create = () => runWithRequestIdentity({ tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'operator-a', audience: 'operator', dataScope: 'all', isSaasAdmin: false },
    () => h.dependencies.confirmation.createOrder('tenant-a', h.body, 'Synthetic operator', { category: { code: 'camera' } }, 'delivery-binding'));
  await assert.rejects(create(), error => error.getStatus?.() === 409 && /报价事实已变化/u.test(error.message));
  assert.equal(injected, true);
  assert.equal(h.state.records.rentalOrder.length, 0);
  assert.equal(h.state.records.rentalOrderIdempotencyRecord.length, 0);
  assert.equal(h.state.records.quote[0].consumedAt, undefined);
  assert.deepEqual(h.state.records.quote[0].deliveryAddressSnapshot, original);
  h.state.onOperation = undefined;
  assert.equal((await create()).replayed, false);
  assert.equal((await create()).replayed, true);
  assert.equal(h.state.records.rentalOrder.length, 1);
  assert.equal(h.state.records.rentalOrderIdempotencyRecord.length, 1);
});

// Actual Core preparation and lock-time validation, with declared in-memory
// transport only. Native SQL/lock timing is tested in the owned database driver.
test('Core freezes kit targets and rejects changed composition, missing legacy evidence and cross-space evidence', async () => {
  const b = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup('camping');
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const { assertRentalInventoryBasis } = require('../apps/api/src/modules/rental-core/rental-quote-inventory-basis');
  await runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: 'synthetic-user',
    audience: 'operator', dataScope: 'all', isSaasAdmin: false }, async () => {
    const groups = b.core.listItemGroups('tenant_001'), kit = groups.find(row => row.inventoryMode === 'bundle');
    assert.ok(kit && kit.bundleComponents.length);
    b.facts.listAssets = async () => groups.flatMap(group => Array.from({ length: 4 }, (_, index) => ({
      id: group.id + '-asset-' + index, itemGroupId: group.id, locationId: b.location.id, status: 'available' })));
    b.facts.listStockBalances = async () => groups.map(group => ({ itemGroupId: group.id, locationId: b.location.id,
      onHandQuantity: 100, maintenanceQuantity: 0 }));
    const context = { ...b.quoteConfiguration, category: await b.core.getWorkspaceCategory('tenant_001') };
    const request = { customerType: 'personal', customerId: 'customer-a', startAt: b.candidate.start, endAt: b.candidate.end,
      fulfillmentMode: b.candidate.fulfillmentMode, fulfillmentLocationId: b.location.id,
      lines: [{ itemGroupId: kit.id, quantity: 1, pricingUnit: 'day_24h' }] };
    request.lines[0].pricingGroupId = b.core.listPricingGroups('tenant_001').find(row => row.memberItemGroupIds.includes(kit.id)).id;
    const rates = await b.business.listSpaceRatesAt('tenant_001', context, request.startAt);
    const rate = rates.find(row => (row.pricingGroupId ?? row.itemGroupId) === request.lines[0].pricingGroupId);
    assert.ok(rate); request.lines[0].pricingUnit = rate.unit;
    const normal = await b.core.resolvePricingGroupQuoteRequest('tenant_001', request);
    const quoted = await b.business.createQuote('tenant_001', context, normal);
    assert.ok(quoted.inventoryBasis); assert.equal(quoted.inventoryBasis.version, 'rental-quote-inventory-1');
    const body = { ...quoted.request, quoteId: quoted.id, customerName: 'Synthetic customer' };
    const order = await b.core.prepareOrder('tenant_001', body, 'Synthetic operator', quoted);
    assert.deepEqual(order.reservations.map(row => [row.itemGroupId, row.quantity]).sort(),
      kit.bundleComponents.filter(row => !row.optional).map(row => [row.itemGroupId, row.quantity]).sort());
    const original = structuredClone(quoted.inventoryBasis), tx = {};
    await assertRentalInventoryBasis(b.core.configStore, 'tenant_001', 'workspace-a', quoted.request.lines, original, tx);
    const changed = structuredClone(groups);
    changed.find(row => row.id === kit.id).bundleComponents[0].quantity += 1;
    b.core.configStore.listItemGroupsPage = async (_tenant, _workspace, query, presentedTx) => {
      assert.equal(presentedTx, tx);
      return { rows: changed.filter(row => row.id === query.itemGroupId), truncated: false,
        source: 'persisted_workspace_configuration', configurationVersion: 'not-a-business-version' };
    };
    let inventoryLocks = 0; b.facts.lockInventoryTargets = async () => { inventoryLocks++; };
    const availability = { locationId: b.location.id, startAt: body.startAt, endAt: body.endAt, lines: body.lines };
    await assert.rejects(b.core.assertAvailabilityWithLocks('tenant_001', availability, tx, quoted.ruleSnapshot, quoted),
      error => error.getStatus?.() === 409 && /组成已变化/u.test(error.message));
    assert.equal(inventoryLocks, 0); assert.deepEqual(quoted.inventoryBasis, original);
    await assert.rejects(b.core.prepareOrder('tenant_001', body, 'Synthetic operator', { ...quoted, inventoryBasis: undefined }),
      error => error.getStatus?.() === 409);
    await assert.rejects(b.core.prepareOrder('tenant_001', body, 'Synthetic operator', {
      ...quoted, inventoryBasis: { ...original, workspaceId: 'another-space' } }), error => error.getStatus?.() === 409);
    const unchanged = structuredClone(groups).reverse();
    for (const row of unchanged) { row.updatedAt = '2099-01-01T00:00:00Z'; row.bundleComponents.reverse(); }
    b.core.configStore.listItemGroupsPage = async (_tenant, _workspace, query) => ({ rows: unchanged.filter(row => row.id === query.itemGroupId),
      truncated: false, source: 'persisted_workspace_configuration', configurationVersion: 'changed-timestamp-only' });
    await assertRentalInventoryBasis(b.core.configStore, 'tenant_001', 'workspace-a', quoted.request.lines, original, tx);
  });
});

test('Core same-key receipt replay precedes missing inventory evidence and current object changes', async () => {
  const h = await require('./fixtures/ai-native/approved-order-composition.cjs').approvedOrderHarness();
  const { runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  const create = () => runWithRequestIdentity({ tenantId: 'tenant-a', workspaceId: 'workspace-a', userId: 'operator-a',
    audience: 'operator', dataScope: 'all', isSaasAdmin: false }, () => h.dependencies.confirmation.createOrder('tenant-a', h.body,
      'Synthetic operator', { category: { code: 'camera' } }, 'original-inventory-replay'));
  const first = await create();
  h.dependencies.core.prepareOrder = async () => { throw Error('must not prepare an already committed operation'); };
  h.dependencies.core.assertAvailabilityWithLocks = async () => { throw Error('must not retry committed inventory'); };
  const replay = await create();
  assert.equal(replay.replayed, true); assert.equal(replay.order.id, first.order.id);
  assert.equal(h.state.records.rentalOrder.length, 1); assert.equal(h.state.records.rentalOrderIdempotencyRecord.length, 1);
});
