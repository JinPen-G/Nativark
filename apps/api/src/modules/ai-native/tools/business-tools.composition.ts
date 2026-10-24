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
import type { RentalCoreController } from '../../rental-core/rental-core.controller';
import { AiOrderExtensionPreviewService } from './order-extension-preview.service';
import { AiOrderCandidatesService } from './order-candidates.service';
import { z } from 'zod';

/** Server composition only. Guard and current session come from the application
 * host, never model arguments. No HTTP route, dispatch, entitlement or approval
 * is installed. Each call still runs the original route's current Guard/ALS. */
export function composeAiAuthorizedBusinessTools(input: {
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  core: Pick<RentalCoreService, 'listItemGroups' | 'availability' | 'getOrder' | 'getProfile'
    | 'getWorkspaceCategory' | 'getBusinessSettings' | 'listPricingGroups'
    | 'listCouponTemplates' | 'listLocations' | 'listOperators' | 'resolvePricingGroupQuoteRequest'> & Partial<Pick<RentalCoreService, 'listInspectionsPage' | 'listItemGroupsPage' | 'queryOrders'>>;
  memberships: AiMembershipCandidateReadPort;
  business: Pick<RentalBusinessService, 'createQuote' | 'getQuote' | 'tenantReadiness'> & Partial<Pick<RentalBusinessService, 'normalizeQuoteInput' | 'createQuoteForOriginalOperation' | 'readQuoteForOriginalOperation' | 'readQuoteForOriginalReference'>>;
  reports: Pick<RentalWorkspaceReportRepository, 'getBoundedOperationReport'>;
  payments?: AiOrderPaymentReadPort;
  /** Human Core preview only; absence never falls back to AI pricing. */
  extensionPreview?: Pick<RentalCoreController, 'previewExtension'>;
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
  const orderActions = composeAiBusinessOrderApplication(input.approvedOrder ? {
    ...input.approvedOrder, guard: input.guard, credentials: input.credentials
  } : undefined);
  const orderActionsAvailable = orderActions.availability === 'available_for_persisted_approved_action';
  return Object.freeze({
    settingsActions: composeAiSettingsBusinessConsumer(input.approvedSettings ? {
      ...input.approvedSettings, guard: input.guard, credentials: input.credentials
    } : undefined),
    orderActions,
    scenes: new AiBusinessScenePreparationService({
      orderAuthority: orderId => new AiOrderRouteContextAuthority(input.guard, input.credentials, orderId, input.clock),
      orderMaterial: orderPreparation, openingAuthority: diagnostics, opening: openingActions,
      quoteAuthority: routes, quote: quotePreparation
    }),
    catalog: reads.catalog,
    orders: new AiOrderCandidatesService(typeof input.core.queryOrders === 'function'
      ? { queryOrders: input.core.queryOrders.bind(input.core) } : undefined, routes, input.clock),
    availability: reads.availability,
    membershipCandidates: reads.membershipCandidates,
    memberProfileDifference: new AiMemberProfileDifferenceService(reads.membershipCandidates, routes),
    memberProfileSubmissionMaterial: (value: unknown) => new AiMemberProfileDifferenceService(reads.membershipCandidates, routes).submissionMaterial(value),
    order,
    orderExplanation: explanation,
    orderNextSteps: nextSteps,
    orderExtensionPreview: (serverOrderId: string) => new AiOrderExtensionPreviewService(serverOrderId, input.core,
      new AiOrderRouteContextAuthority(input.guard, input.credentials, serverOrderId, input.clock), routes,
      input.extensionPreview, input.clock),
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
      reconciliationAvailability: () => {
        // Exact original-reference recovery is real when the Core port exists;
        // a missing observed row stays unknown and never becomes a retry.
        const available = typeof input.business.readQuoteForOriginalReference === 'function'
          && typeof input.business.readQuoteForOriginalOperation === 'function';
        return { status: available ? 'available_original_reference_only' as const : 'unavailable' as const,
          nextAction: 'reconcile' as const, retryable: false as const,
          ...(available ? { entry: 'quote.recoverOriginal(reference, expectedIdentityHash)',
            semantics: 'exact_original_operation_key_only_missing_row_stays_unknown' as const }
            : { missingDependency: 'business.readQuoteForOriginalReference/readQuoteForOriginalOperation' }) };
      },
      /** Stage-labeled handoff material for the mainline order flow. It only
       * observes one exact original quote operation under the current guard;
       * proposal/approval/order stages belong to the persisted AIN-07 flow. */
      commitHandoff: async (value: unknown) => {
        const parsed = z.object({ reference: z.string().min(1).max(512),
          selectionRevision: z.string().regex(/^[a-f0-9]{64}$/u).optional() }).strict()
          .safeParse(structuredClone(value));
        if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
        if (typeof input.business.readQuoteForOriginalReference !== 'function') {
          return { status: 'prepared_not_submitted' as const, stages: { quoteSaved: 'unknown_port_unavailable' as const },
            orderApproval: 'not_granted' as const, execution: 'not_attempted' as const,
            formalInterface: { existing: orderActionsAvailable ? 'orderActions.submit/reconcile' : 'unavailable_no_approved_order_dependencies',
              missing: 'business.readQuoteForOriginalReference' } };
        }
        return routes.withRead('quote_context', {}, async context => {
          const { requestId: _request, authorizedAt: _at, ...identity } = context;
          const result = await quote.recoverOriginal(parsed.data.reference, requestFingerprint(identity));
          const quoted = result.status === 'quoted' && result.quote;          return { status: 'prepared_not_submitted' as const,
            stages: {
              preparation: 'completed_before_quote_reobservable_via_businessPreparation' as const,
              quoteSaved: result.quotePersistence === 'saved' && quoted ? 'saved' as const : result.quotePersistence ?? 'unknown' as const,
              ...(quoted ? { quoteContent: { quoteId: result.quote!.id, quoteNo: result.quote!.quoteNo,
                expiresAt: result.quote!.expiresAt, currency: result.quote!.currency ?? null,
                payableAmount: result.quote!.payableAmount, receivableAmount: result.quote!.receivableAmount,
                versions: { pricingPlanVersion: result.quote!.pricingPlanVersion,
                  ...(result.quote!.priceVersion ? { priceVersion: result.quote!.priceVersion } : {}),
                  ruleVersion: result.quote!.ruleVersion },
                reservation: result.quote!.reservation } } : {}),
              userConfirmedQuote: 'not_attested_by_this_lane_host_selection_evidence_required' as const,
              proposalProduced: 'owned_by_persisted_approval_flow' as const,
              humanApproval: 'owned_by_persisted_approval_flow' as const,
              coreOrderCreated: 'not_queried_use_orderActions_or_order_read' as const,
              resultUnknown: result.quotePersistence === 'unknown'
                ? { state: 'unknown' as const, nextAction: 'reconcile' as const, retryable: false as const }
                : 'not_applicable' as const
            },
            ...(parsed.data.selectionRevision ? { selectionRevision: parsed.data.selectionRevision } : {}),
            orderApproval: 'not_granted' as const, inventoryReservation: quoted ? result.quote!.reservation : 'not_attempted' as const,
            execution: 'not_attempted' as const,
            formalInterface: { existing: orderActionsAvailable ? 'orderActions.submit/reconcile' : 'unavailable_no_approved_order_dependencies',
              required: orderActionsAvailable ? [] : ['persisted approved-order dependencies (approvedOrder input)'] } };
        });
      },
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
