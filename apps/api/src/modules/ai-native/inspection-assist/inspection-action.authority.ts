import { hasEffectivePermission } from '../../../common/permission-match';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { AiInspectionActorScope, AiInspectionTarget } from '@rental-os/shared';
import { InspectionAssistError } from './inspection-assist.validation';
import type { Prisma } from '@prisma/client';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';

export class InspectionActionAuthority {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>, private readonly credentials: AiOrderRouteCredentialSource) {}

  async withAction<T>(target: AiInspectionTarget, action: 'read' | 'write' | 'bind' | 'submit',
    execute: (scope: AiInspectionActorScope) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(target);
    const authority = new AiOrderRouteContextAuthority(this.guard, this.credentials, snapshot.orderId);
    const result = await authority.withOrderRead(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
        || !['staff', 'operator'].includes(context.audience) || !('access' in context)) throw new InspectionAssistError('ACCESS_DENIED');
      this.assertPermission(snapshot, action, context.access.permissions);
      if (context.audience !== 'staff' && context.audience !== 'operator') throw new InspectionAssistError('ACCESS_DENIED');
      try {
        return { ok: true as const, value: await execute({ tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
          ownerId: context.actor.userId, audience: context.audience }) };
      } catch (error) { return { ok: false as const, error }; }
    }).catch(() => { throw new InspectionAssistError('ACCESS_DENIED'); });
    if (!result.ok) throw result.error;
    return result.value;
  }

  /** Original Auth holds its Tenant/session/role locks in this transaction. Match
   * the current projection without replacing the Guard store or broadening it. */
  async assertTransactionScope(target: AiInspectionTarget, scope: AiInspectionActorScope, user: SystemUserRow, tx: Prisma.TransactionClient) {
    const identity = getRequestIdentity();
    if (!identity || identity.tenantId !== scope.tenantId || identity.workspaceId !== scope.workspaceId
      || identity.userId !== scope.ownerId || identity.audience !== scope.audience || identity.isSaasAdmin !== false
      || !identity.dataScope || !identity.locationScope || !Array.isArray(identity.permissions)
      || user.id !== scope.ownerId || user.tenantId !== scope.tenantId || !user.isActive || user.mustChangePassword || user.isSaasAdmin) {
      throw new InspectionAssistError('ACCESS_DENIED');
    }
    const locationScope = await resolveUserBusinessLocationScope(user, scope.workspaceId,
      user.locationScope ?? identity.locationScope, tx);
    const projection = (permissions: readonly string[], isPlatformAdmin: boolean | undefined, dataScope: unknown,
      organizationId: string | undefined, locations: typeof locationScope) => ({ permissions: [...permissions].sort(),
      isPlatformAdmin: Boolean(isPlatformAdmin), dataScope, organizationId,
      locationScope: { mode: locations.mode, locationIds: [...locations.locationIds].sort() } });
    if (requestFingerprint(projection(user.permissions, user.isPlatformAdmin, user.dataScope, user.organizationId, locationScope))
      !== requestFingerprint(projection(identity.permissions, identity.isPlatformAdmin, identity.dataScope, identity.organizationId, identity.locationScope))) {
      throw new InspectionAssistError('ACCESS_DENIED');
    }
    this.assertPermission(target, 'bind', user.permissions);
  }

  private assertPermission(target: AiInspectionTarget, action: 'read' | 'write' | 'bind' | 'submit', permissions: readonly string[]) {
    const stagePermission = `rental-os:order:${target.stage}`;
    if (action !== 'read' && !hasEffectivePermission(permissions, '*') && !hasEffectivePermission(permissions, stagePermission)
      && (action === 'bind' || !hasEffectivePermission(permissions, 'rental-os:order:operate'))) throw new InspectionAssistError('ACCESS_DENIED');
  }
}
