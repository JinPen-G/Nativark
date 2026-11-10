'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('./fixtures/ai-native/contract-consumer.cjs').blockNetwork(test);
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { AuthService } = require('../apps/api/src/modules/auth/auth.service');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { AiBusinessReadRouteAuthority } = require('../apps/api/src/modules/ai-native/business-read-route.authority');
const { AiCatalogReadFactsService } = require('../apps/api/src/modules/ai-native/catalog-read-facts.service');
const { AiMembershipCandidateReadFactsService } = require('../apps/api/src/modules/ai-native/membership-candidate-read-facts.service');
const { getRequestIdentity, runWithRequestIdentity } = require('../apps/api/src/common/request-identity');
const samples = require('./fixtures/ai-native/authorization-baseline.cjs');

function setup(audience = 'operator') {
  const state = { user: samples.user({ permissions: ['rental-os:order:create'] }), workspace: 'workspace-a', session: true, member: true };
  const auth = new AuthService({
    getAuthSession: async () => state.session ? { id: 'session-a', userId: state.user.id, audience, currentWorkspaceId: state.workspace } : undefined,
    findUserById: async () => state.user, findWorkspaceScopedUser: async () => state.member ? state.user : undefined, listUserWorkspaces: async () => []
  }, { get: key => key === 'AUTH_TOKEN_SECRET' ? 'synthetic-business-read-secret' : undefined });
  // One original credential binds the selected space and expiry. A session
  // switch must fail revalidation, not silently regenerate a fresh credential.
  const authorization = `Bearer ${auth.signAccessToken({ sub: state.user.id, tid: state.user.tenantId,
    sid: 'session-a', wid: state.workspace, aud: audience, exp: Math.floor(Date.now() / 1000) + 600 })}`;
  const credentials = { current: async () => ({ requestId: 'read-request', audience, authorization }) };
  const guard = new ApiAuthGuard(auth, undefined, undefined, undefined, {});
  return { state, authority: new AiBusinessReadRouteAuthority(guard, credentials) };
}
const denied = error => error.code === 'FORBIDDEN';
const emptyCatalogPage = () => ({ rows: [], truncated: false, nextCursor: null,
  source: 'persisted_workspace_configuration', configurationVersion: '1'.repeat(64) });

for (const audience of ['operator', 'staff']) test(`actual Guard establishes scoped ${audience} catalog read and preserves parent ALS`, async () => {
  const f = setup(audience); let reads = 0;
  const service = new AiCatalogReadFactsService({ listItemGroupsPage: async (tenant, query) => {
    reads++; const identity = getRequestIdentity();
    assert.equal(tenant, 'tenant-a'); assert.deepEqual(query, { limit: 10 });
    assert.equal(identity.workspaceId, 'workspace-a');
    assert.equal(identity.userId, 'operator-a'); assert.equal(identity.staffApi, audience === 'staff');
    return emptyCatalogPage();
  } }, f.authority);
  await runWithRequestIdentity({ tenantId: 'parent', userId: 'parent', isSaasAdmin: true }, async () => {
    const before = structuredClone(getRequestIdentity()); const result = await service.read({ limit: 10 });
    assert.deepEqual(result.items, []); assert.equal(result.scope.workspaceId, 'workspace-a');
    assert.deepEqual(getRequestIdentity(), before);
  });
  assert.equal(reads, 1);
});

for (const revoke of [state => { state.session = false; }, state => { state.member = false; },
  state => { state.user.permissions = []; }, state => { state.workspace = 'workspace-b'; }]) {
  test('actual Guard revalidation discards a late catalog result after identity changes', async () => {
    const f = setup(); let reads = 0;
    const service = new AiCatalogReadFactsService({ listItemGroupsPage: async () => { reads++; revoke(f.state); return emptyCatalogPage(); } }, f.authority);
    await assert.rejects(service.read({ limit: 10 }), denied); assert.equal(reads, 1);
  });
}

test('actual Guard rejects missing permission before calling the catalog reader', async () => {
  const f = setup(); f.state.user.permissions = []; let reads = 0;
  const service = new AiCatalogReadFactsService({ listItemGroupsPage: async () => { reads++; return emptyCatalogPage(); } }, f.authority);
  await assert.rejects(service.read({ limit: 10 }), denied); assert.equal(reads, 0);
});

test('actual staff route allowlist rejects membership candidates even with create-order permission', async () => {
  const f = setup('staff'); let reads = 0;
  const service = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => { reads++; return []; } }, f.authority);
  await assert.rejects(service.read({ limit: 10 }), denied); assert.equal(reads, 0);
});

test('membership reader receives actual own-data ALS rather than caller scope', async () => {
  const f = setup(); f.state.user.dataScope = 'own'; let reads = 0;
  const service = new AiMembershipCandidateReadFactsService({
    listPersonalOptions: async () => { throw Error('unbounded member lookup must not run'); },
    listPersonalOptionsPage: async (tenant, query) => {
      reads++; assert.equal(tenant, 'tenant-a'); assert.deepEqual(query, { limit: 10 });
      const identity = getRequestIdentity();
      assert.equal(identity.dataScope, 'own'); assert.equal(identity.workspaceId, 'workspace-a');
      assert.equal(identity.userId, 'operator-a'); return { rows: [], truncated: false };
    }
  }, f.authority);
  const result = await service.read({ limit: 10 }); assert.deepEqual(result.candidates, []); assert.equal(reads, 1);
});

test('membership reads preserve original administrator/wildcard grants and reject lost or mismatched authority', async () => {
  for (const mode of ['explicit', 'tenant_admin', 'wildcard']) {
    const f = setup();
    f.state.user.isPlatformAdmin = mode === 'tenant_admin';
    f.state.user.permissions = mode === 'tenant_admin' ? [] : mode === 'wildcard' ? ['*'] : ['rental-os:order:create'];
    let reads = 0;
    const page = () => {
      const identity = getRequestIdentity();
      assert.equal(identity.tenantId, 'tenant-a'); assert.equal(identity.workspaceId, 'workspace-a');
      assert.equal(identity.userId, 'operator-a'); reads++; return { rows: [], truncated: false };
    };
    const service = new AiMembershipCandidateReadFactsService({
      listPersonalOptions: async () => { throw Error('unbounded lookup forbidden'); },
      listPersonalOptionsPage: async () => page(), listBookingOptionsPage: async () => page()
    }, f.authority);
    assert.deepEqual((await service.read({ limit: 2 })).candidates, []);
    assert.deepEqual((await service.readBookingOptions({ customerId: 'customer-a', limit: 2 })).options, []);
    assert.equal(reads, 2, mode);
    f.state.user.isPlatformAdmin = false; f.state.user.permissions = [];
    await assert.rejects(service.read({ limit: 2 }), denied);
    await assert.rejects(service.readBookingOptions({ customerId: 'customer-a', limit: 2 }), denied);
    assert.equal(reads, 2, 'current Guard must reject before another query');
  }
  const revoked = setup(); revoked.state.user.isPlatformAdmin = true; revoked.state.user.permissions = [];
  let lateReads = 0;
  const late = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => [], listPersonalOptionsPage: async () => {
    lateReads++; revoked.state.user.isPlatformAdmin = false; return { rows: [], truncated: false };
  } }, revoked.authority);
  await assert.rejects(late.read({ limit: 2 }), denied); assert.equal(lateReads, 1, 'late administrator revocation discards the result');
  const current = setup(); current.state.user.isPlatformAdmin = true; current.state.user.permissions = [];
  const context = await current.authority.withRead('membership_candidates', { limit: 2 }, async value => structuredClone(value));
  let bareReads = 0;
  const bare = new AiMembershipCandidateReadFactsService({ listPersonalOptions: async () => [], listPersonalOptionsPage: async () => {
    bareReads++; return { rows: [], truncated: false };
  } }, { withRead: async (_kind, _input, read) => read(context) });
  await assert.rejects(bare.read({ limit: 2 }), denied, 'copied context alone is not an administrator grant');
  await assert.rejects(runWithRequestIdentity({ tenantId: 'tenant-b', workspaceId: 'workspace-b', userId: 'operator-a',
    isPlatformAdmin: true, isSaasAdmin: false }, () => bare.read({ limit: 2 })), denied);
  assert.equal(bareReads, 0);
});

test('resolve-only authority cannot activate any business reader', () => {
  assert.throws(() => new AiCatalogReadFactsService({ listItemGroupsPage: async () => emptyCatalogPage() }, { resolve: async () => ({}) }), error => error.code === 'CONFIG_INVALID');
});

test('tenant administrator flag preserves original Guard-authorized AIN08 reads without SaaS or scope elevation', async () => {
  const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
  const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
  const { RENTAL_CATEGORY_DEFINITIONS } = require('@rental-os/shared');
  const f = setup(), T = 'tenant-a', W = 'workspace-a', def = RENTAL_CATEGORY_DEFINITIONS.find(row => row.code === 'camera');
  f.state.user.isPlatformAdmin = true; f.state.user.permissions = [];
  const counts = { report: 0, quote: 0, availability: 0, rates: 0 }, owners = { tenantId: T, workspaceId: W };
  const group = { id: 'item-a', tenantId: T, categoryCode: 'camera', code: 'ITEM', name: 'Synthetic item', inventoryMode: 'quantity', unit: '台',
    attributes: {}, bundleComponents: [], status: 'enabled', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };
  const quote = { ...owners, categoryCode: 'camera', profile: { tenantId: T, categoryCode: 'camera', capabilities: [], terminology: def.terminology },
    settings: { tenantId: T, categoryCode: 'camera', configVersion: '1.0', pricing: { enabledUnits: ['day_24h'], defaultUnit: 'day_24h', currency: 'CNY', holidayPricingEnabled: false },
      fulfillment: { enabledModes: ['store_pickup_return'] }, payment: { enabledMethods: ['offline_cash'] }, calendar: { timeZone: 'Asia/Shanghai' } },
    groups: [group], pricingGroups: [], couponTemplates: [], locations: [], operators: [] };
  // Explicit persisted leaf returns only. AuthService, original Guard/ALS and
  // the exact Core/business methods execute; no SQL/DB simulation or new ACL.
  const cfg = {
    readReportConfigurationFacts: async () => { counts.report++; return { ...owners, categoryCode: 'camera', currency: 'CNY' }; },
    readQuoteConfigurationFacts: async () => { counts.quote++; return structuredClone(quote); },
    readFulfillmentAdmission: async () => ({ locations: [{ ...owners, id: 'location-a', status: 'enabled', operatorId: 'operator-a', capabilities: ['pickup', 'return'] }],
      operators: [{ ...owners, id: 'operator-a', status: 'enabled', type: 'self_operated' }] }),
    listItemGroupsPage: async () => ({ rows: [structuredClone(group)], source: 'persisted_workspace_configuration', truncated: false, nextCursor: null, configurationVersion: 'synthetic-version' })
  };
  const core = new RentalCoreService(cfg, { readAvailabilitySnapshot: async () => { counts.availability++;
    return { assets: [], reservations: [], stocks: [{ ...owners, id: 'stock-a', itemGroupId: 'item-a', locationId: 'location-a', onHandQuantity: 3, maintenanceQuantity: 0 }] }; } });
  const business = new RentalBusinessService({ readQuoteRateTargets: async () => { counts.rates++; return [{ itemGroupId: 'item-a', unit: 'day_24h', priceVersionId: 'version-a', priceVersion: 'v1' }]; } }, {}, cfg);
  const availability = { locationId: 'location-a', startAt: '2026-11-10T00:00:00Z', endAt: '2026-11-11T00:00:00Z', lines: [{ itemGroupId: 'item-a', quantity: 1 }] };
  const reads = [
    ['report', 'risk', {}, () => core.readReportConfiguration(T)],
    ['quote', 'quote_context', {}, () => core.readQuoteConfiguration(T)],
    ['availability', 'availability', availability, () => core.readAvailability(T, availability)],
    ['rates', 'quote_context', {}, () => business.readQuoteRateTargets(T, quote, '2026-11-10T00:00:00Z')]
  ];
  const outcomes = await Promise.all(reads.map(async ([name, kind, input, read]) => {
    let allowed = false;
    try { const value = await f.authority.withRead(kind, input, async context => {
      allowed = true; const current = getRequestIdentity();
      assert.equal(current.isPlatformAdmin, true); assert.equal(current.isSaasAdmin, false);
      assert.deepEqual(context.scope, { kind: 'workspace', ...owners }); return read();
    }); return { name, allowed, reads: counts[name], success: true, value }; }
    catch (error) { return { name, allowed, reads: counts[name], success: false, error: error.code ?? error.name }; }
  }));
  console.log('tenant-admin-read-outcomes', JSON.stringify(outcomes.map(({ value: _value, ...row }) => row)));
  assert.ok(outcomes.every(row => row.allowed && row.success && row.reads === 1));
  assert.equal(outcomes.find(row => row.name === 'availability').value.available, true);
  assert.equal(core.states.size, 0);
  // isPlatformAdmin supplies no tenant/workspace or durable current membership.
  const before = counts.report;
  await assert.rejects(f.authority.withRead('risk', {}, () => core.readReportConfiguration('tenant-b'))); assert.equal(counts.report, before);
  f.state.member = false;
  await assert.rejects(f.authority.withRead('risk', {}, () => core.readReportConfiguration(T))); assert.equal(counts.report, before);
  f.state.member = true; f.state.user.isSaasAdmin = true;
  await assert.rejects(f.authority.withRead('risk', {}, () => core.readReportConfiguration(T))); assert.equal(counts.report, before);
  await assert.rejects(runWithRequestIdentity({ ...owners, userId: 'operator-a', isPlatformAdmin: true, isSaasAdmin: true }, () => core.readReportConfiguration(T)));
  f.state.user.isSaasAdmin = false;
  const real = cfg.readReportConfigurationFacts;
  cfg.readReportConfigurationFacts = async () => { const result = await real(); f.state.member = false; return result; };
  await assert.rejects(f.authority.withRead('risk', {}, () => core.readReportConfiguration(T))); assert.equal(counts.report, before + 1);
});
