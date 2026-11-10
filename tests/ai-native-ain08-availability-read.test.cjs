'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node' } });
const { AiAvailabilityReadFactsService } = require('../apps/api/src/modules/ai-native/availability-read-facts.service');
const input = { locationId: 'location-a', startAt: '2026-10-10T00:00:00Z', endAt: '2026-10-11T00:00:00Z', lines: [{ itemGroupId: 'group-a', quantity: 1 }] };
const context = { contractVersion: 'ain-c03-draft-1', requestId: 'req-avail', authorizedAt: '2026-10-05T00:00:00Z', audience: 'staff', actor: { kind: 'user', userId: 'user-avail' }, scope: { kind: 'workspace', tenantId: 'tenant-avail', workspaceId: 'workspace-avail' }, access: { permissions: ['rental-os:order:view'], dataScope: 'all', locationScope: { mode: 'selected', locationIds: ['location-a'] } } };
const authority = value => ({ withRead: async (_kind, _input, read) => read(typeof value === 'function' ? value() : value) });
const output = { available: true, locationId: input.locationId, startAt: input.startAt, endAt: input.endAt, lines: [{ itemGroupId: 'group-a', itemGroupCode: 'camera-a', itemGroupName: 'Camera', inventoryMode: 'quantity', requestedQuantity: 1, availableQuantity: 2, available: true, reasons: [] }] };
test('availability projection delegates calculation to Core and preserves returned facts', async () => {
  let calls = 0; const service = new AiAvailabilityReadFactsService({ readAvailability: async (tenantId, value) => { calls++; assert.equal(tenantId, 'tenant-avail'); assert.deepEqual(value, input); return output; } }, authority(context), () => new Date('2026-10-05T01:00:00Z'));
  const result = await service.read(input); assert.deepEqual(result.result, output); assert.equal(calls, 1);
});
test('selected location scope rejects before Core and projection does not reserve stock', async () => {
  let calls = 0; const service = new AiAvailabilityReadFactsService({ readAvailability: async () => { calls++; return output; } }, authority({ ...context, access: { ...context.access, locationScope: { mode: 'selected', locationIds: [] } } }));
  await assert.rejects(() => service.read(input), error => error.code === 'FORBIDDEN'); assert.equal(calls, 0);
});

test('legacy initialization availability port cannot be composed as an R0 reader', () => {
  assert.throws(() => new AiAvailabilityReadFactsService({ availability: async () => output }, authority(context)),
    error => error.code === 'CONFIG_INVALID');
});

test('projection rejects a Core result that is not bound to the requested availability lines', async () => {
  const mismatched = { ...output, lines: [{ ...output.lines[0], itemGroupId: 'group-other', requestedQuantity: 99 }] };
  const service = new AiAvailabilityReadFactsService(
    { readAvailability: async () => mismatched },
    authority(context)
  );
  await assert.rejects(() => service.read(input), error => error.code === 'INVALID_RESPONSE');
});

test('availability projection rejects contradictory Core success without deriving replacement stock facts', async () => {
  const malformed = [
    { ...output, lines: [{ ...output.lines[0], available: false }] },
    { ...output, available: false },
    { ...output, lines: [{ ...output.lines[0], availableQuantity: 0 }] }
  ];
  for (const result of malformed) {
    let calls = 0;
    const service = new AiAvailabilityReadFactsService({ readAvailability: async () => { calls++; return result; } }, authority(context));
    await assert.rejects(service.read(input), error => error.code === 'INVALID_RESPONSE');
    assert.equal(calls, 1, 'a contradictory result is rejected, never retried or recalculated');
  }
});

// Query-recording doubles exercise the real repository. They return explicitly
// supplied rows; they do not emulate MySQL filtering, locking or transactions.
function repositoryFixture(beforeRead) {
  const { RentalCoreFactRepository } = require('../apps/api/src/modules/rental-core/rental-core-fact.repository');
  const scope = { tenantId: 'tenant-avail', workspaceId: 'workspace-avail', locationId: 'location-a', itemGroupId: 'group-a' };
  const rows = { reservations: [{ ...scope, quantity: 3, releasedQuantity: 1, status: 'CONFIRMED',
    startAt: new Date('2026-10-10T00:00:00Z'), endAt: new Date('2026-10-11T00:00:00Z'),
    order: { tenantId: scope.tenantId, workspaceId: scope.workspaceId,
      ruleSnapshot: { fulfillment: { pickupBufferMinutes: 30, returnBufferMinutes: 60 } } } }],
    assets: [{ ...scope, id: 'asset-a', status: 'AVAILABLE' }], stocks: [{ ...scope, onHandQuantity: 7, maintenanceQuantity: 2 }],
    workOrders: [{ ...scope, assetId: 'asset-a', locationId: 'historical-location', itemGroupId: 'historical-group' }] };
  const queries = [];
  const delegate = name => ({ findMany: async query => { queries.push({ name, query: structuredClone(query) });
    await beforeRead?.(name); return structuredClone(rows[name]); } });
  const db = { businessWorkspace: { findFirst: async query => {
    assert.deepEqual(query.where, { id: scope.workspaceId, tenantId: scope.tenantId }); return { id: scope.workspaceId }; } },
    rentalReservation: delegate('reservations'), rentalAsset: delegate('assets'), rentalStockBalance: delegate('stocks'),
    rentalWorkOrder: delegate('workOrders') };
  const repository = new RentalCoreFactRepository(db);
  const identity = { tenantId: scope.tenantId, workspaceId: scope.workspaceId, userId: 'user-a', isSaasAdmin: false,
    dataScope: 'all', locationScope: { mode: 'selected', locationIds: [scope.locationId] } };
  const read = (value = { locationId: scope.locationId, itemGroupIds: [scope.itemGroupId] }, actor = identity) =>
    require('../apps/api/src/common/request-identity').runWithRequestIdentity(actor,
      () => repository.readAvailabilitySnapshot(scope.tenantId, scope.workspaceId, value));
  return { rows, queries, identity, read };
}

test('actual availability repository bounds every query and retains original occupancy without sensitive bodies', async () => {
  const h = repositoryFixture(), result = await h.read();
  assert.equal(h.queries.length, 3);
  for (const { name, query } of h.queries) {
    assert.equal(query.take, 10001); assert.deepEqual(query.orderBy, { id: 'asc' });
    assert.equal(query.where.tenantId, 'tenant-avail'); assert.equal(query.where.workspaceId, 'workspace-avail');
    assert.equal(query.where.locationId, 'location-a'); assert.deepEqual(query.where.itemGroupId, { in: ['group-a'] });
    assert.equal(query.include, undefined);
    if (name === 'reservations') {
      assert.ok(query.where.status.in.length > 0); assert.equal(query.where.OR[0].expiresAt, null);
      assert.ok(query.where.OR[1].expiresAt.gte instanceof Date);
      assert.equal(query.select.order.select.allocations, undefined);
    }
  }
  assert.deepEqual(result.reservations, [{ itemGroupId: 'group-a', locationId: 'location-a', quantity: 2,
    startAt: '2026-10-09T23:30:00.000Z', endAt: '2026-10-11T01:00:00.000Z' }]);
  assert.deepEqual(result.assets, [{ itemGroupId: 'group-a', locationId: 'location-a', status: 'available' }]);
  assert.deepEqual(result.stocks, [{ itemGroupId: 'group-a', locationId: 'location-a', onHandQuantity: 7, maintenanceQuantity: 2 }]);
  h.rows.reservations[0].status = 'FULFILLED'; h.rows.reservations[0].order.ruleSnapshot = {};
  assert.equal((await h.read()).reservations[0].endAt, '9999-12-30T00:00:00.000Z');
});

test('actual repository refuses all inventory overflow and invalid ownership rather than computing a partial result', async () => {
  for (const kind of ['reservations', 'assets', 'stocks']) {
    const h = repositoryFixture(); h.rows[kind] = Array.from({ length: 10001 }, () => structuredClone(h.rows[kind][0]));
    await assert.rejects(h.read(), /不能按部分事实计算/);
  }
  for (const kind of ['reservations', 'assets', 'stocks']) {
    const h = repositoryFixture(); h.rows[kind][0].workspaceId = 'other-space';
    await assert.rejects(h.read(), /来源变化/);
  }
  const h = repositoryFixture(); h.rows.reservations[0].order.tenantId = 'other-tenant';
  await assert.rejects(h.read(), /来源变化/);
});

test('actual repository requires explicit current space and location, and keeps own-asset filtering bounded', async () => {
  for (const actor of [{ ...repositoryFixture().identity, workspaceId: undefined },
    { ...repositoryFixture().identity, locationScope: { mode: 'selected', locationIds: [] } }]) {
    const h = repositoryFixture(); await assert.rejects(h.read(undefined, actor), /经营空间|地点/); assert.equal(h.queries.length, 0);
  }
  for (const value of [{ locationId: 'location-a', itemGroupIds: new Array(1) },
    { locationId: 'location-a', itemGroupIds: ['group-a', 'group-a'] },
    { locationId: 'location-a', itemGroupIds: ['group-a'], sql: 'not-permitted' }]) {
    const h = repositoryFixture(); await assert.rejects(h.read(value), /参数无效/); assert.equal(h.queries.length, 0);
  }
  const h = repositoryFixture();
  h.rows.assets.push({ ...h.rows.assets[0], id: 'not-owned' });
  const result = await h.read(undefined, { ...h.identity, dataScope: 'own' });
  const owned = h.queries.find(row => row.name === 'workOrders').query;
  assert.equal(owned.take, 10001); assert.deepEqual(owned.distinct, ['assetId']);
  assert.equal(owned.where.tenantId, 'tenant-avail'); assert.equal(owned.where.workspaceId, 'workspace-avail');
  // Work-order location/group are historical; ownership follows the asset even
  // after a cross-location return. Only CURRENT assets bound the candidate set.
  assert.equal(owned.where.locationId, undefined); assert.equal(owned.where.itemGroupId, undefined);
  assert.deepEqual(owned.where.assetId, { in: ['asset-a', 'not-owned'] });
  assert.deepEqual(owned.where.OR, [{ createdBy: 'user-a' }, { assigneeId: 'user-a' }]);
  const assetQuery = h.queries.find(row => row.name === 'assets').query;
  assert.equal(assetQuery.take, 10001); assert.equal(assetQuery.where.locationId, 'location-a');
  assert.deepEqual(assetQuery.where.itemGroupId, { in: ['group-a'] });
  assert.deepEqual(result.assets, [{ itemGroupId: 'group-a', locationId: 'location-a', status: 'available' }]);
  h.rows.workOrders = Array.from({ length: 10001 }, () => ({ assetId: 'asset-a' }));
  await assert.rejects(h.read(undefined, { ...h.identity, dataScope: 'own' }), /本人库存读取超出上限/);
  const revoked = repositoryFixture(name => {
    if (name === 'assets') require('../apps/api/src/common/request-identity').getRequestIdentity().locationScope = { mode: 'selected', locationIds: [] };
  });
  await assert.rejects(revoked.read(), /身份或范围变化/);
});

test('actual Core read serves all four definition-driven categories without initialization or inventory writes', async () => {
  const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
  for (const category of Object.values(require('@rental-os/shared').RentalCategoryCode)) {
    const h = await setup(category), group = h.core.listItemGroups('tenant_001').find(row => row.inventoryMode !== 'bundle');
    const request = { ...input, locationId: h.location.id, lines: [{ itemGroupId: group.id, quantity: 1 }] };
    const snapshot = { reservations: [{ itemGroupId: group.id, locationId: h.location.id, quantity: 2, startAt: input.startAt, endAt: input.endAt }],
      assets: Array.from({ length: 3 }, () => ({ itemGroupId: group.id, locationId: h.location.id, status: 'available' })),
      stocks: [{ itemGroupId: group.id, locationId: h.location.id, onHandQuantity: 7, maintenanceQuantity: 2 }] };
    h.facts.readAvailabilitySnapshot = async (tenant, workspace, query) => {
      assert.equal(tenant, 'tenant_001'); assert.equal(workspace, 'workspace-a');
      assert.deepEqual(query, { locationId: h.location.id, itemGroupIds: [group.id] }); return structuredClone(snapshot);
    };
    const before = [structuredClone(h.core.configStore.writes), structuredClone(h.facts.writes)];
    const observed = await h.tools.availability.read(request);
    assert.equal(observed.result.lines[0].availableQuantity, group.inventoryMode === 'serialized' ? 1 : 3);
    assert.deepEqual(observed.result, h.core.computeAvailability({ itemGroups: [group] }, snapshot, request));
    assert.deepEqual([h.core.configStore.writes, h.facts.writes], before);
    delete h.facts.readAvailabilitySnapshot;
    await assert.rejects(h.tools.availability.read(request), error => error.code === 'PROVIDER_UNAVAILABLE');
    assert.deepEqual([h.core.configStore.writes, h.facts.writes], before);
  }
});

test('Core resolves persisted bundle dependencies and fails closed on missing config, oversized graphs and read-time revocation', async () => {
  const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
  const h = await setup(), group = h.core.listItemGroups('tenant_001').find(row => row.inventoryMode !== 'bundle');
  group.inventoryMode = 'quantity';
  const bundle = { ...group, id: 'bundle-a', code: 'BUNDLE', name: 'Bundle', inventoryMode: 'bundle',
    bundleComponents: [{ itemGroupId: group.id, itemGroupCode: group.code, itemGroupName: group.name, quantity: 2 }] };
  const queries = [], before = [structuredClone(h.core.configStore.writes), structuredClone(h.facts.writes)];
  h.core.configStore.listItemGroupsPage = async (_tenant, _workspace, query) => {
    queries.push(query.itemGroupId);
    const row = [group, bundle].find(row => row.id === query.itemGroupId);
    return { rows: row ? [structuredClone(row)] : [], truncated: false, nextCursor: null,
      source: 'persisted_workspace_configuration', configurationVersion: '1'.repeat(64) };
  };
  h.facts.readAvailabilitySnapshot = async (_tenant, _workspace, query) => {
    assert.deepEqual(query.itemGroupIds, ['bundle-a', group.id]);
    return { reservations: [], assets: [], stocks: [{ itemGroupId: group.id, locationId: h.location.id, onHandQuantity: 5, maintenanceQuantity: 1 }] };
  };
  const request = { ...input, locationId: h.location.id, lines: [{ itemGroupId: bundle.id, quantity: 2 }] };
  assert.equal((await h.tools.availability.read(request)).result.lines[0].availableQuantity, 2);
  assert.deepEqual(queries, ['bundle-a', group.id]);
  // Each line can fit separately while their shared component demand cannot.
  // Preserve Core's merged-demand decision, rather than deriving success from
  // the per-line availableQuantity returned for the independent requests.
  const merged = await h.tools.availability.read({ ...request,
    lines: [...request.lines, { itemGroupId: group.id, quantity: 1 }] });
  assert.equal(merged.result.available, false);
  assert.ok(merged.result.lines.every(line => line.availableQuantity >= line.requestedQuantity && line.available === false));
  assert.ok(merged.result.lines.every(line => line.reasons.some(reason => reason.includes('合并需求'))));
  group.id = 'missing-original'; await assert.rejects(h.tools.availability.read(request), error => error.code === 'PROVIDER_UNAVAILABLE');
  group.id = bundle.bundleComponents[0].itemGroupId;
  bundle.bundleComponents = Array.from({ length: 100 }, (_, index) => ({ itemGroupId: `dependency-${index}`, quantity: 1 }));
  await assert.rejects(h.tools.availability.read(request), error => error.code === 'PROVIDER_UNAVAILABLE');
  bundle.bundleComponents = [];
  const { getRequestIdentity, runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
  for (const malformed of [{ ...request, sql: 'not-permitted' }, { ...request, lines: new Array(1) },
    { ...request, lines: [{ itemGroupId: bundle.id, quantity: 1, workspaceId: 'other-space' }] }]) {
    await assert.rejects(runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: 'user-a', isSaasAdmin: false },
      () => h.core.readAvailability('tenant_001', malformed)), /查询明细无效/);
  }
  await assert.rejects(runWithRequestIdentity({ tenantId: 'tenant_001', workspaceId: 'workspace-a', userId: 'user-a', isSaasAdmin: false,
    locationScope: { mode: 'all', locationIds: [] } }, async () => {
    h.facts.readAvailabilitySnapshot = async () => { getRequestIdentity().workspaceId = 'other-space'; return { assets: [], stocks: [], reservations: [] }; };
    return h.core.readAvailability('tenant_001', request);
  }), /身份或范围变化/);
  assert.deepEqual([h.core.configStore.writes, h.facts.writes], before);
});
