import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderReadFactsService } from '../order-read-facts.service';
import type { AiOrderPaymentFactsService } from './order-payment-facts.service';
import type { AiOrderFundingFactsService } from './order-funding-facts.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import type { AiExecutionContext } from '@rental-os/shared';
import { assertAiReadContextBinding } from './read-context-binding';
import type { AiOrderInspectionFactsService } from './order-inspection-facts.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import { z } from 'zod';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const time = z.string().max(40).datetime({ offset: true });
const lifecycleSchema = z.object({ orderId: id, tenantId: id, workspaceId: id, sourceOrderUpdatedAt: time,
  // Core marks delivered consumables consumed; they do not await a return.
  allocations: z.array(z.object({ id, status: z.enum(['pre_assigned', 'locked', 'allocated', 'picked_up', 'returned', 'released', 'consumed']),
    quantity: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) }).strict()).max(200),
  changes: z.array(z.object({ id, type: id, status: id, requestedAt: time, appliedAt: time.optional() }).strict()).max(50),
  extensions: z.array(z.object({ id, status: z.enum(['pending_payment', 'effective', 'cancelled', 'expired']),
    originalEndAt: time, newEndAt: time }).strict()).max(50),
  truncated: z.object({ changes: z.boolean(), extensions: z.boolean() }).strict(),
  semantics: z.literal('recorded_lifecycle_not_financial_or_action_eligibility') }).strict();

/** Structured evidence only, not an explanation generator or a payment ledger.
 * Bound once by the server; optional finance denial exposes no existence/count. */
export class AiOrderExplanationFactsService {
  constructor(private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead' | 'resolve'>,
    private readonly facts: Pick<AiOrderReadFactsService, 'read' | 'readHistoricalBasis'>,
    private readonly payments?: Pick<AiOrderPaymentFactsService, 'read'>,
    private readonly clock: () => Date = () => new Date(),
    private readonly inspections?: Pick<AiOrderInspectionFactsService, 'read'>,
    private readonly lifecycle?: Pick<RentalCoreService, 'readOrderExplanationState'>,
    private readonly funding?: Pick<AiOrderFundingFactsService, 'read'>) {}

  async read(expectedContext?: AiExecutionContext, selection: { history: boolean; payments: boolean; inspections?: boolean; lifecycle?: boolean } = { history: true, payments: true }) {
    const selected = structuredClone(selection), parent = expectedContext && structuredClone(expectedContext);
    if (typeof selected.history !== 'boolean' || typeof selected.payments !== 'boolean') throw new ModelGatewayError('INVALID_REQUEST');
    if ((selected.inspections !== undefined && typeof selected.inspections !== 'boolean')
      || (selected.lifecycle !== undefined && typeof selected.lifecycle !== 'boolean')
      || Object.keys(selected).some(key => !['history', 'payments', 'inspections', 'lifecycle'].includes(key))) throw new ModelGatewayError('INVALID_REQUEST');
    // Keep one original server parent across the first Guard wait. The clone
    // is only an assertion; optional sources still apply their own live rights.
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, parent);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(context.scope);
      const principal = (value: typeof context) => {
        const { requestId: _, authorizedAt: __, ...identity } = value;
        return requestFingerprint(identity);
      };
      const expectedPrincipal = principal(context);
      const recheck = async () => {
        if (principal(await this.authority.resolve()) !== expectedPrincipal) throw new ModelGatewayError('FORBIDDEN');
      };
      const assertBinding = (row: { scope: unknown; audience?: unknown; orderId?: string; order?: { id: string } }) => {
        if (requestFingerprint(row.scope) !== requestFingerprint(scope)
          || (row.audience !== undefined && row.audience !== context.audience)
          || (row.order?.id ?? row.orderId) !== orderId) throw new ModelGatewayError('FORBIDDEN');
      };
      const current = await this.facts.read(context); assertBinding(current);
      await recheck();
      // Only an attempted asynchronous source read introduces another authority
      // boundary. Skipped optional branches do not yield; keep live rechecks
      // after attempted reads (including failures), the final order read and
      // the outer original route Guard instead of repeating no-read checks.
      let history: Awaited<ReturnType<AiOrderReadFactsService['readHistoricalBasis']>> | undefined;
      if (selected.history) { try { history = await this.facts.readHistoricalBasis(context); } catch { /* Uniform optional coverage, no raw exception. */ } }
      if (history) {
        assertBinding(history);
        if (history.sourceOrderUpdatedAt !== current.order.updatedAt) throw new ModelGatewayError('CONFIG_INVALID');
      }
      if (selected.history) await recheck();
      let payment: Awaited<ReturnType<AiOrderPaymentFactsService['read']>> | undefined;
      if (selected.payments && this.payments) { try { payment = await this.payments.read(context); } catch { /* No count/reason/existence on denied finance. */ } }
      if (payment) assertBinding(payment);
      if (selected.payments && this.payments) await recheck();
      let funding: Awaited<ReturnType<AiOrderFundingFactsService['read']>> | undefined;
      if (selected.payments && this.funding) {
        try { funding = await this.funding.read(context); } catch { /* Uniform optional finance coverage; outer authority still rechecks revocation. */ }
      }
      if (funding && (funding.tenantId !== scope.tenantId || funding.workspaceId !== scope.workspaceId || funding.orderId !== orderId
        || funding.sourceOrderUpdatedAt !== current.order.updatedAt || funding.currency !== current.order.currency))
        throw new ModelGatewayError('INVALID_RESPONSE');
      if (selected.payments && this.funding) await recheck();
      let inspections: Awaited<ReturnType<AiOrderInspectionFactsService['read']>> | undefined;
      if (selected.inspections && this.inspections) inspections = await this.inspections.read(context);
      if (inspections) {
        assertBinding(inspections);
        if (inspections.sourceOrderUpdatedAt !== current.order.updatedAt) throw new ModelGatewayError('CONFIG_INVALID');
        if (history?.inspection.status === 'available' && inspections.frozenBasis?.status === 'available') {
          // These are two observations of the SAME original order snapshot,
          // not a choice between old and replacement templates. Compare only
          // their shared reference whitelist; Core owns resource applicability.
          const canonical = (values: Array<{ id: string; code: string; stage: string; version: string }>) => values
            .map(({ id, code, stage, version }) => ({ id, code, stage, version })).sort((a, b) => a.id.localeCompare(b.id));
          if (requestFingerprint(canonical(history.inspection.templates)) !== requestFingerprint(canonical(inspections.frozenBasis.value.originalTemplateRefs)))
            throw new ModelGatewayError('INVALID_RESPONSE');
        }
      }
      if (selected.inspections && this.inspections) await recheck();
      let lifecycle: z.infer<typeof lifecycleSchema> | undefined;
      if (selected.lifecycle && this.lifecycle) {
        try { lifecycle = lifecycleSchema.parse(await this.lifecycle.readOrderExplanationState(scope.tenantId, orderId)); }
        catch { /* Uniform unavailable; never synthesize an empty lifecycle. */ }
      }
      if (lifecycle && (lifecycle.orderId !== orderId || lifecycle.tenantId !== scope.tenantId || lifecycle.workspaceId !== scope.workspaceId
        || lifecycle.sourceOrderUpdatedAt !== current.order.updatedAt
        || [lifecycle.allocations, lifecycle.changes, lifecycle.extensions].some(rows => new Set(rows.map(row => row.id)).size !== rows.length)
        || Buffer.byteLength(JSON.stringify(lifecycle), 'utf8') > 32768)) throw new ModelGatewayError('INVALID_RESPONSE');
      if (selected.lifecycle && this.lifecycle) await recheck();
      // Re-read the actual minimal order after all optional awaits; outer route
      // bridge revalidates current identity as well. Sequential, not atomic DB snapshot.
      const latest = await this.facts.read(context); assertBinding(latest);
      if (requestFingerprint(latest.order) !== requestFingerprint(current.order)) throw new ModelGatewayError('CONFIG_INVALID');
      const now = this.clock();
      if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
      const reference = (field: string) => ({ scope, resourceType: 'order' as const, resourceId: orderId,
        version: current.order.updatedAt, field, observedAt: current.observedAt });
      return {
        requestId: context.requestId, audience: context.audience, scope, orderId, orderVersion: current.order.updatedAt,
        observedAt: now.toISOString(), consistency: 'revalidated_reads_not_atomic_snapshot' as const,
        coverage: 'partial' as const,
        order: { coverage: 'partial' as const, value: current.order, source: reference('order') },
        amounts: { coverage: 'partial' as const, value: current.order.amounts, currency: current.order.currency, source: reference('amounts'),
          meaning: 'core_order_amounts_not_payment_totals' as const },
        fulfillment: { coverage: 'partial' as const, value: { startAt: current.order.startAt,
          originalEndAt: current.order.originalEndAt, effectiveEndAt: current.order.effectiveEndAt,
          effectiveEndBasis: current.order.effectiveEndBasis }, source: reference('rental_period'),
          inspectionExecution: 'not_loaded' as const },
        history: history ? { coverage: 'partial' as const, value: history, source: reference('saved_basis') }
          : { coverage: selected.history ? 'unavailable' as const : 'not_loaded' as const },
        payments: payment ? { coverage: 'partial' as const, value: payment,
          source: { ...reference('payment_records'), observedAt: payment.observedAt } }
          : { coverage: selected.payments ? 'unavailable' as const : 'not_loaded' as const },
        inspections: inspections ? { coverage: 'partial' as const, value: inspections,
          source: { ...reference('inspection_records'), observedAt: inspections.observedAt } }
          : { coverage: selected.inspections ? 'unavailable' as const : 'not_loaded' as const },
        lifecycle: lifecycle ? { coverage: 'partial' as const, value: lifecycle }
          : { coverage: selected.lifecycle ? 'unavailable' as const : 'not_loaded' as const },
        actualReceivedTotal: { coverage: 'not_loaded' as const },
        // Internal domain provenance is not a newly registered public citation.
        fundingLedger: funding ? { coverage: 'partial' as const, value: funding }
          : { coverage: selected.payments ? 'unavailable' as const : 'not_loaded' as const }
      };
    });
  }
}
