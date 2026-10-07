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
test('enterprise qualification is explicitly unavailable, not defaulted to a personal quote', async () => {
  const h = await setup(); let calls = 0;
  await assert.rejects(h.authority.withQuote({ ...input, customerType: 'corporate' }, async () => { calls++; }), e => e.code === 'CAPABILITY_UNSUPPORTED');
  assert.equal(calls, 0);
});
test('quote permission revocation suppresses callback result', async () => {
  const h = await setup();
  await assert.rejects(h.authority.withQuote(input, async () => { h.identity.user.permissions = []; return true; }));
});
test('settings source resolves actual workspace Core context with authorized location filtering', async () => {
  const h = await setup(), config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId: 'tenant-a', categoryCode: 'camera', isDefault: true }];
  const core = new RentalCoreService(config, stores.createAbsorbingFactStore()); await core.onApplicationBootstrap();
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
  const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), config);
  await business.onApplicationBootstrap();
  const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
  const members = new MembershipService({ customerProfile: { findMany: async () => [{ id: 'customer-a', name: 'Synthetic customer', phoneMasked: '138****0000', membership: { status: 'active' } }] } }, {});
  const { AiCatalogReadFactsService } = require('../apps/api/src/modules/ai-native/catalog-read-facts.service');
  const { AiMembershipCandidateReadFactsService } = require('../apps/api/src/modules/ai-native/membership-candidate-read-facts.service');
  const readers = { catalog: new AiCatalogReadFactsService(core, h.bridge), members: new AiMembershipCandidateReadFactsService(members, h.bridge) };
  const tools = composeAiGuardedQuoteTools({ core, business, routes: h.bridge, readers, clock: () => new Date() });
  const source = new AiGuardedQuoteCoreContextSource(core, h.bridge);
  const scope = { kind: 'workspace', tenantId: 'tenant_001', workspaceId: 'workspace-a' }, ctx = await source.current(scope);
  const prepared = await tools.candidates.prepare({ customerType: 'personal', customerId: 'customer-a', items: [{ productName: ctx.groups[0].name, quantity: 1 }],
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
});
