import { Prisma, type PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT,
  AI_TASK_TRANSITION_REASONS_DRAFT, AI_STEP_TRANSITION_REASONS_DRAFT,
  type AiTaskEventDraft, type AiTaskEventPageDraft, type AiTaskEventResetDraft
} from "@rental-os/shared";
import { AiTaskRepository, AiTaskRepositoryError, type AiTaskRepositoryAuthority } from "./ai-task.repository";
import { aiPersistenceEventCursor } from "./persistence-scope";
import { isAiTaskEventPageConsistentDraft } from "./task-transition-draft";

const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().positive().max(4294967295);
const inputSchema = z.object({ taskId: id, after: z.string().min(1).max(20), limit: z.number().int().min(1).max(100) }).strict();
const dataSchemas = {
  "task.transition": z.object({ from: z.enum(AI_TASK_STATUSES_DRAFT), to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.enum(AI_TASK_TRANSITION_REASONS_DRAFT) }).strict(),
  "step.registered": z.object({ stepId: id, runId: id, sequence: revision, stepRevision: z.literal(1) }).strict(),
  "step.changed": z.object({ stepId: id, runId: id, stepRevision: revision, status: z.enum(AI_STEP_STATUSES_DRAFT), reason: z.enum(AI_STEP_TRANSITION_REASONS_DRAFT) }).strict(),
  "task.output_ready": z.object({ resultId: id }).strict(),
  "access.revoked": z.object({ code: z.enum(["AI_ACCESS_DENIED", "AI_SCOPE_CHANGED"]) }).strict()
};
const taskSelect = { id: true, scopeId: true, revision: true, contractVersion: true, eventCursor: true } satisfies Prisma.AiTaskSelect;
const eventSelect = { scopeId: true, taskId: true, cursor: true, taskRevision: true, type: true, payload: true, occurredAt: true } satisfies Prisma.AiTaskEventSelect;
type EventRow = Prisma.AiTaskEventGetPayload<{ select: typeof eventSelect }>;

/** Decode only declared wire fields. The internal audit envelope never leaves this function. */
function wireEvent(row: EventRow): AiTaskEventDraft {
  if (!revision.safeParse(row.taskRevision).success || !(row.occurredAt instanceof Date) || !Number.isFinite(row.occurredAt.getTime())) {
    throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
  }
  const envelope = z.object({ data: z.unknown() }).safeParse(row.payload);
  if (!envelope.success) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
  const base = { contractVersion: AI_TASK_DRAFT_VERSION, taskId: row.taskId, cursor: row.cursor.toString(), taskRevision: row.taskRevision, occurredAt: row.occurredAt.toISOString() };
  switch (row.type) {
    case "task.transition": return { ...base, type: row.type, data: dataSchemas[row.type].parse(envelope.data.data) };
    case "step.registered": return { ...base, type: row.type, data: dataSchemas[row.type].parse(envelope.data.data) };
    case "step.changed": return { ...base, type: row.type, data: dataSchemas[row.type].parse(envelope.data.data) };
    case "task.output_ready": return { ...base, type: row.type, data: dataSchemas[row.type].parse(envelope.data.data) };
    case "access.revoked": return { ...base, type: row.type, data: dataSchemas[row.type].parse(envelope.data.data) };
    default: throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
  }
}

/** Internal polling source, not an SSE/HTTP route. Reauthorization is mandatory even on empty pages. */
export class AiTaskEventRepository {
  private readonly access: AiTaskRepository;
  constructor(db: Pick<PrismaClient, "$transaction" | "aiTask" | "aiRun">, authority: AiTaskRepositoryAuthority, clock: () => Date = () => new Date()) {
    this.db = db;
    this.access = new AiTaskRepository(db, authority, clock);
  }
  private readonly db: Pick<PrismaClient, "$transaction" | "aiTask" | "aiRun">;

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
        const events = rows.slice(0, input.limit).map(wireEvent);
        const page: AiTaskEventPageDraft = {
          contractVersion: AI_TASK_DRAFT_VERSION, taskId: task.id, events,
          nextCursor: events.at(-1)?.cursor ?? input.after, hasMore: rows.length > input.limit
        };
        if (!isAiTaskEventPageConsistentDraft(page, input.after)) throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
        return page;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, maxWait: 2500, timeout: 5000 });
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
