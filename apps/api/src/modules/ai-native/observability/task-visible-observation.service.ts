/** Original owner-only client timing diagnostics in OperationLog. Browser
 * claims are not trusted business facts, execution, pricing or SLO evidence. */
import { Prisma, type PrismaClient } from '@prisma/client';
import { isDeepStrictEqual } from 'node:util';
import type { AiTaskClientVisibleReportDraft, AiTaskClientVisibleReceiptDraft } from '@rental-os/shared';
import { AiTaskRepositoryError, type AiTaskRepository } from '../ai-task.repository';
import { AiTaskRunnerError } from '../runner/ai-task-runner.service';
import { validateAiTaskObservation } from '../task-contract-validation';
import { requestFingerprint } from '../../rental-core/rental-idempotency.repository';

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
    if (report.trigger === 'original_input_resume') {
      const origin = await db.aiTaskInputRequest.findFirst({ where: { id: report.originKey, taskId: report.taskId,
        scopeId }, select: { id: true } });
      if (!origin) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    if (report.surface === 'server_conversation') {
      const conversation = await db.aiConversation.findFirst({ where: { id: report.conversationId, scopeId,
        ownerId: before.actorId, status: 'active', deletedAt: null, activeTurnId: report.turnId }, select: { id: true } });
      const turn = conversation && await db.aiConversationTurn.findFirst({ where: { id: report.turnId,
        conversationId: conversation.id, scopeId, ownerId: before.actorId, originalRequestId: report.originKey }, select: { id: true } });
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
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 2500, timeout: 5000 });
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
