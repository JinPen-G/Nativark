/** Ordinary personal-profile authorization through the original membership
 * Guard/ALS routes. No order-create grant, caller actor, settings authority or
 * client self-service token can authorize an operator profile change. */
import { ForbiddenException } from '@nestjs/common';
import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import type { ApiAuthGuard } from '../../common/api-auth.guard';
import { getRequestIdentity, runWithRequestIdentity } from '../../common/request-identity';
import { requestFingerprint } from '../rental-core/rental-idempotency.repository';

export interface ApprovedProfileCredentials {
  current(): Promise<{ authorization: string; audience: 'operator' | 'staff'; requestId: string }>;
}
export interface ApprovedProfileActor {
  tenantId: string;
  workspaceId: string;
  actorId: string;
}

export class ApprovedProfileRouteAuthority {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>,
    private readonly credentials: ApprovedProfileCredentials) {
    if (typeof guard?.canActivate !== 'function' || typeof credentials?.current !== 'function') throw new ForbiddenException();
  }

  async withAuthorization<T>(mode: 'read' | 'write', customerId: string,
    work: (actor: ApprovedProfileActor, revalidate: () => Promise<void>) => Promise<T>): Promise<T> {
    if (!['read', 'write'].includes(mode) || typeof customerId !== 'string'
      || !/^[A-Za-z0-9._:-]{1,191}$/u.test(customerId)) throw new ForbiddenException();
    return this.withRoute(mode, customerId, work);
  }

  /** Original tenant-member list read, before a person has selected a target.
   * Uses the same personal-member Guard; no fabricated customer/order grant. */
  withListRead<T>(work: (actor: ApprovedProfileActor, revalidate: () => Promise<void>) => Promise<T>): Promise<T> {
    return this.withRoute('read', undefined, work);
  }

  private async withRoute<T>(mode: 'read' | 'write', customerId: string | undefined,
    work: (actor: ApprovedProfileActor, revalidate: () => Promise<void>) => Promise<T>): Promise<T> {
    if (typeof work !== 'function') throw new ForbiddenException();
    const credential = structuredClone(await this.credentials.current());
    // The staff facade has its own registered projection. Do not manufacture a
    // staff route or treat an operator membership URL as a staff authorization.
    if (!credential || credential.audience !== 'operator' || typeof credential.authorization !== 'string'
      || !/^Bearer \S+$/u.test(credential.authorization) || credential.authorization.length > 8192
      || typeof credential.requestId !== 'string' || !credential.requestId) throw new ForbiddenException();
    const authorize = async <R>(consume: (actor: ApprovedProfileActor, fingerprint: string) => Promise<R>) => {
      if (requestFingerprint(await this.credentials.current()) !== requestFingerprint(credential)) throw new ForbiddenException();
      return runWithRequestIdentity({}, async () => {
        const url = mode === 'read' ? '/api/membership/personal' : `/api/membership/personal/${encodeURIComponent(customerId!)}`;
        const request: { url: string; originalUrl: string; method: string; headers: object; query: object; body: object;
          user?: { id: string; tenantId: string; isActive: boolean; isSaasAdmin?: boolean; permissions?: string[] } } = {
          url, originalUrl: url, method: mode === 'read' ? 'GET' : 'PUT',
          headers: { authorization: credential.authorization }, query: {}, body: {}
        };
        if (await this.guard.canActivate(new ExecutionContextHost([request])) !== true) throw new ForbiddenException();
        const user = request.user, identity = getRequestIdentity();
        if (!user?.isActive || user.isSaasAdmin || !identity || identity.isSaasAdmin || identity.staffApi
          || !identity.workspaceId || identity.userId !== user.id || identity.tenantId !== user.tenantId) throw new ForbiddenException();
        return consume({ tenantId: user.tenantId, workspaceId: identity.workspaceId, actorId: user.id },
          requestFingerprint({ identity, permissions: user.permissions, audience: credential.audience }));
      });
    };
    return authorize(async (actor, fingerprint) => {
      const revalidate = () => authorize(async (_actor, current) => {
        if (current !== fingerprint) throw new ForbiddenException();
      });
      const result = await work(actor, revalidate);
      if (mode === 'read') await revalidate();
      return result;
    });
  }
}
