/** Rental retention adds original business source discovery to the same body erasure. */
import type { Prisma } from '@prisma/client';
import { AiTaskRepositoryError } from '../../task-errors';
import { createAiTaskBodyErasure } from './task-body-erasure';
import { inspectRetentionSource, retentionSourceCopies } from './retention-model-sources';
const unavailable = () => new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
type Scope = { scopeId: string; owner: { tenantId: string; workspaceId: string } };
export const { eraseExpiredTaskBodies, eraseWorkspaceSourceTaskBodies, erasePlatformTaskBodies } = createAiTaskBodyErasure([
  'rental.order.commit', 'tenant.notifications.commit', 'membership.profile.commit'
]);

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
    await eraseWorkspaceSourceTaskBodies(tx, { scopeId: input.scopeId, owner: input.owner, taskId,
      now: input.now, check: input.check });
  }
  // Reopen the original markers; removing heads alone is not propagation.
  if ((await retentionSourceCopies(tx, input.scopeId, input.kind, input.resourceId, input.owner)).length) throw unavailable();
  await input.check();
  return { erasedTasks: taskIds.length };
}
