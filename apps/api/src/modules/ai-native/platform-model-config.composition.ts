import type { PrismaClient } from '@prisma/client';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import type { SecretBox } from '../../common/secret-box';
import { AiScopeRepository, type AiCurrentScopeAuthority } from './ai-scope.repository';
import type { AiOrderRouteCredentialSource } from './order-route-context.authority';
import { PlatformModelConfigurationAuthority } from './platform-model-config.authority';
import { PrismaPlatformModelConnection } from './platform-model-connection';
import { ModelGatewayError } from './model-gateway.ports';
import type { ModelConfigurationOperationDb } from './model-configuration-operation';

/** Request-scoped explicit composition, not a root module or background loop.
 * Management and invocation resolve different authenticated consumer contexts;
 * neither factory switches role from a caller-provided flag. */
export function createAuthorizedPlatformModelConfiguration(ports: {
  db: Pick<PrismaClient, '$transaction' | 'aiScope' | 'aiProviderProfile' | 'aiPlatformModelConnection'> & ModelConfigurationOperationDb;
  guard: Pick<ApiAuthGuard, 'canActivate'>;
  credentials: AiOrderRouteCredentialSource;
  invocation: AiCurrentScopeAuthority;
  profileId: string;
  secrets: SecretBox;
}) {
  if ([ports?.db?.$transaction, ports?.db?.aiScope?.findFirst, ports?.db?.aiProviderProfile?.findFirst,
    ports?.db?.aiProviderProfile?.updateMany, ports?.db?.aiPlatformModelConnection?.findUnique,
    ports?.db?.aiPlatformModelConnection?.create, ports?.db?.aiPlatformModelConnection?.update]
    .some(method => typeof method !== 'function')) throw new ModelGatewayError('CONFIG_INVALID');
  const authority = new PlatformModelConfigurationAuthority(ports.guard, ports.credentials, ports.profileId, ports.invocation);
  const observations = new AiScopeRepository(ports.db, { resolve: () => authority.resolveRead() });
  return {
    management: new PrismaPlatformModelConnection(ports.db, new AiScopeRepository(ports.db, authority), authority, ports.secrets, observations),
    invocation: new PrismaPlatformModelConnection(ports.db, new AiScopeRepository(ports.db, ports.invocation), authority, ports.secrets)
  };
}
