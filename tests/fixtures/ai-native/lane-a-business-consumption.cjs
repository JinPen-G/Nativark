'use strict';
const { authorizedRunnerHarness } = require('./task-authorized-runner.cjs');
const { ApiAuthGuard } = require('../../../apps/api/src/common/api-auth.guard');
const { RentalCoreService } = require('../../../apps/api/src/modules/rental-core/rental-core.service');
const { RentalBusinessService } = require('../../../apps/api/src/modules/rental-core/rental-business.service');
const { MembershipService } = require('../../../apps/api/src/modules/platform/membership.service');
const { RentalWorkspaceReportRepository } = require('../../../apps/api/src/modules/rental-core/rental-workspace-report.repository');
const { composeAiAuthorizedBusinessTools } = require('../../../apps/api/src/modules/ai-native/tools/business-tools.composition');
const stores = require('../../helpers/absorbing-config-store.cjs');
exports.setup = async (categoryCode = 'camera', withMembership = false) => {
  const h = await authorizedRunnerHarness();
  h.identity.user.tenantId = 'tenant_001';
  h.identity.user.permissions.push('rental-core:catalog:view', 'rental-os:order:create', 'rental-os:report:view');
  const config = stores.createAbsorbingConfigStore();
  config.listWorkspaces = async () => [{ id: 'workspace-a', tenantId: 'tenant_001', categoryCode, isDefault: true }];
  const facts = stores.createAbsorbingFactStore();
  const core = new RentalCoreService(config, facts); await core.onApplicationBootstrap();
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
  }, {});
  const business = new RentalBusinessService(stores.createAbsorbingBusinessConfigStore(), businessFacts, config,
    undefined,undefined,undefined,undefined,undefined,undefined,withMembership?memberships:undefined);
  await business.onApplicationBootstrap();
  const reports = new RentalWorkspaceReportRepository({ rentalOrder: { groupBy: async () => [], aggregate: async () => ({ _sum: {} }), findMany: async () => [] }, rentalAsset: { groupBy: async () => [] }, rentalStockBalance: { aggregate: async () => ({ _sum: {} }) } });
  const tools = composeAiAuthorizedBusinessTools({ core, business, memberships, reports,
    guard: new ApiAuthGuard(h.authorization.auth, undefined, undefined, undefined, {}), credentials: h.authorization.credentials });
  const group = core.listItemGroups('tenant_001')[0], location = core.listLocations('tenant_001')[0];
  const candidate = { customerType: 'personal', customerId: 'customer-a', items: [{ productName: group.name, quantity: 1 }],
    start: '2026-11-10T09:00:00+08:00', end: '2026-11-11T09:00:00+08:00', fulfillmentMode: 'store_pickup_return', locationName: location.name };
  return { h, tools, core, business, businessFacts, candidate, memberships, membershipRows, reports, facts, group, location };
};
