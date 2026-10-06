import type { AiTaskInputAnswerDraft, AiTaskInputContractDraft } from '@rental-os/shared';
import type { AiTaskRunnerLease } from '../runner/ai-task-runner.ports';

export interface AiTaskInputBinding {
  scopeId: string;
  taskId: string;
  runId: string;
  stepId: string;
  registrationRef: string;
  toolCode: string;
  toolVersion: string;
  planHash: string;
  planRevision: number;
  inputRef: string;
  inputHash: string;
  basisResultRef: string;
}

export type AiTaskInputRequirement = { kind: 'not_required' } | {
  kind: 'required';
  contract: AiTaskInputContractDraft;
  inputRef: string;
  inputHash: string;
  expiresAt: string;
};

export interface AiTaskInputSource {
  resolve(binding: Readonly<AiTaskInputBinding>): Promise<AiTaskInputRequirement>;
  validateAnswers(binding: Readonly<AiTaskInputBinding>, contract: AiTaskInputContractDraft, answers: readonly AiTaskInputAnswerDraft[]): Promise<{
    disposition: 'context_only'; planHash: string; inputRef: string; inputHash: string;
  }>;
}

export interface AiTaskInputContext {
  requestId: string;
  receiptId: string;
  answers: readonly AiTaskInputAnswerDraft[];
}
export interface AiTaskInputReader {
  readForStep(lease: AiTaskRunnerLease, registrationRef: string): Promise<readonly AiTaskInputContext[]>;
}
