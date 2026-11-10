'use strict';
const { authorizedRunnerHarness } = require('./task-authorized-runner.cjs');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { RentalCoreService } = require('../../../apps/api/src/modules/rental-core/rental-core.service');
const { RentalBusinessService } = require('../../../apps/api/src/modules/rental-core/rental-business.service');
const { MembershipService } = require('../../../apps/api/src/modules/platform/membership.service');
const { RentalWorkspaceReportRepository } = require('../../../apps/api/src/modules/rental-core/rental-workspace-report.repository');
const { composeAiAuthorizedBusinessTools } = require('../../../apps/api/src/modules/ai-native/tools/business-tools.composition');
const stores = require('../../helpers/absorbing-config-store.cjs');
const { requestFingerprint } = require('../../../apps/api/src/modules/rental-core/rental-idempotency.repository');
exports.setup = async (categoryCode = 'camera', withMembership = false) => {
  const h = await authorizedRunnerHarness();
  h.identity.user.tenantId = 'tenant_001';
  h.identity.user.permissions.push('rental-core:catalog:view', 'rental-os:order:create', 'rental-os:report:view');
  const config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId: 'tenant_001', categoryCode, isDefault: true }];
  const facts = stores.createAbsorbingFactStore();
  // Explicit fixture rows from the original spies, not a bounded SQL emulator.
  // The real repository's query bounds/ownership have separate assertions.
  facts.readAvailabilitySnapshot = async () => {
    const [reservations, assets, stocks] = await Promise.all([facts.activeReservations(), facts.listAssets(), facts.listStockBalances()]);
    return { reservations, assets, stocks };
  };
  const core = new RentalCoreService(config, facts); await core.onApplicationBootstrap();
  // Declared synthetic pagination endpoint over the SAME seeded synthetic
  // catalog (not a Prisma integrity simulation): deterministic id-ordered
  // pages with the formal cursor/truncated contract for the persisted port.
  config.listItemGroupsPage = async (tenantId, workspaceId, query) => {
    if (workspaceId !== 'workspace-a') throw Error('synthetic workspace mismatch');
    const seeded = core.listItemGroups(tenantId);
    const all = seeded.filter(row => (!query.itemGroupId || row.id === query.itemGroupId)
      && (!query.name || row.name === query.name) && (!query.cursor || row.id > query.cursor))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0));
    const rows = all.slice(0, query.limit), truncated = all.length > query.limit;
    return { rows, truncated, nextCursor: truncated ? rows[rows.length - 1].id : null,
      source: 'persisted_workspace_configuration',
      configurationVersion: requestFingerprint(seeded.map(row => [row.id, row.name, row.status, row.unit])) };
  };
  const businessFacts = stores.createAbsorbingBusinessFactStore();
  const membershipRows = { customer:{id:'customer-a',tenantId:'tenant_001',customerType:'personal',name:'Synthetic customer',phoneMasked:'138****0000'},
    link:{tenantId:'tenant_001',customerId:'customer-a',status:'active'}, bookingOptions:[], bookingQueries:[], corporateCustomers:[], corporateLinks:[] };
  const memberships = new MembershipService({
    businessWorkspace:{findFirst:async ({where})=>where.tenantId==='tenant_001'&&where.id==='workspace-a'?{id:'workspace-a',categoryCode}:null},
    customerProfile: { findMany: async () => [{ ...membershipRows.customer, membership: membershipRows.link }],
      findFirst:async ({where})=>structuredClone([membershipRows.customer,...membershipRows.corporateCustomers]
        .find(row=>row.tenantId===where.tenantId&&row.id===where.id&&(!where.customerType||row.customerType===where.customerType))??null) },
    customerMembership:{findUnique:async ({where})=>structuredClone([membershipRows.link,...membershipRows.corporateLinks]
      .find(row=>row.tenantId===where.tenantId_customerId.tenantId&&row.customerId===where.tenantId_customerId.customerId)??null)},
    customerCorporateMembership:{findMany:async query=>{
      membershipRows.bookingQueries.push(structuredClone(query));
      return structuredClone(membershipRows.bookingOptions.filter(row=>!query.where.id||row.id<query.where.id.lt)
        .sort((a,b)=>a.id<b.id?1:a.id>b.id?-1:0).slice(0,query.take));
    },findFirst:async ({where})=>structuredClone(membershipRows.bookingOptions.find(row=>row.tenantId===where.tenantId
      &&row.personalCustomerId===where.personalCustomerId&&row.corporateCustomerId===where.corporateCustomerId
      &&row.status===where.status&&row.effectiveFrom<=where.effectiveFrom.lte
      &&(!row.effectiveTo||row.effectiveTo>=where.OR[1].effectiveTo.gte))??null)},
    customerQualificationRef:{findMany:async()=>[]},customerMembershipQualificationType:{findMany:async()=>[]},
    customerMembershipPlanAssignment:{findFirst:async()=>null}
  }, { lockCustomerBusinessGate: async (tenantId, customerId, tx) => {
    if (!tx || tenantId !== 'tenant_001') throw Error('synthetic customer lock scope mismatch');
    return [membershipRows.customer, ...membershipRows.corporateCustomers].some(row => row.id === customerId && row.tenantId === tenantId);
  } });
  // Opening tests get declared minimal persisted-source samples, independent
  // of seeded quote state. These fixtures do not simulate SQL or persistence.
  config.readReadinessCoreFacts = async () => ({ tenantId: 'tenant_001', workspaceId: 'workspace-a', categoryCode,
    timeZone: 'Asia/Shanghai', enabledItemGroupCount: 1, serviceableLocationCount: 1,
    pricingGroups: [{ id: 'opening-pricing-sample', name: 'Synthetic pricing group' }] });
  const { RENTAL_OPENING_TERMINOLOGY_FIELDS } = require('../../../apps/api/src/modules/rental-core/rental-core-config.repository');
  const syntheticProfile = await core.getProfile('tenant_001'), syntheticSettings = await core.getBusinessSettings('tenant_001');
  const openingConfiguration = { tenantId: 'tenant_001', workspaceId: 'workspace-a', categoryCode,
    profile: { configVersion: syntheticProfile.configVersion, terminology: Object.fromEntries(RENTAL_OPENING_TERMINOLOGY_FIELDS.map(field => [field, syntheticProfile.terminology[field]])) },
    settings: { configVersion: syntheticSettings.configVersion, pricing: { currency: syntheticSettings.pricing.currency,
      enabledUnits: [...syntheticSettings.pricing.enabledUnits], defaultUnit: syntheticSettings.pricing.defaultUnit },
      fulfillment: { enabledModes: [...syntheticSettings.fulfillment.enabledModes] } },
    groups: core.listItemGroups('tenant_001').map(({ id, code, status, inventoryMode, unit }) => ({ id, code, status, inventoryMode, unit })),
    pricingGroups: core.listPricingGroups('tenant_001').map(({ id, code, status, version }) => ({ id, code, status, version })),
    locations: core.listLocations('tenant_001').map(({ id, code, status, capabilities }) => ({ id, code, status, capabilities })),
    truncated: { groups: false, pricingGroups: false, locations: false }, enabledItemGroupCount: 1, enabledLocationCount: 1 };
  const quoteConfiguration = { tenantId: 'tenant_001', workspaceId: 'workspace-a', categoryCode,
    profile: syntheticProfile, settings: syntheticSettings, groups: core.listItemGroups('tenant_001'),
    pricingGroups: core.listPricingGroups('tenant_001'), couponTemplates: core.listCouponTemplates('tenant_001'),
    locations: core.listLocations('tenant_001'), operators: core.listOperators('tenant_001') };
  // Declared returned rows over the original synthetic reference case. No
  // production fallback or database/SQL interpretation is installed here.
  config.readQuoteConfigurationFacts = async () => structuredClone(quoteConfiguration);
  config.readOpeningConfigurationFacts = async () => structuredClone(openingConfiguration);
  config.readReportConfigurationFacts = async () => ({ tenantId: 'tenant_001', workspaceId: 'workspace-a',
    categoryCode, currency: syntheticSettings.pricing.currency });
  const businessConfig = stores.createAbsorbingBusinessConfigStore();
  businessConfig.readReadinessBusinessFacts = async () => ({ tenantId: 'tenant_001', workspaceId: 'workspace-a',
    ruleVersions: [], publishedCalendarYears: [], pricedGroupIds: ['opening-pricing-sample'],
    operationsAccounts: 0, hasActiveRole: false, priceVersion: null });
  const business = new RentalBusinessService(businessConfig, businessFacts, config,
    undefined,undefined,undefined,undefined,undefined,undefined,withMembership?memberships:undefined);
  await business.onApplicationBootstrap();
  businessConfig.readQuoteRateTargets = async (tenantId, workspaceId, at) => {
    if (tenantId !== 'tenant_001' || workspaceId !== 'workspace-a') throw Error('synthetic rate source mismatch');
    const rows = await business.listSpaceRatesAt(tenantId, { ...quoteConfiguration, category: core.listCategories().find(row => row.code === categoryCode) }, at.toISOString());
    return rows.map(({ pricingGroupId, itemGroupId, unit }) => ({ pricingGroupId, itemGroupId, unit,
      priceVersionId: 'synthetic-version', priceVersion: 'v1' }));
  };
  const reports = new RentalWorkspaceReportRepository({ rentalOrder: { groupBy: async () => [], aggregate: async () => ({ _sum: {} }), findMany: async () => [] }, rentalAsset: { groupBy: async () => [] }, rentalStockBalance: { aggregate: async () => ({ _sum: {} }) } });
  const tools = composeAiAuthorizedBusinessTools({ core, business, memberships, reports,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), credentials: h.authorization.credentials });
  require('../../helpers/fulfillment-admission-fixture.cjs').bindFulfillmentAdmission([core, business], 'tenant_001', 'workspace-a', {
    locations: core.listLocations('tenant_001'), operators: core.listOperators('tenant_001')
  });
  const group = core.listItemGroups('tenant_001')[0], location = core.listLocations('tenant_001')[0];
  const rentalStart = Date.now() + 24 * 60 * 60 * 1000;
  const candidate = { customerType: 'personal', customerId: 'customer-a', items: [{ productName: group.name, quantity: 1 }],
    start: new Date(rentalStart).toISOString(), end: new Date(rentalStart + 24 * 60 * 60 * 1000).toISOString(),
    // The reference sample must use a registered category mode; a warehouse
    // category must not be blocked by this fixture's old store-only assumption.
    fulfillmentMode: core.listCategories().find(row => row.code === categoryCode).businessModel.fulfillmentModes[0], locationName: location.name };
  const units = await tools.quote.candidates.prepare(candidate);
  candidate.items[0].pricingUnit = units.clarifications.find(row => row.field === 'items.0.pricingUnit').candidates[0].id;
  return { h, tools, core, business, businessFacts, candidate, memberships, membershipRows, reports, facts, group, location, openingConfiguration, quoteConfiguration };
};
