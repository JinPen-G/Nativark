'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { RentalCoreConfigRepository, RENTAL_READINESS_FACT_LIMIT } = require('../apps/api/src/modules/rental-core/rental-core-config.repository');
const { RentalBusinessConfigRepository } = require('../apps/api/src/modules/rental-core/rental-business-config.repository');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { runWithRequestIdentity, getRequestIdentity } = require('../apps/api/src/common/request-identity');
const { AiOpeningReadFactsService } = require('../apps/api/src/modules/ai-native/tools/diagnostic-read-facts.service');
const { AiDiagnosticRouteAuthority } = require('../apps/api/src/modules/ai-native/tools/diagnostic-route.authority');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { RENTAL_CATEGORY_DEFINITIONS } = require('@rental-os/shared');
const T = 'tenant-a', W = 'workspace-a';
const owns = { tenantId: T, workspaceId: W };
const identity = { ...owns, userId: 'operator-a', isSaasAdmin: false };
const inScope = read => runWithRequestIdentity(identity, read);
const never = () => { throw Error('unbounded/initialization path must not run'); };

// Explicit returned rows + recorded queries only. No in-memory SQL, relation,
// filtering, transaction or MySQL JSON_TABLE emulator is installed here.
function fixture(categoryCode = 'camera') {
  const log = [], now = new Date('2026-01-01T00:00:00Z');
  const rows = { categoryCode, settings: [{ ...owns, timeZone: 'Asia/Shanghai' }], itemCount: 1, locationCount: 1,
    groups: [{ ...owns, id: 'pricing-a', name: 'Pricing A' }], rules: [{ ...owns, id: 'rule-a', version: 'v1', status: 'published', effectiveFrom: now }],
    refs: [{ ...owns, planId: 'plan-a', ratesType: 'ARRAY', rateIndex: 1, pricingGroupId: 'pricing-a', pricingGroupIdType: 'STRING', itemGroupId: 'item-a', itemGroupIdType: 'STRING' }],
    accountCount: 2, roleCount: 1, calendarCount: 1, planCount: 3,
    priceVersion: { ...owns, sequence: 1, effectiveFrom: now }, afterRead: undefined };
  const capture = (name, read) => async query => {
    log.push({ name, query: structuredClone(query) });
    const value = read(query);
    await rows.afterRead?.(name, query);
    return structuredClone(value);
  };
  const db = {
    businessWorkspace: { findFirst: capture('workspace', () => ({ id: W, tenantId: T, categoryCode: rows.categoryCode.toUpperCase() })) },
    rentalItemGroup: { count: capture('items', () => rows.itemCount), findMany: never },
    rentalFulfillmentLocation: { count: capture('locations', () => rows.locationCount), findMany: never },
    rentalPricingGroup: { findMany: capture('pricingGroups', () => rows.groups) },
    rentalRuleVersion: { findMany: capture('rules', () => rows.rules) },
    rentalBusinessCalendar: { count: capture('calendars', () => rows.calendarCount), findMany: never },
    rentalPriceVersion: { findFirst: capture('priceVersion', () => rows.priceVersion) },
    workspaceMember: { count: capture('accounts', query => query.where.OR ? rows.roleCount : rows.accountCount), findMany: never },
    customerMembershipPlan: { count: capture('membership', () => rows.planCount), findMany: never },
    $queryRaw: async query => {
      log.push({ name: 'sql', query: { sql: query.sql, values: query.values } });
      const result = query.sql.includes('rental_tenant_business_settings') ? rows.settings : rows.refs;
      await rows.afterRead?.('sql', query);
      return structuredClone(result);
    }
  };
  const config = new RentalCoreConfigRepository(db), businessConfig = new RentalBusinessConfigRepository(db), memberships = new MembershipService(db);
  config.loadAll = never; businessConfig.loadAll = never;
  const business = new RentalBusinessService(businessConfig, { loadAll: never }, config,
    undefined, db, undefined, undefined, undefined, undefined, memberships);
  return { rows, log, db, config, businessConfig, memberships, business };
}

for (const { code } of RENTAL_CATEGORY_DEFINITIONS) test(`${code}: bounded persisted opening needs no quote/cache/bootstrap and keeps nine original decisions`, async () => {
  const f = fixture(code);
  const result = await inScope(() => f.business.readTenantReadiness(T));
  assert.equal(result.ready, true); assert.equal(result.items.length, 9); assert.equal(result.status, 'completed');
  assert.deepEqual(result.quoteBlockers, []);
  assert.equal(result.items.find(row => row.key === 'membership_base').summary, '会员方案 3 个');
  assert.equal(result.items.find(row => row.key === 'fulfillment_network').summary, '可用履约地点 1 个');
  assert.equal(f.business.states.size, 0, 'the R0 read must not create seeded business state');
  const rules = f.log.find(row => row.name === 'rules').query;
  assert.equal(rules.take, 2); assert.equal('config' in rules.select, false);
  assert.deepEqual(rules.where.status.in, ['pending', 'published', 'superseded']);
  const version = f.log.find(row => row.name === 'priceVersion').query;
  assert.deepEqual(version.orderBy, [{ effectiveFrom: 'desc' }, { sequence: 'desc' }]);
  assert.equal('rates' in version.select, false);
  assert.deepEqual(f.log.find(row => row.name === 'membership').query, { where: { tenantId: T } });
  assert.equal(f.log.find(row => row.name === 'pricingGroups').query.take, RENTAL_READINESS_FACT_LIMIT + 1);
  for (const entry of f.log.filter(row => row.name === 'calendars')) {
    assert.equal(entry.query.where.status, 'published'); assert.equal(entry.query.where.tenantId, T); assert.equal(entry.query.where.workspaceId, W);
  }
  const sql = f.log.filter(row => row.name === 'sql');
  assert.ok(sql.every(row => row.query.values.includes(T) && row.query.values.includes(W)));
  assert.match(sql[0].query.sql, /JSON_EXTRACT\(settings, '\$\.calendar\.timeZone'\)/u);
  assert.match(sql[1].query.sql, /JSON_TABLE/u); assert.match(sql[1].query.sql, /FOR ORDINALITY/u);
  assert.equal(sql[1].query.values.at(-1), RENTAL_READINESS_FACT_LIMIT + 1);
  assert.doesNotMatch(sql[1].query.sql, /SELECT\s+\*|unitPrice|deposit|fulfillmentFees/iu);
});

test('manual and bounded readers share original nine-item results for the same facts', async () => {
  const f = fixture(), category = RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'camera');
  const context = { profile: { tenantId: T, categoryCode: 'camera' }, category: { ...category, name: 'camera' },
    settings: { calendar: { timeZone: 'Asia/Shanghai' } },
    groups: [{ id: 'item-a', status: 'enabled' }], pricingGroups: [{ id: 'pricing-a', name: 'Pricing A', status: 'enabled' }],
    locations: [{ id: 'location-a', status: 'enabled', operatorId: 'operator-a', capabilities: ['pickup', 'return'] }],
    operators: [{ id: 'operator-a', status: 'enabled' }], couponTemplates: [] };
  const year = new Date().getFullYear();
  f.business.states.set(W, { categoryCode: 'camera', ruleVersions: f.rows.rules,
    calendars: [year, year + 1, year + 2].map(year => ({ year, status: 'published', version: '1.0' })),
    pricingPlans: [{ status: 'enabled', rates: [{ pricingGroupId: 'pricing-a', itemGroupId: 'item-a' }] }] });
  const bounded = await inScope(() => f.business.readTenantReadiness(T));
  const manual = await inScope(() => f.business.tenantReadiness(T, context));
  assert.deepEqual(bounded, manual);
  f.rows.priceVersion = null; f.rows.planCount = 0;
  assert.deepEqual(await inScope(() => f.business.readTenantReadiness(T)), await inScope(() => f.business.tenantReadiness(T, context)));
});

test('scalar role facts preserve explicit override and database some without a member/assignment list', async () => {
  const f = fixture(); await inScope(() => f.business.readTenantReadiness(T));
  const queries = f.log.filter(row => row.name === 'accounts').map(row => row.query);
  assert.equal(queries.length, 2);
  assert.deepEqual(queries[0].where, { ...owns, isActive: true, user: { is: { isActive: true } } });
  assert.deepEqual(queries[1].where.OR, [
    { roleId: { not: null, notIn: [''] }, role: { is: { isActive: true } } },
    { OR: [{ roleId: null }, { roleId: '' }], user: { is: { OR: [
      { role: { is: { isActive: true } } }, { roleAssignments: { some: { role: { is: { isActive: true } } } } }
    ] } } }
  ]);
  assert.ok(queries.every(query => !('take' in query) && !('select' in query)));
  f.rows.roleCount = 0;
  assert.equal((await inScope(() => f.business.readTenantReadiness(T))).items.find(row => row.key === 'accounts_roles').done, false);
});

test('missing optional membership and a failed count remain different and do not block ready', async () => {
  const f = fixture(); f.rows.planCount = 0;
  let result = await inScope(() => f.business.readTenantReadiness(T));
  const absent = result.items.find(row => row.key === 'membership_base');
  assert.equal(absent.done, false); assert.equal(absent.optional, true); assert.equal(absent.unavailable, false); assert.equal(result.ready, true);
  f.db.customerMembershipPlan.count = async () => { throw Error('explicit membership outage'); };
  result = await inScope(() => f.business.readTenantReadiness(T));
  assert.equal(result.items.find(row => row.key === 'membership_base').unavailable, true); assert.equal(result.ready, true);
  assert.ok(!result.quoteBlockers.some(row => row.includes('会员')));
  f.db.customerMembershipPlan.count = async () => NaN;
  assert.equal((await inScope(() => f.business.readTenantReadiness(T))).items.find(row => row.key === 'membership_base').unavailable, true);
});

test('latest issued same-time conflict and missing price/calendar/target facts use the original decision', async () => {
  const f = fixture(); f.rows.rules.push({ ...f.rows.rules[0], id: 'rule-b', version: 'v2', status: 'pending' });
  f.rows.priceVersion = null; f.rows.calendarCount = 0; f.rows.refs[0].pricingGroupId = 'foreign-pricing';
  const result = await inScope(() => f.business.readTenantReadiness(T));
  assert.equal(result.ready, false);
  assert.match(result.items.find(row => row.key === 'business_rule').missing, /同一时点/u);
  assert.equal(result.items.find(row => row.key === 'business_calendar').done, false);
  assert.equal(result.items.find(row => row.key === 'price_version').done, false);
  assert.equal(result.items.find(row => row.key === 'pricing_groups_rates').done, false);
  assert.ok(result.quoteBlockers.includes('规则版本同时生效冲突'));
  assert.ok(!result.quoteBlockers.some(row => row.includes('日历')));
});

test('legacy item target fallback and empty enabled plans are accepted without reading amount JSON', async () => {
  const f = fixture(); f.rows.refs = [
    { ...f.rows.refs[0], pricingGroupId: null, pricingGroupIdType: null, itemGroupId: 'pricing-a' },
    { ...f.rows.refs[0], planId: 'empty-plan', rateIndex: null, pricingGroupId: null, pricingGroupIdType: null, itemGroupId: null, itemGroupIdType: null }
  ];
  assert.equal((await inScope(() => f.business.readTenantReadiness(T))).items.find(row => row.key === 'pricing_groups_rates').done, true);
});

test('global pricing reference/group sentinels refuse partial successful readiness', async () => {
  let f = fixture(); f.rows.groups = Array.from({ length: RENTAL_READINESS_FACT_LIMIT + 1 }, (_unused, index) => ({ ...owns, id: `p-${index}`, name: `P ${index}` }));
  await assert.rejects(inScope(() => f.business.readTenantReadiness(T)), /读取上限/u);
  f = fixture(); f.rows.refs = Array.from({ length: RENTAL_READINESS_FACT_LIMIT + 1 }, (_unused, index) => ({ ...f.rows.refs[0], rateIndex: index + 1 }));
  await assert.rejects(inScope(() => f.business.readTenantReadiness(T)), /读取上限/u);
});

test('foreign source rows, malformed refs, bad timezone and invalid counts fail closed', async () => {
  for (const corrupt of [
    f => { f.rows.groups[0].workspaceId = 'foreign'; },
    f => { f.rows.rules[0].tenantId = 'foreign'; },
    f => { f.rows.refs[0].workspaceId = 'foreign'; },
    f => { f.rows.refs[0].pricingGroupIdType = 'OBJECT'; },
    f => { f.rows.refs[0].ratesType = 'OBJECT'; },
    f => { f.rows.refs.push({ ...f.rows.refs[0] }); },
    f => { f.rows.priceVersion.workspaceId = 'foreign'; },
    f => { f.rows.itemCount = NaN; },
    f => { f.rows.settings[0].timeZone = 'invalid/time-zone'; }
  ]) {
    const f = fixture(); corrupt(f); await assert.rejects(inScope(() => f.business.readTenantReadiness(T)));
  }
});

test('selected-location counts keep the original Core filter and suppress read-time narrowing', async () => {
  const f = fixture();
  await runWithRequestIdentity({ ...identity, locationScope: { mode: 'selected', locationIds: ['location-a', 'location-b'] } },
    () => f.business.readTenantReadiness(T));
  const where = f.log.find(row => row.name === 'locations').query.where;
  assert.deepEqual(where.id, { in: ['location-a', 'location-b'] });
  assert.deepEqual(where.capabilities, { array_contains: ['pickup', 'return'] });
  assert.deepEqual(where.operator, { is: { ...owns, status: 'enabled' } });
  f.rows.afterRead = async name => { if (name === 'locations') getRequestIdentity().locationScope.locationIds = ['location-a']; };
  await assert.rejects(runWithRequestIdentity({ ...identity, locationScope: { mode: 'selected', locationIds: ['location-a', 'location-b'] } },
    () => f.business.readTenantReadiness(T)));
});

test('business-year query uses original timezone/end-boundary semantics, not annual day materialization', async () => {
  const f = fixture(); f.rows.settings[0].timeZone = 'America/Los_Angeles';
  await inScope(() => f.business.readTenantReadiness(T));
  const year = new Date().getFullYear();
  assert.deepEqual(f.log.filter(row => row.name === 'calendars').map(row => row.query.where.year), [year - 1, year, year + 1]);
});

test('missing current ALS, foreign tenant, read-time scope change and missing producer never fall back', async () => {
  const f = fixture(); await assert.rejects(f.business.readTenantReadiness(T)); assert.equal(f.log.length, 0);
  await assert.rejects(inScope(() => f.business.readTenantReadiness('foreign'))); assert.equal(f.log.length, 0);
  f.rows.afterRead = async name => { if (name === 'pricingGroups') getRequestIdentity().workspaceId = 'foreign'; };
  await assert.rejects(inScope(() => f.business.readTenantReadiness(T)));
  const missing = fixture(); delete missing.config.readReadinessCoreFacts;
  // Prototype methods need to be shadowed to model a missing injected port.
  missing.config.readReadinessCoreFacts = undefined;
  await assert.rejects(inScope(() => missing.business.readTenantReadiness(T)), /事实源不可用/u);
  assert.equal(missing.log.length, 0);
});

test('actual original Guard rejects late revocation and opening does not require quote-context permission', async () => {
  const h = await authorizedRunnerHarness(), f = fixture();
  h.identity.user.permissions = ['system:user:manage'];
  const authority = new AiDiagnosticRouteAuthority(new AiBusinessReadRouteAuthority(new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), h.authorization.credentials));
  const opening = new AiOpeningReadFactsService(f.business, authority);
  const result = await opening.read({ limit: 50, sections: ['membership_base'] });
  assert.equal(result.coverage, 'requested_sections'); assert.equal(result.ready, true); assert.equal(result.items.length, 1);
  f.rows.afterRead = async name => { if (name === 'membership') h.identity.user.permissions = []; };
  await assert.rejects(opening.read({ limit: 50 }));
});

async function persistedOpening() {
  const { composePersistedTaskAuthorization } = require('../apps/api/src/modules/ai-native/task-authorization.composition');
  const { composePersistedOpeningTaskRunner } = require('../apps/api/src/modules/ai-native/runner/persisted-catalog-runner.composition');
  const { AI_TOOL_DRAFT_VERSION } = require('@rental-os/shared');
  const h = await authorizedRunnerHarness({ aiTaskPlanPolicy: [], aiTaskActionInput: [] }), f = fixture();
  h.state.aiTaskRunPlan.length = 0;
  h.state.aiTaskPlanPolicy.push({ scopeId: 'scope-a', sceneCode: 'synthetic-clarification', sceneVersion: '1', revision: 1, enabled: true,
    allowedTools: [{ code: 'tenant.opening.diagnose', version: AI_TOOL_DRAFT_VERSION }], limits: h.clone(h.plan.limits), expiresAt: new Date('2026-10-07T12:00:00Z') });
  const auth = composePersistedTaskAuthorization({ ...h.authorization, db: h.db, clock: () => new Date(h.control.now) });
  const lease = await auth.tasks.claimRun(h.claim());
  const root = composePersistedOpeningTaskRunner({ db: h.db, authorization: h.authorization,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}),
    wall: () => new Date(h.control.now), monotonic: () => ++h.control.tick,
    core: {}, business: f.business }); // No diagnosticCore/quote-context source.
  await root.source.publishOpeningInput({ taskId: 'task-a', registrationRef: 'opening-a',
    expectedTaskRevision: h.state.aiTask[0].revision, lease, input: { limit: 50 } });
  await root.evidence.savePlan({ ...h.clone(h.plan), steps: [{ registrationRef: 'opening-a', operation: 'readonly', toolCode: 'tenant.opening.diagnose', toolVersion: AI_TOOL_DRAFT_VERSION }] }, lease);
  await auth.tasks.releaseRun({ taskId: 'task-a', runId: 'run-a', holderId: lease.holderId,
    expectedTaskRevision: h.state.aiTask[0].revision, expectedRunRevision: h.state.aiRun[0].revision, expectedFencingToken: h.state.aiRun[0].fencingToken.toFixed(0) });
  return { h, f, root };
}

test('persisted opening runs the real bounded business reader without diagnosticCore and retains step/resource/result chain', async () => {
  const { h, f, root } = await persistedOpening();
  assert.equal((await root.runner.run(h.claim())).status, 'succeeded');
  assert.equal(h.state.aiTaskResultArtifact[0].payload.ready, true);
  assert.equal(h.state.aiTaskExecutionBudget[0].consumedSteps, 1n);
  assert.ok(f.log.some(row => row.name === 'membership'));
  assert.equal(f.business.states.size, 0);
});

test('persisted opening rejects late revocation rather than storing a successful result', async () => {
  const { h, f, root } = await persistedOpening();
  f.rows.afterRead = async name => { if (name === 'membership') h.identity.membership = false; };
  await Promise.allSettled([root.runner.run(h.claim())]);
  assert.equal(h.state.aiTaskResultArtifact.filter(row => row.outcome === 'SUCCEEDED').length, 0);
});
