import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { AI_CONTRACT_DRAFT_VERSION, type AiExecutionContext } from '@rental-os/shared';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';
import type { AiOrderRouteCredentialSource } from './order-route-context.authority';
import { isAiStepExecutionContext } from './task-contract-validation';
import { ModelGatewayError } from './model-gateway.ports';

export type AiBusinessReadKind = 'catalog' | 'availability' | 'membership_candidates';
export interface AiBusinessReadAuthority {
  withRead<T>(kind: AiBusinessReadKind, input: unknown, read: (context: AiExecutionContext) => Promise<T>): Promise<T>;
}
const routes = {
  catalog: { method: 'GET', path: '/rental/v1/item-groups' },
  availability: { method: 'POST', path: '/rental/v1/availability' },
  membership_candidates: { method: 'GET', path: '/rental/v1/booking-members' }
} as const;

/** Closed route bridge. The actual business read runs inside the Guard's ALS
 * identity; a context returned by resolve() alone cannot establish that store.
 * Sequential revalidation is not an atomic authorization transaction.
 */
export class AiBusinessReadRouteAuthority implements AiBusinessReadAuthority {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: AiOrderRouteCredentialSource,
    private readonly clock: () => Date = () => new Date()) {
    if (typeof guard?.canActivate !== 'function' || typeof credentials?.current !== 'function') throw new ModelGatewayError('CONFIG_INVALID');
  }

  async withRead<T>(kind: AiBusinessReadKind, input: unknown, read: (context: AiExecutionContext) => Promise<T>): Promise<T> {
    if (!['catalog', 'availability', 'membership_candidates'].includes(kind) || typeof read !== 'function') throw new ModelGatewayError('INVALID_REQUEST');
    const body = structuredClone(input);
    const route = routes[kind];
    const authorize = async <R>(consume: (context: AiExecutionContext) => Promise<R>): Promise<R> => {
      const credential = structuredClone(await this.credentials.current());
      if (!credential || !['operator', 'staff'].includes(credential.audience)
        || typeof credential.authorization !== 'string' || credential.authorization.length > 8192
        || typeof credential.requestId !== 'string') throw new ModelGatewayError('FORBIDDEN');
      return runWithRequestIdentity({}, async () => {
        const staff = credential.audience === 'staff';
        const request: { url: string; originalUrl: string; method: string; headers: object; query: object; body: unknown; staffApiRequest: boolean; user?: { id: string; tenantId: string; isActive: boolean; isSaasAdmin?: boolean; permissions?: string[] } } = {
          url: `/api${route.path}`, originalUrl: `/api${staff ? route.path.replace('/rental/v1/', '/staff/v1/') : route.path}`,
          method: route.method, headers: { authorization: credential.authorization }, query: {}, body: structuredClone(body), staffApiRequest: staff
        };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new ModelGatewayError('FORBIDDEN');
        const user = request.user, identity = getRequestIdentity(), now = this.clock();
        if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || !identity.workspaceId
          || identity.userId !== user.id || identity.tenantId !== user.tenantId || identity.staffApi !== staff
          || !(now instanceof Date) || !Number.isFinite(now.getTime())) throw new ModelGatewayError('FORBIDDEN');
        const context = {
          contractVersion: AI_CONTRACT_DRAFT_VERSION, requestId: credential.requestId, authorizedAt: now.toISOString(),
          audience: credential.audience, actor: { kind: 'user', userId: user.id },
          scope: { kind: 'workspace', tenantId: identity.tenantId, workspaceId: identity.workspaceId },
          access: { permissions: user.permissions, dataScope: identity.dataScope, locationScope: identity.locationScope,
            ...(identity.organizationId ? { organizationId: identity.organizationId } : {}) }
        };
        if (!isAiStepExecutionContext(context)) throw new ModelGatewayError('FORBIDDEN');
        return consume(structuredClone(context));
      });
    };
    const binding = (context: AiExecutionContext) => {
      const { requestId: _request, authorizedAt: _time, ...identity } = context;
      return requestFingerprint(identity);
    };
    try {
      return await authorize(async context => {
        const before = binding(context);
        const result = await read(context);
        await authorize(async current => { if (binding(current) !== before) throw new ModelGatewayError('FORBIDDEN'); });
        return result;
      });
    } catch (error) {
      if (error instanceof ModelGatewayError) throw error;
      throw new ModelGatewayError('FORBIDDEN');
    }
  }
}
