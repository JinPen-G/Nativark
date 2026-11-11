import { hasEffectivePermission } from '../../../common/permission-match';
import type { ApiAuthGuard } from '../../../common/api-auth.guard';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { AiInspectionActorScope, AiInspectionTarget } from '@rental-os/shared';
import { InspectionAssistError } from './inspection-assist.validation';

export class InspectionActionAuthority {
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>, private readonly credentials: AiOrderRouteCredentialSource) {}

  async withAction<T>(target: AiInspectionTarget, action: 'read' | 'write' | 'bind' | 'submit',
    execute: (scope: AiInspectionActorScope) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(target);
    const authority = new AiOrderRouteContextAuthority(this.guard, this.credentials, snapshot.orderId);
    const result = await authority.withOrderRead(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
        || !['staff', 'operator'].includes(context.audience) || !('access' in context)) throw new InspectionAssistError('ACCESS_DENIED');
      const stagePermission = `rental-os:order:${snapshot.stage}`;
      const permissions = context.access.permissions;
      if (action !== 'read' && !hasEffectivePermission(permissions, '*') && !hasEffectivePermission(permissions, stagePermission)
        && (action === 'bind' || !hasEffectivePermission(permissions, 'rental-os:order:operate'))) throw new InspectionAssistError('ACCESS_DENIED');
      if (context.audience !== 'staff' && context.audience !== 'operator') throw new InspectionAssistError('ACCESS_DENIED');
      try {
        return { ok: true as const, value: await execute({ tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
          ownerId: context.actor.userId, audience: context.audience }) };
      } catch (error) { return { ok: false as const, error }; }
    }).catch(() => { throw new InspectionAssistError('ACCESS_DENIED'); });
    if (!result.ok) throw result.error;
    return result.value;
  }
}
