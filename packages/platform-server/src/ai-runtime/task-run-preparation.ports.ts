/** 原准备阶段的资源端口。只关联受权计划、原预占及同一租约，不授权模型派发或业务执行。 */
import type { AiTaskRunnerLease, AiTaskRunnerPlan, AiTaskRunnerOverheadTicket } from './ai-task-runner.ports';

export type AiTaskPreparationDefinition = Omit<AiTaskRunnerPlan, 'taskRevision'> & { bindingHash: string };
export interface AiTaskPreparationTicket {
  key: string;
  prepared: boolean;
  /** Original reservation minus this preparation's already spent admission time.
   * Required for a new callback; a completed original receipt has no work window. */
  remainingMs?: number;
}
export interface AiTaskPreparationResources {
  begin(lease: AiTaskRunnerLease, definition: AiTaskPreparationDefinition | undefined, maximumMs: number,
    signal?: AbortSignal): Promise<AiTaskPreparationTicket>;
  complete(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease): Promise<void>;
  /** Atomic original measurement/settlement and startup reservation. Only a
   * fresh same-process preparation may hand over; a receipt is not a clock. */
  handoff?(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease, recovery: boolean,
    retainStepAllowance: boolean): Promise<AiTaskRunnerOverheadTicket>;
  abandon(ticket: AiTaskPreparationTicket, lease: AiTaskRunnerLease): Promise<void>;
}
