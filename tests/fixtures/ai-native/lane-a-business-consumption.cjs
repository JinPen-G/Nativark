'use strict';
const { authorizedRunnerHarness } = require('./task-authorized-runner.cjs');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { RentalCoreService } = require('../../../apps/api/src/modules/rental-core/rental-core.service');
const { RentalBusinessService } = require('../../../apps/api/src/modules/rental-core/rental-business.service');
const { MembershipService } = require('../../../apps/api/src/modules/platform/membership.service');
const { RentalWorkspaceReportRepository } = require('../../../apps/api/src/modules/rental-core/rental-workspace-report.repository');
const { composeAiAuthorizedBusinessTools } = require('../../../apps/api/src/modules/ai-native/tools/business-tools.composition');
const stores = require('../../helpers/absorbing-config-store.cjs');
exports.setup = async () => {
  const h = await authorizedRunnerHarness();
  h.identity.user.tenantId = 'tenant_001';
  h.identity.user.permissions.push('rental-core:catalog:view', 'rental-os:order:create', 'rental-os:report:view');
  const config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId: 'tenant_001', categoryCode: 'camera', isDefault: true }];
  const facts = stores.createAbsorbingFactStore();
  const core = new RentalCoreService(config, facts); await core.onApplicationBootstrap();
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), stores.createAbsorbingBusinessFactStore(), config);
  await business.onApplicationBootstrap();
  const memberships = new MembershipService({ customerProfile: { findMany: async () => [{ id: 'customer-a', name: 'Synthetic customer', phoneMasked: '138****0000', membership: { status: 'active' } }] } }, {});
  const reports = new RentalWorkspaceReportRepository({ rentalOrder: { groupBy: async () => [], aggregate: async () => ({ _sum: {} }), findMany: async () => [] }, rentalAsset: { groupBy: async () => [] }, rentalStockBalance: { aggregate: async () => ({ _sum: {} }) } });
  const tools = composeAiAuthorizedBusinessTools({ core, business, memberships, reports,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), credentials: h.authorization.credentials });
  const group = core.listItemGroups('tenant_001')[0], location = core.listLocations('tenant_001')[0];
  const candidate = { customerType: 'personal', customerId: 'customer-a', items: [{ productName: group.name, quantity: 1 }],
    start: '2026-11-10T09:00:00+08:00', end: '2026-11-11T09:00:00+08:00', fulfillmentMode: 'store_pickup_return', locationName: location.name };
  return { h, tools, core, business, candidate, memberships, reports, facts, group, location };
};
