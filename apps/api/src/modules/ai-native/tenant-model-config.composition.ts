import type { PrismaClient } from '@prisma/client';
import type { SecretBox } from '../../common/secret-box';
import { ModelGatewayError } from './model-gateway.ports';
import { PrismaTenantModelConfigRepository } from './tenant-model-config.repository';
import { TenantModelConfigService, type TenantModelConfigPorts } from './tenant-model-config.service';
import type { AiScopeRepository } from './ai-scope.repository';
import { TenantModelConnectionResolver, type GatewayConnectionResolver } from './routed-model-transport';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

/** Explicit server composition only. No AppModule registration, credential default
 * or actor inferred from caller-supplied tenant/workspace IDs. The authority must
 * be bound to current server authentication and action permission checks.
 */
export function createPersistedTenantModelConfiguration(input: {
  db: Pick<PrismaClient, 'aiTenantModelConfiguration' | 'systemParameterSet'>;
  authorize: TenantModelConfigPorts['authorize'];
  secrets: SecretBox;
}): TenantModelConfigService {
  if (!input || typeof input.authorize !== 'function' || typeof input.secrets?.encrypt !== 'function'
    || typeof input.secrets?.decrypt !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  return new TenantModelConfigService({ authorize: input.authorize,
    repository: new PrismaTenantModelConfigRepository(input.db) }, input.secrets);
}

/** Adds canonical scope ownership to the EXISTING encrypted BYOK resolver.
 * Sequential revocation checks are not an atomic dispatch grant.
 */
export function createScopeBoundTenantModelConnection(configuration: TenantModelConfigService,
  scopes: Pick<AiScopeRepository, 'resolveRoutingScopes'>): GatewayConnectionResolver {
  if (typeof scopes?.resolveRoutingScopes !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  const resolver = new TenantModelConnectionResolver(configuration);
  return { async resolve(value, selected) {
    const context = structuredClone(value), profile = structuredClone(selected);
    if (!profile?.enabled || profile.disabledAt) throw new ModelGatewayError('CONFIG_INVALID');
    const current = async () => {
      const resolved = structuredClone(await scopes.resolveRoutingScopes('tenant_managed'));
      const actor = resolved.context.actor, scope = resolved.context.scope;
      if (actor.kind !== 'user' || actor.userId !== context.actorId || scope.kind !== 'workspace'
        || scope.tenantId !== context.tenantId || scope.workspaceId !== context.workspaceId
        || resolved.configurationScope.kind !== 'TENANT' || resolved.configurationScope.id !== profile.scopeId
        || resolved.configurationScope.tenantId !== context.tenantId) throw new ModelGatewayError('FORBIDDEN');
      const { authorizedAt: _, requestId: __, ...identity } = resolved.context;
      return requestFingerprint({ identity, owner: resolved.configurationScope });
    };
    const before = await current(), connection = await resolver.resolve(context, profile);
    if (await current() !== before) throw new ModelGatewayError('FORBIDDEN');
    return connection;
  } };
}
