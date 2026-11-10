import { z } from 'zod';
import type { RentalFundingService } from '../../rental-core/rental-funding.service';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import type { AiExecutionContext } from '@rental-os/shared';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const time = z.string().max(40).datetime({ offset: true });
const money = z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER);
const cash = z.union([z.object({ coverage: z.literal('unavailable') }).strict(), z.object({ coverage: z.literal('available'),
  collected: money, refunded: money, netReceived: z.number().finite().max(Number.MAX_SAFE_INTEGER).min(-Number.MAX_SAFE_INTEGER) }).strict()]);
const deposit = z.union([z.object({ coverage: z.literal('unavailable') }).strict(), z.object({ coverage: z.literal('available'),
  collected: money, captured: money, refunded: money, balance: money }).strict()]);
const provider = z.enum(['mock', 'offline', 'alipay', 'wechat_pay', 'stripe']);
export const aiOrderFundingFactsSchema = z.object({ tenantId: id, workspaceId: id, orderId: id, currency: z.string().regex(/^[A-Z]{3}$/u),
  sourceOrderUpdatedAt: time, observedAt: time, consistency: z.literal('repeatable_read_snapshot_not_provider_refresh'),
  coverage: z.literal('complete_within_200_row_caps'), source: z.literal('persisted_original_funding_domain'), rentalCash: cash, deposit,
  preauthorization: z.object({ coverage: z.literal('unavailable'), reason: z.literal('no_verified_provider_preauthorization_port') }).strict(),
  legacySecurity: z.object({ unverified: z.boolean(), unverifiedAmount: money }).strict(),
  events: z.array(z.object({ id, instrument: z.enum(['rental', 'deposit', 'preauthorization']),
    action: z.enum(['initiate', 'append', 'capture', 'refund', 'release', 'fail']), amount: money,
    recordedProvider: provider, accountingProvider: provider, at: time,
    accounting: z.enum(['original_recorded_funds', 'simulation_or_unverified_not_real_funds']) }).strict()).max(200),
  offlineRegistrations: z.array(z.object({ id, instrument: z.enum(['rental', 'deposit']), amount: money,
    status: z.enum(['pending', 'confirmed']), registeredAt: time, confirmedAt: time.nullable(), fundingEventId: id.nullable() }).strict()).max(200),
  corporateAllocations: z.literal('not_cash_not_loaded'), settlementBalance: z.literal('not_computed'), execution: z.literal('not_attempted') }).strict();
const binding = (context: AiExecutionContext) => {
  const { requestId: _, authorizedAt: __, ...value } = context;
  return requestFingerprint(value);
};

/** Internal funds source, not a public DTO/ledger or funds action. Requires the
 * original order authority AND the original finance observation Guard/ALS. This
 * is deliberately stricter than the legacy funding page's order-view alternative.
 * No unbounded listEvents, provider refresh, ledger repair or document creation. */
export class AiOrderFundingFactsService {
  constructor(private readonly funding: Pick<RentalFundingService, 'readOrderExplanationFacts'>,
    private readonly core: Pick<RentalCoreService, 'readOrderFacts'>,
    private readonly orderAuthority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly routes: AiBusinessReadAuthority) {}

  async read(expectedContext?: AiExecutionContext) {
    // The caller's mutable parent cannot replace the original binding during
    // the order Guard wait. This snapshot is not a financial authorization.
    const parent = expectedContext && structuredClone(expectedContext);
    return this.orderAuthority.withOrderRead(async (owner, orderId) => {
      assertAiReadContextBinding(owner, parent);
      if (owner.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scope = structuredClone(owner.scope), expected = binding(owner);
      const before = await this.core.readOrderFacts(scope.tenantId, orderId);
      if (before.id !== orderId || before.tenantId !== scope.tenantId) throw new ModelGatewayError('INVALID_RESPONSE');
      return this.routes.withRead('payment_intents', { orderId }, async context => {
        if (binding(context) !== expected) throw new ModelGatewayError('FORBIDDEN');
        if (typeof this.funding?.readOrderExplanationFacts !== 'function') throw new ModelGatewayError('CAPABILITY_UNSUPPORTED');
        const result = aiOrderFundingFactsSchema.parse(await this.funding.readOrderExplanationFacts(scope.tenantId, scope.workspaceId, orderId));
        if (result.tenantId !== scope.tenantId || result.workspaceId !== scope.workspaceId || result.orderId !== orderId
          || result.currency !== before.currency || result.sourceOrderUpdatedAt !== before.updatedAt
          || new Set(result.events.map(row => row.id)).size !== result.events.length
          || new Set(result.offlineRegistrations.map(row => row.id)).size !== result.offlineRegistrations.length)
          throw new ModelGatewayError('INVALID_RESPONSE');
        const after = await this.core.readOrderFacts(scope.tenantId, orderId);
        if (requestFingerprint(before) !== requestFingerprint(after)) throw new ModelGatewayError('CONFIG_INVALID');
        return result;
      });
    });
  }
}
