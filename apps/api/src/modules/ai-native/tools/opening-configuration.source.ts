import type { AiExecutionContext } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { ModelGatewayError } from '../model-gateway.ports';

/** Internal bounded opening source, not a quote context or write authority.
 * The original opening Guard/ALS surrounds each persisted projection, including
 * post-read revalidation. No cached/full-context fallback is installed. */
export interface AiOpeningConfigurationSource {
  current(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>): ReturnType<RentalCoreService['readOpeningConfiguration']>;
}
export class AiGuardedOpeningConfigurationSource implements AiOpeningConfigurationSource {
  constructor(private readonly core: Pick<RentalCoreService, 'readOpeningConfiguration'>,
    private readonly routes: Pick<AiBusinessReadRouteAuthority, 'withRead'>) {
    if (typeof core?.readOpeningConfiguration !== 'function' || typeof routes?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async current(expected: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>) {
    if (expected?.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(expected);
    return this.routes.withRead('opening', { limit: 50 }, async context => {
      if (context.scope.kind !== 'workspace' || context.scope.tenantId !== scope.tenantId || context.scope.workspaceId !== scope.workspaceId)
        throw new ModelGatewayError('FORBIDDEN');
      const result = await this.core.readOpeningConfiguration(scope.tenantId);
      if (result.tenantId !== scope.tenantId || result.workspaceId !== scope.workspaceId) throw new ModelGatewayError('INVALID_RESPONSE');
      return result;
    });
  }
}
