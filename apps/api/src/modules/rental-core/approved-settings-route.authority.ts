import { ForbiddenException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from './rental-idempotency.repository';

export interface ApprovedSettingsCredentials {
  current(): Promise<{ authorization: string; audience: 'operator' | 'staff'; requestId: string }>;
}
export interface ApprovedSettingsActor {
  tenantId: string;
  workspaceId: string;
  actorId: string;
}

export class ApprovedSettingsRouteAuthority {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>, private readonly credentials: ApprovedSettingsCredentials) {
    if (typeof guard?.canActivate !== 'function' || typeof credentials?.current !== 'function') throw new ForbiddenException();
  }

  async withAuthorization<T>(mode: 'read' | 'write', work: (actor: ApprovedSettingsActor, revalidate: () => Promise<void>) => Promise<T>): Promise<T> {
    const credential = structuredClone(await this.credentials.current());
    if (!credential || !['operator', 'staff'].includes(credential.audience) ||
        typeof credential.authorization !== 'string' || !/^Bearer \S+$/u.test(credential.authorization) || credential.authorization.length > 8192 ||
        typeof credential.requestId !== 'string' || !credential.requestId) throw new ForbiddenException();
    const authorize = async <R>(consume: (actor: ApprovedSettingsActor, fingerprint: string) => Promise<R>) => {
      if (requestFingerprint(await this.credentials.current()) !== requestFingerprint(credential)) throw new ForbiddenException();
      return runWithRequestIdentity({}, async () => {
        const staff = credential.audience === 'staff';
        const request: { url: string; originalUrl: string; method: string; headers: object; query: object; body: object; staffApiRequest: boolean;
          user?: { id: string; tenantId: string; isActive: boolean; isSaasAdmin?: boolean; permissions?: string[] } } = {
          url: '/api/rental/v1/business-settings', originalUrl: `/api/${staff ? 'staff' : 'rental'}/v1/business-settings`,
          method: mode === 'write' ? 'PUT' : 'GET', headers: { authorization: credential.authorization }, query: {}, body: {}, staffApiRequest: staff
        };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new ForbiddenException();
        const user = request.user, identity = getRequestIdentity();
        if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || !identity.workspaceId ||
            identity.userId !== user.id || identity.tenantId !== user.tenantId || identity.staffApi !== staff) throw new ForbiddenException();
        return consume({ tenantId: user.tenantId, workspaceId: identity.workspaceId, actorId: user.id },
          requestFingerprint({ identity, permissions: user.permissions, audience: credential.audience }));
      });
    };
    return authorize(async (actor, fingerprint) => {
      const revalidate = () => authorize(async (_current, currentFingerprint) => {
        if (currentFingerprint !== fingerprint) throw new ForbiddenException();
      });
      const result = await work(actor, revalidate);
      if (mode === 'read') await revalidate();
      return result;
    });
  }
}
