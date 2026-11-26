/** Public budget assembly uses the same reservation and ledger tables as the
 * compatibility host. Settings authority and Task participation are explicit. */
import type { Prisma } from '@prisma/client';
import type { createAiTaskTransactionBoundary } from '../../task-transactions';
import { BudgetError } from './budget.ports';
import { PrismaBudgetLedgerRepository, type BudgetLedgerDatabase, type BudgetLedgerTransactionHooks } from './prisma-budget-ledger.repository';

export { BudgetError } from './budget.ports';
export type { BudgetAuthority, BudgetEvidencePort, BudgetQuotePort } from './budget.ports';
export { BudgetService } from './budget.service';

type TaskTransactions = Pick<ReturnType<typeof createAiTaskTransactionBoundary<Prisma.TransactionClient>>, 'withAiTaskTransaction'>;

export function createPublicBudgetLedger(input: {
  db: BudgetLedgerDatabase;
  taskTransactions?: TaskTransactions;
  settingsTransactions?: Pick<BudgetLedgerTransactionHooks, 'beginSettings'>;
  recovery?: 'original_task';
  nativeAuthorization?: true;
  clock?: () => Date;
}) {
  const begin = input.settingsTransactions?.beginSettings.bind(input.settingsTransactions);
  const task = input.taskTransactions?.withAiTaskTransaction.bind(input.taskTransactions);
  const recoverOriginal = input.recovery === 'original_task';
  return new PrismaBudgetLedgerRepository(input.db, {
    nativeAuthorization: input.nativeAuthorization,
    async beginSettings(tx, key, settings, operation) {
      const lease = await begin?.(tx, key, settings, operation);
      if (!lease || typeof lease.revalidate !== 'function' || typeof lease.close !== 'function') throw new BudgetError('UNAVAILABLE');
      return lease;
    },
    withTask(tx, stepId, action, work) {
      // An already-dispatched call keeps its accounting obligation even when
      // Task/scene admission is no longer available. Original usage evidence
      // remains mandatory in BudgetService and the original ledger checks.
      if (action !== 'reserve' && action !== 'dispatch'
        && !(recoverOriginal && (action === 'release' || action === 'reconcile'))) return work();
      if (!task) throw new BudgetError('FORBIDDEN');
      return task(tx, { kind: 'step', stepId }, work);
    }
  }, input.clock);
}
