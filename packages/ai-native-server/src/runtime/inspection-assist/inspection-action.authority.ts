import { hasEffectivePermission } from '@rental-os/platform-server/permission-match';
import type { ApiAuthGuard } from '../rental-adapters/api-auth.guard';
import { AiOrderRouteContextAuthority, type AiOrderRouteCredentialSource } from '../order-route-context.authority';
import type { AiInspectionActorScope, AiInspectionTarget } from '@rental-os/shared';
import { InspectionAssistError } from './inspection-assist.validation';
import type { Prisma } from '@prisma/client';
import type { SystemUserRow } from '@rental-os/platform-contracts';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { resolveUserBusinessLocationScope } from '@rental-os/rental-core/business-location-scope';
import { AsyncLocalStorage } from 'node:async_hooks';
import { assertRentalBusinessTenantAccessAfterLock } from '@rental-os/rental-core/mysql-business-fence';
import type { InspectionEvidenceTransactionPorts } from './prisma-inspection-evidence.authority';
import type { InspectionTemplateService } from './inspection-template.service';
import type { InspectionDraftTransactionAuthority } from './prisma-inspection-draft.repository';

type Action = 'read' | 'write' | 'bind' | 'submit';
type CurrentAction = { active: boolean; target: AiInspectionTarget; action: Action; scope: AiInspectionActorScope };

export class InspectionActionAuthority {
  private readonly currentActions = new AsyncLocalStorage<CurrentAction>();
  constructor(private readonly guard: Pick<ApiAuthGuard, 'canActivate'>, private readonly credentials: AiOrderRouteCredentialSource) {}

  async withAction<T>(target: AiInspectionTarget, action: Action,
    execute: (scope: AiInspectionActorScope) => Promise<T>): Promise<T> {
    const snapshot = structuredClone(target);
    const authority = new AiOrderRouteContextAuthority(this.guard, this.credentials, snapshot.orderId);
    const result = await authority.withOrderRead(async context => {
      if (context.scope.kind !== 'workspace' || context.actor.kind !== 'user'
        || !['staff', 'operator'].includes(context.audience) || !('access' in context)) throw new InspectionAssistError('ACCESS_DENIED');
      this.assertPermission(snapshot, action, context.access.permissions);
      if (context.audience !== 'staff' && context.audience !== 'operator') throw new InspectionAssistError('ACCESS_DENIED');
      try {
        const scope: AiInspectionActorScope = { tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId,
          ownerId: context.actor.userId, audience: context.audience };
        const current: CurrentAction = { active: true, target: snapshot, action, scope };
        return { ok: true as const, value: await this.currentActions.run(current, async () => {
          try { return await execute(structuredClone(scope)); }
          finally { current.active = false; }
        }) };
      } catch (error) { return { ok: false as const, error }; }
    }).catch(() => { throw new InspectionAssistError('ACCESS_DENIED'); });
    if (!result.ok) throw result.error;
    return result.value;
  }

  /** Original Auth holds its Tenant/session/role locks in this transaction. Match
   * the current projection without replacing the Guard store or broadening it. */
  async assertTransactionScope(target: AiInspectionTarget, scope: AiInspectionActorScope, user: SystemUserRow, tx: Prisma.TransactionClient,
    action: Action = 'bind') {
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
    this.assertPermission(target, action, user.permissions);
  }

  /** Only a live original withAction callback may begin this lease. All parent,
   * current Auth, Order and draft locks stay in the repository's transaction. */
  draftTransactions(ports: InspectionEvidenceTransactionPorts, templates: InspectionTemplateService): InspectionDraftTransactionAuthority {
    return { begin: async (tx, scope) => {
      if (typeof ports?.auth?.lockRequestWorkspaceAccess !== 'function' || typeof ports.orders?.lockOrder !== 'function'
        || typeof ports.orders.findOrder !== 'function' || typeof tx?.$queryRaw !== 'function') {
        throw new InspectionAssistError('STORAGE_UNAVAILABLE');
      }
      const current = this.currentActions.getStore();
      const active = () => {
        if (!current?.active || this.currentActions.getStore() !== current || current.action === 'read'
          || requestFingerprint(current.scope) !== requestFingerprint(scope) || '$transaction' in tx) {
          throw new InspectionAssistError('ACCESS_DENIED');
        }
      };
      active();
      const authorize = async (readUser: () => Promise<SystemUserRow>) => {
        try {
          const user = await readUser();
          await assertRentalBusinessTenantAccessAfterLock(tx, scope.tenantId);
          active();
          await this.assertTransactionScope(current!.target, scope, user, tx, current!.action);
          return user;
        } catch { throw new InspectionAssistError('ACCESS_DENIED'); }
      };
      const lease = await ports.auth.lockRequestWorkspaceAccess(tx).catch(() => { throw new InspectionAssistError('ACCESS_DENIED'); });
      await authorize(async () => lease.user);
      let locked = false;
      return {
        lockTarget: async (target, bindingFingerprint, mode) => {
          active();
          if (locked || requestFingerprint(target) !== requestFingerprint(current!.target)) throw new InspectionAssistError('BINDING_CHANGED');
          await ports.orders.lockOrder(scope.tenantId, target.orderId, tx);
          if (mode === 'mutation') {
            const binding = await templates.readInTransaction(target, tx);
            if (binding.bindingFingerprint !== bindingFingerprint || binding.owner.actorId !== scope.ownerId
              || binding.scope.tenantId !== scope.tenantId || binding.scope.workspaceId !== scope.workspaceId
              || binding.audience !== scope.audience) throw new InspectionAssistError('BINDING_CHANGED');
          } else {
            // A committed return can already have released the allocation. Do
            // not demand today's editable template to link its ORIGINAL receipt.
            const order = await ports.orders.findOrder(scope.tenantId, target.orderId, tx);
            const locations = getRequestIdentity()?.locationScope;
            const location = target.stage === 'pickup' ? order?.fulfillmentLocationId
              : order?.returnLocationId ?? order?.fulfillmentLocationId;
            if (current!.action !== 'submit' || !order || order.id !== target.orderId || order.tenantId !== scope.tenantId
              || !locations || !location || locations.mode === 'selected' && !locations.locationIds.includes(location)) {
              throw new InspectionAssistError('ACCESS_DENIED');
            }
          }
          active();
          locked = true;
        },
        revalidate: async () => {
          if (!locked) throw new InspectionAssistError('ACCESS_DENIED');
          await authorize(() => lease.revalidate());
        }
      };
    } };
  }

  private assertPermission(target: AiInspectionTarget, action: Action, permissions: readonly string[]) {
    const stagePermission = `rental-os:order:${target.stage}`;
    if (action !== 'read' && !hasEffectivePermission(permissions, '*') && !hasEffectivePermission(permissions, stagePermission)
      && (action === 'bind' || !hasEffectivePermission(permissions, 'rental-os:order:operate'))) throw new InspectionAssistError('ACCESS_DENIED');
  }
}
