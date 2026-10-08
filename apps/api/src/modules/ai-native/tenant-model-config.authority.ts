import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { z } from 'zod';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import type { AiCurrentScopeAuthority } from './ai-scope.repository';
import type { AiOrderRouteCredentialSource } from './order-route-context.authority';
import { ModelGatewayError, type GatewayContext } from './model-gateway.ports';
import { isAiStepExecutionContext } from './task-contract-validation';

const contextSchema = z.object({ tenantId: z.string().min(1).max(128), workspaceId: z.string().min(1).max(128), actorId: z.string().min(1).max(128) }).strict();
const credentialSchema = z.object({ authorization: z.string().min(1).max(8192), requestId: z.string().min(1).max(191), audience: z.enum(['operator', 'staff']) }).strict();
const userSchema = z.object({ id: z.string(), tenantId: z.string(), isActive: z.literal(true), isSaasAdmin: z.boolean().optional() });

/** Reuses the real system-rules Guard for config read/manage. Invocation identity
 * comes from a server-bound current authority (e.g. the existing order-read one).
 * This is NOT AI subscription/budget entitlement or model dispatch authorization.
 */
export class TenantModelConfigurationAuthority {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: AiOrderRouteCredentialSource,
    private readonly invocation: AiCurrentScopeAuthority) {
    if (typeof guard?.canActivate !== 'function' || typeof credentials?.current !== 'function'
      || typeof invocation?.resolve !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }
  async authorize(value: GatewayContext, action: 'read' | 'manage' | 'invoke'): Promise<void> {
    try {
      const expected = contextSchema.parse(value);
      if (action === 'invoke') {
        const current = structuredClone(await this.invocation.resolve());
        if (!isAiStepExecutionContext(current) || !['operator', 'staff'].includes(current.audience)
          || current.actor.kind !== 'user' || current.actor.userId !== expected.actorId || current.scope.kind !== 'workspace'
          || current.scope.tenantId !== expected.tenantId || current.scope.workspaceId !== expected.workspaceId) throw Error();
        return;
      }
      if (action !== 'read' && action !== 'manage') throw Error();
      const credential = credentialSchema.parse(structuredClone(await this.credentials.current()));
      if (credential.audience !== 'operator') throw Error();
      await runWithRequestIdentity({}, async () => {
        // These are existing permission-check paths, not new HTTP endpoints.
        const path = action === 'manage' ? '/api/platform/system-rules/aiModel' : '/api/platform/system-rules';
        const request = { url: path, originalUrl: path, method: action === 'manage' ? 'PUT' : 'GET',
          headers: { authorization: credential.authorization }, query: {}, user: undefined as unknown };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw Error();
        const user = userSchema.parse(request.user), identity = getRequestIdentity();
        if (!identity || identity.isSaasAdmin || user.isSaasAdmin || identity.staffApi
          || user.id !== expected.actorId || identity.userId !== user.id || identity.tenantId !== expected.tenantId
          || user.tenantId !== expected.tenantId || identity.workspaceId !== expected.workspaceId) throw Error();
      });
    } catch { throw new ModelGatewayError('FORBIDDEN'); }
  }
}
