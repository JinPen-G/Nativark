import type { AiWorkspaceScope } from '@rental-os/shared';
import type { RentalBusinessService } from '../../rental-core/rental-business.service';
import { getRequestIdentity } from '../../../common/request-identity';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import type { AiOrderHistoricalQuoteSource } from '../order-read-facts.service';
import { ModelGatewayError } from '../model-gateway.ports';

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
