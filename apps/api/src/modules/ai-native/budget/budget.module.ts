import { BudgetService } from './budget.service';
import type { BudgetAuthority, BudgetEvidencePort, BudgetQuotePort, BudgetTransactionRepository } from './budget.ports';
import type { SubscriptionService } from '../../subscription/subscription.service';
import { ServerBudgetAuthorityAdapter, SubscriptionBudgetEntitlementAdapter, type BudgetAuthorizationSource } from './budget-dependency-adapters';
import { PrismaBudgetRepository } from './prisma-budget.repository';
import { PrismaSubscriptionBudgetReader } from './prisma-subscription-budget-reader';

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

export function createPersistedBudgetSubsystem(dependencies: {
  db: ConstructorParameters<typeof PrismaBudgetRepository>[0];
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  authorization: BudgetAuthorizationSource;
  quotes: BudgetQuotePort;
  evidence: BudgetEvidencePort;
  clock?: () => Date;
}): BudgetService {
  const reader = new PrismaSubscriptionBudgetReader(dependencies.db, dependencies.subscriptions, dependencies.clock);
  const authority = new ServerBudgetAuthorityAdapter(dependencies.authorization, new SubscriptionBudgetEntitlementAdapter(reader));
  return new BudgetService(new PrismaBudgetRepository(dependencies.db, dependencies.clock), authority, dependencies.quotes, dependencies.evidence, dependencies.clock);
}
