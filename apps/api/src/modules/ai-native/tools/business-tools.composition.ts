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
import { AiOrderPaymentFactsService, type AiOrderPaymentReadPort } from './order-payment-facts.service';
import { AiOrderExplanationFactsService } from './order-explanation-facts.service';
import { AiOrderNextStepsService } from './order-next-steps.service';
import { AiOpeningActionListService } from './opening-action-list.service';
import { AiQuoteBusinessPreparationService } from './quote-business-preparation.service';
import { AiOrderExplanationPreparationService } from './order-explanation-preparation.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { AiMemberProfileDifferenceService } from './member-profile-difference.service';
import { AiBusinessScenePreparationService } from '../scenes/business-scene-preparation.service';
import { composeAiBusinessOrderApplication } from '../scenes/business-order-application';
import type { PersistedApprovedOrderDependencies } from '../approval-execution/approved-order-composition.ports';
import { AiOrderInspectionFactsService } from './order-inspection-facts.service';
import { composeAiSettingsBusinessConsumer, type AiSettingsBusinessDependencies } from '../scenes/settings-business-consumer.composition';

/** Server composition only. Guard and current session come from the application
 * host, never model arguments. No HTTP route, dispatch, entitlement or approval
 * is installed. Each call still runs the original route's current Guard/ALS. */
export function composeAiAuthorizedBusinessTools(input: {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  core: Pick<RentalCoreService, 'listItemGroups' | 'availability' | 'getOrder' | 'getProfile'
    | 'getWorkspaceCategory' | 'getBusinessSettings' | 'listPricingGroups'
    | 'listCouponTemplates' | 'listLocations' | 'listOperators' | 'resolvePricingGroupQuoteRequest'> & Partial<Pick<RentalCoreService, 'listInspectionsPage' | 'listItemGroupsPage'>>;
  memberships: AiMembershipCandidateReadPort;
  business: Pick<RentalBusinessService, 'createQuote' | 'getQuote' | 'tenantReadiness'> & Partial<Pick<RentalBusinessService, 'normalizeQuoteInput' | 'createQuoteForOriginalOperation' | 'readQuoteForOriginalOperation' | 'readQuoteForOriginalReference'>>;
  reports: Pick<RentalWorkspaceReportRepository, 'getBoundedOperationReport'>;
  payments?: AiOrderPaymentReadPort;
  /** Explicit AIN-07 dependencies for an EXISTING persisted task/action. No
   * default original input, policy or approval is supplied by this lane. */
  approvedOrder?: Omit<PersistedApprovedOrderDependencies, 'guard' | 'credentials'>;
  approvedSettings?: Omit<AiSettingsBusinessDependencies, 'guard' | 'credentials'>;
  clock?: () => Date;
}) {
  for (const [port, method] of [[input?.business, 'getQuote'], [input?.reports, 'getBoundedOperationReport']] as const) {
    if (!port || typeof (port as unknown as Record<string, unknown>)[method] !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  const routes = new AiBusinessReadRouteAuthority(input.guard, input.credentials, input.clock);
  const context = new AiGuardedQuoteCoreContextSource(input.core, routes);
  const diagnostics = new AiDiagnosticRouteAuthority(routes);
  const order = (serverOrderId: string) => new AiOrderReadFactsService(input.core,
    new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock), input.clock,
    new AiOrderSavedQuoteSource(input.business, context));
  const explanation = (serverOrderId: string) => {
    const authority = new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock);
    return new AiOrderExplanationFactsService(authority, order(serverOrderId), input.payments
      ? new AiOrderPaymentFactsService(input.payments, input.core, authority, routes, input.clock) : undefined, input.clock,
      typeof input.core.listInspectionsPage === 'function' ? new AiOrderInspectionFactsService({
        getOrder: input.core.getOrder.bind(input.core), listInspectionsPage: input.core.listInspectionsPage.bind(input.core)
      }, new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock, 'inspections'), input.clock) : undefined);
  };
  if (typeof input.core.availability !== 'function' || typeof input.core.getOrder !== 'function'
    || typeof input.memberships?.listPersonalOptions !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const reads = { catalog: new AiCatalogReadFactsService(input.core, routes, input.clock),
    availability: new AiAvailabilityReadFactsService(input.core, routes, input.clock),
    membershipCandidates: new AiMembershipCandidateReadFactsService(input.memberships, routes, input.clock) };
  const opening = new AiOpeningReadFactsService(input.business, context, diagnostics, input.clock);
  const quote = composeAiGuardedQuoteTools({ core: input.core, business: input.business, routes,
    readers: { catalog: reads.catalog, members: reads.membershipCandidates }, clock: input.clock });
  const quotePreparation = new AiQuoteBusinessPreparationService(quote.candidates, reads.availability, routes,
    { contexts: context, catalog: reads.catalog });
  const nextSteps = (serverOrderId: string) => new AiOrderNextStepsService(
    new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock), explanation(serverOrderId));
  const risks = new AiRiskReadFactsService(input.reports, {
    category: async scope => (await context.current(scope)).category.code,
    currency: async scope => (await context.current(scope)).settings.pricing.currency
  }, diagnostics, input.clock);
  const openingActions = new AiOpeningActionListService(opening, risks, context, diagnostics);
  const orderPreparation = (serverOrderId: string) => new AiOrderExplanationPreparationService(
    new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock),
    explanation(serverOrderId), nextSteps(serverOrderId));
  return Object.freeze({
    settingsActions: composeAiSettingsBusinessConsumer(input.approvedSettings ? {
      ...input.approvedSettings, guard: input.guard, credentials: input.credentials
    } : undefined),
    orderActions: composeAiBusinessOrderApplication(input.approvedOrder ? {
      ...input.approvedOrder, guard: input.guard, credentials: input.credentials
    } : undefined),
    scenes: new AiBusinessScenePreparationService({
      orderAuthority: orderId => new AiOrderRouteContextAuthority(input.guard, input.credentials, orderId, input.clock),
      orderMaterial: orderPreparation, openingAuthority: diagnostics, opening: openingActions,
      quoteAuthority: routes, quote: quotePreparation
    }),
    catalog: reads.catalog,
    availability: reads.availability,
    membershipCandidates: reads.membershipCandidates,
    memberProfileDifference: new AiMemberProfileDifferenceService(reads.membershipCandidates, routes),
    memberProfileSubmissionMaterial: (value: unknown) => new AiMemberProfileDifferenceService(reads.membershipCandidates, routes).submissionMaterial(value),
    order,
    orderExplanation: explanation,
    orderNextSteps: nextSteps,
    orderExplanationPreparation: orderPreparation,
    orderManualHandoff: (serverOrderId: string, value: unknown) => nextSteps(serverOrderId).manualHandoff(value),
    orderPayments: (serverOrderId: string) => {
      if (!input.payments) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
      return new AiOrderPaymentFactsService(input.payments, input.core,
        new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock), routes, input.clock);
    },
    opening, risks,
    openingActions,
    openingSection: (value: unknown) => new AiOpeningActionListService(opening, risks, context, diagnostics).readSection(value),
    openingSectionDifferences: (value: unknown) => new AiOpeningActionListService(opening, risks, context, diagnostics).prepareSections(value),
    riskRecheck: (value: unknown) => new AiOpeningActionListService(opening, risks, context, diagnostics).recheckRisk(value),
    quote: Object.freeze({ ...quote, businessPreparation: quotePreparation,
      bookingIdentityOptions: (value: unknown) => reads.membershipCandidates.readBookingOptions(value),
      reconciliationAvailability: () => quotePreparation.reconciliationAvailability(),
      /** Explicit R1 entry; the host owns the human-selection evidence. Core
       * quote success is not order approval, payment, or stock reservation. */
      previewBusinessSelection: async (value: unknown) => {
        const supplied = structuredClone(value);
        const prepared = await quotePreparation.prepare(supplied);
        if (prepared.status !== 'ready') return prepared;
        const result = await quote.previewSelection(supplied);
        if (result.status !== 'quoted' || !result.quote) return result;
        return { ...result, confirmationReview: {
          source: { scope: result.scope, resourceType: 'quote' as const, resourceId: result.quote.id,
            observedAt: result.observedAt, ruleVersion: result.quote.ruleVersion,
            pricingPlanVersion: result.quote.pricingPlanVersion, priceVersion: result.quote.priceVersion },
          inputFingerprint: requestFingerprint(prepared.request), configVersion: prepared.configVersion,
          selectionRevision: prepared.selectionRevision, expiresAt: result.quote.expiresAt,
          availabilityObservedAt: prepared.availability.observedAt,
          validity: 'valid_at_quote_observation_recheck_before_commit' as const,
          stock: 'observed_not_reserved' as const, previousConfirmation: 'must_not_reuse' as const,
          changes: { amounts: 'unknown_previous_trusted_quote_not_loaded' as const,
            availability: 'unknown_previous_observation_not_loaded' as const },
          orderApproval: 'not_granted' as const } };
      }
    })
  });
}
