import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import type { RentalWorkspaceReportRepository } from '../../rental-core/rental-workspace-report.repository';
import { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { AiCatalogReadFactsService } from '../catalog-read-facts.service';
import { AiAvailabilityReadFactsService } from '../availability-read-facts.service';
import { AiMembershipCandidateReadFactsService } from '../membership-candidate-read-facts.service';
import type { AiMembershipCandidateReadPort } from '../membership-candidate-read-facts.service';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import { AiOrderReadFactsService } from '../order-read-facts.service';
import { AiDiagnosticRouteAuthority } from './diagnostic-route.authority';
import { AiOpeningReadFactsService, AiRiskReadFactsService } from './diagnostic-read-facts.service';
import { AiGuardedQuoteCoreContextSource, composeAiGuardedQuoteTools } from './quote-route.composition';
import { AiOrderSavedQuoteSource } from './order-saved-quote.source';
import { ModelGatewayError } from '../model-gateway.ports';

/** Server composition only. Guard and current session come from the application
 * host, never model arguments. No HTTP route, dispatch, entitlement or approval
 * is installed. Each call still runs the original route's current Guard/ALS. */
export function composeAiAuthorizedBusinessTools(input: {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  core: Pick<RentalCoreService, 'listItemGroups' | 'availability' | 'getOrder' | 'getProfile'
    | 'getWorkspaceCategory' | 'getBusinessSettings' | 'listPricingGroups'
    | 'listCouponTemplates' | 'listLocations' | 'listOperators' | 'resolvePricingGroupQuoteRequest'>;
  memberships: AiMembershipCandidateReadPort;
  business: Pick<RentalBusinessService, 'createQuote' | 'getQuote' | 'tenantReadiness'>;
  reports: Pick<RentalWorkspaceReportRepository, 'getOperationReport'>;
  clock?: () => Date;
}) {
  for (const [port, method] of [[input?.business, 'getQuote'], [input?.reports, 'getOperationReport']] as const) {
    if (!port || typeof (port as unknown as Record<string, unknown>)[method] !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, input.clock);
  const context = new AiGuardedQuoteCoreContextSource(input.core, routes);
  const diagnostics = new AiDiagnosticRouteAuthority(routes);
  const order = (serverOrderId: string) => new AiOrderReadFactsService(input.core,
    new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock), input.clock,
    new AiOrderSavedQuoteSource(input.business, context));
  if (typeof input.core.availability !== 'function' || typeof input.core.getOrder !== 'function'
    || typeof input.memberships?.listPersonalOptions !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const reads = { catalog: new AiCatalogReadFactsService(input.core, routes, input.clock),
    availability: new AiAvailabilityReadFactsService(input.core, routes, input.clock),
    membershipCandidates: new AiMembershipCandidateReadFactsService(input.memberships, routes, input.clock) };
  return Object.freeze({
    catalog: reads.catalog,
    availability: reads.availability,
    membershipCandidates: reads.membershipCandidates,
    order,
    opening: new AiOpeningReadFactsService(input.business, context, diagnostics, input.clock),
    risks: new AiRiskReadFactsService(input.reports, {
      category: async scope => (await context.current(scope)).category.code,
      currency: async scope => (await context.current(scope)).settings.pricing.currency
    }, diagnostics, input.clock),
    quote: composeAiGuardedQuoteTools({ core: input.core, business: input.business, routes,
      readers: { catalog: reads.catalog, members: reads.membershipCandidates }, clock: input.clock })
  });
}
