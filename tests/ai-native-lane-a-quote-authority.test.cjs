'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiQuoteRouteAuthority, AiGuardedQuoteCoreContextSource, composeAiGuardedQuoteTools } = require('../apps/api/src/modules/ai-native/tools/quote-route.composition');
const { AiQuotePreviewService } = require('../apps/api/src/modules/ai-native/quote-preview.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const stores = require('./helpers/absorbing-config-store.cjs');
const input = { customerType: 'personal', customerId: 'customer-a', fulfillmentMode: 'store_pickup_return', fulfillmentLocationId: 'location-a',
  startAt: '2026-11-10T09:00:00+08:00', endAt: '2026-11-11T09:00:00+08:00', lines: [{ itemGroupId: 'group-a', quantity: 1 }] };
async function setup() {
  const h = await authorizedRunnerHarness();
  h.identity.user.permissions.push('rental-os:order:create');
  const bridge = new AiBusinessReadRouteAuthority(new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), h.authorization.credentials);
  return { ...h, bridge, authority: new AiQuoteRouteAuthority(bridge) };
}
test('formal R1 quote callback runs only under original quote Guard and ALS', async () => {
  const h = await setup();
  assert.equal(await h.authority.withQuote(input, async c => { assert.equal(c.scope.workspaceId, 'workspace-a'); return 'quote'; }), 'quote');
});
test('selected authorized fulfillment location is mapped to original Guard field without accepting caller scope', async () => {
  const h = await setup(); h.identity.user.locationScope = { mode: 'selected', locationIds: ['location-a'] };
  assert.equal(await h.authority.withQuote(input, async () => true), true);
  await assert.rejects(h.authority.withQuote({ ...input, returnLocationId: 'location-b' }, async () => true));
  await assert.rejects(h.authority.withQuote({ ...input, tenantId: 'tenant-b' }, async () => true));
});
test('enterprise payer intent reaches original quote Guard intact, without granting order authority', async () => {
  const h = await setup(); let calls = 0, guardedInput;
  await assert.rejects(h.authority.withQuote({ ...input, customerType: 'corporate' }, async () => { calls++; }), e => e.code === 'CAPABILITY_UNSUPPORTED');
  const withQuote = h.bridge.withQuote.bind(h.bridge);
  h.bridge.withQuote = async (request, consume) => { guardedInput = structuredClone(request); return withQuote(request, consume); };
  const enterprise = { ...input, bookingIdentity: { bookingIdentity: 'enterprise_employee', corporateCustomerId: 'company-a', enterpriseContractAndPayer: true } };
  const pending = h.authority.withQuote(enterprise, async () => { calls++; return 'Core_must_resolve_current_membership'; });
  enterprise.bookingIdentity.enterpriseContractAndPayer = false;
  assert.equal(await pending, 'Core_must_resolve_current_membership');
  assert.equal(guardedInput.bookingIdentity.enterpriseContractAndPayer, true);
  assert.equal(await h.authority.withQuote(enterprise, async () => 'still_requires_Core_qualification'), 'still_requires_Core_qualification');
  assert.equal(guardedInput.bookingIdentity.enterpriseContractAndPayer, false);
  assert.equal(calls, 1);
  h.identity.user.permissions = [];
  await assert.rejects(h.authority.withQuote(enterprise, async () => { calls++; }));
  assert.equal(calls, 1);
});
test('quote permission revocation suppresses callback result', async () => {
  const h = await setup();
  await assert.rejects(h.authority.withQuote(input, async () => { h.identity.user.permissions = []; return true; }));
});
test('settings source resolves actual workspace Core context with authorized location filtering', async () => {
  const h = await setup(), config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId: 'tenant-a', categoryCode: 'camera', isDefault: true }];
  const core = new RentalCoreService(config, stores.createAbsorbingFactStore()); await core.onApplicationBootstrap();
  const currentWorkspace = (await config.listWorkspaces())[0];
  const persistedQuoteRows = { tenantId: currentWorkspace.tenantId, workspaceId: currentWorkspace.id, categoryCode: currentWorkspace.categoryCode };
  Object.assign(persistedQuoteRows, { profile: core.getProfile(persistedQuoteRows.tenantId), settings: core.getBusinessSettings(persistedQuoteRows.tenantId),
    groups: core.listItemGroups(persistedQuoteRows.tenantId), pricingGroups: core.listPricingGroups(persistedQuoteRows.tenantId),
    couponTemplates: core.listCouponTemplates(persistedQuoteRows.tenantId), locations: core.listLocations(persistedQuoteRows.tenantId), operators: core.listOperators(persistedQuoteRows.tenantId) });
  config.readQuoteConfigurationFacts = async () => structuredClone(persistedQuoteRows);
  // Declared synthetic pagination endpoint over the SAME seeded synthetic
  // catalog: AI reads are bounded-only (listItemGroupsPage), id-ordered pages
  // with the formal cursor/truncated contract.
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  config.listItemGroupsPage = async (tenantId, workspaceId, query) => {
    const seeded = core.listItemGroups(tenantId);
    const all = seeded.filter(row => (!query.itemGroupId || row.id === query.itemGroupId)
      && (!query.name || row.name === query.name) && (!query.cursor || row.id > query.cursor))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const rows = all.slice(0, query.limit), truncated = all.length > query.limit;
    return { rows, truncated, nextCursor: truncated ? rows[rows.length - 1].id : null,
      source: 'persisted_workspace_configuration',
      configurationVersion: requestFingerprint(seeded.map(row => [row.id, row.name, row.status, row.unit])) };
  };
  const source = new AiGuardedQuoteCoreContextSource(core, h.bridge);
  const scope = { kind: 'workspace', tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const ctx = await source.current(scope);
  assert.equal(ctx.profile.tenantId, 'tenant-a'); assert.equal(ctx.category.code, 'camera');
  await assert.rejects(source.current({ ...scope, workspaceId: 'workspace-b' }));
  await assert.rejects(source.current({ ...scope, kind: 'tenant' }));
  ctx.settings.calendar.timeZone = 'UTC';
  assert.equal((await source.current(scope)).settings.calendar.timeZone, 'Asia/Shanghai');
});
test('revocation during context await prevents even the first Core side effect', async () => {
  const h = await setup(); let calls = 0;
  const svc = new AiQuotePreviewService({ createQuote: async () => { calls++; throw Error('should not execute'); } },
    { current: async () => { h.identity.user.permissions = []; return {}; } }, h.authority);
  await assert.rejects(svc.preview(input)); assert.equal(calls, 0);
});
test('configuration changing between context reads prevents Core quote', async () => {
  const h = await setup(); let reads = 0, calls = 0;
  const svc = new AiQuotePreviewService({ createQuote: async () => { calls++; throw Error('should not execute'); } },
    { current: async () => ({ settings: { configVersion: ++reads } }) }, h.authority);
  await assert.rejects(svc.preview(input)); assert.equal(calls, 0);
});

for (const categoryCode of ['camera', 'camping', 'vehicle', 'construction']) test(`${categoryCode}: guarded candidates and formal resolver quote match manual Core without automatic write`, async () => {
  const h = await setup(); h.identity.user.tenantId = 'tenant_001'; h.identity.user.permissions.push('rental-core:catalog:view');
  const config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId: 'tenant_001', categoryCode, isDefault: true }];
  const core = new RentalCoreService(config, stores.createAbsorbingFactStore()); await core.onApplicationBootstrap();
  const currentWorkspace = (await config.listWorkspaces())[0];
  const persistedQuoteRows = { tenantId: currentWorkspace.tenantId, workspaceId: currentWorkspace.id, categoryCode: currentWorkspace.categoryCode };
  Object.assign(persistedQuoteRows, { profile: core.getProfile(persistedQuoteRows.tenantId), settings: core.getBusinessSettings(persistedQuoteRows.tenantId),
    groups: core.listItemGroups(persistedQuoteRows.tenantId), pricingGroups: core.listPricingGroups(persistedQuoteRows.tenantId),
    couponTemplates: core.listCouponTemplates(persistedQuoteRows.tenantId), locations: core.listLocations(persistedQuoteRows.tenantId), operators: core.listOperators(persistedQuoteRows.tenantId) });
  config.readQuoteConfigurationFacts = async () => structuredClone(persistedQuoteRows);
  // Declared synthetic pagination endpoint over the SAME seeded synthetic
  // catalog: AI reads are bounded-only (listItemGroupsPage), id-ordered pages
  // with the formal cursor/truncated contract.
  const { requestFingerprint } = require('../apps/api/src/modules/rental-core/rental-idempotency.repository');
  config.listItemGroupsPage = async (tenantId, workspaceId, query) => {
    const seeded = core.listItemGroups(tenantId);
    const all = seeded.filter(row => (!query.itemGroupId || row.id === query.itemGroupId)
      && (!query.name || row.name === query.name) && (!query.cursor || row.id > query.cursor))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const rows = all.slice(0, query.limit), truncated = all.length > query.limit;
    return { rows, truncated, nextCursor: truncated ? rows[rows.length - 1].id : null,
      source: 'persisted_workspace_configuration',
      configurationVersion: requestFingerprint(seeded.map(row => [row.id, row.name, row.status, row.unit])) };
  };
  const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
  const priceConfig = stores.createAbsorbingBusinessConfigStore();
  const business = new RentalBusinessService(priceConfig, stores.createAbsorbingBusinessFactStore(), config);
  await business.onApplicationBootstrap();
  priceConfig.readQuoteRateTargets = async (tenantId, _workspaceId, at) => {
    const rows = await business.listSpaceRatesAt(tenantId, { ...persistedQuoteRows,
      category: core.listCategories().find(row => row.code === categoryCode) }, at.toISOString());
    return rows.map(({ pricingGroupId, itemGroupId, unit }) => ({ pricingGroupId, itemGroupId, unit,
      priceVersionId: 'synthetic-version', priceVersion: 'v1' }));
  };
  const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
  const members = new MembershipService({ customerProfile: { findMany: async () => [{ id: 'customer-a', name: 'Synthetic customer', phoneMasked: '138****0000', membership: { status: 'active' } }] } }, {});
  const { AiCatalogReadFactsService } = require('../apps/api/src/modules/ai-native/catalog-read-facts.service');
  const { AiMembershipCandidateReadFactsService } = require('../apps/api/src/modules/ai-native/membership-candidate-read-facts.service');
  const readers = { catalog: new AiCatalogReadFactsService(core, h.bridge), members: new AiMembershipCandidateReadFactsService(members, h.bridge) };
  const tools = composeAiGuardedQuoteTools({ core, business, routes: h.bridge, readers, clock: () => new Date() });
  const source = new AiGuardedQuoteCoreContextSource(core, h.bridge);
  const scope = { kind: 'workspace', tenantId: 'tenant_001', workspaceId: 'workspace-a' }, ctx = await source.current(scope);
  require('./helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], 'tenant_001', 'workspace-a', ctx);
  const rates = await h.bridge.withRead('quote_context', {}, () => business.listSpaceRatesAt('tenant_001', ctx, '2026-11-10T09:00:00+08:00'));
  const prepared = await tools.candidates.prepare({ customerType: 'personal', customerId: 'customer-a', items: [{ productName: ctx.groups[0].name, quantity: 1, pricingUnit: rates.find(rate => rate.itemGroupId === ctx.groups[0].id).unit }],
    start: '2026-11-10T09:00:00+08:00', end: '2026-11-11T09:00:00+08:00', fulfillmentMode: ctx.settings.fulfillment.enabledModes[0], locationName: ctx.locations[0].name });
  assert.equal(prepared.status, 'needs_confirmation');
  const ai = await tools.preview.preview(prepared.request);
  assert.equal(ai.status, 'quoted'); assert.equal(ai.quote.reservation, 'not_reserved');
  const manual = await h.authority.withQuote(prepared.request, async c => {
    const context = await source.current(c.scope);
    return business.createQuote(c.scope.tenantId, context, await core.resolvePricingGroupQuoteRequest(c.scope.tenantId, prepared.request));
  });
  assert.equal(ai.quote.payableAmount, manual.payableAmount);
  assert.equal(ai.quote.receivableAmount, manual.receivableAmount);
  assert.deepEqual(ai.quote.chargeLines, manual.chargeLines);
  const rejected = await tools.preview.preview({ ...prepared.request, fulfillmentLocationId: 'missing-location' });
  assert.equal(rejected.status, 'unavailable'); assert.equal(rejected.quote, undefined);
});
test('dependency unavailability is not classified as inventory shortage', async () => {
  const h = await setup();
  const service = new AiQuotePreviewService({ createQuote: async () => { throw Error('依赖服务不可用'); } }, { current: async () => ({}) }, h.authority);
  assert.equal((await service.preview(input)).status, 'unavailable');
});

test('dedicated quote context uses scoped bounded tables without startup/cache and price selection transfers no monetary snapshot', async () => {
  const { RentalCoreConfigRepository } = require('../apps/api/src/modules/rental-core/rental-core-config.repository');
  const { RentalBusinessConfigRepository } = require('../apps/api/src/modules/rental-core/rental-business-config.repository');
  const { getRequestIdentity } = require('../apps/api/src/common/request-identity');
  const never = () => { throw Error('startup/cache/factContext must not run in a readonly context'); };
  for (const code of ['camera', 'camping', 'vehicle', 'construction']) {
    const h = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup(code);
    const cfg = h.quoteConfiguration, T = cfg.tenantId, W = cfg.workspaceId, owns = { tenantId: T, workspaceId: W };
    const date = value => new Date(value), rows = { metadata: [{ ...owns, categoryCode: code, settingsCategoryCode: code,
      configVersion: cfg.settings.configVersion, settings: structuredClone(cfg.settings), profileVersion: cfg.profile.configVersion,
      profileCategoryCode: code, capabilities: cfg.profile.capabilities, terminology: cfg.profile.terminology,
      initializedAt: date(cfg.profile.initializedAt), profileUpdatedAt: date(cfg.profile.updatedAt) }],
      groups: cfg.groups.map(g => ({ ...g, ...owns, categoryCode: code.toUpperCase(), inventoryMode: g.inventoryMode.toUpperCase(),
        createdAt: date(g.createdAt), updatedAt: date(g.updatedAt), bundleComponents: g.bundleComponents.map(c => ({
          componentItemGroupId: c.itemGroupId, quantity: c.quantity, optional: Boolean(c.optional), substitutionGroup: c.substitutionGroup ?? null,
          componentItemGroup: { ...owns, id: c.itemGroupId, code: c.itemGroupCode, name: c.itemGroupName } })) })),
      pricing: cfg.pricingGroups.map(g => ({ ...g, ...owns, categoryCode: code.toUpperCase(), defaultPricingUnit: g.defaultPricingUnit ?? null,
        createdAt: date(g.createdAt), updatedAt: date(g.updatedAt), members: g.members.map(m => ({ itemGroupId: m.id,
          itemGroup: { ...m, ...owns, inventoryMode: m.inventoryMode.toUpperCase() } })) })),
      locations: cfg.locations.map(l => ({ ...l, ...owns, organizationId: l.organizationId ?? null, parentLocationId: l.parentLocationId ?? null,
        operatorId: l.operatorId ?? null, operatorName: l.operatorName ?? null, operatorType: l.operatorType ?? null, timezone: l.timezone ?? null })),
      operators: cfg.operators.map(o => ({ ...o, ...owns, createdAt: date(o.createdAt), updatedAt: date(o.updatedAt) })),
      attrs: cfg.groups.map(g => ({ ...owns, id: g.id, attributes: g.attributes, updatedAt: date(g.updatedAt) })), coupons: [] };
    const queries = [], capture = name => async query => { queries.push({ name, query }); return structuredClone(rows[name]); };
    const db = { businessWorkspace: { findFirst: async () => ({ id: W }) }, rentalItemGroup: { findMany: capture('groups') },
      rentalPricingGroup: { findMany: capture('pricing') }, rentalFulfillmentOperator: { findMany: capture('operators') },
      $queryRaw: async query => { const name = query.sql.includes('FROM rental_fulfillment_locations') ? 'locations'
        : query.sql.includes('FROM rental_coupon_templates') ? 'coupons' : query.sql.includes('FROM rental_item_groups') ? 'attrs' : 'metadata';
        queries.push({ name, query }); return structuredClone(rows[name]); } };
    const repo = new RentalCoreConfigRepository(db), core = new RentalCoreService(repo, {});
    repo.loadAll = never;
    for (const method of ['getProfile', 'getBusinessSettings', 'getWorkspaceCategory', 'listItemGroups', 'listPricingGroups', 'listLocations', 'listOperators', 'listCouponTemplates', 'factContext']) core[method] = never;
    const routes = new AiBusinessReadRouteAuthority(new ApiAuthGuard(h.h.authorization.auth, undefined, undefined, undefined, {}), h.h.authorization.credentials);
    const source = new AiGuardedQuoteCoreContextSource(core, routes), scope = { kind: 'workspace', ...owns };
    const result = await source.current(scope);
    assert.equal(core.states.size, 0); assert.equal(result.category.code, code); assert.equal(result.settings.pricing.currency, cfg.settings.pricing.currency);
    assert.deepEqual(result.settings.calendar.weeklyHours, cfg.settings.calendar.weeklyHours);
    for (const name of ['groups', 'pricing']) { const q = queries.find(row => row.name === name).query;
      assert.equal(q.take, 101); assert.deepEqual(q.where, owns); assert.equal('attributes' in q.select, false);
      assert.equal((name === 'groups' ? q.select.bundleComponents : q.select.members).take, 257); }
    for (const row of queries.filter(row => ['metadata', 'locations', 'attrs', 'coupons'].includes(row.name))) {
      assert.match(row.query.sql, /OCTET_LENGTH/u); assert.ok(row.query.values.includes(T) && row.query.values.includes(W));
      assert.doesNotMatch(row.query.sql, /SELECT\s+\*|credential|contactPhone|(?:SELECT|,)\s*cs\.state(?:\s+AS|\s*,)/iu);
      if (row.name === 'metadata') {
        assert.match(row.query.sql, /LEFT JOIN rental_core_state_snapshots/u);
        assert.match(row.query.sql, /cs\.tenantId = w\.tenantId AND cs\.workspaceId = w\.id/u);
        assert.match(row.query.sql, /\$\.profile\.configVersion/u);
        assert.match(row.query.sql, /cv\.definition/u); // Persisted adopted body, not a recommended/seed profile.
        assert.match(row.query.sql, /\$\.defaultCapabilities/u);
      }
    }
    for (const [name, bad] of [['metadata', []], ['metadata', [{ ...rows.metadata[0], terminology: { readLimitExceeded: true } }]],
      ['groups', Array.from({ length: 101 }, (_unused, i) => ({ ...rows.groups[0], id: `too-many-${i}` }))],
      ['pricing', [{ ...rows.pricing[0], workspaceId: 'foreign' }]], ['attrs', rows.attrs.map((r, i) => i ? r : { ...r, updatedAt: new Date(0) })]]) {
      const before = rows[name]; rows[name] = bad; await assert.rejects(source.current(scope)); rows[name] = before;
    }
    const priced = [{ ...owns, id: 'version-a', sequence: 1, ratesType: 'ARRAY', rateCount: 1,
      rateIndex: 1, itemGroupId: cfg.groups[0].id, pricingGroupId: null, unit: cfg.settings.pricing.defaultUnit }];
    let rateRows = priced, sql;
    const priceRepo = new RentalBusinessConfigRepository({ businessWorkspace: db.businessWorkspace, $queryRaw: async query => { sql = query; return structuredClone(rateRows); } });
    priceRepo.loadAll = never;
    const targets = await routes.withRead('quote_context', {}, () => priceRepo.readQuoteRateTargets(T, W, new Date('2026-11-10T00:00:00Z')));
    assert.equal(targets[0].priceVersionId, 'version-a'); assert.equal('baseAmount' in targets[0], false);
    assert.match(sql.sql, /ORDER BY effectiveFrom DESC, sequence DESC LIMIT 1/u);
    assert.match(sql.sql, /JSON_LENGTH\(v\.rates\) <=/u); assert.equal(sql.values.at(-1), 10001);
    assert.doesNotMatch(sql.sql, /AS rates\b|baseAmount|depositAmount|tier/iu);
    rateRows = [{ ...priced[0], rateCount: 10001 }];
    await assert.rejects(routes.withRead('quote_context', {}, () => priceRepo.readQuoteRateTargets(T, W, new Date('2026-11-10T00:00:00Z'))));
    rateRows = [{ ...priced[0], ratesType: 'OBJECT' }];
    await assert.rejects(routes.withRead('quote_context', {}, () => priceRepo.readQuoteRateTargets(T, W, new Date('2026-11-10T00:00:00Z'))));
    rateRows = [{ ...priced[0], pricingGroupId: cfg.pricingGroups[0].id, itemGroupId: null }];
    await assert.rejects(routes.withRead('quote_context', {}, () => priceRepo.readQuoteRateTargets(T, W, new Date('2026-11-10T00:00:00Z'))));
    rateRows = []; assert.deepEqual(await routes.withRead('quote_context', {}, () => priceRepo.readQuoteRateTargets(T, W, new Date('2026-11-10T00:00:00Z'))), []);
    h.h.identity.user.permissions = [];
    await assert.rejects(source.current(scope));
  }
});

test('current delivery choice reaches actual Core quote and changed address cannot silently create another quote', async t => {
  const previous = process.env.PLATFORM_DATA_SOURCE;
  process.env.PLATFORM_DATA_SOURCE = 'memory'; // Existing offline Core config store, not a MySQL price assertion.
  t.after(() => { if (previous === undefined) delete process.env.PLATFORM_DATA_SOURCE; else process.env.PLATFORM_DATA_SOURCE = previous; });
  const b = await require('./fixtures/ai-native/lane-a-business-consumption.cjs').setup('camera');
  const row = { id: 'address-a', tenantId: 'tenant_001', customerId: 'customer-a', status: 'active', revision: 1,
    recipient: 'Synthetic recipient', phone: '13800000000', phoneMasked: '138****0000', countryCode: 'CN',
    province: 'Synthetic province', city: 'Synthetic city', district: null, detail: 'Synthetic detail', postalCode: null,
    latitude: null, longitude: null, isDefault: true, updatedAt: new Date('2026-10-07T00:00:00Z') };
  // Only the persistence boundary is simulated; list/selection/Guard and Core
  // quote computation and stored delivery snapshot use product implementations.
  b.business.prisma = { customerDeliveryAddress: {
    findMany: async ({ where }) => where.tenantId === row.tenantId && where.customerId === row.customerId ? [structuredClone(row)] : [],
    findFirst: async ({ where }) => where.id === row.id && where.tenantId === row.tenantId && where.customerId === row.customerId ? structuredClone(row) : null
  } };
  let writes = 0;
  const create = b.business.createQuote.bind(b.business);
  b.business.createQuote = async (...args) => { writes++; return create(...args); };
  const candidate = { ...b.candidate, fulfillmentMode: 'delivery' };
  const first = await b.tools.quote.candidates.prepare(candidate);
  assert.equal(first.status, 'missing_input');
  assert.deepEqual(first.clarifications.find(c => c.field === 'deliveryAddressId').candidates.map(c => c.id), ['address-a']);
  const selected = { ...candidate, deliveryAddressId: 'address-a', selectionRevision: first.selectionRevision };
  // The explicit address joins the candidate fingerprint and answering the
  // re-offered round normalizes the untrusted name away, so the contract
  // re-offers the candidate's own current values until it settles, keeping
  // the confirmed address bound throughout.
  const { originalQuoteAnswerContract, applyOriginalQuoteAnswers } = require('../apps/api/src/modules/ai-native/scenes/original-quote-input');
  const answerCurrent = (candidateValue, field) => {
    const current = field.fieldId === 'delivery_address_selection' ? candidateValue.deliveryAddressId
      : field.fieldId === 'fulfillment_selection' ? candidateValue.fulfillmentMode
      : field.fieldId === 'pricing_unit_selection' ? candidateValue.items[0].pricingUnit
      : field.fieldId === 'item_selection' ? candidateValue.items[0].itemGroupId
      : field.fieldId === 'customer_selection' ? candidateValue.customerId
      : field.fieldId === 'pickup_location' ? candidateValue.locationId : undefined;
    if (!field.options) return current;
    return field.options.some(option => option.value === current) ? current : field.options[0].value;
  };
  let addressCandidate = selected, prepared = await b.tools.quote.candidates.prepare(addressCandidate);
  for (let round = 0; round < 6 && prepared.status === 'missing_input'; round++) {
    const roundContract = originalQuoteAnswerContract(addressCandidate, prepared, 'Reconfirm the chosen address');
    addressCandidate = applyOriginalQuoteAnswers(addressCandidate, [{ contract: roundContract,
      answers: roundContract.fields.filter(field => field.required).map(field => ({ fieldId: field.fieldId, value: answerCurrent(addressCandidate, field) })) }]);
    prepared = await b.tools.quote.candidates.prepare(addressCandidate);
  }
  assert.equal(prepared.status, 'needs_confirmation');
  assert.equal((await b.tools.quote.previewSelection(addressCandidate)).status, 'quoted');
  assert.equal(writes, 1);
  row.revision++; row.detail = 'Changed detail';
  await assert.rejects(b.tools.quote.preview.preview(prepared.request, prepared.configurationFingerprint, prepared.addressFingerprint),
    error => error.code === 'CONFIG_INVALID');
  assert.equal(writes, 1);
  await assert.rejects(b.tools.quote.preview.preview(prepared.request, prepared.configurationFingerprint), error => error.code === 'CONFIG_INVALID');
  assert.equal(writes, 1);
  const again = await b.tools.quote.previewSelection(selected);
  assert.equal(again.status, 'missing_input'); assert.equal(again.request, undefined);
  assert.equal(writes, 1);
});
