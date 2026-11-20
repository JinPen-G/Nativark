/** Original owner-only client timing diagnostics in OperationLog. Browser
 * claims are not trusted business facts, execution, pricing or SLO evidence. */
import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import { AI_TEXT_MODEL_STEP_CODE, AI_IMAGE_MODEL_STEP_CODE, AI_AUDIO_MODEL_STEP_CODE,
  type AiTaskClientVisibleReportDraft, type AiTaskClientVisibleReceiptDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { validateAiTaskObservation } from '../task-contract-validation';
import { requestFingerprint } from '../rental-adapters/rental-idempotency.repository';

export const CLIENT_VISIBLE_LOG_ACTION = 'ai_task_client_visible';
type Db = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun' | 'operationLog' | 'aiTaskInputRequest'
  | 'aiConversation' | 'aiConversationTurn'>;
export interface TaskVisibleObservationDependencies {
  db: Db; tasks: Pick<AiTaskRepository, 'resolveAccess'>;
  /** Original current model/approval readers, not a client-selected adapter. */
  sourceBinding(value: AiTaskClientVisibleReportDraft): Promise<string | null>;
  clock?: () => Date;
}
export function clientVisibleLogId(scopeId: string, actorId: string, observationId: string) {
  const value = requestFingerprint({ version: 'client-visible-log-1', scopeId, actorId, observationId });
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-5${value.slice(13, 16)}-a${value.slice(17, 20)}-${value.slice(20, 32)}`;
}
export function parseClientVisibleLog(detail: unknown): { report: AiTaskClientVisibleReportDraft; sourceBinding: string } {
  if (!detail || typeof detail !== 'object' || Array.isArray(detail)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const row = detail as Record<string, unknown>;
  if (Object.keys(row).length !== 3 || row.version !== 'client-visible-log-1' || typeof row.sourceBinding !== 'string'
    || !/^[a-f0-9]{64}$/u.test(row.sourceBinding)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  return { report: validateAiTaskObservation('AiTaskClientVisibleReportDraft', row.report), sourceBinding: row.sourceBinding };
}

export async function recordTaskVisibleObservation(d: TaskVisibleObservationDependencies, value: unknown,
  signal?: AbortSignal): Promise<AiTaskClientVisibleReceiptDraft> {
  const report = validateAiTaskObservation('AiTaskClientVisibleReportDraft', structuredClone(value));
  if ((report.kind === 'text') !== (report.source.kind === 'model_result')
    || report.surface === 'server_conversation' && (!report.conversationId || !report.turnId)
    || report.surface === 'task_center' && (report.conversationId !== undefined || report.turnId !== undefined))
    throw new AiTaskRepositoryError('AI_INVALID_INPUT');
  if (!d.db || typeof d.db.$transaction !== 'function' || typeof d.tasks?.resolveAccess !== 'function'
    || typeof d.sourceBinding !== 'function') throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const current = async () => {
    if (signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    const access = structuredClone(await d.tasks.resolveAccess(report.taskId, 'read_step_terminal'));
    if (access.scope.kind !== 'WORKSPACE' || typeof access.scope.tenantId !== 'string' || typeof access.scope.workspaceId !== 'string'
      || access.actorKind !== 'USER' || !['OPERATOR', 'STAFF'].includes(access.audience))
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    return { ...access, scope: { ...access.scope, tenantId: access.scope.tenantId, workspaceId: access.scope.workspaceId } };
  };
  const before = await current(), binding = await d.sourceBinding(structuredClone(report));
  if (binding === null || !/^[a-f0-9]{64}$/u.test(binding)) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const now = d.clock?.() ?? new Date();
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  const originCurrent = async (db: Pick<Prisma.TransactionClient, 'aiTaskInputRequest' | 'aiConversation' | 'aiConversationTurn'>, scopeId: string) => {
    let originalRequestId = report.originKey;
    if (report.trigger === 'original_input_resume') {
      const origin = await db.aiTaskInputRequest.findFirst({ where: { id: report.originKey, taskId: report.taskId,
        scopeId, status: 'CONSUMED', createdBy: before.actorId }, select: { id: true, scopeId: true, taskId: true,
        runId: true, planHash: true, status: true, createdBy: true, expiresAt: true,
        basis: { select: { step: { select: { toolCode: true } } } },
        plan: { select: { run: { select: { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true,
          sequence: true, status: true, resourceOriginRunId: true, _count: { select: { steps: true } },
          task: { select: { id: true, scopeId: true, inputRef: true } } } } } },
        receipt: { select: { id: true, scopeId: true, taskId: true, requestId: true, planHash: true,
          actorKind: true, actorId: true, audience: true, consumedAt: true,
          continuationRun: { select: { id: true, scopeId: true, taskId: true, actorKind: true, actorId: true,
            sequence: true, resourceOriginRunId: true, inputReceiptId: true } } } } } });
      const sourceRun = origin?.plan?.run, receipt = origin?.receipt, sourceTask = sourceRun?.task;
      if (!origin || origin.id !== report.originKey || origin.scopeId !== scopeId || origin.taskId !== report.taskId
        || origin.status !== 'CONSUMED' || origin.createdBy !== before.actorId || !sourceRun || !sourceTask || !receipt
        || sourceRun.id !== origin.runId || sourceRun.scopeId !== scopeId || sourceRun.taskId !== report.taskId
        || sourceRun.actorKind !== before.actorKind || sourceRun.actorId !== before.actorId
        || sourceTask.id !== report.taskId || sourceTask.scopeId !== scopeId
        || !Number.isSafeInteger(sourceRun._count?.steps) || sourceRun._count.steps < 1
        || receipt.scopeId !== scopeId || receipt.taskId !== report.taskId || receipt.requestId !== origin.id
        || receipt.planHash !== origin.planHash || receipt.actorKind !== before.actorKind || receipt.actorId !== before.actorId
        || receipt.audience !== before.audience || !(receipt.consumedAt instanceof Date)
        || !Number.isFinite(receipt.consumedAt.getTime()) || !(origin.expiresAt instanceof Date)
        || !Number.isFinite(origin.expiresAt.getTime()) || receipt.consumedAt > origin.expiresAt)
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const modelContinuation = sourceRun._count.steps === 1
        && (origin.basis.step.toolCode === AI_TEXT_MODEL_STEP_CODE || origin.basis.step.toolCode === AI_IMAGE_MODEL_STEP_CODE
          || origin.basis.step.toolCode === AI_AUDIO_MODEL_STEP_CODE);
      const successor = receipt.continuationRun, resumed = successor ?? sourceRun;
      if (modelContinuation !== !!successor || resumed.id !== report.runId || resumed.scopeId !== scopeId
        || resumed.taskId !== report.taskId || resumed.actorKind !== before.actorKind || resumed.actorId !== before.actorId
        || successor && (sourceRun.status !== 'SUCCEEDED' || successor.inputReceiptId !== receipt.id
          || successor.sequence !== sourceRun.sequence + 1
          || successor.resourceOriginRunId !== (sourceRun.resourceOriginRunId ?? sourceRun.id)))
        throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      // The question identifies its consumed answer and exact resumed Run. The
      // frozen parent Task supplies the original conversation request separately.
      if (report.surface === 'server_conversation') {
        if (typeof sourceTask.inputRef !== 'string'
          || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(sourceTask.inputRef))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
        originalRequestId = sourceTask.inputRef;
      }
    }
    if (report.surface === 'server_conversation') {
      const conversation = await db.aiConversation.findFirst({ where: { id: report.conversationId, scopeId,
        ownerId: before.actorId, status: 'active', deletedAt: null, activeTurnId: report.turnId }, select: { id: true } });
      const turn = conversation && await db.aiConversationTurn.findFirst({ where: { id: report.turnId,
        conversationId: conversation.id, scopeId, ownerId: before.actorId, originalRequestId }, select: { id: true } });
      if (!turn) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
  };
  let scopeId: string | undefined;
  let attempted = false;
  try {
    const recorded = await d.db.$transaction(async tx => {
      const task = await tx.aiTask.findFirst({ where: before.where, select: { id: true, scopeId: true, revision: true } });
      if (!task || task.id !== report.taskId || !task.scopeId) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      scopeId = task.scopeId;
      const run = await tx.aiRun.findFirst({ where: { id: report.runId, taskId: report.taskId, scopeId: task.scopeId,
        actorKind: before.actorKind, actorId: before.actorId }, select: { id: true } });
      if (!run) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      await originCurrent(tx, task.scopeId);
      const access = await current();
      if (access.bindingKey !== before.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      const id = clientVisibleLogId(task.scopeId, before.actorId, report.observationId);
      const detail = { version: 'client-visible-log-1', report, sourceBinding: binding };
      const existing = await tx.operationLog.findUnique({ where: { id } });
      if (existing) {
        if (existing.action !== CLIENT_VISIBLE_LOG_ACTION || existing.userId !== before.actorId
          || existing.tenantId !== before.scope.tenantId || existing.workspaceId !== before.scope.workspaceId
          || !isDeepStrictEqual(parseClientVisibleLog(existing.detail), { report, sourceBinding: binding }))
          throw new AiTaskRepositoryError('AI_REVISION_CONFLICT');
        return existing;
      }
      if (signal?.aborted) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      attempted = true;
      return tx.operationLog.create({ data: { id, tenantId: before.scope.tenantId, workspaceId: before.scope.workspaceId,
        userId: before.actorId, action: CLIENT_VISIBLE_LOG_ACTION, detail: detail as unknown as Prisma.InputJsonValue,
        createdAt: now } });
    }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
    // Log acknowledgement is not authority to deliver stale source data. A
    // committed log is retained on loss/revocation; never retry or erase it.
    if ((await current()).bindingKey !== before.bindingKey || await d.sourceBinding(structuredClone(report)) !== binding)
      throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    if (!scopeId) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    await originCurrent(d.db, scopeId);
    if (!(recorded.createdAt instanceof Date) || !Number.isFinite(recorded.createdAt.getTime()))
      throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
    return { version: 'client-visible-1', observationId: report.observationId, taskId: report.taskId, runId: report.runId,
      kind: report.kind, status: 'recorded', recordedAt: recorded.createdAt.toISOString(),
      provenance: 'client_reported_not_business_fact', effects: 'no_authorization_execution_accounting_or_slo' };
  } catch (error) {
    if (attempted) throw new AiTaskRunnerError('AI_RESULT_UNKNOWN');
    if (error instanceof AiTaskRepositoryError) throw error;
    throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
  }
}
