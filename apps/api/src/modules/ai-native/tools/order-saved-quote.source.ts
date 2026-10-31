import { NotFoundException } from '@nestjs/common';
import type { AiWorkspaceScope } from '@rental-os/shared';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { getRequestIdentity } from '../../../common/request-identity';
import type { AiQuoteCoreContextSource } from '../quote-preview.service';
import type { AiOrderHistoricalQuoteSource } from '../order-read-facts.service';
import { ModelGatewayError } from '../model-gateway.ports';

/** Only consumed inside the original guarded order reader. Current context is
 * used to locate the workspace's existing quote store, NOT as historical rate,
 * rule/calendar/template evidence. No global quote-ID lookup or price fallback. */
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
