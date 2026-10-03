import { z } from 'zod';
import { AI_CONTRACT_DRAFT_VERSION, RentalCoreOrderStatus, AI_ORDER_FACTS_DRAFT_VERSION, type AiOrderReadFactsDraft, type AiWorkspaceScope } from '@rental-os/shared';
import type { RentalCoreService } from '../rental-core/rental-core.service';
import { AiOrderRouteContextAuthority } from './order-route-context.authority';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const time = z.string().max(40).datetime({ offset: true });
const amount = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).optional();
// Parse only a minimal projection of the Core response, never relay the aggregate.
const projection = z.object({
  id, tenantId: id, orderNo: z.string().min(1).max(191), status: z.nativeEnum(RentalCoreOrderStatus),
  startAt: time, endAt: time, effectiveEndAt: time.optional(), updatedAt: time,
  currency: z.string().regex(/^[A-Z]{3}$/u), rentalAmount: amount, serviceAmount: amount,
  discountAmount: amount, couponAmount: amount, depositAmount: amount, preAuthAmount: amount, finalPayableAmount: amount
});

/** Internal read projection only; not registered as an executable tool or HTTP DTO.
 * Amounts are copied from Core, not recomputed; payment and historical fee evidence
 * require their dedicated readers and are explicitly absent in this slice.
 */
export class AiOrderReadFactsService {
  constructor(private readonly core: Pick<RentalCoreService, 'getOrder'>,
    private readonly authority: AiOrderRouteContextAuthority, private readonly clock: () => Date = () => new Date()) {}
  async read(): Promise<AiOrderReadFactsDraft> {
    return this.authority.withOrderRead(async (context, orderId) => {
      const audience = context.audience;
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user' || (audience !== 'operator' && audience !== 'staff')) throw Error('unsupported read scope');
      const order = projection.parse(await this.core.getOrder(context.scope.tenantId, orderId));
      if (order.id !== orderId || order.tenantId !== context.scope.tenantId) throw Error('order binding mismatch');
      const observed = this.clock();
      if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw Error('invalid observation time');
      const observedAt = observed.toISOString(), scope: AiWorkspaceScope = { ...context.scope };
      const source: AiOrderReadFactsDraft['sources'][0] = { scope, resourceType: 'order', resourceId: order.id, observedAt, basis: { kind: 'current' } };
      return {
        draftVersion: AI_ORDER_FACTS_DRAFT_VERSION, contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId, audience, scope, observedAt,
        order: { id: order.id, orderNo: order.orderNo, status: order.status, updatedAt: order.updatedAt,
          startAt: order.startAt, originalEndAt: order.endAt, effectiveEndAt: order.effectiveEndAt ?? order.endAt,
          effectiveEndBasis: order.effectiveEndAt ? 'effectiveEndAt' as const : 'endAt_fallback' as const,
          currency: order.currency, amounts: {
            rental: order.rentalAmount ?? null, service: order.serviceAmount ?? null, discount: order.discountAmount ?? null,
            coupon: order.couponAmount ?? null, deposit: order.depositAmount ?? null, preAuthorization: order.preAuthAmount ?? null,
            finalPayable: order.finalPayableAmount ?? null
          } },
        sources: [source], paymentEvidence: 'not_loaded' as const, historicalFeeEvidence: 'not_loaded' as const
      };
    });
  }
}
