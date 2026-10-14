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
        required: ['customer_explicit_selection', 'items_quantity', 'explicit_supported_pricing_unit', 'absolute_period_or_supported_relative_time', 'fulfillment_location'],
        capabilities: [...current.profile.capabilities],
        enterpriseIdentity: 'explicit_selection_requires_current_authorized_relationship_and_Core_qualification' as const,
        enterprisePayer: 'unavailable_current_independent_payer_authority_required' as const,
        deliveryAddress: 'current_customer_choice_and_Core_snapshot_required' as const,
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
      const originalPage = await this.sources.catalog.read({ limit: 1, itemGroupId: prepared.request.lines[0].itemGroupId }, context);
      const original = originalPage.items.find(row => row.id === prepared.request.lines[0].itemGroupId);
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
          source: { scope: catalog.scope, resourceType: 'item_group' as const, resourceId: candidate.id, observedAt: catalog.observedAt,
            configurationVersion: catalog.configurationVersion } });
      }
      const latest = await this.candidates.prepare(input.candidate, context);
      if (latest.status !== 'needs_confirmation' || latest.selectionRevision !== prepared.selectionRevision) throw new ModelGatewayError('CONFIG_INVALID');
      return { status: 'candidates_only' as const, scope: catalog.scope, originalItemGroupId: original.id,
        selectionRevision: prepared.selectionRevision, rows, notQueried: candidates.length - rows.length,
        candidateCoverage: catalog.truncated ? 'partial_persisted_page' as const : 'complete_persisted_page' as const,
        nextCursor: catalog.nextCursor, configurationVersion: catalog.configurationVersion,
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

  /** Single host-facing preparation result. It is deliberately not a task,
   * quote or order state machine: the host still owns human confirmation. */
  async prepareUnified(value: unknown) {
    const result = await this.prepare(value);
    const next = result.status === 'ready' ? 'preview_quote' as const
      : result.status === 'missing_input' || result.status === 'ambiguous' ? 'clarify_input' as const
      : result.status === 'qualification_required' ? 'use_qualification_flow' as const
      : 'manual_review' as const;
    return { ...result, next, authority: 'current_guarded_business_context' as const,
      sideEffects: { quoteSaved: false as const, inventoryReserved: false as const,
        orderCreated: false as const, approvalGranted: false as const } };
  }

  /** Field provenance for the formal request. No inferred/model value is
   * labelled as user confirmation; the formal Core resolver remains the only
   * source allowed to normalize the final request. */
  async inputSources(value: unknown) {
    const snapshot = structuredClone(value);
    const result = await this.candidates.prepare(snapshot);
    if (result.status !== 'needs_confirmation') return result;
    const supplied = snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
      ? snapshot as Record<string, unknown> : {};
    // This endpoint receives extracted candidate data, not a persisted human
    // action receipt. Presence of an ID or a matching name is not provenance.
    const source = (field: string, value: unknown, suppliedValue: boolean) => ({
      field, value: structuredClone(value), kind: suppliedValue ? 'supplied_candidate' as const : 'server_resolved_candidate' as const,
      confirmed: false as const, confirmationEvidence: 'not_loaded' as const
    });
    const fields = [
      source('customerId', result.request.customerId, Boolean(supplied.customerId)),
      ...(result.request.bookingIdentity ? [source('bookingIdentity', result.request.bookingIdentity,
        supplied.bookingIdentity !== undefined)] : []),
      source('items', result.request.lines, Boolean(supplied.items)),
      source('startAt', result.request.startAt, Boolean(supplied.start)),
      source('endAt', result.request.endAt, Boolean(supplied.end)),
      source('fulfillmentMode', result.request.fulfillmentMode, Boolean(supplied.fulfillmentMode)),
      source('fulfillmentLocationId', result.request.fulfillmentLocationId, Boolean(supplied.locationId)),
      source('returnLocationId', result.request.returnLocationId, Boolean(supplied.returnLocationId)),
      ...(result.request.deliveryAddressId ? [source('deliveryAddressId', result.request.deliveryAddressId, Boolean(supplied.deliveryAddressId))] : [])
    ];
    return sealBusinessScenario('quote_clarification', { status: 'prepared_input_sources' as const,
      request: structuredClone(result.request), selectionRevision: result.selectionRevision,
      inputFingerprint: requestFingerprint(result.request), fields,
      coreNormalization: 'not_yet_called' as const, humanConfirmation: 'required_before_preview' as const }).payload;
  }

  /** Compare two already produced Core quote snapshots without recomputing
   * money. Old quote/approval references remain distinct and cannot be reused. */
  compareQuotes(previous: unknown, current: unknown) {
    const schema = z.object({ id: z.string().min(1), period: z.object({ startAt: z.string(), endAt: z.string() }),
      lineUnits: z.array(z.object({ itemGroupId: z.string().optional(), quantity: z.number(), pricingUnit: z.string().optional() }).passthrough()),
      payableAmount: z.number().finite().nonnegative(), receivableAmount: z.number().finite().nonnegative(),
      currency: z.string().optional(), expiresAt: z.string() }).passthrough();
    const before = schema.safeParse(previous), after = schema.safeParse(current);
    if (!before.success || !after.success) throw new ModelGatewayError('INVALID_REQUEST');
    const a = before.data, b = after.data;
    const lineShape = (rows: typeof a.lineUnits) => rows.map(row => ({ itemGroupId: row.itemGroupId,
      quantity: row.quantity, pricingUnit: row.pricingUnit }));
    const same = (left: unknown, right: unknown) => requestFingerprint(left) === requestFingerprint(right);
    return { status: 'compared' as const, previousQuoteId: a.id, currentQuoteId: b.id,
      inputChanges: { items: !same(lineShape(a.lineUnits), lineShape(b.lineUnits)),
        quantity: !same(lineShape(a.lineUnits).map(row => row.quantity), lineShape(b.lineUnits).map(row => row.quantity)),
        period: a.period.startAt !== b.period.startAt || a.period.endAt !== b.period.endAt,
        location: 'not_projected_in_quote_display' as const },
      coreAmounts: { payableChanged: a.payableAmount !== b.payableAmount, receivableChanged: a.receivableAmount !== b.receivableAmount,
        currencyChanged: a.currency !== b.currency, arithmetic: 'not_recomputed_by_ai_layer' as const },
      validity: { previous: a.expiresAt, current: b.expiresAt }, approvalReuse: 'forbidden_new_quote_requires_new_confirmation' as const };
  }

  /** No formal order-creation handoff is owned by this lane. */
  async commitHandoff() {
    return { status: 'unavailable' as const, reason: 'formal_order_commit_input_port_not_exposed' as const,
      required: ['original_request_reference', 'quote_id', 'selection_revision', 'source_versions'],
      sideEffects: 'not_attempted' as const, orderApproval: 'not_granted' as const };
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
