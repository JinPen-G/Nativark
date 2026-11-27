import { prismaRuntime } from '@rental-os/platform-server/prisma-runtime';
import type { Prisma, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT,
  type AiTaskEventPageDraft, type AiTaskEventResetDraft, type AiTaskSnapshotDraft
} from "@rental-os/platform-contracts/ai-task";
import type { TaskPersistenceRepository } from './task-persistence.repository';
import { AiTaskRepositoryError } from '../task-errors';
import { aiPersistenceEventCursor } from "./persistence-scope";
import { isAiTaskEventPageConsistentDraft } from "./task-transition-draft";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().positive().max(4294967295);
const inputSchema = z.object({ taskId: id, after: z.string().min(1).max(20), limit: z.number().int().min(1).max(100) }).strict();
const taskSelect = { id: true, scopeId: true, revision: true, contractVersion: true, eventCursor: true } satisfies Prisma.AiTaskSelect;
const snapshotTaskSelect = { ...taskSelect, status: true, sceneCode: true, sceneVersion: true,
  createdAt: true, updatedAt: true, cancelRequestedAt: true } satisfies Prisma.AiTaskSelect;
const snapshotStepSelect = { id: true, taskId: true, scopeId: true, runId: true,
  sequence: true, revision: true, status: true, toolCode: true, resultRef: true } satisfies Prisma.AiStepSelect;
const snapshotSchema = z.object({
  contractVersion: z.literal(AI_TASK_DRAFT_VERSION), taskId: id, revision, status: z.enum(AI_TASK_STATUSES_DRAFT),
  sceneCode: id, sceneVersion: id, createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }), cancelRequestedAt: z.string().datetime({ offset: true }).nullable(),
  cursor: z.string().refine(value => { try { aiPersistenceEventCursor(value); return true; } catch { return false; } }),
  steps: z.array(z.object({ stepId: id, runId: id, sequence: revision, revision,
    status: z.enum(AI_STEP_STATUSES_DRAFT), resultId: id.optional(), kind: z.enum(['model', 'confirmation']).optional() }).strict()).max(1000)
}).strict();
const eventSelect = { scopeId: true, taskId: true, cursor: true, taskRevision: true, type: true, payload: true, occurredAt: true } satisfies Prisma.AiTaskEventSelect;
import { projectAiTaskWireEvent } from './task-event-projection';
export { projectAiTaskWireEvent } from './task-event-projection';

/** Internal polling source, not an SSE/HTTP route. Reauthorization is mandatory even on empty pages. */
export type TaskEventDatabase = Pick<PrismaClient, '$transaction' | 'aiTask' | 'aiRun'>;
export type TaskResultKind = (code: string) => 'model' | 'confirmation' | undefined;
export class TaskEventReader {
  constructor(private readonly db: TaskEventDatabase, private readonly access: Pick<TaskPersistenceRepository, 'resolveAccess'>,
    private readonly resultKind: TaskResultKind) {}

  /** Metadata and timeline share a RepeatableRead watermark. This does not
   * expose input/output bodies, worker tokens or approval evidence. Terminal
   * model result IDs are lookup keys only, not permission or success proof.
   * Reading never claims a run or restarts execution after a reset.
   */
  async readSnapshot(value: unknown, includeReadReferences = false): Promise<AiTaskSnapshotDraft> {
    const parsed = z.object({ taskId: id }).strict().safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError('AI_INVALID_INPUT');
    const taskId = parsed.data.taskId;
    const operations = ['read_metadata', 'read_events', 'read_step_terminal'] as const;
    const initial = structuredClone(await this.access.resolveAccess(taskId, operations[0]));
    for (const operation of operations.slice(1)) {
      const access = await this.access.resolveAccess(taskId, operation);
      if (access.bindingKey !== initial.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    let snapshot: AiTaskSnapshotDraft;
    try {
      snapshot = await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.where, select: snapshotTaskSelect });
        if (!task || task.contractVersion !== AI_TASK_DRAFT_VERSION) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
        if (task.id !== taskId || !id.safeParse(task.scopeId).success) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        const rows = await tx.aiStep.findMany({ where: { scopeId: task.scopeId, taskId }, select: snapshotStepSelect,
          orderBy: [{ runId: 'asc' }, { sequence: 'asc' }, { id: 'asc' }], take: 1001 });
        if (rows.length > 1000 || new Set(rows.map(row => row.id)).size !== rows.length
          || new Set(rows.map(row => JSON.stringify([row.runId, row.sequence]))).size !== rows.length
          || rows.some(row => row.taskId !== taskId || row.scopeId !== task.scopeId)) throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
        return snapshotSchema.parse({ contractVersion: AI_TASK_DRAFT_VERSION, taskId, revision: task.revision,
          status: task.status.toLowerCase(), sceneCode: task.sceneCode, sceneVersion: task.sceneVersion,
          createdAt: task.createdAt.toISOString(), updatedAt: task.updatedAt.toISOString(),
          cancelRequestedAt: task.cancelRequestedAt?.toISOString() ?? null, cursor: task.eventCursor.toString(),
          steps: rows.map(row => {
            const kind = includeReadReferences ? this.resultKind(row.toolCode) : undefined;
            return { stepId: row.id, runId: row.runId, sequence: row.sequence, revision: row.revision,
              status: row.status.toLowerCase(), ...(kind && { kind }),
              ...(kind === 'model' && ['SUCCEEDED', 'FAILED'].includes(row.status) && row.resultRef ? { resultId: row.resultRef } : {}) };
          }) });
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError('AI_STORAGE_UNAVAILABLE');
    }
    for (const operation of operations) {
      const current = await this.access.resolveAccess(taskId, operation);
      if (current.bindingKey !== initial.bindingKey) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
    }
    return snapshot;
  }

  async readPage(value: unknown): Promise<AiTaskEventPageDraft | AiTaskEventResetDraft> {
    const parsed = inputSchema.safeParse(value);
    if (!parsed.success) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
    const input = parsed.data;
    let after: bigint;
    try { after = aiPersistenceEventCursor(input.after); }
    catch { throw new AiTaskRepositoryError("AI_INVALID_INPUT"); }
    const initial = await this.access.resolveAccess(input.taskId, "read_events");
    let result: AiTaskEventPageDraft | AiTaskEventResetDraft;
    try {
      result = await this.db.$transaction(async tx => {
        const task = await tx.aiTask.findFirst({ where: initial.where, select: taskSelect });
        if (!task) throw new AiTaskRepositoryError("AI_RESOURCE_UNAVAILABLE");
        if (task.contractVersion !== AI_TASK_DRAFT_VERSION) return { contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, status: "reset_required", reason: "unsupported_version" };
        if (task.eventCursor < 0n || task.eventCursor > 18446744073709551615n || !revision.safeParse(task.revision).success) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
        if (after > task.eventCursor) throw new AiTaskRepositoryError("AI_INVALID_INPUT");
        const rows = await tx.aiTaskEvent.findMany({
          where: { scopeId: task.scopeId, taskId: task.id, cursor: { gt: after, lte: task.eventCursor } },
          select: eventSelect, orderBy: { cursor: "asc" }, take: input.limit + 1
        });
        let previous = after, previousRevision = 0;
        for (const row of rows) {
          if (row.scopeId !== task.scopeId || row.taskId !== task.id || row.cursor <= previous || row.cursor > task.eventCursor
            || !revision.safeParse(row.taskRevision).success || row.taskRevision < previousRevision || row.taskRevision > task.revision) {
            throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
          }
          previous = row.cursor; previousRevision = row.taskRevision;
        }
        // We cannot invent missing history. Explicit retained-prefix watermarks belong to the future retention policy.
        if (rows.length === 0 && after < task.eventCursor) return { contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, status: "reset_required", reason: "cursor_expired" };
        const events = rows.slice(0, input.limit).map(projectAiTaskWireEvent);
        const page: AiTaskEventPageDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, events,
          nextCursor: events.at(-1)?.cursor ?? input.after, hasMore: rows.length > input.limit
        };
        if (!isAiTaskEventPageConsistentDraft(page, input.after)) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
        return page;
      }, { isolationLevel: prismaRuntime.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
    } catch (error) {
      if (error instanceof AiTaskRepositoryError) throw error;
      throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
    }
    // Do not leak buffered history after logout/scope changes while the database was being read.
    const current = await this.access.resolveAccess(input.taskId, "read_events");
    if (initial.bindingKey !== current.bindingKey) throw new AiTaskRepositoryError("AI_ACCESS_DENIED");
    return result;
  }
}
