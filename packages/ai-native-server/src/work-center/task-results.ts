/** Both public readers project the same original measured Artifact. Only the
 * outcome of the fixed diagnostic is public; its provider reply stays private. */
import type { PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, type AiTaskRunnerOutcomeDraft } from '@rental-os/platform-contracts/ai-task';
import { AI_CONVERSATION_DRAFT_VERSION } from '@rental-os/platform-contracts/ai-original-result';
import { requestFingerprint as hash } from '@rental-os/platform-contracts/request-fingerprint';
import type { createPublicAiTaskPersistence } from '../task-persistence';
import { textProbeIntent } from '../runtime/text-capability-probe';
import { admitsTool, conflict, denied, owner, transactionOptions, unavailable, type BoundAuthority, type Owner } from './scene';
import type { WorkCenterConversations } from './conversations';
import type { WorkCenterTaskAuthority } from './task-authority';
import type { WorkCenterDiagnostic } from './diagnostic';

export const diagnosticArtifact = z.object({ version: z.literal('public-text-artifact-1'),
  callId: z.string().regex(/^capability:[a-f0-9]{64}$/u), receiptId: z.string().uuid().nullable(),
  check: z.enum(['verified', 'mismatch', 'unverified']) }).strict();
const taskStatus = z.enum(AI_TASK_STATUSES_DRAFT);
type TaskRef = { taskId: string; runId: string };
type ResultRef = { taskId: string; resultId: string };
type TurnRef = { conversationId: string; admissionKey: string; resultId: string };
type ReadAction = 'read_metadata' | 'read_step_terminal';

export function createWorkCenterResultReaders(input: { db: PrismaClient; authority: BoundAuthority;
  taskAuthority: WorkCenterTaskAuthority; conversations: WorkCenterConversations; diagnostic: WorkCenterDiagnostic;
  tasks: ReturnType<typeof createPublicAiTaskPersistence> }) {
  const { db, authority, taskAuthority, conversations, diagnostic, tasks } = input;
  const task = async (taskId: string, action: ReadAction) =>
    taskAuthority.originalForTask(conversations, await authority.actions.resolve(taskId, action), taskId);
  const authorize = async (taskId: string, before: Owner, ...actions: ReadAction[]) => {
    await db.$transaction(async tx => {
      for (const action of actions) {
        const context = await authority.readActionOn(tx, taskId, action);
        if (hash(await owner(tx, context)) !== hash(before)) throw denied();
      }
    }, transactionOptions);
    authority.assertCurrent();
  };

  async function snapshot(ref: TaskRef, outcome?: AiTaskRunnerOutcomeDraft) {
    const handoff = outcome?.status === 'unavailable' && outcome.nextAction === 'manual_handoff' ? outcome : null;
    const before = await task(ref.taskId, 'read_metadata'), key = { scopeId: before.who.scopeId, taskId: ref.taskId, runId: ref.runId };
    const read = () => db.aiRun.findFirst({ where: { id: ref.runId, scopeId: key.scopeId, taskId: ref.taskId, sequence: 1,
      actorKind: 'USER', actorId: before.who.ownerId } });
    const run = await read(), steps = await db.aiStep.findMany({ where: key, take: 2 });
    if (!run || run.id !== ref.runId || run.scopeId !== key.scopeId || run.taskId !== ref.taskId || run.actorKind !== 'USER'
      || run.actorId !== before.who.ownerId || run.sequence !== 1 || steps.length > 1 || steps.some(row => row.scopeId !== key.scopeId
        || row.taskId !== key.taskId || row.runId !== key.runId || !admitsTool(row.toolCode, row.toolVersion))) throw unavailable();
    const step = steps[0];
    let resultId = step?.resultRef ?? null;
    if (!resultId && step?.status === 'RUNNING') {
      // A provider result may be uncertain before the Step can publish an
      // acknowledgement. Expose only the original started marker's locator.
      const rows = await db.aiTaskResultArtifact.findMany({ where: { ...key, stepId: step.id,
        actionId: step.actionId, stepFingerprint: step.requestFingerprint, completeMeasurement: false }, take: 2 });
      if (rows.length > 1) throw unavailable();
      resultId = rows[0]?.id ?? null;
    }
    const verifyResult = resultId !== null && (handoff !== null || !step?.resultRef);
    if (verifyResult) {
      const artifact = await tasks.readResult({ taskId: ref.taskId, resultId });
      if (!step || artifact.taskId !== ref.taskId || artifact.runId !== run.id || artifact.stepId !== step.id || artifact.resultId !== resultId)
        throw conflict();
    }
    const pending = handoff && await db.aiTaskExecutionCharge.findFirst({ where: { ...key,
      stepId: null, actionId: null, stepFingerprint: null, gatewayInvocationId: null,
      resource: 'ACTIVE_MS', amount: { gt: 0n }, status: { in: ['RESERVED', 'UNKNOWN'] } }, select: { chargeId: true } });
    const current = await task(ref.taskId, 'read_metadata');
    const afterRun = await read();
    if (current.row.revision !== before.row.revision || current.row.status !== before.row.status || !afterRun
      || afterRun.revision !== run.revision || afterRun.status !== run.status || afterRun.fencingToken.toFixed(0) !== run.fencingToken.toFixed(0)
      || afterRun.leaseOwnerId !== run.leaseOwnerId || afterRun.leaseExpiresAt?.getTime() !== run.leaseExpiresAt?.getTime()) throw conflict();
    await authorize(ref.taskId, before.who, 'read_metadata', ...(verifyResult ? ['read_step_terminal'] as const : []));
    return { contractVersion: AI_TASK_DRAFT_VERSION, taskId: ref.taskId, runId: ref.runId,
      revision: before.row.revision, status: taskStatus.parse(before.row.status.toLowerCase()), runStatus: taskStatus.parse(run.status.toLowerCase()),
      resultId, execution: 'observed_original_task' as const,
      ...(handoff && { runner: { status: handoff.status, nextAction: 'manual_handoff' as const, completedSteps: handoff.completedSteps,
        cleanupFailed: handoff.cleanupFailed, ...(handoff.stopReason && { stopReason: handoff.stopReason }),
        runTimeAccounting: pending ? 'pending_original_time' as const : 'not_observed' as const } }) };
  }

  async function result(ref: ResultRef, checkAssociation?: (runId: string) => Promise<void>) {
    const before = await task(ref.taskId, 'read_step_terminal'), original = await tasks.readResult(ref);
    const challenge = textProbeIntent(before.input.command.operationId, before.who.scopeId, 'text');
    const run = await db.aiRun.findFirst({ where: { scopeId: before.who.scopeId, id: original.runId, taskId: ref.taskId,
      sequence: 1, actorKind: 'USER', actorId: before.who.ownerId } });
    if (!run || run.id !== original.runId || run.actorId !== before.who.ownerId || run.actorKind !== 'USER' || run.sequence !== 1
      || run.scopeId !== before.who.scopeId || run.taskId !== ref.taskId || original.resultId !== ref.resultId) throw unavailable();
    const parsed = original.status === 'succeeded' ? diagnosticArtifact.parse(original.payload) : null;
    if (parsed) {
      if (!parsed.receiptId || parsed.callId !== challenge.intent.requestId) throw unavailable();
      await diagnostic.terminalEvidence(db, { receiptId: parsed.receiptId, check: parsed.check, callId: parsed.callId, stepId: original.stepId,
        runId: original.runId, scopeId: before.who.scopeId, tenantId: before.who.tenantId, ownerId: before.who.ownerId });
    }
    // Reopen the exact Artifact and reauthorize its Task after the conversation
    // association check. Conversation access alone cannot release a result.
    await checkAssociation?.(original.runId);
    const latest = await tasks.readResult(ref);
    if (hash(latest) !== hash(original)) throw conflict();
    await authorize(ref.taskId, before.who, 'read_step_terminal');
    return { contractVersion: original.contractVersion, taskId: original.taskId, runId: original.runId, resultId: original.resultId,
      status: original.status === 'succeeded' ? 'available' as const : original.status,
      diagnostic: parsed ? { capability: 'text' as const, check: parsed.check } : null, contentHash: original.contentHash,
      activeMs: original.activeMs, outputBytes: original.outputBytes, observedAt: original.observedAt,
      execution: 'read_only_no_start_no_reconnect_side_effect' as const, businessExecution: 'not_inferred_from_model_result' as const };
  }

  async function conversationResult(ref: TurnRef) {
    const before = await conversations.originalForTurn(ref);
    const recheck = async (runId?: string) => {
      const after = await conversations.originalForTurn(ref);
      if (hash(after.turn) !== hash(before.turn) || after.head.revision !== before.head.revision
        || after.row.contentHash !== before.row.contentHash || runId !== undefined && runId !== after.turn.task?.runId) throw conflict();
    };
    let current = null;
    if (before.turn.task) current = await result({ taskId: before.turn.task.taskId, resultId: ref.resultId }, recheck);
    else await recheck();
    return { draftVersion: AI_CONVERSATION_DRAFT_VERSION, conversationId: ref.conversationId, admissionKey: ref.admissionKey,
      result: current, status: current ? 'observed' as const : 'not_observed' as const, execution: 'read_only_no_start_no_dispatch' as const };
  }
  return { snapshot, result, conversationResult };
}
