/** Original persisted confirmation observations, never execution authority. */
import { AI_TASK_STATUSES_DRAFT } from './ai-task-draft';
import { leafClosed as object, leafEnum as choice, leafInt as integer, leafList as list,
  leafText as text, leafTime as time, type AiLeafSchemaDraft } from './ai-gateway-draft-schemas';

export interface AiTaskConfirmationHistoryDraft {
  version: 'task-confirmation-history-1'; taskId: string; runId: string; stepId: string;
  task: { status: string; revision: number; cursor: string };
  phases: Array<{ phaseId: string; sequence: 1 | 2; startedAt: string;
    receiptId: string | null; kind: 'confirmation' | 'succeeded' | 'failed' | 'unknown' | null }>;
  transitions: Array<{ kind: 'paused' | 'continued'; taskRevision: number; cursor: string; observedAt: string }>;
  execution: 'read_only_no_claim_or_dispatch'; businessOutcome: 'not_attested';
  absenceSemantics: 'not_observed_is_not_proof_of_not_executed';
}

const id = text(36), revision = integer(1, 4294967295);
const cursor: AiLeafSchemaDraft = { type: 'string', pattern: '^(0|[1-9][0-9]{0,19})$' };
export const AI_TASK_CONFIRMATION_HISTORY_SCHEMAS: Record<string, AiLeafSchemaDraft> = {
  AiTaskConfirmationHistoryDraft: object({ version: choice('task-confirmation-history-1'), taskId: id, runId: id, stepId: id,
    task: object({ status: choice(...AI_TASK_STATUSES_DRAFT), revision, cursor }),
    phases: list(object({ phaseId: id, sequence: integer(1, 2), startedAt: time,
      receiptId: { oneOf: [id, { type: 'null' }] },
      kind: { oneOf: [choice('confirmation', 'succeeded', 'failed', 'unknown'), { type: 'null' }] } }), 2),
    transitions: list(object({ kind: choice('paused', 'continued'), taskRevision: revision, cursor, observedAt: time }), 2),
    execution: choice('read_only_no_claim_or_dispatch'), businessOutcome: choice('not_attested'),
    absenceSemantics: choice('not_observed_is_not_proof_of_not_executed') })
};
