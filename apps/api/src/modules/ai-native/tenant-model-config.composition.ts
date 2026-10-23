import type { PrismaClient } from '@prisma/client';
import type { SecretBox } from '../../common/secret-box';
import { ModelGatewayError } from './model-gateway.ports';
import { PrismaTenantModelProfileRepository } from './tenant-model-profile.repository';
import { TenantModelConfigService, type TenantModelConfigPorts } from './tenant-model-config.service';
import type { AiScopeRepository } from './ai-scope.repository';
import { TenantModelConnectionResolver, type GatewayConnectionResolver } from './routed-model-transport';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import { gatewayBudgetPrincipal } from './budget/gateway-budget-principal';
import type { ModelConfigurationOperationDb } from './model-configuration-operation';

/** Explicit server composition only. No AppModule registration, credential default
 * or actor inferred from caller-supplied tenant/workspace IDs. The authority must
 * be bound to current server authentication and action permission checks.
 */
export function createPersistedTenantModelConfiguration(input: {
  db: Pick<PrismaClient, '$transaction' | 'aiTenantModelConfiguration' | 'systemParameterSet' | 'aiScope' | 'aiProviderProfile'> & ModelConfigurationOperationDb;
  authorize: TenantModelConfigPorts['authorize'];
  secrets: SecretBox;
}): TenantModelConfigService {
  if (!input || typeof input.authorize !== 'function' || typeof input.secrets?.encrypt !== 'function'
    || typeof input.secrets?.decrypt !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  return new TenantModelConfigService({ authorize: input.authorize,
    repository: new PrismaTenantModelProfileRepository(input.db, input.authorize) }, input.secrets);
}

/** Adds canonical scope ownership to the EXISTING encrypted BYOK resolver.
 * Sequential revocation checks are not an atomic dispatch grant.
 */
export function createScopeBoundTenantModelConnection(configuration: TenantModelConfigService,
  scopes: Pick<AiScopeRepository, 'resolveRoutingScopes'>): GatewayConnectionResolver {
  if (typeof scopes?.resolveRoutingScopes !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const resolver = new TenantModelConnectionResolver(configuration);
  const assertScope = async (value: import('./model-gateway.ports').GatewayContext, selected: import('./provider-profile.ports').AiProviderProfileRecord) => {
    const context = structuredClone(value), profile = structuredClone(selected);
    const resolved = structuredClone(await scopes.resolveRoutingScopes('tenant_managed'));
    let principal: ReturnType<typeof gatewayBudgetPrincipal>;
    try { principal = gatewayBudgetPrincipal(resolved.context); } catch { throw new ModelGatewayError('FORBIDDEN'); }
    if (principal.actorId !== context.actorId || principal.tenantId !== context.tenantId || principal.workspaceId !== context.workspaceId
      || resolved.configurationScope.kind !== 'TENANT' || resolved.configurationScope.id !== profile.scopeId
      || resolved.configurationScope.tenantId !== context.tenantId) throw new ModelGatewayError('FORBIDDEN');
    const { authorizedAt: _, requestId: __, ...identity } = resolved.context;
    return requestFingerprint({ identity, owner: resolved.configurationScope });
  };
  return { async assertCurrent(value, selected) {
    const context = structuredClone(value), profile = structuredClone(selected);
    const before = await assertScope(context, profile);
    await resolver.assertCurrent(context, profile);
    if (await assertScope(context, profile) !== before) throw new ModelGatewayError('FORBIDDEN');
  }, async resolve(value, selected) {
    const context = structuredClone(value), profile = structuredClone(selected);
    if (!profile?.enabled || profile.disabledAt) throw new ModelGatewayError('CONFIG_INVALID');
    const current = () => assertScope(context, profile);
    const before = await current(), connection = await resolver.resolve(context, profile);
    if (await current() !== before) throw new ModelGatewayError('FORBIDDEN');
    // Canonical scope resolution is asynchronous; a mode/key change during it
    // must not publish the credential obtained before that final check.
    const latest = await configuration.selectionForInvocation(context);
    if (latest.mode !== 'tenant_managed' || latest.revision !== profile.configRevision) throw new ModelGatewayError('CONFIG_INVALID');
    return connection;
  } };
}
