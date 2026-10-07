import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import type { AiAvailabilityReadFactsService } from '../availability-read-facts.service';
import type { AiQuoteCandidatePreparationService } from './quote-candidate-preparation.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { sealBusinessScenario } from './business-scenario-input';

/** Read-only preparation. It does not attest a human selection, save a quote,
 * reserve stock, or approve an order. Every source still uses its original Guard. */
export class AiQuoteBusinessPreparationService {
  constructor(private readonly candidates: Pick<AiQuoteCandidatePreparationService, 'prepare'>,
    private readonly availability: Pick<AiAvailabilityReadFactsService, 'read'>,
    private readonly authority: AiBusinessReadAuthority) {}

  async prepare(value: unknown) {
    const input = structuredClone(value);
    return this.authority.withRead('quote_context', {}, async context => {
      const selected = await this.candidates.prepare(input, context);
      if (selected.status !== 'needs_confirmation') return { ...selected, scope: context.scope,
        audience: context.audience, observedAt: context.authorizedAt };
      const availability = await this.availability.read({ locationId: selected.request.fulfillmentLocationId,
        startAt: selected.request.startAt, endAt: selected.request.endAt,
        lines: selected.request.lines.map(line => ({ itemGroupId: line.itemGroupId!, quantity: line.quantity })) }, context);
      const current = await this.candidates.prepare(input, context);
      if (current.status !== 'needs_confirmation'
        || requestFingerprint(current.request) !== requestFingerprint(selected.request)
        || current.selectionRevision !== selected.selectionRevision) throw new ModelGatewayError('CONFIG_INVALID');
      const evidence = { scope: availability.scope, resourceType: 'availability' as const,
        request: { locationId: availability.result.locationId, startAt: availability.result.startAt, endAt: availability.result.endAt },
        observedAt: availability.observedAt, fingerprint: requestFingerprint(availability.result) };
      return { ...selected, status: availability.result.available ? 'ready' as const : 'unavailable' as const,
        scope: context.scope, audience: context.audience,
        reason: availability.result.available ? undefined : 'current_availability_insufficient' as const,
        availability: { ...availability, source: evidence },
        confirmation: 'host_must_verify_explicit_human_selection' as const,
        quotePersistence: 'not_attempted' as const,
        review: { configVersion: selected.configVersion, selectionRevision: selected.selectionRevision,
          configurationFingerprint: selected.configurationFingerprint, availabilityObservedAt: availability.observedAt,
          priceDifference: 'unknown_no_previous_trusted_quote' as const,
          quoteValidity: 'not_quoted' as const, atomicity: 'sequential_reads_not_stock_lock' as const } };
    });
  }

  async prepareInput(value: unknown, modelAvailability: 'not_requested' | 'unavailable' = 'not_requested') {
    if (!['not_requested', 'unavailable'].includes(modelAvailability)) throw new ModelGatewayError('INVALID_REQUEST');
    const facts = await this.prepare(value);
    return sealBusinessScenario('quote_clarification', { scope: facts.scope, audience: facts.audience,
      observedAt: facts.observedAt, facts,
      model: { status: modelAvailability, answer: 'not_generated' as const },
      gaps: ['human_selection_evidence_owned_by_mainline', 'no_stock_reservation', 'no_order_approval'],
      execution: 'not_attempted' as const });
  }

  /** There is no original-operation key on Core.createQuote/getQuote. Never
   * use a latest-quote lookup or retry a create to manufacture reconciliation. */
  async reconciliationAvailability() {
    return this.authority.withRead('quote_context', {}, async () => ({ status: 'unavailable' as const,
      nextAction: 'reconcile' as const, retryable: false as const,
      missingDependency: 'Core quote lookup by original operation key + request fingerprint + owner/scope' as const }));
  }
}
