import type { AiExecutionContext } from '@rental-os/shared';
import type { RentalCoreService } from '../../rental-core/rental-core.service';
import type { AiBusinessReadRouteAuthority } from '../business-read-route.authority';
import { ModelGatewayError } from '../model-gateway.ports';
import { readAiDiagnosticSource } from './diagnostic-read-facts.service';
import { assertAiReadContextBinding } from './read-context-binding';

/** Internal bounded opening source, not a quote context or write authority.
 * Every persisted projection runs under its original Guard/ALS. An enclosing
 * server-resolved principal is checked before Core access, not replaced by an
 * equal workspace or by the nested Guard's own before/after identity check. */
export interface AiOpeningConfigurationSource {
  current(scope: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>,
    expectedContext?: AiExecutionContext): ReturnType<RentalCoreService['readOpeningConfiguration']>;
}
export class AiGuardedOpeningConfigurationSource implements AiOpeningConfigurationSource {
  constructor(private readonly core: Pick<RentalCoreService, 'readOpeningConfiguration'>,
    private readonly routes: Pick<AiBusinessReadRouteAuthority, 'withRead'>) {
    if (typeof core?.readOpeningConfiguration !== 'function' || typeof routes?.withRead !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async current(expected: Extract<AiExecutionContext['scope'], { kind: 'workspace' }>, expectedContext?: AiExecutionContext) {
    if (expected?.kind !== 'workspace') throw new ModelGatewayError('FORBIDDEN');
    const scope = structuredClone(expected);
    const principal = expectedContext && structuredClone(expectedContext);
    return this.routes.withRead('opening', { limit: 50 }, async context => {
      assertAiReadContextBinding(context, principal);
      if (context.scope.kind !== 'workspace' || context.scope.tenantId !== scope.tenantId || context.scope.workspaceId !== scope.workspaceId)
        throw new ModelGatewayError('FORBIDDEN');
      const result = await readAiDiagnosticSource(() => this.core.readOpeningConfiguration(scope.tenantId));
      if (result.tenantId !== scope.tenantId || result.workspaceId !== scope.workspaceId) throw new ModelGatewayError('INVALID_RESPONSE');
      return result;
    });
  }
}
