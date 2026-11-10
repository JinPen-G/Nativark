import { NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiWorkspaceScope } from '@rental-os/shared';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { getRequestIdentity } from '../../../common/request-identity';
import type { AiQuoteCoreContextSource } from '../quote-preview.service';
import type { AiOrderHistoricalQuoteSource } from '../order-read-facts.service';
import { ModelGatewayError } from '../model-gateway.ports';

/** Only consumed inside the original guarded order reader. Current context is
 * used to locate the workspace's existing quote store, NOT as historical rate,
 * rule/calendar/template evidence. No global quote-ID lookup or price fallback. */
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

export class AiOrderSavedQuoteSource implements AiOrderHistoricalQuoteSource {
  constructor(private readonly business: Pick<RentalBusinessService, 'loadQuote'>,
    private readonly contexts: AiQuoteCoreContextSource) {
    if (typeof business?.loadQuote !== 'function' || typeof contexts?.current !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async read(expected: AiWorkspaceScope, quoteId: string): ReturnType<AiOrderHistoricalQuoteSource['read']> {
    if (expected?.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(expected), identity = structuredClone(getRequestIdentity());
    if (!identity?.userId || identity.isSaasAdmin || identity.tenantId !== scope.tenantId || identity.workspaceId !== scope.workspaceId) {
      throw new ModelGatewayError('FORBIDDEN');
    }
    try {
      const context = await this.contexts.current(structuredClone(scope));
      const current = getRequestIdentity();
      if (current?.userId !== identity.userId || current?.tenantId !== scope.tenantId || current?.workspaceId !== scope.workspaceId) throw new ModelGatewayError('FORBIDDEN');
      const quote = structuredClone(await this.business.loadQuote(scope.tenantId, context, quoteId));
      const after = getRequestIdentity();
      if (after?.userId !== identity.userId || after?.tenantId !== scope.tenantId || after?.workspaceId !== scope.workspaceId) throw new ModelGatewayError('FORBIDDEN');
      if (quote?.id !== quoteId || quote.tenantId !== scope.tenantId) throw new ModelGatewayError('INVALID_RESPONSE');
      return { status: 'available', quote };
    } catch (error) {
      if (error instanceof NotFoundException) return { status: 'missing' };
      throw error;
    }
  }
}
