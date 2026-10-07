import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import type { AiAvailabilityReadFactsService } from '../availability-read-facts.service';
import type { AiQuoteCandidatePreparationService } from './quote-candidate-preparation.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { sealBusinessScenario } from './business-scenario-input';
import { z } from 'zod';
import { AI_QUOTE_CANDIDATE_LIMITS } from './quote-candidate-preparation.service';
import type { AiQuoteCoreContextSource } from '../quote-preview.service';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';

/** Read-only preparation. It does not attest a human selection, save a quote,
 * reserve stock, or approve an order. Every source still uses its original Guard. */
export class AiQuoteBusinessPreparationService {
  constructor(private readonly candidates: Pick<AiQuoteCandidatePreparationService, 'prepare'>,
    private readonly availability: Pick<AiAvailabilityReadFactsService, 'read'>,
    private readonly authority: AiBusinessReadAuthority,
    private readonly sources: { contexts: AiQuoteCoreContextSource; catalog: Pick<AiCatalogReadFactsService, 'read'> }) {}

  async describeInput() {
    return this.authority.withRead('quote_context', {}, async context => {
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const current = structuredClone(await this.sources.contexts.current(context.scope));
      const category = current.category.businessModel;
      const result = { scope: context.scope, audience: context.audience, observedAt: context.authorizedAt,
        categoryCode: current.category.code, configVersion: current.settings.configVersion,
        pricingUnits: category.pricingUnits.filter(unit => current.settings.pricing.enabledUnits.includes(unit)),
        fulfillmentModes: category.fulfillmentModes.filter(mode => current.settings.fulfillment.enabledModes.includes(mode)),
        deliveryDestination: category.deliveryDestination, timeZone: current.settings.calendar.timeZone,
        limits: AI_QUOTE_CANDIDATE_LIMITS,
        required: ['customer_explicit_selection', 'items_quantity', 'absolute_period_or_supported_relative_time', 'fulfillment_location'],
        capabilities: [...current.profile.capabilities],
        enterpriseIdentity: 'qualification_required_no_authorized_adapter' as const,
        rounding: 'Core_quote_snapshot_only_not_recomputed' as const };
      if (requestFingerprint(current) !== requestFingerprint(await this.sources.contexts.current(context.scope))) throw new ModelGatewayError('CONFIG_INVALID');
      return result;
    });
  }

  /** At most five candidates/availability calls. No automatic replacement or
   * combined price; multi-line substitution needs a separate explicit choice. */
  async alternatives(value: unknown) {
    const parsed = z.object({ candidate: z.unknown(), limit: z.number().int().min(1).max(5).default(5) }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = structuredClone(parsed.data);
    return this.authority.withRead('quote_context', {}, async context => {
      const prepared = await this.candidates.prepare(input.candidate, context);
      if (prepared.status !== 'needs_confirmation') return prepared;
      if (prepared.request.lines.length !== 1) return { status: 'unavailable' as const, reason: 'explicit_single_line_selection_required' as const };
      const catalog = await this.sources.catalog.read({ limit: 100 }, context);
      const original = catalog.items.find(row => row.id === prepared.request.lines[0].itemGroupId);
      if (!original) throw new ModelGatewayError('CONFIG_INVALID');
      const candidates = catalog.items.filter(row => row.status === 'enabled' && row.id !== original.id);
      const rows = [];
      for (const candidate of candidates.slice(0, input.limit)) {
        const availability = await this.availability.read({ locationId: prepared.request.fulfillmentLocationId,
          startAt: prepared.request.startAt, endAt: prepared.request.endAt,
          lines: [{ itemGroupId: candidate.id, quantity: prepared.request.lines[0].quantity }] }, context);
        rows.push({ candidate: { id: candidate.id, name: candidate.name, unit: candidate.unit,
          inventoryMode: availability.result.lines[0].inventoryMode },
          differences: { unitChanged: candidate.unit !== original.unit, originalInventoryMode: 'not_projected' as const },
          availability, price: 'not_quoted' as const, compatibility: 'not_verified' as const,
          source: { scope: catalog.scope, resourceType: 'item_group' as const, resourceId: candidate.id, observedAt: catalog.observedAt } });
      }
      const latest = await this.candidates.prepare(input.candidate, context);
      if (latest.status !== 'needs_confirmation' || latest.selectionRevision !== prepared.selectionRevision) throw new ModelGatewayError('CONFIG_INVALID');
      return { status: 'candidates_only' as const, scope: catalog.scope, originalItemGroupId: original.id,
        selectionRevision: prepared.selectionRevision, rows, notQueried: candidates.length - rows.length,
        automaticReplacement: false as const, selection: 'explicit_reprepare_required' as const, prices: 'not_combined' as const };
    });
  }

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
