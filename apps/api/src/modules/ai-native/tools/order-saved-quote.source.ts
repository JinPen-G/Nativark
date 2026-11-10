
import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiWorkspaceScope } from '@rental-os/shared';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { getRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiOrderHistoricalQuoteSource } from '../order-read-facts.service';
import { ModelGatewayError } from '../model-gateway.ports';

/** Native order-bound history only. The fixed original order authority and Core
 * recheck the quote link before/after its saved read; IDs/scope never grant access.
 * No BusinessContext/current price/cache/quote creation or transaction is made. */
export class AiNativeOrderSavedQuoteSource implements AiOrderHistoricalQuoteSource {
  private readonly quote: RentalBusinessService['readQuoteInTransaction'];
  private readonly order: RentalCoreService['getOrderInTransaction'];
  private readonly readOrder: AiOrderRouteContextAuthority['withOrderRead'];
  constructor(business: Pick<RentalBusinessService, 'readQuoteInTransaction'>,
    core: Pick<RentalCoreService, 'getOrderInTransaction'>,
    authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly native: Prisma.TransactionClient, private readonly signal: AbortSignal,
    private readonly assertCurrent: () => void) {
    if (typeof business?.readQuoteInTransaction !== 'function' || typeof core?.getOrderInTransaction !== 'function'
      || typeof authority?.withOrderRead !== 'function' || !native || '$transaction' in native
      || typeof assertCurrent !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
    this.quote = business.readQuoteInTransaction.bind(business);
    this.order = core.getOrderInTransaction.bind(core);
    this.readOrder = authority.withOrderRead.bind(authority);
  }
  async read(expected: AiWorkspaceScope, quoteId: string): ReturnType<AiOrderHistoricalQuoteSource['read']> {
    const scope = structuredClone(expected);
    const live = () => { if (this.signal.aborted) throw new ModelGatewayError('FORBIDDEN'); this.assertCurrent(); };
    live();
    if (scope?.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
    return this.readOrder(async (context, orderId) => {
      live();
      const identity = getRequestIdentity();
      if (context.actor.kind !== 'user' || context.audience !== 'operator' || requestFingerprint(context.scope) !== requestFingerprint(scope)
        || identity?.tenantId !== scope.tenantId || identity.workspaceId !== scope.workspaceId || identity.userId !== context.actor.userId || identity.isSaasAdmin) {
        throw new ModelGatewayError('FORBIDDEN');
      }
      const before = await this.order(scope.tenantId, orderId, this.native, this.signal, live); live();
      if (before.id !== orderId || before.tenantId !== scope.tenantId || before.quoteId !== quoteId) throw new ModelGatewayError('FORBIDDEN');
      const binding = requestFingerprint(before);
      let result: Awaited<ReturnType<AiOrderHistoricalQuoteSource['read']>>;
      try {
        const quote = await this.quote(scope.tenantId, quoteId, this.native, this.signal, live); live();
        if (quote.id !== quoteId || quote.tenantId !== scope.tenantId) throw new ModelGatewayError('INVALID_RESPONSE');
        result = { status: 'available', quote: structuredClone(quote) };
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
        result = { status: 'missing' };
      }
      live();
      const after = await this.order(scope.tenantId, orderId, this.native, this.signal, live); live();
      if (requestFingerprint(after) !== binding) throw new ModelGatewayError('INVALID_RESPONSE');
      return result;
    });
  }
}

/** Only inside the original guarded order reader. The repository reuses its
 * original order visibility and JOINs that order's saved quote. No current
 * context, initialization, global quote lookup or historical price fallback. */
export class AiOrderSavedQuoteSource implements AiOrderHistoricalQuoteSource {
  constructor(private readonly business: Pick<RentalBusinessService, 'readOrderLinkedQuoteFacts'>) {
    if (typeof business?.readOrderLinkedQuoteFacts !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async read(expected: AiWorkspaceScope, quoteId: string, orderId: string): ReturnType<AiOrderHistoricalQuoteSource['read']> {
    if (expected?.kind !== 'workspace' || !orderId || !quoteId) throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(expected), identity = getRequestIdentity();
    if (!identity?.userId || identity.isSaasAdmin || identity.tenantId !== scope.tenantId || identity.workspaceId !== scope.workspaceId)
      throw new ModelGatewayError('FORBIDDEN');
    const binding = requestFingerprint(identity);
    const quote = await this.business.readOrderLinkedQuoteFacts(scope.tenantId, orderId, quoteId);
    if (requestFingerprint(getRequestIdentity()) !== binding) throw new ModelGatewayError('FORBIDDEN');
    return quote === undefined ? { status: 'missing' } : { status: 'available', quote: structuredClone(quote) };
  }
}
