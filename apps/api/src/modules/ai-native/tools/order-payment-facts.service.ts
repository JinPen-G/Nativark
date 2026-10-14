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
const binding = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return requestFingerprint(value);
};

export type AiOrderPaymentReadPort = Pick<PaymentRuntimeService, 'listPaymentIntents' | 'listPaymentRefunds'>
  & Partial<Pick<PaymentRuntimeService, 'listPaymentIntentsPage' | 'listPaymentRefundsPage'>>;

/** Local reads only: never refresh providers, create payments or issue refunds.
 * The original order AND finance route Guards are both required. */
export class AiOrderPaymentFactsService {
  constructor(private readonly payments: AiOrderPaymentReadPort,
    private readonly core: Pick<RentalCoreService, 'getOrder'>,
    private readonly orderAuthority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly routes: AiBusinessReadAuthority, private readonly clock: () => Date = () => new Date()) {
    for (const [port, name] of [[payments, 'listPaymentIntents'], [payments, 'listPaymentRefunds'], [core, 'getOrder'],
      [orderAuthority, 'withOrderRead'], [routes, 'withRead']] as const) {
      if (!port || typeof (port as unknown as Record<string, unknown>)[name] !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    }
  }
  async read(expectedContext?: AiExecutionContext) {
    return this.orderAuthority.withOrderRead(async (owner, orderId) => {
      assertAiReadContextBinding(owner, expectedContext);
      if (owner.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(owner.scope), expected = binding(owner);
      const order = z.object({ id, tenantId: id, currency }).parse(await this.core.getOrder(scope.tenantId, orderId));
      if (order.id !== orderId || order.tenantId !== scope.tenantId) throw new ModelGatewayError('INVALID_RESPONSE');
      return this.routes.withRead('payment_intents', { orderId }, async context => {
        if (binding(context) !== expected) throw new ModelGatewayError('FORBIDDEN');
        // Both original bounded capabilities are required before any financial
        // query. Projection caps cannot make legacy full-list queries bounded.
        if (typeof this.payments.listPaymentIntentsPage !== 'function'
          || typeof this.payments.listPaymentRefundsPage !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        const intentPage = await this.payments.listPaymentIntentsPage(scope.tenantId, scope.workspaceId, orderId, { limit: 20 });
        if (!intentPage || typeof intentPage.truncated !== 'boolean') throw new ModelGatewayError('INVALID_RESPONSE');
        const intents = z.array(intentSchema).max(20).parse(intentPage.rows);
        if (new Set(intents.map(row => row.intentId)).size !== intents.length || intents.some(row => row.currency !== order.currency)) throw new ModelGatewayError('INVALID_RESPONSE');
        const refunds: z.infer<typeof refundSchema>[] = [];
        let refundsTruncated = intentPage.truncated;
        for (const intent of intents) {
          const limit = Math.min(50, 100 - refunds.length);
          if (limit === 0) { refundsTruncated = true; break; }
          const refundPage = await this.routes.withRead('payment_refunds', { orderId, intentId: intent.intentId }, async current => {
            if (binding(current) !== expected) throw new ModelGatewayError('FORBIDDEN');
            if (typeof this.payments.listPaymentRefundsPage !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
            return this.payments.listPaymentRefundsPage(scope.tenantId, scope.workspaceId, orderId, intent.intentId, { limit });
          });
          if (!refundPage || typeof refundPage.truncated !== 'boolean') throw new ModelGatewayError('INVALID_RESPONSE');
          const rows = z.array(refundSchema).max(limit).parse(refundPage.rows);
          refundsTruncated ||= refundPage.truncated;
          if (rows.some(row => row.orderId !== orderId || row.paymentIntentId !== intent.intentId || row.currency !== order.currency)) throw new ModelGatewayError('INVALID_RESPONSE');
          refunds.push(...rows);
          if (refunds.length > 100 || new Set(refunds.map(row => row.refundId)).size !== refunds.length) throw new ModelGatewayError('INVALID_RESPONSE');
        }
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
