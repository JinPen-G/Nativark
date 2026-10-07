import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderReadFactsService } from '../order-read-facts.service';
import type { AiOrderPaymentFactsService } from './order-payment-facts.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import type { AiExecutionContext } from '@rental-os/shared';
import { assertAiReadContextBinding } from './read-context-binding';

/** Structured evidence only, not an explanation generator or a payment ledger.
 * Bound once by the server; optional finance denial exposes no existence/count. */
export class AiOrderExplanationFactsService {
  constructor(private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead' | 'resolve'>,
    private readonly facts: Pick<AiOrderReadFactsService, 'read' | 'readHistoricalBasis'>,
    private readonly payments?: Pick<AiOrderPaymentFactsService, 'read'>,
    private readonly clock: () => Date = () => new Date()) {}

  async read(expectedContext?: AiExecutionContext) {
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expectedContext);
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
      let history: Awaited<ReturnType<AiOrderReadFactsService['readHistoricalBasis']>> | undefined;
      try { history = await this.facts.readHistoricalBasis(context); } catch { /* Uniform optional coverage, no raw exception. */ }
      if (history) {
        assertBinding(history);
        if (history.sourceOrderUpdatedAt !== current.order.updatedAt) throw new ModelGatewayError('CONFIG_INVALID');
      }
      await recheck();
      let payment: Awaited<ReturnType<AiOrderPaymentFactsService['read']>> | undefined;
      if (this.payments) { try { payment = await this.payments.read(context); } catch { /* No count/reason/existence on denied finance. */ } }
      if (payment) assertBinding(payment);
      await recheck();
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
          : { coverage: 'unavailable' as const },
        payments: payment ? { coverage: 'partial' as const, value: payment,
          source: { ...reference('payment_records'), observedAt: payment.observedAt } }
          : { coverage: 'unavailable' as const },
        actualReceivedTotal: { coverage: 'not_loaded' as const },
        fundingLedger: { coverage: 'not_loaded' as const }
      };
    });
  }
}
