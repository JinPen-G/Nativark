import { BudgetService } from './budget.service';
import type { BudgetAuthority, BudgetEvidencePort, BudgetQuotePort, BudgetTransactionRepository } from './budget.ports';

export interface BudgetSubsystemDependencies {
  repository: BudgetTransactionRepository;
  authority: BudgetAuthority;
  quotes: BudgetQuotePort;
  evidence: BudgetEvidencePort;
}

/** Explicit composition helper. It creates no Nest provider, route, worker or
 * production feature flag; missing dependencies fail closed in BudgetService. */
export function createBudgetSubsystem(dependencies: BudgetSubsystemDependencies): BudgetService {
  return new BudgetService(dependencies.repository, dependencies.authority, dependencies.quotes, dependencies.evidence);
}
