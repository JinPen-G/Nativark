/** Current member Guard plus the original change/creation receipt for history.
 * Does not renew Task policies or permit approval, recovery or execution. The
 * current owner, workspace, immutable change and canonical Run remain binding. */
import { AI_TASK_DRAFT_VERSION } from '@rental-os/shared';
import { ApprovedProfileRouteAuthority } from '../../platform/approved-profile-route.authority';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';
import { composeProfileTaskCreation } from '../approval-execution/profile-task-creation.composition';
import { profileDenied, type ApprovedProfileApplicationDependencies } from '../approval-execution/approved-profile-task.authority';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { aiTaskAccessFromContext, type AiTaskRepositoryAuthority } from '../ai-task.repository';

export function composeOriginalProfileReadAuthority(d: ApprovedProfileApplicationDependencies): AiTaskRepositoryAuthority {
  const clock = d.clock ?? (() => new Date()), identity = new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, clock);
  const route = new ApprovedProfileRouteAuthority(d.guard, d.credentials), creation = composeProfileTaskCreation(d);
  const principal = (value: Awaited<ReturnType<typeof identity.resolve>>) => {
    const { requestId: _request, authorizedAt: _time, ...current } = value;
    return requestFingerprint(current);
  };
  return { async resolve(taskId, operation) {
    if (!['read_metadata', 'read_events', 'read_step_terminal'].includes(operation)) throw profileDenied();
    const current = await identity.resolve(), access = aiTaskAccessFromContext(current, taskId, clock());
    const readTask = () => d.db.aiTask.findFirst({ where: access.where, include: { scope: true } });
    const task = await readTask();
    if (!task || current.actor.kind !== 'user' || current.audience !== 'operator' || current.scope.kind !== 'workspace'
      || task.id !== taskId || task.ownerKind !== 'USER' || task.ownerId !== current.actor.userId || task.audience !== 'OPERATOR'
      || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.sceneCode !== d.scene.code || task.sceneVersion !== d.scene.version
      || task.archivedAt !== null || !task.inputRef || !task.inputHash || task.inputRevision !== 1 || !task.scope
      || Object.entries(access.scope).some(([name, value]) => task.scope[name as keyof typeof task.scope] !== value)) throw profileDenied();
    const change = await d.db.customerApprovedProfileChange.findUnique({ where: { id: task.inputRef } });
    if (!change || change.id !== task.inputRef || change.tenantId !== current.scope.tenantId || change.workspaceId !== current.scope.workspaceId
      || change.actorId !== current.actor.userId || change.changeHash !== task.inputHash) throw profileDenied();
    const original = { customerId: change.customerId, changeId: change.id, changeHash: change.changeHash };
    return route.withAuthorization('read', original.customerId, async (actor, revalidate) => {
      if (current.actor.kind !== 'user' || current.scope.kind !== 'workspace' || actor.actorId !== current.actor.userId
        || actor.tenantId !== current.scope.tenantId || actor.workspaceId !== current.scope.workspaceId) throw profileDenied();
      const first = await creation.read(original);
      if (!('state' in first.receipt) || first.receipt.state !== 'observed' || !('task' in first.receipt) || !first.receipt.task
        || first.receipt.task.taskId !== taskId || task.creationKey !== `profile-create-${change.id}`) throw profileDenied();
      await revalidate();
      const after = await identity.resolve(), latest = await readTask(), receipt = await creation.read(original);
      if (principal(current) !== principal(after) || !latest || latest.inputRef !== task.inputRef || latest.inputHash !== task.inputHash
        || latest.ownerId !== task.ownerId || latest.archivedAt !== null || latest.scopeId !== task.scopeId
        || !('state' in receipt.receipt) || receipt.receipt.state !== 'observed' || !('task' in receipt.receipt) || !receipt.receipt.task
        || receipt.receipt.task.taskId !== taskId || receipt.receipt.task.runId !== first.receipt.task.runId
        || requestFingerprint(receipt.original) !== requestFingerprint(first.original)) throw profileDenied();
      await revalidate();
      if (principal(await identity.resolve()) !== principal(after)) throw profileDenied();
      return after;
    });
  } };
}
