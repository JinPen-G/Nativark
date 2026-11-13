/** Shared metadata and committed timeline projections. SSE and polling consume
 * the same event; a cursor or snapshot never grants execution or source access. */
import { AI_TASK_DRAFT_VERSION, AI_TASK_STATUSES_DRAFT, AI_STEP_STATUSES_DRAFT,
  AI_TASK_TRANSITION_REASONS_DRAFT, AI_STEP_TRANSITION_REASONS_DRAFT } from './ai-task-draft';
import type { AiSceneRequestReadDraft } from './ai-scene-request-draft';
import { leafClosed as object, leafEnum as choice, leafId as id, leafInt as integer,
  leafList as list, leafRef as ref, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export interface AiOriginalTaskEventsReadDraft { original: AiSceneRequestReadDraft; after: string; limit: number }
const version = choice(AI_TASK_DRAFT_VERSION), status = choice(...AI_TASK_STATUSES_DRAFT);
const revision = integer(1, Number.MAX_SAFE_INTEGER), time: AiLeafSchemaDraft = { type: 'string', format: 'date-time', maxLength: 40 };
const cursor: AiLeafSchemaDraft = { type: 'string', minLength: 1, maxLength: 20, pattern: '^(0|[1-9][0-9]*)$' };
const positiveCursor: AiLeafSchemaDraft = { type: 'string', minLength: 1, maxLength: 20, pattern: '^[1-9][0-9]*$' };
const nullable = (schema: AiLeafSchemaDraft): AiLeafSchemaDraft => ({ ...schema, type: [schema.type as string, 'null'] });
const eventBase = { contractVersion: version, taskId: id(), cursor: positiveCursor, taskRevision: revision, occurredAt: time };

export const AI_TASK_OBSERVATION_DRAFT_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTaskEventDraft: { oneOf: [
    object({ ...eventBase, type: choice('task.transition'), data: object({ from: status, to: status, reason: choice(...AI_TASK_TRANSITION_REASONS_DRAFT) }) }),
    object({ ...eventBase, type: choice('step.registered'), data: object({ stepId: id(), runId: id(), sequence: integer(1, 4294967295), stepRevision: { type: 'integer', enum: [1] } }) }),
    object({ ...eventBase, type: choice('step.changed'), data: object({ stepId: id(), runId: id(), stepRevision: revision,
      status: choice(...AI_STEP_STATUSES_DRAFT), reason: choice(...AI_STEP_TRANSITION_REASONS_DRAFT) }) }),
    object({ ...eventBase, type: choice('task.output_ready'), data: object({ resultId: id() }) }),
    object({ ...eventBase, type: choice('task.input_refreshed'), data: object({ requestId: id(), previousRevision: revision, revision }) }),
    object({ ...eventBase, type: choice('access.revoked'), data: object({ code: choice('AI_ACCESS_DENIED', 'AI_SCOPE_CHANGED') }) })] },
  AiTaskEventPageDraft: object({ contractVersion: version, taskId: id(), events: list(ref('AiTaskEventDraft'), 100), nextCursor: cursor, hasMore: { type: 'boolean' } }),
  AiTaskEventsObservationDraft: { oneOf: [ref('AiTaskEventPageDraft'), ref('AiTaskEventResetDraft')] },
  AiTaskSnapshotDraft: object({ contractVersion: version, taskId: id(), revision, status, sceneCode: id(), sceneVersion: id(),
    createdAt: time, updatedAt: time, cancelRequestedAt: nullable(time), cursor,
    steps: list(object({ stepId: id(), runId: id(), sequence: revision, revision, status: choice(...AI_STEP_STATUSES_DRAFT),
      resultId: id(), kind: choice('model', 'confirmation') }, ['stepId', 'runId', 'sequence', 'revision', 'status']), 1000) }),
  AiTaskEventResetDraft: object({ contractVersion: version, taskId: id(), status: choice('reset_required'), reason: choice('cursor_expired', 'unsupported_version') }),
  AiTaskMetadataQueryDraft: object({ limit: integer(1, 50), cursor: { type: 'string', maxLength: 512 }, status, sceneCode: id(),
    initiatorId: id(), createdFrom: time, createdBefore: time }, []),
  AiTaskMetadataPageDraft: object({ items: list(object({ taskId: id(), status, revision, sceneCode: id(), sceneVersion: id(),
    createdAt: time, updatedAt: time, cancelRequestedAt: nullable(time) }), 50), nextCursor: { type: ['string', 'null'], maxLength: 512 } })
};
