'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
require('ts-node').register({ transpileOnly: false, compilerOptions: { module: 'commonjs', moduleResolution: 'node', experimentalDecorators: true, emitDecoratorMetadata: true } });
const { composeAiAuthorizedBusinessTools } = require('../apps/api/src/modules/ai-native/tools/business-tools.composition');
const { authorizedRunnerHarness } = require('./fixtures/ai-native/task-authorized-runner.cjs');
const { ApiAuthGuard } = require('../apps/api/src/common/api-auth.guard');
const { RentalCoreService } = require('../apps/api/src/modules/rental-core/rental-core.service');
const { RentalBusinessService } = require('../apps/api/src/modules/rental-core/rental-business.service');
const { MembershipService } = require('../apps/api/src/modules/platform/membership.service');
const { RentalWorkspaceReportRepository } = require('../apps/api/src/modules/rental-core/rental-workspace-report.repository');
const stores = require('./helpers/absorbing-config-store.cjs');
async function setup() {
  const h = await authorizedRunnerHarness();
  h.identity.user.tenantId = 'tenant_001';
  h.identity.user.permissions.push('rental-core:catalog:view', 'rental-os:order:create', 'rental-os:report:view');
  const config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId: 'tenant_001', categoryCode: 'camera', isDefault: true }];
  const core = new RentalCoreService(config, stores.createAbsorbingFactStore()); await core.onApplicationBootstrap();
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), config); await business.onApplicationBootstrap();
  const memberships = new MembershipService({ customerProfile: { findMany: async () => [{ id: 'customer-a', name: 'Synthetic customer', phoneMasked: '138****0000', membership: { status: 'active' } }] } }, {});
  const reports = new RentalWorkspaceReportRepository({ rentalOrder: { groupBy: async () => [], aggregate: async () => ({ _sum: {} }), findMany: async () => [] }, rentalAsset: { groupBy: async () => [] }, rentalStockBalance: { aggregate: async () => ({ _sum: {} }) } });
  const tools = composeAiAuthorizedBusinessTools({ core, business, memberships, reports,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), credentials: h.authorization.credentials });
  return { h, tools, core };
}
test('server composition connects actual catalog, diagnostics, candidates and formal Core quote', async () => {
  const { tools, core } = await setup();
  const catalog = await tools.catalog.read({ limit: 50 });
  assert.ok(catalog);
  const opening = await tools.opening.read({ limit: 50 }); assert.equal(opening.scope.workspaceId, 'workspace-a');
  const actions = await tools.openingActions.read({ risks: { from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' } });
  assert.ok(actions.sections.length > 0); assert.ok(actions.sections.every(row => row.candidate.proposedChanges.length === 0));
  assert.equal(actions.risks.value.historicalUtilization.status, 'unavailable');
  assert.equal(actions.sections[0].externalVerification, 'not_loaded');
  const risk = await tools.risks.read({ from: '2026-01-01T00:00:00Z', to: '2026-01-02T00:00:00Z' }); assert.equal(risk.profit.status, 'unavailable');
  // Names/locations are sourced from the actual seeded Core, not model enums.
  const group = core.listItemGroups('tenant_001')[0], location = core.listLocations('tenant_001')[0];
  const candidate = { customerType: 'personal', customerId: 'customer-a', items: [{ productName: group.name, quantity: 1 }],
    start: '2026-11-10T09:00:00+08:00', end: '2026-11-11T09:00:00+08:00', fulfillmentMode: 'store_pickup_return', locationName: location.name };
  const prepared = await tools.quote.candidates.prepare(candidate);
  assert.equal(prepared.status, 'needs_confirmation');
  const unconfirmed = await tools.quote.previewSelection(candidate); assert.equal(unconfirmed.status, 'missing_input'); assert.equal(unconfirmed.quote, undefined);
  const quote = await tools.quote.previewSelection({ ...candidate, selectionRevision: prepared.selectionRevision }); assert.equal(quote.status, 'quoted'); assert.equal(quote.quote.reservation, 'not_reserved'); assert.equal(quote.quotePersistence, 'saved');
});
test('same composition rejects current permission withdrawal instead of using captured context', async () => {
  const { tools, h } = await setup(); h.identity.user.permissions = [];
  await assert.rejects(tools.catalog.read({ limit: 50 }));
  await assert.rejects(tools.opening.read({ limit: 50 }));
  await assert.rejects(tools.openingActions.read({}));
});
