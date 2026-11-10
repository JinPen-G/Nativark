import { z } from 'zod';
import type { PaymentRuntimeService } from '../../integrations/payment.runtime.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiExecutionContext } from '@rental-os/shared';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const currency = z.string().regex(/^[A-Z]{3}$/u);
const time = z.string().max(40).datetime({ offset: true });
// Minimal local projections of existing PaymentRuntimeService responses, not
// new public DTOs. Raw message, checkoutURL, JSAPI, provider IDs never escape.
const intentSchema = z.object({ intentId: id, instrument: z.enum(['rental', 'deposit', 'preauthorization']),
  amount, currency, status: z.enum(['pending', 'paid', 'failed', 'funding_failed', 'closed']), expiresAt: time, paidAt: time.optional() });
const refundSchema = z.object({ refundId: id, paymentIntentId: id, orderId: id, amount, currency,
  status: z.enum(['pending', 'accepted', 'funding_pending', 'succeeded', 'failed', 'closed']),
  acceptedAt: time.optional(), succeededAt: time.optional(), fundedAt: time.optional(), createdAt: time, updatedAt: time });
const intentPageSchema = z.object({ rows: z.array(intentSchema).max(20), truncated: z.boolean(), nextCursor: id.optional() });
const orderSchema = z.object({ id, tenantId: id, currency });
const binding = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return requestFingerprint(value);
};

export type AiOrderPaymentReadPort = Partial<Pick<PaymentRuntimeService, 'readOrderPaymentIntentsPage' | 'readOrderPaymentRefundsPage'>>;

/** Local reads only: never refresh providers, create payments or issue refunds.
 * Original order AND finance Guards are required. Bounded pages are reopened
 * across refund waits; equal projections do not attest a cross-domain snapshot. */
export class AiOrderPaymentFactsService {
  constructor(private readonly payments: AiOrderPaymentReadPort,
    private readonly core: Pick<RentalCoreService, 'readOrderFacts'>,
    private readonly orderAuthority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly routes: AiBusinessReadAuthority, private readonly clock: () => Date = () => new Date()) {
    if (!payments || typeof payments !== 'object') throw new ModelGatewayError('CONFIG_INVALID');
    for (const [port, name] of [[core, 'readOrderFacts'],
      [orderAuthority, 'withOrderRead'], [routes, 'withRead']] as const) {
      if (!port || typeof (port as unknown as Record<string, unknown>)[name] !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    }
  }
  async read(expectedContext?: AiExecutionContext) {
    // Copy the original server parent before the order Guard can yield; the
    // assertion grants no finance access and both live Guards still run.
    const parent = expectedContext && structuredClone(expectedContext);
    return this.orderAuthority.withOrderRead(async (owner, orderId) => {
      assertAiReadContextBinding(owner, parent);
      if (owner.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(owner.scope), expected = binding(owner);
      const order = orderSchema.parse(await this.core.readOrderFacts(scope.tenantId, orderId));
      if (order.id !== orderId || order.tenantId !== scope.tenantId) throw new ModelGatewayError('INVALID_RESPONSE');
      return this.routes.withRead('payment_intents', { orderId }, async context => {
        if (binding(context) !== expected) throw new ModelGatewayError('FORBIDDEN');
        // Both original bounded capabilities are required before any financial
        // query. Projection caps cannot make legacy full-list queries bounded.
        if (typeof this.payments.readOrderPaymentIntentsPage !== 'function'
          || typeof this.payments.readOrderPaymentRefundsPage !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        const readIntents = async () => {
          if (typeof this.payments.readOrderPaymentIntentsPage !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
          const page = intentPageSchema.parse(await this.payments.readOrderPaymentIntentsPage(scope.tenantId, scope.workspaceId, orderId, { limit: 20 }));
          if (new Set(page.rows.map(row => row.intentId)).size !== page.rows.length
            || page.rows.some(row => row.currency !== order.currency)) throw new ModelGatewayError('INVALID_RESPONSE');
          return page;
        };
        const readRefunds = async (intentId: string, limit: number) => {
          const page = await this.routes.withRead('payment_refunds', { orderId, intentId }, async current => {
            if (binding(current) !== expected) throw new ModelGatewayError('FORBIDDEN');
            if (typeof this.payments.readOrderPaymentRefundsPage !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
            return this.payments.readOrderPaymentRefundsPage(scope.tenantId, scope.workspaceId, orderId, intentId, { limit });
          });
          const parsed = z.object({ rows: z.array(refundSchema).max(limit), truncated: z.boolean(), nextCursor: id.optional() }).parse(page);
          if (parsed.rows.some(row => row.orderId !== orderId || row.paymentIntentId !== intentId || row.currency !== order.currency))
            throw new ModelGatewayError('INVALID_RESPONSE');
          return parsed;
        };
        const intentPage = await readIntents(), intents = intentPage.rows;
        const refunds: z.infer<typeof refundSchema>[] = [];
        const refundPages: { intentId: string; limit: number; page: Awaited<ReturnType<typeof readRefunds>> }[] = [];
        let refundsTruncated = intentPage.truncated;
        for (const intent of intents) {
          const limit = Math.min(50, 100 - refunds.length);
          if (limit === 0) { refundsTruncated = true; break; }
          const page = await readRefunds(intent.intentId, limit);
          refundPages.push({ intentId: intent.intentId, limit, page });
          refundsTruncated ||= page.truncated;
          refunds.push(...page.rows);
          if (refunds.length > 100 || new Set(refunds.map(row => row.refundId)).size !== refunds.length) throw new ModelGatewayError('INVALID_RESPONSE');
        }
        // Order/Guard rereads alone cannot attest payment/refund status changes
        // which need not update the order. Reopen exactly the observed pages,
        // in reverse nesting order, including empty pages and coverage metadata.
        // Never chase a new cursor, retry a changed page, or refresh a provider.
        for (const { intentId, limit, page } of refundPages.slice().reverse()) {
          if (requestFingerprint(page) !== requestFingerprint(await readRefunds(intentId, limit)))
            throw new ModelGatewayError('INVALID_RESPONSE');
        }
        const currentIntents = await this.routes.withRead('payment_intents', { orderId }, async current => {
          if (binding(current) !== expected) throw new ModelGatewayError('FORBIDDEN');
          return readIntents();
        });
        if (requestFingerprint(intentPage) !== requestFingerprint(currentIntents)
          || requestFingerprint(order) !== requestFingerprint(orderSchema.parse(await this.core.readOrderFacts(scope.tenantId, orderId))))
          throw new ModelGatewayError('INVALID_RESPONSE');
        const now = this.clock();
        if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('CONFIG_INVALID');
        return { requestId: owner.requestId, audience: owner.audience, scope, orderId, observedAt: now.toISOString(),
          source: 'persisted_payment_runtime' as const, status: 'available' as const,
          // `paid` is the recorded payment state, not an inferred order state.
          // Refund accepted/funding_pending/succeeded remain distinct.
          intents, refunds, fundingLedger: 'not_loaded' as const,
          totals: 'not_computed' as const, truncated: refundsTruncated, freshness: 'local_records_not_provider_refresh' as const };
      });
    });
  }
}
