import { z } from 'zod';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderExplanationFactsService } from './order-explanation-facts.service';
import type { AiOrderNextStepsService } from './order-next-steps.service';
import { sealBusinessScenario } from './business-scenario-input';
import { assertAiReadContextBinding } from './read-context-binding';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { buildOrderExplanation, projectOrderHistoryFacts, projectOrderInspectionEvidence, projectOrderExplanationMaterialV2,
  parseOrderSourceReopenV2, validateOrderSourceReadV2, assertOrderPublicationV2Available, orderExplanationDisplayBudget,
  orderExplanationSourcesFit } from './order-explanation-renderer';
import { AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, type AiOrderExplanationMaterialV2, type AiOrderSourceReadV2, type AiExecutionContext } from '@rental-os/shared';

const input = z.object({ modelAvailability: z.enum(['not_requested', 'unavailable']).default('not_requested'),
  question: z.enum(['status', 'fees', 'payments', 'next_steps']).default('status'),
  previousOrderVersion: z.string().max(191).optional() }).strict();

/** Prepare/reopen minimal original order facts; never authorize a business write.
 * Snapshot the expected server parent before the first Guard await, then compare
 * only after current authorization. A caller-mutated assertion grants nothing. */
export class AiOrderExplanationPreparationService {
  constructor(private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly facts: Pick<AiOrderExplanationFactsService, 'read'>,
    private readonly next: Pick<AiOrderNextStepsService, 'read'>) {}

  async prepare(value: unknown = {}, expectedContext?: AiExecutionContext) {
    const parsed = input.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const expected = expectedContext && structuredClone(expectedContext);
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expected);
      const question = parsed.data.question;
      const facts = await this.facts.read(context, { history: question === 'fees', payments: question === 'payments', inspections: question === 'fees',
        lifecycle: question === 'status' || question === 'fees' });
      const next = question === 'next_steps' ? await this.next.read(context) : undefined;
      const latest = await this.facts.read(context, { history: false, payments: false });
      if (requestFingerprint(latest.order.value) !== requestFingerprint(facts.order.value)) throw new ModelGatewayError('CONFIG_INVALID');
      const status = { coverage: facts.order.coverage, value: { id: orderId, status: facts.order.value.status,
        updatedAt: facts.orderVersion, ...(question === 'status' || question === 'fees' ? { lifecycle: facts.lifecycle } : {}) }, source: facts.order.source };
      // A fee explanation needs the actual current rental period alongside
      // its separately labelled saved quote/rule basis. Reuse the existing
      // authorized projection; do not infer a duration or recalculate fees.
      const projection = question === 'fees' ? { order: status, amounts: facts.amounts,
        fulfillment: facts.fulfillment, history: facts.history, inspections: facts.inspections }
        : question === 'payments' ? { order: status, amounts: facts.amounts, payments: facts.payments,
          actualReceivedTotal: facts.actualReceivedTotal, fundingLedger: facts.fundingLedger }
        : { order: status };
      const gaps = question === 'fees' ? [{ field: 'history', status: facts.history.coverage }, { field: 'inspections', status: facts.inspections.coverage }]
        : question === 'payments' ? [{ field: 'payments', status: facts.payments.coverage },
          { field: 'actualReceivedTotal', status: facts.actualReceivedTotal.coverage }, { field: 'fundingLedger', status: facts.fundingLedger.coverage }]
        : question === 'next_steps' ? [{ field: 'allowedActions', status: 'unavailable' }] : [];
      const material = {
        status: 'facts_only' as const, scope: facts.scope, audience: context.audience,
        orderId, orderVersion: facts.orderVersion, observedAt: facts.observedAt,
        question, facts: projection, gaps, model: { status: parsed.data.modelAvailability, answer: 'not_generated' as const },
        handoff: { status: 'manual_review_only' as const, resource: next?.manual ?? { kind: 'order_resource' as const, scope: facts.scope, orderId },
          // Existing registered page; host resolves this key, not a model URL.
          operatorRouteKey: context.audience === 'operator' ? 'APP_ROUTES.orderDetail' as const : undefined,
          routeSource: context.audience === 'operator' ? 'apps/admin/src/app/AppRouter.tsx' : undefined,
          candidates: next?.candidates ?? [], allowedActions: next?.allowedActions ?? 'not_queried',
          blockers: ['current_allowed_actions_not_loaded', 'destination_must_reauthorize'],
          informationNeeded: gaps.map(row => row.field),
          execution: 'not_attempted' as const }
      };
      // A genuinely oversized source combination retains the original optional
      // funding fallback. Duplicating facts into display must not trigger it:
      // valid complete sources stay intact and only optional display is reduced.
      if (question === 'payments' && 'fundingLedger' in projection && projection.fundingLedger && 'value' in projection.fundingLedger
        && !orderExplanationSourcesFit(material)) {
        const bounded = { ...material, facts: { ...projection, fundingLedger: { coverage: 'unavailable' as const } },
          gaps: gaps.map(gap => gap.field === 'fundingLedger' ? { ...gap, status: 'unavailable' as const } : gap) };
        return sealBusinessScenario('order_explanation', { ...bounded, explanation: buildOrderExplanation({ payload: bounded },
          orderExplanationDisplayBudget(bounded)) });
      }
      const displayed = { ...material, explanation: buildOrderExplanation({ payload: material },
        question === 'fees' || question === 'payments' ? orderExplanationDisplayBudget(material) : undefined) };
      return sealBusinessScenario('order_explanation', displayed);
    });
  }

  /** New publication only: execute the actual authorized source preparation,
   * then validate the named shared v2. Old prepare()/stored model input stay v1. */
  async preparePublicV2(value: unknown = {}): Promise<AiOrderExplanationMaterialV2> {
    assertOrderPublicationV2Available();
    return projectOrderExplanationMaterialV2(await this.prepare(value));
  }

  /** Closed field dispatch through original read authorities, not a model path.
   * A citation does not carry actor permission or permit financial execution.
   * Expected server context binds the original requester only after the Guard. */
  async reopenCitationV2(value: unknown, expectedContext?: AiExecutionContext): Promise<AiOrderSourceReadV2> {
    const reference = parseOrderSourceReopenV2(value), expected = expectedContext && structuredClone(expectedContext);
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expected);
      if (orderId !== reference.resourceId || requestFingerprint(context.scope) !== requestFingerprint(reference.scope))
        throw new ModelGatewayError('FORBIDDEN');
      const current = await this.facts.read(context, { history: reference.field === 'saved_basis',
        payments: reference.field === 'payment_records' || reference.field === 'funding_records',
        inspections: reference.field === 'inspection_records', lifecycle: reference.field === 'lifecycle_records' });
      const common = { materialVersion: AI_ORDER_EXPLANATION_MATERIAL_V2_VERSION, scope: current.scope, orderId, field: reference.field };
      if (current.orderVersion !== reference.version) return validateOrderSourceReadV2({ ...common,
        status: 'stale', reason: 'order_version_changed_reread_material' }, reference);
      const source = (field: string, observedAt = current.observedAt) => ({ scope: current.scope,
        resourceType: 'order', resourceId: orderId, version: current.orderVersion, field, observedAt });
      const sources = {
        order: { ...current.order, value: { id: orderId, status: current.order.value.status, updatedAt: current.orderVersion } },
        amounts: current.amounts, saved_basis: current.history, payment_records: current.payments,
        rental_period: current.fulfillment, inspection_records: current.inspections,
        funding_records: current.fundingLedger.coverage === 'partial'
          ? { ...current.fundingLedger, source: source('funding_records', current.fundingLedger.value.observedAt) } : current.fundingLedger,
        lifecycle_records: current.lifecycle.coverage === 'partial'
          ? { ...current.lifecycle, source: source('lifecycle_records') } : current.lifecycle
      };
      const selected = sources[reference.field];
      return validateOrderSourceReadV2('source' in selected ? { ...common, status: 'available', value: selected,
        observedAt: current.observedAt, freshness: 'current_observation_not_frozen_material',
        reauthorization: 'current_order_authority_rechecked', execution: 'not_attempted' } : { ...common,
        status: 'missing', reason: 'historical_or_optional_source_not_loaded' }, reference);
    });
  }

  /** Re-open one server-issued citation through the same order authority.
   * Original-request aggregation binds its current owner, not a client actor. */
  async reopenCitation(value: unknown, expectedContext?: AiExecutionContext) {
    const parsed = z.object({ question: z.enum(['status', 'fees', 'payments', 'next_steps']),
      resourceType: z.literal('order'), resourceId: z.string().min(1).max(191),
      scope: z.object({ kind: z.literal('workspace'), tenantId: z.string().min(1).max(191), workspaceId: z.string().min(1).max(191) }).strict(),
      version: z.string().min(1).max(191),
      field: z.enum(['order', 'amounts', 'saved_basis', 'payment_records', 'rental_period', 'inspection_records']) }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const reference = parsed.data, expected = expectedContext && structuredClone(expectedContext);
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expected);
      if (orderId !== reference.resourceId || requestFingerprint(context.scope) !== requestFingerprint(reference.scope)) {
        throw new ModelGatewayError('FORBIDDEN');
      }
      // The reference selects a closed fact source, never a URL/table/tool.
      // Loading history or finance is independent of the displayed question.
      const current = await this.facts.read(context, { history: reference.field === 'saved_basis', payments: reference.field === 'payment_records',
        inspections: reference.field === 'inspection_records', lifecycle: reference.field === 'order' });
      if (current.orderId !== orderId || requestFingerprint(current.scope) !== requestFingerprint(reference.scope)) throw new ModelGatewayError('FORBIDDEN');
      if (current.orderVersion !== reference.version) return { status: 'stale' as const,
        field: reference.field, reason: 'order_version_changed_reread_material' as const };
      const sources = { order: current.order, amounts: current.amounts, saved_basis: current.history,
        payment_records: current.payments, rental_period: current.fulfillment, inspection_records: current.inspections };
      const source = sources[reference.field];
      return 'source' in source ? { status: 'available' as const, scope: current.scope, orderId,
        field: reference.field, value: reference.field === 'saved_basis'
          ? { ...structuredClone(source), value: projectOrderHistoryFacts(current.history.coverage === 'partial' ? current.history.value : undefined) }
          : reference.field === 'inspection_records'
            ? { ...structuredClone(source), value: projectOrderInspectionEvidence(current.inspections.coverage === 'partial' ? current.inspections.value : undefined) }
            : structuredClone(source), observedAt: current.observedAt,
        freshness: 'current_observation_not_historical_payment_snapshot' as const,
        reauthorization: 'current_order_authority_rechecked' as const }
        : { status: 'missing' as const, scope: current.scope, orderId,
          field: reference.field, reason: 'historical_or_optional_source_not_loaded' as const };
    });
  }

  /** Re-read facts for a repeated question and compare only stable versions. */
  async refresh(value: unknown = {}) {
    const parsed = input.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    // Preserve the validated optional scalar before the guarded source waits;
    // a later caller-object change cannot replace or supply comparison evidence.
    const previousVersion = parsed.data.previousOrderVersion;
    const current = await this.prepare(parsed.data);
    return { current, comparison: previousVersion === undefined ? { status: 'not_comparable' as const }
      : { status: 'compared' as const, orderChanged: current.payload.orderVersion !== previousVersion,
        basis: 'server_order_updated_at_only' as const, eventTimeline: 'not_created' as const } };
  }

  /** Verifies exact structured citations only, not natural-language semantics.
   * The free text remains untrusted and can never authorize an operation. */
  async validateGenerated(value: unknown) {
    const parsed = z.object({ question: z.enum(['status', 'fees', 'payments', 'next_steps']), text: z.string().max(4000),
      claims: z.array(z.object({ field: z.string().max(191), sourceId: z.string().max(191),
        value: z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()]) }).strict()).max(20) }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const current = await this.prepare({ question: parsed.data.question });
    const explanation = current.payload.explanation;
    const allowed = new Map(explanation.claims.map(claim => [claim.field, claim]));
    const valid = parsed.data.claims.length > 0 && parsed.data.claims.every(claim => {
      const expected = allowed.get(claim.field);
      return expected?.sourceId === claim.sourceId && Object.is(expected.value, claim.value);
    });
    // Matching claims cannot validate arbitrary prose. Never echo model text
    // that can say "paid" while its accompanying claim still says "failed".
    return { valid, scope: current.payload.scope, factsFingerprint: current.payloadFingerprint,
      validation: 'exact_structured_fields_and_resource_ids_only' as const,
      text: { value: valid ? explanation.text : '', trust: 'unverified_text_not_execution_evidence' as const },
      modelProse: 'discarded_in_favor_of_deterministic_facts' as const,
      executionAllowed: false as const };
  }
}
