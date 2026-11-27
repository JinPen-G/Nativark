/** Closed original Task event projection shared by reads and retention. */
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT, AI_TASK_TRANSITION_REASONS_DRAFT,
  AI_STEP_TRANSITION_REASONS_DRAFT, type AiTaskEventDraft } from '@rental-os/platform-contracts/ai-task';
import { AiTaskRepositoryError } from '../task-errors';
const id = z.string().min(1).max(191).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u);
const revision = z.number().int().positive().max(4294967295);
const dataSchemas = {
  "task.transition": z.object({ from: z.enum(AI_TASK_STATUSES_DRAFT), to: z.enum(AI_TASK_STATUSES_DRAFT), reason: z.enum(AI_TASK_TRANSITION_REASONS_DRAFT) }).strict(),
  "step.registered": z.object({ stepId: id, runId: id, sequence: revision, stepRevision: z.literal(1) }).strict(),
  "step.changed": z.object({ stepId: id, runId: id, stepRevision: revision, status: z.enum(AI_STEP_STATUSES_DRAFT), reason: z.enum(AI_STEP_TRANSITION_REASONS_DRAFT) }).strict(),
  "task.output_ready": z.object({ resultId: id }).strict(),
  "task.input_refreshed": z.object({ requestId: id, previousRevision: revision, revision }).strict()
    .refine(data => data.revision === data.previousRevision + 1),
  "access.revoked": z.object({ code: z.enum(["AI_ACCESS_DENIED", "AI_SCOPE_CHANGED"]) }).strict()
};
type EventRow = Pick<Prisma.AiTaskEventGetPayload<{}>, 'scopeId' | 'taskId' | 'cursor' | 'taskRevision' | 'occurredAt' | 'type' | 'payload'>;

/** Decode only declared wire fields. The internal audit envelope never leaves this function. */
export function projectAiTaskWireEvent(row: EventRow): AiTaskEventDraft {
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
    case "task.input_refreshed": return { ...base, type: row.type, data: dataSchemas[row.type].parse(envelope.data.data) };
    case "access.revoked": return { ...base, type: row.type, data: dataSchemas[row.type].parse(envelope.data.data) };
    default: throw new AiTaskRepositoryError("AI_STORAGE_UNAVAILABLE");
  }
}

