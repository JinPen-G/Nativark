/** 平台检测沿原 SaaS 主体与 Task 事务核权；不借租户 Core grant，
 * 不新增任务、财务账或重发许可。原 input/Task/Run/Step 及操作键逐次绑定。 */
import type { PrismaClient } from '@prisma/client';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from '../ai-task.repository';
import type { PrismaTextProbeOriginalRequestRepository } from '../prisma-text-probe-original-request.repository';
import { textProbeTaskCreationKey } from '../text-capability-probe-task.composition';
import { TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE } from '../text-capability-probe';
import { beginPlatformAiManagementTransaction } from '../platform-management-transaction';
import type { AiExecutionContext } from '@rental-os/shared';
import { holdAiTaskDeploymentAdmission, withAiTaskTransactionAuthority, type AiTaskTransactionReference } from '../task-transaction-authority';

type Original = NonNullable<Awaited<ReturnType<PrismaTextProbeOriginalRequestRepository['readHistoricalOriginal']>>>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export async function withPlatformProbeTaskTransactions<T>(input: {
  db: PrismaClient;
  key: { inputRef: string; creationKey: string };
  current(): Promise<AiExecutionContext>;
  readOriginal(requestKey: string): Promise<Original | null>;
  purpose: 'creation' | 'execution' | 'control' | 'recovery' | 'accounting';
  clock?: () => Date;
}, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const principal = await input.current();
  if (principal.actor.kind !== 'saas_admin' || principal.scope.kind !== 'platform' || principal.audience !== 'operator') throw denied();
  const locator = await input.db.aiTaskOriginalRequest.findFirst({ where: { id: input.key.inputRef,
    ownerKind: 'SAAS_ADMIN', ownerId: principal.actor.userId, audience: 'OPERATOR', sceneCode: TEXT_PROBE_SCENE } });
  if (!locator || locator.id !== input.key.inputRef || textProbeTaskCreationKey(locator.requestKey) !== input.key.creationKey) throw denied();
  const requestKey = locator.requestKey, original = await input.readOriginal(requestKey);
  if (!original || original.context.actor.kind !== 'saas_admin' || original.context.scope.kind !== 'platform'
    || original.context.audience !== 'operator' || original.sceneCode !== TEXT_PROBE_SCENE
    || original.owner.ownerKind !== 'SAAS_ADMIN' || original.owner.ownerId !== original.context.actor.userId
    || original.owner.audience !== 'OPERATOR') throw denied();
  const context = { actorId: original.context.actor.userId };
  if (context.actorId !== principal.actor.userId || original.inputRef !== input.key.inputRef) throw denied();
  const raw = await input.db.aiTaskOriginalRequest.findFirst({ where: { id: original.inputRef, ...original.owner } });
  if (!raw || raw.id !== original.inputRef || raw.requestKey !== requestKey || raw.contentHash !== original.inputHash
    || raw.revision !== original.inputRevision || raw.sceneCode !== original.sceneCode || raw.sceneVersion !== original.sceneVersion
    || raw.status !== 'STORED' || raw.erasedAt) throw denied();
  const originalHash = hash(raw), clock = input.clock ?? (() => new Date());
  const taskWhere = { ...original.owner, scopeKind: 'PLATFORM' as const,
    sceneCode: original.sceneCode, sceneVersion: original.sceneVersion,
    creationKey: textProbeTaskCreationKey(requestKey), inputRef: original.inputRef,
    inputRevision: original.inputRevision, inputHash: original.inputHash, archivedAt: null };
  const leases: Array<{ close(): void }> = [];
  try {
    return await withAiTaskTransactionAuthority({ binding: hash({ originalHash, context, purpose: input.purpose }),
      async begin(tx, reference) {
        if ('$transaction' in tx) throw denied();
        const task = input.purpose === 'creation' ? null : await input.db.aiTask.findFirst({ where: taskWhere });
        if (input.purpose !== 'creation' && (!task || task.contractVersion !== AI_TASK_DRAFT_VERSION
          || Object.entries(taskWhere).some(([key, value]) => task[key as keyof typeof task] !== value))) throw denied();
        const participant = await beginPlatformAiManagementTransaction(tx, context.actorId);
        if (!participant) throw denied();
        leases.push(participant);
        const deployment = await holdAiTaskDeploymentAdmission(tx,
          input.purpose === 'creation' || input.purpose === 'execution' ? 'new_work' : 'task_control');
        await tx.$queryRaw(prismaRuntime.sql`SELECT id FROM ai_task_original_requests WHERE scopeId = ${original.owner.scopeId} AND id = ${original.inputRef} FOR UPDATE`);
        const verifyReference = async (key: AiTaskTransactionReference) => {
          const current = await tx.aiTaskOriginalRequest.findFirst({ where: { id: original.inputRef, ...original.owner } });
          if (!current || hash(current) !== originalHash) throw denied();
          if (input.purpose === 'creation' || input.purpose === 'execution') {
            deployment.requireNewWork();
            const now = clock();
            if (!Number.isFinite(now.getTime()) || current.expiresAt <= now || current.creationClosedAt || current.creationCloseKey) throw denied();
          }
          if (input.purpose === 'creation') {
            if (key.kind !== 'creation' || key.inputRef !== original.inputRef || key.sceneCode !== original.sceneCode) throw denied();
            return;
          }
          if (!task || key.kind === 'creation') throw denied();
          const latest = await tx.aiTask.findFirst({ where: { ...taskWhere, id: task.id } });
          if (!latest || latest.id !== task.id || latest.contractVersion !== AI_TASK_DRAFT_VERSION
            || Object.entries(taskWhere).some(([field, value]) => latest[field as keyof typeof latest] !== value)) throw denied();
          if (input.purpose === 'control' && key.kind !== 'task_control'
            || input.purpose === 'recovery' && key.kind !== 'task' && key.kind !== 'task_control'
            || input.purpose === 'accounting' && key.kind !== 'step') throw denied();
          if (key.kind === 'task' || key.kind === 'task_control') {
            if (key.taskId !== task.id) throw denied();
            return;
          }
          const invocation = key.kind === 'invocation' ? await tx.aiGatewayInvocation.findFirst({ where: {
            callId: key.callId, taskId: task.id, scopeId: task.scopeId, actorId: context.actorId } }) : null;
          if (key.kind === 'invocation' && (!invocation || invocation.callId !== key.callId || invocation.taskId !== task.id
            || invocation.scopeId !== task.scopeId || invocation.actorId !== context.actorId)) throw denied();
          const stepId = key.kind === 'step' ? key.stepId : invocation!.stepId;
          const step = await tx.aiStep.findFirst({ where: { id: stepId, taskId: task.id, scopeId: task.scopeId } });
          if (!step || step.id !== stepId || step.taskId !== task.id || step.scopeId !== task.scopeId
            || step.toolCode !== TEXT_CAPABILITY_PROBE_TOOL || step.toolVersion !== AI_TOOL_DRAFT_VERSION
            || step.requestFingerprint !== requestFingerprint(original.command)) throw denied();
          const run = await tx.aiRun.findFirst({ where: { id: step.runId, taskId: task.id, scopeId: task.scopeId,
            actorKind: 'SAAS_ADMIN', actorId: context.actorId, sequence: 1 } });
          if (!run || run.id !== step.runId || run.taskId !== task.id || run.scopeId !== task.scopeId
            || run.actorKind !== 'SAAS_ADMIN' || run.actorId !== context.actorId || run.sequence !== 1
            || invocation && (invocation.runId !== run.id || invocation.actionId !== step.actionId
              || invocation.stepFingerprint !== step.requestFingerprint)) throw denied();
        };
        await verifyReference(reference);
        return { verifyReference, async revalidate() {
          await participant.revalidate();
          await verifyReference(reference);
        } };
      }
    }, consume);
  } finally { for (const lease of leases) lease.close(); }
}
