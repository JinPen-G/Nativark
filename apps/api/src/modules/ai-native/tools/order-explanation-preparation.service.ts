import { z } from 'zod';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderExplanationFactsService } from './order-explanation-facts.service';
import type { AiOrderNextStepsService } from './order-next-steps.service';
import { sealBusinessScenario } from './business-scenario-input';
import { ModelGatewayError } from '../model-gateway.ports';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

const input = z.object({ modelAvailability: z.enum(['not_requested', 'unavailable']).default('not_requested'),
  question: z.enum(['status', 'fees', 'payments', 'next_steps']).default('status'),
  previousOrderVersion: z.string().max(191).optional() }).strict();

export class AiOrderExplanationPreparationService {
  constructor(private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly facts: Pick<AiOrderExplanationFactsService, 'read'>,
    private readonly next: Pick<AiOrderNextStepsService, 'read'>) {}

  async prepare(value: unknown = {}) {
    const parsed = input.safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.authority.withOrderRead(async (context, orderId) => {
      const question = parsed.data.question;
      const facts = await this.facts.read(context, { history: question === 'fees', payments: question === 'payments', inspections: question === 'fees' });
      const next = question === 'next_steps' ? await this.next.read(context) : undefined;
      const latest = await this.facts.read(context, { history: false, payments: false });
      if (requestFingerprint(latest.order.value) !== requestFingerprint(facts.order.value)) throw new ModelGatewayError('CONFIG_INVALID');
      const status = { coverage: facts.order.coverage, value: { id: orderId, status: facts.order.value.status,
        updatedAt: facts.orderVersion }, source: facts.order.source };
      const projection = question === 'fees' ? { order: status, amounts: facts.amounts, history: facts.history, inspections: facts.inspections }
        : question === 'payments' ? { order: status, amounts: facts.amounts, payments: facts.payments,
          actualReceivedTotal: facts.actualReceivedTotal, fundingLedger: facts.fundingLedger }
        : { order: status };
      const gaps = question === 'fees' ? [{ field: 'history', status: facts.history.coverage }, { field: 'inspections', status: facts.inspections.coverage }]
        : question === 'payments' ? [{ field: 'payments', status: facts.payments.coverage },
          { field: 'actualReceivedTotal', status: facts.actualReceivedTotal.coverage }, { field: 'fundingLedger', status: facts.fundingLedger.coverage }]
        : question === 'next_steps' ? [{ field: 'allowedActions', status: 'unavailable' }] : [];
      return sealBusinessScenario('order_explanation', {
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
      });
    });
  }

  /** Re-open one server-issued citation through the same order authority. */
  async reopenCitation(value: unknown) {
    const parsed = z.object({ question: z.enum(['status', 'fees', 'payments', 'next_steps']),
      resourceType: z.literal('order'), resourceId: z.string().min(1).max(191),
      scope: z.object({ kind: z.literal('workspace'), tenantId: z.string().min(1).max(191), workspaceId: z.string().min(1).max(191) }).strict(),
      version: z.string().min(1).max(191),
      field: z.enum(['order', 'amounts', 'saved_basis', 'payment_records', 'rental_period', 'inspection_records']) }).strict().safeParse(value);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    const reference = parsed.data;
    return this.authority.withOrderRead(async (context, orderId) => {
      if (orderId !== reference.resourceId || requestFingerprint(context.scope) !== requestFingerprint(reference.scope)) {
        throw new ModelGatewayError('FORBIDDEN');
      }
      // The reference selects a closed fact source, never a URL/table/tool.
      // Loading history or finance is independent of the displayed question.
      const current = await this.facts.read(context, { history: reference.field === 'saved_basis', payments: reference.field === 'payment_records',
        inspections: reference.field === 'inspection_records' });
      if (current.orderId !== orderId || requestFingerprint(current.scope) !== requestFingerprint(reference.scope)) throw new ModelGatewayError('FORBIDDEN');
      if (current.orderVersion !== reference.version) return { status: 'stale' as const,
        field: reference.field, reason: 'order_version_changed_reread_material' as const };
      const sources = { order: current.order, amounts: current.amounts, saved_basis: current.history,
        payment_records: current.payments, rental_period: current.fulfillment, inspection_records: current.inspections };
      const source = sources[reference.field];
      return 'source' in source ? { status: 'available' as const, scope: current.scope, orderId,
        field: reference.field, value: structuredClone(source), observedAt: current.observedAt,
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
    const current = await this.prepare(parsed.data);
    const previous = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown> : {};
    const previousVersion = typeof previous.previousOrderVersion === 'string' ? previous.previousOrderVersion : undefined;
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
    const facts = current.payload.facts;
    const allowed = new Map<string, { value: unknown; sourceId: string }>([
      ['order.status', { value: facts.order.value.status, sourceId: current.payload.orderId }],
      ['order.updatedAt', { value: facts.order.value.updatedAt, sourceId: current.payload.orderId }]
    ]);
    // Optional/finance-denied sources are explicit coverage objects without a
    // value. They must remain unavailable, not crash validation or become a
    // fabricated zero.
    if (facts.amounts?.coverage === 'partial' && 'value' in facts.amounts) {
      for (const [field, value] of Object.entries(facts.amounts.value)) allowed.set(`amounts.${field}`, { value, sourceId: current.payload.orderId });
      allowed.set('amounts.currency', { value: facts.amounts.currency, sourceId: current.payload.orderId });
    }
    if (facts.payments?.coverage === 'partial' && 'value' in facts.payments) {
      for (const row of facts.payments.value.intents) {
        allowed.set(`payments.${row.intentId}.status`, { value: row.status, sourceId: row.intentId });
        allowed.set(`payments.${row.intentId}.amount`, { value: row.amount, sourceId: row.intentId });
      }
      for (const row of facts.payments.value.refunds) {
        allowed.set(`refunds.${row.refundId}.status`, { value: row.status, sourceId: row.refundId });
        allowed.set(`refunds.${row.refundId}.amount`, { value: row.amount, sourceId: row.refundId });
      }
    }
    const valid = parsed.data.claims.every(claim => {
      const expected = allowed.get(claim.field);
      return expected?.sourceId === claim.sourceId && Object.is(expected.value, claim.value);
    });
    return { valid, scope: current.payload.scope, factsFingerprint: current.payloadFingerprint,
      validation: 'exact_structured_fields_and_resource_ids_only' as const,
      text: { value: parsed.data.text, trust: 'unverified_text_not_execution_evidence' as const },
      executionAllowed: false as const };
  }
}
