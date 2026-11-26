/** The selected host joins each original explanation transaction to current
 * human resource authority. Only the original automatic Task/Run/Step may be
 * used; this does not grant model execution, create work or retry unknowns. */
import type { PrismaClient } from '@prisma/client';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import { TASK_TEXT_MODEL_TOOL } from '../model-input/task-model-input';
import { withAiTaskTransactionAuthority, type AiTaskTransactionReference } from '../task-transaction-authority';
import type { HumanAutomationTransactionParticipant } from './human-automation-transactions';
import type { AutomationTaskModelOrigin } from './automation-task-model.authority';

const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');

export async function withAutomationExplanationTransactions<T>(input: {
  db: PrismaClient;
  transactions?: HumanAutomationTransactionParticipant;
  origin: AutomationTaskModelOrigin;
  clock(): Date;
  assertCurrent(): Promise<void>;
}, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  if (!input.transactions) throw denied();
  const origin = structuredClone(input.origin), original = origin.original;
  const leases: Array<{ close(): void }> = [];
  const current = async () => {
    await input.assertCurrent();
    const now = input.clock().getTime();
    if (!Number.isFinite(now) || Date.parse(origin.expiresAt) <= now) throw denied();
  };
  try {
    return await withAiTaskTransactionAuthority({ binding: requestFingerprint({ original, binding: origin.bindingHash }),
      async begin(tx, reference) {
        if ('$transaction' in tx) throw denied();
        const lease = await input.transactions!.begin(tx, [origin.event.eventId]);
        leases.push(lease);
        const verifyReference = async (key: AiTaskTransactionReference) => {
          if (key.kind === 'creation') throw denied();
          const task = await tx.aiTask.findFirst({ where: { id: original.taskId, scopeId: origin.scopeId } });
          if (!task || task.id !== original.taskId || task.scopeId !== origin.scopeId
            || task.ownerKind !== 'AUTOMATION' || task.ownerId !== origin.subjectId || task.audience !== 'AUTOMATION'
            || task.inputRef !== original.inputRef || task.inputHash !== origin.inputHash
            || task.sceneCode !== origin.sceneCode || task.sceneVersion !== origin.sceneVersion || task.archivedAt) throw denied();
          const run = await tx.aiRun.findFirst({ where: { id: original.runId, taskId: task.id, scopeId: task.scopeId } });
          if (!run || run.id !== original.runId || run.taskId !== task.id || run.scopeId !== task.scopeId
            || run.actorKind !== 'AUTOMATION' || run.actorId !== origin.subjectId || run.sequence !== 1) throw denied();
          if (key.kind === 'task' || key.kind === 'task_control') {
            if (key.taskId !== task.id) throw denied();
          } else {
            const invocation = key.kind === 'invocation' ? await tx.aiGatewayInvocation.findFirst({ where: {
              callId: key.callId, taskId: task.id, scopeId: task.scopeId, runId: run.id } }) : null;
            if (key.kind === 'invocation' && (!invocation || invocation.callId !== key.callId
              || invocation.taskId !== task.id || invocation.scopeId !== task.scopeId || invocation.runId !== run.id)) throw denied();
            const stepId = key.kind === 'step' ? key.stepId : invocation!.stepId;
            const step = await tx.aiStep.findFirst({ where: { id: stepId, taskId: task.id, scopeId: task.scopeId, runId: run.id } });
            if (!step || step.id !== stepId || step.taskId !== task.id || step.scopeId !== task.scopeId || step.runId !== run.id
              || step.toolCode !== TASK_TEXT_MODEL_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION
              || invocation && (invocation.actionId !== step.actionId || invocation.stepFingerprint !== step.requestFingerprint)) throw denied();
          }
          await current();
        };
        await verifyReference(reference);
        return { verifyReference, async revalidate() {
          await lease.revalidate();
          await verifyReference(reference);
        } };
      }
    }, consume);
  } finally { for (const lease of leases) lease.close(); }
}
