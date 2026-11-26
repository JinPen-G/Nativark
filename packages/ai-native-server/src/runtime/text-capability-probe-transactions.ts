/** The original capability request owns every Task/Run/Step reference. Selected
 * Auth/Tenant/Core locks precede the original input and Task locks. This neither
 * creates a replacement task nor changes the Gateway's settlement authority. */
import type { PrismaClient } from '@prisma/client';
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { AI_TASK_DRAFT_VERSION, AI_TOOL_DRAFT_VERSION } from '@rental-os/shared';
import { AiTaskRepositoryError } from './ai-task.repository';
import type { PrismaTextProbeOriginalRequestRepository } from './prisma-text-probe-original-request.repository';
import { textProbeTaskCreationKey } from './text-capability-probe-task.composition';
import { TEXT_CAPABILITY_PROBE_TOOL, TEXT_PROBE_SCENE } from './text-capability-probe';
import { beginTenantModelConfigurationTransaction, type TenantModelConfigurationTransactionParticipant } from './tenant-model-config-transactions';
import { holdAiTaskDeploymentAdmission, withAiTaskTransactionAuthority, type AiTaskTransactionReference } from './task-transaction-authority';

type Original = NonNullable<Awaited<ReturnType<PrismaTextProbeOriginalRequestRepository['readHistoricalOriginal']>>>;
const denied = () => new AiTaskRepositoryError('AI_ACCESS_DENIED');
const hash = (value: unknown) => requestFingerprint(JSON.parse(JSON.stringify(value)));

export async function withTextProbeTaskTransactions<T>(input: {
  db: PrismaClient;
  requestKey: string;
  readOriginal(): Promise<Original | null>;
  participant: TenantModelConfigurationTransactionParticipant;
  purpose: 'creation' | 'execution' | 'control' | 'recovery' | 'accounting';
  clock?: () => Date;
}, consume: () => Promise<T>): Promise<T> {
  if (!hasRentalBusinessTenantFence()) return consume();
  const original = await input.readOriginal();
  if (!original || original.context.actor.kind !== 'user' || original.context.scope.kind !== 'workspace'
    || original.context.audience !== 'operator' || original.sceneCode !== TEXT_PROBE_SCENE
    || original.owner.ownerKind !== 'USER' || original.owner.ownerId !== original.context.actor.userId
    || original.owner.audience !== 'OPERATOR') throw denied();
  const context = { actorId: original.context.actor.userId, tenantId: original.context.scope.tenantId,
    workspaceId: original.context.scope.workspaceId };
  const raw = await input.db.aiTaskOriginalRequest.findFirst({ where: { id: original.inputRef, ...original.owner } });
  if (!raw || raw.id !== original.inputRef || raw.requestKey !== input.requestKey || raw.contentHash !== original.inputHash
    || raw.revision !== original.inputRevision || raw.sceneCode !== original.sceneCode || raw.sceneVersion !== original.sceneVersion
    || raw.status !== 'STORED' || raw.erasedAt) throw denied();
  const originalHash = hash(raw), clock = input.clock ?? (() => new Date());
  const taskWhere = { ...original.owner, scopeKind: 'WORKSPACE' as const,
    sceneCode: original.sceneCode, sceneVersion: original.sceneVersion,
    creationKey: textProbeTaskCreationKey(input.requestKey), inputRef: original.inputRef,
    inputRevision: original.inputRevision, inputHash: original.inputHash, archivedAt: null };
  const leases: Array<{ close(): void }> = [];
  try {
    return await withAiTaskTransactionAuthority({ binding: hash({ originalHash, context, purpose: input.purpose }),
      async begin(tx, reference) {
        if ('$transaction' in tx) throw denied();
        const task = input.purpose === 'creation' ? null : await input.db.aiTask.findFirst({ where: taskWhere });
        if (input.purpose !== 'creation' && (!task || task.contractVersion !== AI_TASK_DRAFT_VERSION
          || Object.entries(taskWhere).some(([key, value]) => task[key as keyof typeof task] !== value))) throw denied();
        const participant = await beginTenantModelConfigurationTransaction(tx, context, input.participant);
        if (!participant) throw denied();
        leases.push(participant);
        const deployment = await holdAiTaskDeploymentAdmission(tx,
          input.purpose === 'creation' || input.purpose === 'execution' ? 'new_work' : 'task_control');
        const spaces = await tx.$queryRaw<Array<{ id: string }>>(prismaRuntime.sql`SELECT id FROM business_workspaces WHERE tenantId = ${context.tenantId} AND id = ${context.workspaceId} AND status = 'active' FOR UPDATE`);
        if (spaces.length !== 1 || spaces[0].id !== context.workspaceId) throw denied();
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
            actorKind: 'USER', actorId: context.actorId, sequence: 1 } });
          if (!run || run.id !== step.runId || run.taskId !== task.id || run.scopeId !== task.scopeId
            || run.actorKind !== 'USER' || run.actorId !== context.actorId || run.sequence !== 1
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
