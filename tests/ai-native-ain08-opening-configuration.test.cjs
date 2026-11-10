'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreConfigRepository, RENTAL_OPENING_TERMINOLOGY_FIELDS } = require('../apps/api/src/modules/rental-core/rental-core-config.repository');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/src/common/request-identity');
const { RENTAL_CATEGORY_DEFINITIONS } = require('@rental-os/shared');
const { setup } = require('./fixtures/ai-native/lane-a-business-consumption.cjs');
const T = 'tenant-a', W = 'workspace-a', owns = { tenantId: T, workspaceId: W };
const scoped = read => runWithRequestIdentity({ ...owns, userId: 'user-a', isSaasAdmin: false }, read);
const never = () => { throw Error('unbounded/cache/initialization read must not run'); };

// Returned rows and query recorders only. This does not interpret SQL, emulate
// JSON transport/relations or prove MySQL ordering, limits or integrity.
function fixture(code = 'camera') {
  const def = RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === code), queries = [];
  const state = { metadata: [{ ...owns, categoryCode: code, configVersion: '1.0',
    options: { configVersion: '1.0', currency: 'CNY', defaultUnit: def.businessModel.defaultPricingUnit,
      enabledUnits: [def.businessModel.defaultPricingUnit, 'unsupported-unit'], enabledModes: ['unsupported-mode'] },
    profileVersion: '1.0', profileCategoryCode: code, terminology: Object.fromEntries(RENTAL_OPENING_TERMINOLOGY_FIELDS.map(field => [field, null])) }],
    groups: [{ ...owns, id: 'item-a', code: 'ITEM', status: 'enabled', inventoryMode: 'SERIALIZED', unit: '台' }],
    pricing: [{ ...owns, id: 'pricing-a', code: 'PRICE', status: 'enabled', version: 1 }],
    locations: [{ ...owns, id: 'location-a', code: 'LOC', status: 'enabled', capabilities: ['pickup', 'return'] }],
    enabledItems: 1, enabledLocations: 1, afterRead: undefined };
  const capture = (name, result) => async query => {
    queries.push({ name, query: structuredClone(query) });
    const value = structuredClone(result()); await state.afterRead?.(name); return value;
  };
  const db = {
    businessWorkspace: { findFirst: capture('workspace', () => ({ id: W, tenantId: T, categoryCode: code.toUpperCase() })) },
    rentalItemGroup: { findMany: capture('items', () => state.groups), count: capture('itemCount', () => state.enabledItems) },
    rentalPricingGroup: { findMany: capture('pricing', () => state.pricing) },
    rentalFulfillmentLocation: { count: capture('locationCount', () => state.enabledLocations), findMany: never },
    $queryRaw: async query => {
      const name = query.sql.includes('FROM rental_fulfillment_locations') ? 'locations' : 'metadata';
      queries.push({ name, query: { sql: query.sql, values: query.values } });
      const result = structuredClone(name === 'locations' ? state.locations : state.metadata);
      await state.afterRead?.(name); return result;
    }
  };
  const repo = new RentalCoreConfigRepository(db), core = new RentalCoreService(repo, {});
  repo.loadAll = never;
  for (const method of ['getProfile', 'getBusinessSettings', 'getWorkspaceCategory', 'listItemGroups', 'listPricingGroups', 'listLocations', 'listOperators', 'listCouponTemplates']) core[method] = never;
  return { state, queries, repo, core, def };
}

for (const { code } of RENTAL_CATEGORY_DEFINITIONS) test(`${code}: opening uses persisted minimal fields without cached quote context and shares original option normalization`, async () => {
  const f = fixture(code), out = await scoped(() => f.core.readOpeningConfiguration(T));
  assert.equal(f.core.states.size, 0);
  assert.deepEqual(out.settings.pricing.enabledUnits, [f.def.businessModel.defaultPricingUnit]);
  assert.deepEqual(out.settings.fulfillment.enabledModes, [f.def.businessModel.fulfillmentModes[0]]);
  assert.equal(out.profile.terminology.itemLabel, f.def.terminology.itemLabel);
  assert.equal(out.categoryVersion, f.def.version);
  for (const name of ['items', 'pricing']) {
    const q = f.queries.find(row => row.name === name).query;
    assert.equal(q.take, 101); assert.deepEqual(q.orderBy, { id: 'asc' }); assert.deepEqual(q.where, owns);
    assert.equal('include' in q, false); assert.equal('members' in q.select, false); assert.equal('bundleComponents' in q.select, false);
  }
  const meta = f.queries.find(row => row.name === 'metadata').query;
  assert.ok(meta.values.includes(T) && meta.values.includes(W));
  assert.match(meta.sql, /w\.isDefault = TRUE/u); assert.match(meta.sql, /OCTET_LENGTH/u); assert.match(meta.sql, /LEFT\(JSON_UNQUOTE/u);
  assert.doesNotMatch(meta.sql, /SELECT\s+\*|credentials|apiKey|capabilities\s+FROM/iu);
  const locations = f.queries.find(row => row.name === 'locations').query;
  assert.equal(locations.values.at(-1), 101); assert.match(locations.sql, /ORDER BY l\.id/u);
  assert.doesNotMatch(locations.sql, /address|contactPhone|operatorName/u);
});

test('101 sentinel yields a 100-row page with explicit truncation and counts independent of the page', async () => {
  const f = fixture();
  f.state.groups = Array.from({ length: 101 }, (_unused, i) => ({ ...owns, id: `item-${i}`, code: `I-${i}`, status: 'disabled', inventoryMode: 'SERIALIZED', unit: '台' }));
  f.state.enabledItems = 3;
  const out = await scoped(() => f.core.readOpeningConfiguration(T));
  assert.equal(out.groups.length, 100); assert.equal(out.truncated.groups, true); assert.equal(out.enabledItemGroupCount, 3);
  assert.ok(out.groups.every(row => row.status === 'disabled'));
  f.state.groups.push({ ...f.state.groups[0], id: 'overflow' });
  await assert.rejects(scoped(() => f.core.readOpeningConfiguration(T)), /读取上限/u);
});

test('even a foreign or malformed sentinel is refused rather than concealed by slicing', async () => {
  const f = fixture();
  f.state.groups = Array.from({ length: 101 }, (_unused, i) => ({ ...f.state.groups[0], id: `item-${i}` }));
  f.state.groups[100].workspaceId = 'foreign';
  await assert.rejects(scoped(() => f.core.readOpeningConfiguration(T)));
  f.state.groups[100].workspaceId = W; f.state.groups[100].status = 'invented';
  await assert.rejects(scoped(() => f.core.readOpeningConfiguration(T)));
});

test('missing persisted settings/profile and malformed or oversized selected JSON remain unavailable or refused', async () => {
  for (const mutate of [
    f => { f.state.metadata = []; },
    f => { f.state.metadata[0].workspaceId = 'foreign'; },
    f => { f.state.metadata[0].options.configVersion = 'different'; },
    f => { f.state.metadata[0].options.currency = 'invalid'; },
    f => { f.state.metadata[0].options.enabledUnits = { invalid: true }; },
    f => { f.state.metadata[0].terminology.itemLabel = '!'.repeat(81); },
    f => { f.state.locations[0].capabilities = { invalid: true }; },
    f => { f.state.enabledItems = NaN; }
  ]) { const f = fixture(); mutate(f); await assert.rejects(scoped(() => f.core.readOpeningConfiguration(T))); }
  const f = fixture(); f.state.metadata[0].profileVersion = null; f.state.metadata[0].profileCategoryCode = null;
  assert.equal((await scoped(() => f.core.readOpeningConfiguration(T))).profile, null);
});

test('selected locations constrain both the SQL page and scalar count, with narrowing rejected after read', async () => {
  const f = fixture();
  const identity = { ...owns, userId: 'user-a', isSaasAdmin: false, locationScope: { mode: 'selected', locationIds: ['location-a', 'location-b'] } };
  await runWithRequestIdentity(identity, () => f.core.readOpeningConfiguration(T));
  assert.deepEqual(f.queries.find(row => row.name === 'locationCount').query.where.id, { in: ['location-a', 'location-b'] });
  const sql = f.queries.find(row => row.name === 'locations').query;
  assert.match(sql.sql, /l\.id IN/u); assert.ok(sql.values.includes('location-a') && sql.values.includes('location-b'));
  f.state.afterRead = async name => { if (name === 'locations') getRequestIdentity().locationScope.locationIds = ['location-a']; };
  await assert.rejects(runWithRequestIdentity(identity, () => f.core.readOpeningConfiguration(T)));
});

test('actual opening actions/sections/materials use the new context without touching full Core readers', async () => {
  const h = await setup();
  for (const method of ['getProfile', 'getBusinessSettings', 'getWorkspaceCategory', 'listItemGroups', 'listPricingGroups', 'listLocations', 'listOperators', 'listCouponTemplates']) h.core[method] = never;
  assert.ok((await h.tools.openingActions.read()).configuration.products.rows.length > 0);
  assert.equal((await h.tools.openingSection({ key: 'workspace_profile' })).status, 'ready_for_human_review');
  assert.ok(Array.isArray((await h.tools.openingActions.requiredMaterials()).rows));
});

test('page truncation does not misclassify an enabled product/location outside the returned page as absent', async () => {
  const h = await setup();
  h.openingConfiguration.groups.forEach(row => { row.status = 'disabled'; });
  h.openingConfiguration.locations.forEach(row => { row.status = 'disabled'; });
  h.openingConfiguration.truncated = { groups: true, pricingGroups: false, locations: true };
  h.openingConfiguration.enabledItemGroupCount = 1; h.openingConfiguration.enabledLocationCount = 1;
  const real = h.business.readTenantReadiness.bind(h.business);
  h.business.readTenantReadiness = async (...args) => {
    const value = await real(...args);
    value.items.filter(row => ['item_groups', 'fulfillment_network'].includes(row.key)).forEach(row => { row.done = false; });
    return value;
  };
  const out = await h.tools.openingActions.read();
  assert.equal(out.configuration.products.truncated, true); assert.equal(out.configuration.fulfillment.truncated, true);
  for (const key of ['item_groups', 'fulfillment_network']) assert.equal(out.sections.find(row => row.key === key).status, 'readiness_unsatisfied');
});

test('current Guard withdrawal, changed projection and missing profile source cannot produce an adopted difference', async () => {
  let h = await setup(); h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.openingActions.read());
  h = await setup(); h.openingConfiguration.profile = null;
  await assert.rejects(h.tools.openingActions.prepareDifference({ expectedVersion: '1.0', changes: [{ field: 'itemLabel', value: '新名称' }] }), error => error.code === 'PROVIDER_UNAVAILABLE');
  h = await setup();
  const read = h.core.configStore.readOpeningConfigurationFacts, snapshot = h.openingConfiguration;
  h.core.configStore.readOpeningConfigurationFacts = async (...args) => { const value = await read(...args); snapshot.settings.configVersion = 'changed'; return value; };
  await assert.rejects(h.tools.openingActions.read(), error => error.code === 'CONFIG_INVALID');
});

test('report metadata uses one bounded joined observation for all four category definitions and rejects missing or corrupt facts', async () => {
  for (const { code } of RENTAL_CATEGORY_DEFINITIONS) {
    const queries = [];
    let rows = [{ ...owns, categoryCode: code.toUpperCase(), settingsCategoryCode: code.toUpperCase(), currency: 'USD' }];
    const db = { businessWorkspace: { findFirst: async () => ({ id: W }) }, $queryRaw: async query => {
      queries.push({ sql: query.sql, values: query.values }); return structuredClone(rows);
    } };
    const repo = new RentalCoreConfigRepository(db), core = new RentalCoreService(repo, {});
    repo.loadAll = never;
    for (const method of ['getProfile', 'getBusinessSettings', 'getWorkspaceCategory', 'listItemGroups', 'listPricingGroups', 'listLocations', 'listOperators', 'listCouponTemplates']) core[method] = never;
    const result = await scoped(() => core.readReportConfiguration(T));
    assert.deepEqual(result, { ...owns, categoryCode: code, currency: 'USD' });
    assert.equal(queries.length, 1); assert.equal(core.states.size, 0);
    assert.match(queries[0].sql, /JOIN rental_tenant_business_settings/u); assert.match(queries[0].sql, /LIMIT 1/u);
    assert.match(queries[0].sql, /LEFT\(JSON_UNQUOTE/u); assert.deepEqual(queries[0].values, [T, W]);
    assert.doesNotMatch(queries[0].sql, /SELECT\s+\*|profile|coupon|operator|credentials|apiKey/iu);
    for (const corrupt of [[], [{ ...rows[0], currency: null }], [{ ...rows[0], currency: 'USDX' }],
      [{ ...rows[0], workspaceId: 'foreign' }], [{ ...rows[0], settingsCategoryCode: 'UNKNOWN' }],
      [rows[0], rows[0]]]) {
      const before = rows; rows = corrupt; await assert.rejects(scoped(() => core.readReportConfiguration(T))); rows = before;
    }
    const read = repo.readReportConfigurationFacts.bind(repo);
    repo.readReportConfigurationFacts = async (...args) => {
      const value = await read(...args); getRequestIdentity().locationScope = { mode: 'selected', locationIds: [] }; return value;
    };
    await assert.rejects(scoped(() => core.readReportConfiguration(T)), /授权范围变化/u);
  }
});

test('actual risk tool needs only report permission and reads minimal metadata once without quote configuration', async () => {
  const h = await setup();
  h.h.identity.user.permissions = ['rental-os:report:view'];
  let reads = 0;
  h.core.configStore.readReportConfigurationFacts = async () => {
    reads++; return { tenantId: 'tenant_001', workspaceId: 'workspace-a', categoryCode: 'camera', currency: 'CNY' };
  };
  for (const method of ['getProfile', 'getBusinessSettings', 'getWorkspaceCategory', 'listItemGroups', 'listPricingGroups', 'listLocations', 'listOperators', 'listCouponTemplates']) h.core[method] = never;
  const range = { from: '2026-11-01T00:00:00Z', to: '2026-11-02T00:00:00Z' };
  const out = await h.tools.risks.read(range);
  assert.equal(out.currency, 'CNY'); assert.equal(reads, 1);
  assert.equal(out.profit.status, 'unavailable'); assert.equal(out.historicalUtilization.status, 'unavailable');
  h.h.identity.user.permissions = [];
  await assert.rejects(h.tools.risks.read(range)); assert.equal(reads, 1);
});
