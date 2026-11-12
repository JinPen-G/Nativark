import type { AiExecutionContext } from '@rental-os/shared';
import { assertAiReadContextBinding } from './read-context-binding';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import type { AiAvailabilityReadFactsService } from '../availability-read-facts.service';
import type { AiQuoteCandidatePreparationService, AiQuotePreparationContextSource } from './quote-candidate-preparation.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { sealBusinessScenario } from './business-scenario-input';
import { z } from 'zod';
import { AI_QUOTE_CANDIDATE_LIMITS, aiQuoteCandidateInputSchema } from './quote-candidate-preparation.service';
import type { AiCatalogReadFactsService } from '../catalog-read-facts.service';

/** Only mismatched completed observations, not a generic source/config fault.
 * The original-request boundary retains its own revision-conflict response. */
export class AiQuotePreparedSourcesChanged extends ModelGatewayError {
  constructor() { super('CONFIG_INVALID'); }
}

/** Read-only preparation. It does not attest a human selection, save a quote,
 * reserve stock, or approve an order. Every source still uses its original Guard. */
export class AiQuoteBusinessPreparationService {
  constructor(private readonly candidates: Pick<AiQuoteCandidatePreparationService, 'prepare'>,
    private readonly availability: Pick<AiAvailabilityReadFactsService, 'read'>,
    private readonly authority: AiBusinessReadAuthority,
    private readonly sources: { contexts: AiQuotePreparationContextSource; catalog: Pick<AiCatalogReadFactsService, 'read'> }) {}

  async describeInput(expectedContext?: AiExecutionContext) {
    const expected = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('quote_context', {}, async context => {
      assertAiReadContextBinding(context, expected);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const current = structuredClone(await this.sources.contexts.current(context.scope, context));
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
        enterprisePayer: 'quote_candidate_only_Core_checks_current_relationship_and_credit_no_order_authority' as const,
        deliveryAddress: 'current_customer_choice_and_Core_snapshot_required' as const,
        rounding: 'Core_quote_snapshot_only_not_recomputed' as const };
      if (requestFingerprint(current) !== requestFingerprint(await this.sources.contexts.current(context.scope, context))) throw new ModelGatewayError('CONFIG_INVALID');
      return result;
    });
  }

  /** At most five candidate/availability reads, never replacement or pricing.
   * A multi-line request needs an explicit index in the current candidate, not
   * a persisted-answer row binding or human approval. Other lines stay intact. */
  async alternatives(value: unknown) {
    const parsed = z.object({ candidate: z.unknown(), limit: z.number().int().min(1).max(5).default(5),
      lineIndex: z.number().int().min(0).max(AI_QUOTE_CANDIDATE_LIMITS.lines - 1).optional() }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const input = structuredClone(parsed.data);
    return this.authority.withRead('quote_context', {}, async context => {
      const prepared = await this.candidates.prepare(input.candidate, context);
      if (prepared.status !== 'needs_confirmation') return prepared;
      if (prepared.request.lines.length !== 1 && input.lineIndex === undefined) return {
        status: 'unavailable' as const, reason: 'explicit_line_selection_required' as const };
      const lineIndex = input.lineIndex ?? 0, selectedLine = prepared.request.lines[lineIndex];
      if (!selectedLine) throw new ModelGatewayError('INVALID_REQUEST');
      const pageQuery = { limit: 100 }, originalQuery = { limit: 1, itemGroupId: selectedLine.itemGroupId };
      const catalog = structuredClone(await this.sources.catalog.read(pageQuery, context));
      const originalPage = structuredClone(await this.sources.catalog.read(originalQuery, context));
      const original = originalPage.items.find(row => row.id === selectedLine.itemGroupId);
      if (!original) throw new ModelGatewayError('CONFIG_INVALID');
      const existingIds = new Set(prepared.request.lines.map(line => line.itemGroupId));
      // A substitute already used by another line would silently merge or
      // duplicate that line. Re-selection, not this read, owns such changes.
      const candidates = catalog.items.filter(row => row.status === 'enabled' && !existingIds.has(row.id));
      const rows = [];
      for (const candidate of candidates.slice(0, input.limit)) {
        const availability = await this.availability.read({ locationId: prepared.request.fulfillmentLocationId,
          startAt: prepared.request.startAt, endAt: prepared.request.endAt,
          lines: prepared.request.lines.map((line, index) => ({ itemGroupId: index === lineIndex ? candidate.id : line.itemGroupId!,
            quantity: line.quantity })) }, context);
        rows.push({ candidate: { id: candidate.id, name: candidate.name, unit: candidate.unit,
          inventoryMode: availability.result.lines[lineIndex].inventoryMode },
          differences: { unitChanged: candidate.unit !== original.unit, originalInventoryMode: 'not_projected' as const },
          availability, price: 'not_quoted' as const, compatibility: 'not_verified' as const,
          source: { scope: catalog.scope, resourceType: 'item_group' as const, resourceId: candidate.id, observedAt: catalog.observedAt,
            configurationVersion: catalog.configurationVersion } });
      }
      // Reopen the same bounded page and exact target after stock waits. The
      // original request's own reread cannot attest unrelated substitute rows.
      const pageBasis = (page: typeof catalog) => ({ scope: page.scope, audience: page.audience, items: page.items,
        configurationVersion: page.configurationVersion, truncated: page.truncated, nextCursor: page.nextCursor });
      if (requestFingerprint(pageBasis(catalog)) !== requestFingerprint(pageBasis(await this.sources.catalog.read(pageQuery, context)))
        || requestFingerprint(pageBasis(originalPage)) !== requestFingerprint(pageBasis(await this.sources.catalog.read(originalQuery, context)))) {
        throw new ModelGatewayError('CONFIG_INVALID');
      }
      // Observe the original candidate/period after the closing catalog waits.
      // Only unchanged source/selection plus elapsed time may enter the original
      // clarification flow. Never hide catalog faults or return old stock rows.
      const latest = await this.candidates.prepare(input.candidate, context);
      if (latest.status === 'missing_input' && latest.selectionRevision === prepared.selectionRevision
        && latest.clarifications?.some(row =>
          (row.field === 'start' || row.field === 'end') && row.reason === 'rental_time_elapsed')) {
        return { ...latest, scope: context.scope, audience: context.audience, observedAt: context.authorizedAt };
      }
      if (latest.status !== 'needs_confirmation' || latest.selectionRevision !== prepared.selectionRevision) throw new ModelGatewayError('CONFIG_INVALID');
      return { status: 'candidates_only' as const, scope: catalog.scope, originalItemGroupId: original.id,
        ...(input.lineIndex !== undefined || prepared.request.lines.length > 1 ? { targetLineIndex: lineIndex,
          originalLineCount: prepared.request.lines.length } : {}),
        selectionRevision: prepared.selectionRevision, rows, notQueried: candidates.length - rows.length,
        candidateCoverage: catalog.truncated ? 'partial_persisted_page' as const : 'complete_persisted_page' as const,
        nextCursor: catalog.nextCursor, configurationVersion: catalog.configurationVersion,
        automaticReplacement: false as const, selection: 'explicit_reprepare_required' as const, prices: 'not_combined' as const };
    });
  }

  async prepare(value: unknown, expectedContext?: AiExecutionContext) {
    // Preserve the original parent's binding before the Guard awaits. Mutating
    // its caller object cannot retarget this read to another authorized actor;
    // the snapshot still grants nothing and every source rechecks live access.
    const input = structuredClone(value), expected = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('quote_context', {}, async context => {
      assertAiReadContextBinding(context, expected);
      const selected = await this.candidates.prepare(input, context);
      if (selected.status !== 'needs_confirmation') return { ...selected, scope: context.scope,
        audience: context.audience, observedAt: context.authorizedAt };
      const availability = await this.availability.read({ locationId: selected.request.fulfillmentLocationId,
        startAt: selected.request.startAt, endAt: selected.request.endAt,
        lines: selected.request.lines.map(line => ({ itemGroupId: line.itemGroupId!, quantity: line.quantity })) }, context);
      const current = await this.candidates.prepare(input, context);
      // The period can elapse during the stock wait even when all projections
      // are unchanged. Keep that explicit clarification in the original input
      // flow, without returning the earlier stock observation as ready material.
      // This is not a catch/downgrade for configuration or authorization faults.
      if (current.status === 'missing_input' && current.selectionRevision === selected.selectionRevision
        && current.clarifications?.some(row =>
          (row.field === 'start' || row.field === 'end') && row.reason === 'rental_time_elapsed')) {
        return { ...current, scope: context.scope, audience: context.audience, observedAt: context.authorizedAt };
      }
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
  async prepareUnified(value: unknown, expectedContext?: AiExecutionContext) {
    return this.unified(await this.prepare(value, expectedContext));
  }

  private unified<T extends { status: string }>(result: T) {
    const next = result.status === 'ready' ? 'preview_quote' as const
      : result.status === 'missing_input' || result.status === 'ambiguous' ? 'clarify_input' as const
      : result.status === 'qualification_required' ? 'use_qualification_flow' as const
      : 'manual_review' as const;
    return { ...result, next, authority: 'current_guarded_business_context' as const,
      sideEffects: { quoteSaved: false as const, inventoryReserved: false as const,
        orderCreated: false as const, approvalGranted: false as const } };
  }

  /** Review the original candidate without refreshing its asserted revision.
   * The original request and persisted-answer path share the same protected
   * observation pair; only the latter may prepare a revision-only re-review. */
  async reviewParameters(value: unknown, expectedContext?: AiExecutionContext) {
    const snapshot = structuredClone(value), expected = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('quote_context', {}, async context => {
      assertAiReadContextBinding(context, expected);
      return this.reviewPair(snapshot, context);
    });
  }

  private async reviewPair(value: unknown, context: AiExecutionContext) {
    const preparation = await this.prepareUnified(value, context);
    const sources = await this.inputSources(value, context);
    if (preparation.status === 'ready' && sources.status === 'missing_input') {
      const missing = sources.missingFields;
      const elapsedOnly = preparation.selectionRevision === sources.selectionRevision
        && /^[a-f0-9]{64}$/u.test(preparation.selectionRevision)
        && !sources.ambiguousFields?.length && Boolean(missing?.length)
        && missing!.every(field => ['start', 'end'].includes(field))
        && Boolean(sources.clarifications?.length)
        && sources.clarifications!.every(row => ['start', 'end'].includes(row.field) && row.reason === 'rental_time_elapsed')
        && missing!.every(field => sources.clarifications!.some(row => row.field === field));
      if (elapsedOnly) {
        // Provenance waits can exhaust a still-unchanged rental period. Return
        // the current blocked source through the original clarification flow,
        // never the earlier request/stock observation or an automatically moved
        // time. Different revisions, missing fields and source faults stay fatal.
        return { preparation: this.unified({ ...sources, scope: context.scope, audience: context.audience,
          observedAt: context.authorizedAt }), sources, humanConfirmation: 'required_before_preview' as const };
      }
    }
    const first = preparation as unknown as Record<string, unknown>, second = sources as unknown as Record<string, unknown>;
    if (first.selectionRevision !== second.selectionRevision
      || (first.request !== undefined && (second.status !== 'prepared_input_sources'
        || requestFingerprint(first.request) !== requestFingerprint(second.request)))) throw new AiQuotePreparedSourcesChanged();
    if (first.request === undefined) {
      const basis = (row: Record<string, unknown>) => ({ status: row.status, selectionRevision: row.selectionRevision,
        missingFields: row.missingFields, ambiguousFields: row.ambiguousFields });
      if (requestFingerprint(basis(first)) !== requestFingerprint(basis(second))) throw new AiQuotePreparedSourcesChanged();
    }
    return { preparation, sources, humanConfirmation: 'required_before_preview' as const };
  }

  /** Internal persisted-answer consumer. Answering a question may change the
   * candidate fingerprint, so its old choice revision cannot confirm the final
   * request. Only a revision-only block may be presented for a NEW explicit
   * review; missing business fields/ambiguity remain blocked. Nothing is saved
   * and the original answer/candidate is never rewritten with this revision. */
  async reviewAnsweredParameters(value: unknown, expectedContext?: AiExecutionContext) {
    const snapshot = aiQuoteCandidateInputSchema.parse(structuredClone(value));
    const parent = expectedContext && structuredClone(expectedContext);
    return this.authority.withRead('quote_context', {}, async context => {
      // A saved answer is not an authority snapshot. Bind this whole review to
      // its current original-request owner after the original Guard, before
      // any candidate/source read; final owner rereads cannot attest an entire
      // second-principal observation that completed between them.
      assertAiReadContextBinding(context, parent);
      // The original answer's review, candidate revision and field sources must
      // share one principal, not merely equal requests from the same workspace.
      const expected = structuredClone(context);
      const observed = await this.candidates.prepare(snapshot, expected);
      const revisionOnly = observed.status === 'missing_input' && observed.missingFields?.length === 1
        && observed.missingFields[0] === 'selectionRevision' && !observed.ambiguousFields?.length
        && /^[a-f0-9]{64}$/u.test(observed.selectionRevision ?? '');
      const reviewCandidate = revisionOnly ? { ...snapshot, selectionRevision: observed.selectionRevision } : snapshot;
      return this.reviewPair(reviewCandidate, expected);
    });
  }

  /** Field provenance for the formal request. No inferred/model value is
   * labelled as user confirmation; the formal Core resolver remains the only
   * source allowed to normalize the final request. */
  async inputSources(value: unknown, expectedContext?: AiExecutionContext) {
    const snapshot = structuredClone(value);
    const result = await this.candidates.prepare(snapshot, expectedContext);
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
      lineUnits: z.array(z.object({ itemGroupId: z.string().optional(), quantity: z.number(), pricingUnit: z.string().optional(),
        usageQuantity: z.number().finite().nonnegative().max(AI_QUOTE_CANDIDATE_LIMITS.usageQuantity).optional() }).passthrough()),
      payableAmount: z.number().finite().nonnegative(), receivableAmount: z.number().finite().nonnegative(),
      currency: z.string().regex(/^[A-Z]{3}$/u).optional(), expiresAt: z.string() }).passthrough();
    const before = schema.safeParse(previous), after = schema.safeParse(current);
    if (!before.success || !after.success) throw new ModelGatewayError('INVALID_REQUEST');
    const a = before.data, b = after.data;
    // The public comparison has boolean amount/currency changes, not an unknown
    // monetary basis. Missing saved currency cannot mean unchanged or be filled
    // from current configuration; its original consumer returns unavailable.
    if (a.currency === undefined || b.currency === undefined) throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
    // Planned usage is part of the saved line input even when a Core cap keeps
    // its amount unchanged. Missing evidence stays distinct from recorded zero;
    // this comparison neither recomputes money nor reuses an old confirmation.
    const lineShape = (rows: typeof a.lineUnits) => rows.map(row => ({ itemGroupId: row.itemGroupId,
      quantity: row.quantity, pricingUnit: row.pricingUnit, usageQuantity: row.usageQuantity }));
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

  async prepareInput(value: unknown, modelAvailability: 'not_requested' | 'unavailable' = 'not_requested', expectedContext?: AiExecutionContext) {
    if (!['not_requested', 'unavailable'].includes(modelAvailability)) throw new ModelGatewayError('INVALID_REQUEST');
    const facts = await this.prepare(value, expectedContext);
    return sealBusinessScenario('quote_clarification', { scope: facts.scope, audience: facts.audience,
      observedAt: facts.observedAt, facts,
      model: { status: modelAvailability, answer: 'not_generated' as const },
      gaps: ['human_selection_evidence_owned_by_mainline', 'no_stock_reservation', 'no_order_approval'],
      execution: 'not_attempted' as const });
  }
}
