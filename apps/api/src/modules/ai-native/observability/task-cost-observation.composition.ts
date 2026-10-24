/** Explicit mainline entry for authorized cost/accounting observation. This
 * composes the EXISTING usage/performance readers with the counting-receipt
 * diagnostics — no second query service, no telemetry store, no SLO claim.
 * Everything here is read-only: no lease, no dispatch, no settlement, no
 * release; unknown outcomes stay unknown and missing records never become
 * zero consumption. */
import type { AiScopeRepository } from '../ai-scope.repository';
import type { AiTaskRepositoryAuthority } from '../ai-task.repository';
import { TaskBudgetUsageReader, type TaskBudgetUsageDb } from '../budget/task-budget-usage.reader';
import { TaskPerformanceReader } from './task-performance.reader';
import { BudgetError } from '../budget/budget.ports';

export interface CountingReceiptObservationSource {
  readCountReceipt(command: unknown): Promise<Record<string, unknown>>;
}
export interface TaskCostObservationDependencies {
  db: TaskBudgetUsageDb & ConstructorParameters<typeof TaskPerformanceReader>[0];
  actions: Pick<AiTaskRepositoryAuthority, 'resolve'>;
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  counting: CountingReceiptObservationSource;
  clock?: () => Date;
}
export interface TaskCostObservationResult {
  page: Awaited<ReturnType<TaskBudgetUsageReader['read']>>;
  summary: Awaited<ReturnType<TaskBudgetUsageReader['summary']>>;
  counting: Array<{ invocationId: string; receipt: Record<string, unknown> }>;
  semantics: { execution: 'read_only_no_dispatch_or_release';
    basis: 'persisted_budget_records_not_provider_invoice';
    countingBasis: 'provider_count_tokens_receipt_not_generation_usage';
    absence: 'no_record_is_not_proof_of_no_consumption' };
}

/** One composition root for the mainline: usage pagination/summary (now
 * including counting admissions as their own reservations), running
 * observations, and per-invocation counting diagnostics for handoff. */
export function composeTaskCostObservation(input: TaskCostObservationDependencies) {
  if (!input?.db || typeof input.actions?.resolve !== 'function' || typeof input.scopes?.resolveCurrent !== 'function'
    || typeof input.counting?.readCountReceipt !== 'function' || input.clock !== undefined && typeof input.clock !== 'function')
    throw new BudgetError('UNAVAILABLE');
  const clock = input.clock ?? (() => new Date());
  const usage = new TaskBudgetUsageReader(input.db, input.actions, input.scopes, clock);
  const performance = new TaskPerformanceReader(input.db, input.actions, usage, clock);
  /** Combined deterministic view over one usage page: the page, the task
   * summary, and the counting diagnostics for every invocation that actually
   * has a receipt. Receipt absence is reported by omission, never as zero. */
  const taskCosts = async (value: unknown): Promise<TaskCostObservationResult> => {
    const page = await usage.read(value);
    const counting: TaskCostObservationResult['counting'] = [];
    const seen = new Set<string>();
    for (const item of page.items) {
      if (seen.has(item.invocationId)) continue;
      seen.add(item.invocationId);
      try {
        const receipt = await input.counting.readCountReceipt({ invocationId: item.invocationId });
        counting.push({ invocationId: item.invocationId, receipt });
      } catch (error) {
        // No counting receipt for this invocation is a valid state.
        if (!(error instanceof BudgetError && error.code === 'UNAVAILABLE')) throw error;
      }
    }
    const summary = await usage.summary({ taskId: page.taskId });
    return { page, summary, counting, semantics: { execution: 'read_only_no_dispatch_or_release',
      basis: 'persisted_budget_records_not_provider_invoice',
      countingBasis: 'provider_count_tokens_receipt_not_generation_usage',
      absence: 'no_record_is_not_proof_of_no_consumption' } };
  };
  return Object.freeze({ usage, performance, taskCosts });
}
