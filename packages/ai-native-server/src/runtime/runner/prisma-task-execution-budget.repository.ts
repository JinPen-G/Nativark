/** Original Rental constructor. Keeps its prior scope checks and host transaction boundary. */
import { withAiTaskTransaction } from '../task-transaction-authority';
import { TaskExecutionBudgetRepository } from './task-execution-budget.repository';
export type { AiTaskExecutionScopeSource } from './task-execution-budget.repository';

const transactions = { withAiTaskTransaction };
export class PrismaTaskExecutionBudgetRepository extends TaskExecutionBudgetRepository {
  constructor(db: ConstructorParameters<typeof TaskExecutionBudgetRepository>[0],
    scopes: ConstructorParameters<typeof TaskExecutionBudgetRepository>[1],
    policies: ConstructorParameters<typeof TaskExecutionBudgetRepository>[2],
    evidence?: ConstructorParameters<typeof TaskExecutionBudgetRepository>[3], clock: () => Date = () => new Date()) {
    super(db, scopes, policies, evidence, clock, transactions);
  }
}
