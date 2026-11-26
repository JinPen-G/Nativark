/** Public Task cumulative accounting. Reuses the original charge rows and
 * lease/CAS rules; model financial accounting remains in the separate ledger. */
import { isStrictAiTaskTransactionBoundary } from './task-transactions';
import { AiTaskExecutionBudgetError, type AiTaskExecutionPolicySource } from './runtime/task-execution-budget.ports';
import { TaskExecutionBudgetRepository } from './runtime/runner/task-execution-budget.repository';

export { AiTaskExecutionBudgetError, AiTaskExecutionPreReservationLimitError } from './runtime/task-execution-budget.ports';
export type { AiTaskExecutionBudgetPort, AiTaskExecutionLease, AiTaskExecutionChargeRequest,
  AiTaskExecutionEvidenceSource, AiTaskExecutionPolicySource, AiTaskExecutionChargeEvidence,
  AiTaskExecutionPolicy, AiTaskExecutionSettlementRequest } from './runtime/task-execution-budget.ports';
export type { AiTaskExecutionScopeSource } from './runtime/runner/task-execution-budget.repository';

type Repository = ConstructorParameters<typeof TaskExecutionBudgetRepository>;
type Boundary = import('./task-transactions').AiTaskTransactionBoundary<import('@prisma/client').Prisma.TransactionClient>;

export function createPublicAiTaskResourceLedger(input: {
  db: Repository[0];
  /** Use the supplied Native inside writes. `settle` and `settle_released_run`
   * use current original-result authority; only `write` admits new work. */
  scopes: Repository[1];
  policies: Required<AiTaskExecutionPolicySource>;
  evidence: NonNullable<Repository[3]>;
  transactions: Boundary;
  clock?: () => Date;
}) {
  if (!isStrictAiTaskTransactionBoundary(input?.transactions) || typeof input.evidence?.read !== 'function'
    || typeof input.policies?.resolveReconciliation !== 'function')
    throw new AiTaskExecutionBudgetError('AI_RESOURCE_UNAVAILABLE');
  return new TaskExecutionBudgetRepository(input.db, input.scopes, input.policies,
    input.evidence, input.clock ?? (() => new Date()), input.transactions, true);
}
