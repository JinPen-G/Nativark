import type { AiExecutionContext } from '@rental-os/shared';
import type { AiBusinessReadAuthority } from '../business-read-route.authority';
import { ModelGatewayError } from '../model-gateway.ports';
import { aiOpeningReadInputSchema, aiRiskReadInputSchema, type AiDiagnosticReadAuthority } from './diagnostic-read-facts.service';

/** Fixed original routes, not an HTTP tool. The existing Guard owns current
 * identity/permissions/ALS; the bridge rechecks after the awaited read.
 * Workspace-wide opening aggregates have no location-redacted source yet. */
export class AiDiagnosticRouteAuthority implements AiDiagnosticReadAuthority {
  constructor(private readonly business: AiBusinessReadAuthority) {
    if (typeof business?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async withRead<T>(kind: 'opening' | 'risk', input: unknown, consume: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    if (!['opening', 'risk'].includes(kind) || typeof consume !== 'function') throw new ModelGatewayError('INVALID_REQUEST');
    const parsed = (kind === 'opening' ? aiOpeningReadInputSchema : aiRiskReadInputSchema).safeParse(input);
    if (!parsed.success) throw new ModelGatewayError('INVALID_REQUEST');
    return this.business.withRead(kind, parsed.data, async context => {
      if (!('access' in context) || context.actor.kind !== 'user' || context.scope.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
      if (kind === 'opening' && (context.access.dataScope !== 'all' || context.access.locationScope?.mode !== 'all')) {
        throw new ModelGatewayError('FORBIDDEN');
      }
      return consume(context);
    });
  }
}
