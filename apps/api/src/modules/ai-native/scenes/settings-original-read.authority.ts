/** Request-local original notification receipt authority. Current Auth and the
 * original Core/creation readers authorize history after execution policies
 * expire; this does not grant preparation, approval, recovery or dispatch. */
import { AI_TASK_DRAFT_VERSION, type AiApprovedSettingsTaskCreationDraft } from '@rental-os/shared';
import { AiTaskCurrentIdentityAuthority } from '../task-current-identity.authority';
import { aiTaskAccessFromContext, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from '../ai-task.repository';
import { originalIdentityHash } from '../task-request/original-request.authority';
import { settingsContract } from '../approval-execution/approved-settings-contracts';
import type { ApprovedSettingsApplicationDependencies } from '../approval-execution/approved-settings-task.authority';

export async function bindOriginalSettingsRead(d: ApprovedSettingsApplicationDependencies,
  original: AiApprovedSettingsTaskCreationDraft, readCreation: (value: AiApprovedSettingsTaskCreationDraft) => Promise<unknown>) {
  const clock = d.clock ?? (() => new Date()), identity = new AiTaskCurrentIdentityAuthority(d.auth, d.credentials, clock);
  const before = await identity.resolve(), initial = settingsContract('AiApprovedSettingsTaskCreationReadDraft', await readCreation(original), true);
  if (initial.receipt.state === 'unknown') throw Object.assign(new Error('AI_RESULT_UNKNOWN'), { code: 'AI_RESULT_UNKNOWN' });
  if (initial.receipt.state !== 'observed' || !initial.receipt.task) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const originalTask = initial.receipt.task;
  const authority: AiTaskRepositoryAuthority = { async resolve(taskId, operation) {
    if (taskId !== originalTask.taskId || !['read_metadata', 'read_events', 'read_step_terminal'].includes(operation))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const current = await identity.resolve(), receipt = settingsContract('AiApprovedSettingsTaskCreationReadDraft', await readCreation(original), true);
    if (receipt.receipt.state !== 'observed' || !receipt.receipt.task || receipt.receipt.task.taskId !== taskId
      || receipt.receipt.task.runId !== originalTask.runId || receipt.original.changeId !== initial.original.changeId
      || receipt.original.changeHash !== initial.original.changeHash) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const access = aiTaskAccessFromContext(current, taskId, clock());
    const task = await d.db.aiTask.findFirst({ where: access.where, include: { scope: true } });
    if (!task || current.actor.kind !== 'user' || current.audience !== 'operator' || current.scope.kind !== 'workspace'
      || task.id !== taskId || task.ownerKind !== 'USER' || task.ownerId !== current.actor.userId || task.audience !== 'OPERATOR'
      || task.archivedAt !== null || task.contractVersion !== AI_TASK_DRAFT_VERSION || task.sceneCode !== d.scene.code
      || task.sceneVersion !== d.scene.version || task.inputRef !== initial.original.changeId || task.inputRevision !== 1
      || task.inputHash !== initial.original.changeHash || !task.scope
      || Object.entries(access.scope).some(([name, value]) => task.scope[name as keyof typeof task.scope] !== value))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const after = await identity.resolve();
    if (originalIdentityHash(current) !== originalIdentityHash(after) || originalIdentityHash(before) !== originalIdentityHash(after))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return after;
  } };
  const verify = () => authority.resolve(originalTask.taskId, 'read_metadata');
  await verify();
  return { original: initial.original, task: { taskId: originalTask.taskId, runId: originalTask.runId }, authority, verify };
}
