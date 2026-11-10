import type { AiExecutionContext } from '@rental-os/shared';
import type { AiOrderRouteContextAuthority } from '../order-route-context.authority';
import type { AiOrderExplanationFactsService } from './order-explanation-facts.service';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { ModelGatewayError } from '../model-gateway.ports';
import { assertAiReadContextBinding } from './read-context-binding';

type Facts = Awaited<ReturnType<AiOrderExplanationFactsService['read']>>;

/** Current evidence for the already-connected order reader/manual reference.
 * Not a business allowed-actions calculator, execution grant or new protocol.
 * Both fact reads run through original Guard/ALS/Core; a saved context alone
 * cannot authorize them. No history, finance, preview or business write runs. */
export class AiOrderNextStepsCurrentSource {
  constructor(private readonly authority: Pick<AiOrderRouteContextAuthority, 'withOrderRead'>,
    private readonly facts: Pick<AiOrderExplanationFactsService, 'read'>) {}

  async withCurrent<T>(expectedContext: AiExecutionContext | undefined,
    consume: (context: AiExecutionContext, current: Facts) => T | Promise<T>): Promise<T> {
    const expected = expectedContext === undefined ? undefined : structuredClone(expectedContext);
    return this.authority.withOrderRead(async (context, orderId) => {
      assertAiReadContextBinding(context, expected);
      if (context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      const scopeHash = requestFingerprint(context.scope);
      const assertBinding = (row: Facts) => {
        if (row.orderId !== orderId || row.order.value.id !== orderId || row.audience !== context.audience
          || requestFingerprint(row.scope) !== scopeHash || requestFingerprint(row.order.source.scope) !== scopeHash
          || row.order.source.resourceType !== 'order' || row.order.source.resourceId !== orderId
          || row.order.source.field !== 'order') throw new ModelGatewayError('FORBIDDEN');
        if (row.orderVersion !== row.order.value.updatedAt || row.order.source.version !== row.orderVersion)
          throw new ModelGatewayError('INVALID_RESPONSE');
      };
      const basis = (row: Facts) => requestFingerprint({ scope: row.scope, audience: row.audience,
        orderId: row.orderId, orderVersion: row.orderVersion, order: row.order.value });
      const before = await this.facts.read(context, { history: false, payments: false });
      assertBinding(before);
      // Capture the real basis before handing clones to the consumer. It cannot
      // mutate the reference to make a changed order appear unchanged.
      const beforeHash = basis(before);
      const result = await consume(structuredClone(context), structuredClone(before));
      const after = await this.facts.read(context, { history: false, payments: false });
      assertBinding(after);
      if (basis(after) !== beforeHash) throw new ModelGatewayError('CONFIG_INVALID');
      return result;
    });
  }
}
