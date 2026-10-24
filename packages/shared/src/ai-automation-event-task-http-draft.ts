/** Explicit event-to-task metadata handoff. It never starts a run or grants
 * automation execution; uncertain writes are observed by the original event. */
import { AI_TASK_STATUSES_DRAFT, type AiTaskStatusDraft } from './ai-task-draft';
import { AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT } from './ai-automation-review-queue-http-draft';
import { leafClosed as object, leafEnum as choice, leafInt as integer, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export const AI_AUTOMATION_EVENT_TASK_HTTP_DRAFT = {
  ...AI_AUTOMATION_REVIEW_QUEUE_HTTP_DRAFT, operation: 'tasks/from-event'
} as const;
export interface AiAutomationEventTaskRequestDraft { eventId: string }
type Base = {
  eventId: string; inputRef: string; creationKey: string;
  dispatchRequested: false; confirmationGranted: false;
  executionPermission: false; businessActionRequested: false;
  workerStarted: false; automaticRetry: false; execution: 'metadata_only_no_dispatch';
};
export type AiAutomationEventTaskResponseDraft = Base & (
  | { inputState: 'unknown'; creationState: 'not_attempted'; task: null; nextAction: 'read_original_event' }
  | { inputState: 'prepared'; creationState: 'unknown' | 'not_observed'; task: null; nextAction: 'read_original_creation' }
  | { inputState: 'prepared'; creationState: 'observed'; task: {
      taskId: string; runId: string; status: AiTaskStatusDraft; revision: number; replayed: boolean
    }; nextAction: 'read_original_task' });

const uuid: AiLeafSchemaDraft = { type: 'string', format: 'uuid' };
const key: AiLeafSchemaDraft = { type: 'string', minLength: 1, maxLength: 191, pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]*$' };
const no: AiLeafSchemaDraft = { type: 'boolean', const: false };
const base = { eventId: uuid, inputRef: uuid, creationKey: key, dispatchRequested: no,
  confirmationGranted: no, executionPermission: no, businessActionRequested: no,
  workerStarted: no, automaticRetry: no, execution: choice('metadata_only_no_dispatch') };
export const AI_AUTOMATION_EVENT_TASK_HTTP_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiAutomationEventTaskRequestDraft: object({ eventId: uuid }),
  AiAutomationEventTaskResponseDraft: { oneOf: [
    object({ ...base, inputState: choice('unknown'), creationState: choice('not_attempted'), task: { type: 'null' },
      nextAction: choice('read_original_event') }),
    object({ ...base, inputState: choice('prepared'), creationState: choice('unknown', 'not_observed'), task: { type: 'null' },
      nextAction: choice('read_original_creation') }),
    object({ ...base, inputState: choice('prepared'), creationState: choice('observed'), task: object({
      taskId: uuid, runId: uuid, status: choice(...AI_TASK_STATUSES_DRAFT), revision: integer(1, 4294967295), replayed: { type: 'boolean' } }),
      nextAction: choice('read_original_task') })] }
};
