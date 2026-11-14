/** Erases original terminal Task bodies under the caller's canonical scope lock.
 * Maintenance requires the original expiry/restore proof; source propagation
 * derives Tasks only from hash-bound copies. Neither path grants execution,
 * changes counters/hashes, or erases business approval/accounting receipts. */
import type { Prisma } from '@prisma/client';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { fingerprint } from '../knowledge/knowledge-validation';
import { aiTaskHasUnresolvedEffects } from '../task-unresolved-effects';
import { projectAiTaskWireEvent } from '../ai-task-event.repository';
import { aiTaskConfirmationEventSchema } from '../runner/prisma-task-confirmation-history.reader';
import { aiTaskResumedConfirmationSchema } from '../runner/prisma-task-run-evidence.repository';
import { AI_RETENTION_POLICY } from './retention-policy';
import { inspectRetentionSource, retentionSourceCopies } from './retention-model-sources';

const businessTools = ['rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit'];
const terminal = ['SUCCEEDED', 'PARTIALLY_SUCCEEDED', 'FAILED', 'CANCELLED'] as const;
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
type Scope = { scopeId: string; owner: { tenantId: string; workspaceId: string } };
type TaskBodies = Scope & { taskId: string; now: Date; check(): Promise<void> };

async function eraseTaskBodies(tx: Prisma.TransactionClient, input: TaskBodies,
  ordinaryExpiry: boolean, expectedHash?: string) {
  const { scopeId, owner, taskId, now, check } = input;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw unavailable();
  const task = await tx.aiTask.findFirst({ where: { id: taskId, scopeId } });
  if (!task || !terminal.includes(task.status as typeof terminal[number])
    || !(task.createdAt instanceof Date) || !Number.isFinite(task.createdAt.getTime())) throw unavailable();
  if (await aiTaskHasUnresolvedEffects(tx, scopeId, taskId, owner)) throw unavailable();
  const key = fingerprint([AI_RETENTION_POLICY.version, owner.tenantId, owner.workspaceId, 'task', taskId]);
  const targetHash = fingerprint(['task', task.id, task.inputRef, task.inputHash, task.createdAt.toISOString()]);
  const receipt = await tx.aiDataErasure.findUnique({ where: { id: key } });
  if (expectedHash && expectedHash !== targetHash || receipt && (receipt.id !== key
    || receipt.tenantId !== owner.tenantId || receipt.workspaceId !== owner.workspaceId
    || receipt.kind !== 'task' || receipt.resourceId !== task.id || receipt.targetHash !== targetHash
    || receipt.policyVersion !== AI_RETENTION_POLICY.version)) throw denied();
  if (ordinaryExpiry && !expectedHash && receipt?.state !== 'erased'
    && task.updatedAt > new Date(now.getTime() - AI_RETENTION_POLICY.conversationDays * 86400000)) throw unavailable();

  // Source deletion may remove an immutable prompt/result before ordinary
  // expiry. Its business phase remains readable; it is never signed anew.
  const businessStep = await tx.aiStep.findFirst({ where: { taskId, scopeId,
    toolCode: { in: businessTools } }, select: { id: true } });
  const mark = { retention: 'erased', receiptId: key, policyVersion: AI_RETENTION_POLICY.version };
  await check();
  if (receipt?.state !== 'erased') {
    const changed = await tx.aiTask.updateMany({ where: { id: task.id, scopeId,
      revision: task.revision, status: task.status }, data: {
      archivedAt: businessStep ? task.archivedAt : now, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }
  const taskWhere = { taskId, scopeId };
  await tx.aiTaskResultArtifact.updateMany({ where: { ...taskWhere,
    step: { toolCode: { notIn: businessTools } } }, data: { payload: mark } });
  await tx.aiTaskInputReceipt.updateMany({ where: taskWhere, data: { answers: [] } });
  await tx.aiTaskInputRequest.updateMany({ where: taskWhere, data: { allowedFields: [] } });
  await tx.aiTaskActionInput.updateMany({ where: { ...taskWhere,
    toolCode: { notIn: businessTools } }, data: { payload: mark } });
  if (!businessStep) await tx.aiTaskRunPlan.updateMany({ where: taskWhere, data: { payload: mark } });

  // Keep the original cursor and validated wire/confirmation references. Raw
  // refresh history or arbitrary event fields can repeat erased source text.
  if (task.eventCursor < 0n || task.eventCursor > 18446744073709551615n
    || await tx.aiTaskEvent.findFirst({ where: { ...taskWhere,
      OR: [{ cursor: { lte: 0n } }, { cursor: { gt: task.eventCursor } }] }, select: { cursor: true } })) throw unavailable();
  let afterCursor = 0n, eventCount = 0;
  while (afterCursor < task.eventCursor) {
    const events = await tx.aiTaskEvent.findMany({ where: { ...taskWhere,
      cursor: { gt: afterCursor, lte: task.eventCursor } }, orderBy: { cursor: 'asc' }, take: 200 });
    eventCount += events.length;
    if (!events.length || eventCount > 10000) throw unavailable();
    for (const event of events) {
      if (event.scopeId !== scopeId || event.taskId !== taskId || event.cursor <= afterCursor
        || event.cursor > task.eventCursor) throw unavailable();
      afterCursor = event.cursor;
      const raw = event.payload;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw unavailable();
      const data = projectAiTaskWireEvent(event).data;
      let confirmation;
      if (businessStep && event.type === 'task.transition' && raw.confirmation !== undefined) {
        const envelope = aiTaskConfirmationEventSchema.parse(raw), initiator = envelope.initiator;
        if (initiator.actorKind !== task.ownerKind || initiator.actorId !== task.ownerId) throw denied();
        const paused = envelope.data.from === 'running' && envelope.data.to === 'waiting_confirmation'
          && envelope.data.reason === 'confirmation_required';
        const resumed = envelope.data.from === 'waiting_confirmation' && envelope.data.to === 'running'
          && envelope.data.reason === 'resume';
        if (!paused && !resumed) throw unavailable();
        confirmation = { initiator, confirmation: resumed ? aiTaskResumedConfirmationSchema.parse(raw).confirmation
          : { checkpointRef: envelope.confirmation.checkpointRef, phaseId: envelope.confirmation.phaseId } };
      }
      const changedEvent = await tx.aiTaskEvent.updateMany({ where: { ...taskWhere, cursor: event.cursor,
        taskRevision: event.taskRevision, type: event.type }, data: { payload: { data, ...confirmation, retention: mark } } });
      if (changedEvent.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
    }
  }
  if (task.inputRef && !await tx.aiTask.findFirst({ where: { scopeId, inputRef: task.inputRef,
    id: { not: taskId }, archivedAt: null }, select: { id: true } })) {
    await tx.aiTaskOriginalRequest.updateMany({ where: { id: task.inputRef, scopeId },
      data: { payload: mark, erasedAt: now } });
  }
  await check();
  if (!receipt) await tx.aiDataErasure.create({ data: { id: key, ...owner, kind: 'task', resourceId: taskId,
    targetHash, policyVersion: AI_RETENTION_POLICY.version, state: 'erased', erasedAt: now } });
  else {
    const changed = await tx.aiDataErasure.updateMany({ where: { id: key, ...owner, revision: receipt.revision },
      data: { state: 'erased', erasedAt: now, revision: { increment: 1 } } });
    if (changed.count !== 1) throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
  }
  await check();
  return { id: key, state: 'erased' as const, replayed: Boolean(receipt) };
}

/** Only the existing full-workspace maintenance/verified restore composition
 * supplies this entry. A receipt ID alone does not bypass its expiry checks. */
export function eraseExpiredTaskBodies(tx: Prisma.TransactionClient, input: TaskBodies, expectedHash?: string) {
  return eraseTaskBodies(tx, input, true, expectedHash);
}

/** Caller has already authorized this original source mutation and holds the
 * canonical scope lock. Discovery proves the exact source copies, not Task read
 * authority. A missing/truncated binding or unresolved effect rolls back ALL. */
export async function eraseRetainedSourceTaskBodies(tx: Prisma.TransactionClient,
  input: Scope & { kind: 'knowledge' | 'memory'; resourceId: string; now: Date; check(): Promise<void> }) {
  if (await inspectRetentionSource(tx, input.scopeId, input.kind, input.resourceId, input.owner) !== 'clear') throw unavailable();
  const copies = await retentionSourceCopies(tx, input.scopeId, input.kind, input.resourceId, input.owner);
  const taskIds = [...new Set(copies.map(copy => copy.taskId))];
  if (taskIds.length > 50) throw unavailable();
  for (const taskId of taskIds) {
    await eraseTaskBodies(tx, { scopeId: input.scopeId, owner: input.owner, taskId,
      now: input.now, check: input.check }, false);
  }
  // Reopen the original markers; removing heads alone is not propagation.
  if ((await retentionSourceCopies(tx, input.scopeId, input.kind, input.resourceId, input.owner)).length) throw unavailable();
  await input.check();
  return { erasedTasks: taskIds.length };
}
