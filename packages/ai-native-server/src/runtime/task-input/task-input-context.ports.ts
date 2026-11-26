/** Authorized server-read context for one existing step. The scenario owns its field IDs. */
import type { AiTaskRunnerLease } from '@rental-os/platform-server/ai-runtime';

export interface TaskInputContext<Answer = { fieldId: string; value: string | number }> {
  requestId: string;
  receiptId: string;
  answers: readonly Answer[];
}
export interface TaskInputReader<Answer = { fieldId: string; value: string | number }> {
  readForStep(lease: AiTaskRunnerLease, registrationRef: string): Promise<readonly TaskInputContext<Answer>[]>;
}
