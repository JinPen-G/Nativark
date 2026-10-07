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

// Internal provenance projection, not a new public transport contract. Parse
// only saved order fields; current configuration is deliberately not a source.
const version = z.string().min(1).max(191);
const historicalProjection = z.object({
  id, tenantId: id, updatedAt: time,
  ruleVersion: version.optional(),
  ruleSnapshot: z.object({ fulfillment: z.object({
    pickupInspectionRequired: z.boolean(), returnInspectionRequired: z.boolean()
  }) }).optional(),
  pricingPlanVersion: version.optional(), priceVersionId: id.optional(), priceVersion: version.optional(),
  calendarVersion: z.string().min(1).max(4096).optional(),
  inspectionTemplateSnapshots: z.array(z.object({
    id, tenantId: id, code: version, stage: z.enum(['pickup', 'return']), version
  })).max(50).optional()
}).superRefine((value, context) => {
  if (Boolean(value.priceVersionId) !== Boolean(value.priceVersion)) context.addIssue({ code: 'custom', message: 'incomplete price version binding' });
  if (value.ruleSnapshot && !value.ruleVersion) context.addIssue({ code: 'custom', message: 'rule snapshot has no version' });
  if (value.inspectionTemplateSnapshots?.some(row => row.tenantId !== value.tenantId)) context.addIssue({ code: 'custom', message: 'template tenant mismatch' });
  const keys = value.inspectionTemplateSnapshots?.map(row => `${row.id}:${row.stage}`) ?? [];
  if (new Set(keys).size !== keys.length) context.addIssue({ code: 'custom', message: 'duplicate template references' });
});

/** Internal read projection only; not registered as an executable tool or HTTP DTO.
 * Amounts are copied from Core, not recomputed; payment and historical fee evidence
 * require their dedicated readers and are explicitly absent in this slice.
 */
export class AiOrderReadFactsService {
  constructor(private readonly core: Pick<RentalCoreService, 'getOrder'>,
    private readonly authority: AiOrderRouteContextAuthority, private readonly clock: () => Date = () => new Date()) {}

  /** Version references and saved inspection requirements only. This does not
   * reconstruct historical prices, return raw rule JSON, or compute fees. */
  async readHistoricalBasis() {
    return this.authority.withOrderRead(async (context, orderId) => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
        || (context.audience !== 'operator' && context.audience !== 'staff')) throw Error('unsupported read scope');
      const order = historicalProjection.parse(await this.core.getOrder(context.scope.tenantId, orderId));
      if (order.id !== orderId || order.tenantId !== context.scope.tenantId) throw Error('order binding mismatch');
      const observed = this.clock();
      if (!(observed instanceof Date) || !Number.isFinite(observed.getTime())) throw Error('invalid observation time');
      return {
        contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: context.requestId,
        audience: context.audience, scope: { ...context.scope }, observedAt: observed.toISOString(),
        orderId, sourceOrderUpdatedAt: order.updatedAt, basis: 'order_snapshot' as const,
        // The order read does not supply the original rate snapshot. A version
        // reference alone must never be presented as complete pricing evidence.
        complete: false as const,
        rule: order.ruleSnapshot ? { status: 'available' as const, version: order.ruleVersion!,
          ...order.ruleSnapshot.fulfillment } : { status: 'missing' as const },
        price: { status: order.pricingPlanVersion ? 'references_only' as const : 'missing' as const,
          pricingPlanVersion: order.pricingPlanVersion, priceVersionId: order.priceVersionId,
          priceVersion: order.priceVersion, calendarVersion: order.calendarVersion,
          rateEvidence: 'not_loaded' as const },
        inspection: { status: order.inspectionTemplateSnapshots === undefined ? 'missing' as const : 'available' as const,
          templates: order.inspectionTemplateSnapshots?.map(({ id, code, stage, version }) => ({ id, code, stage, version })) ?? [] }
      };
    });
  }
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
