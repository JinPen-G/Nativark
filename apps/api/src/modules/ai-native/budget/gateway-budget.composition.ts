import type { AiScopeRepository } from '../ai-scope.repository';
import type { SubscriptionService } from '../../subscription/subscription.service';
import type { BudgetQuotePort } from './budget.ports';
import type { BudgetAuthorizationSource } from './budget-dependency-adapters';
import { PersistedBudgetEvidenceAdapter } from './budget-dependency-adapters';
import { BudgetGatewayAdapter } from './budget-gateway-adapter';
import { createPersistedBudgetSubsystem } from './budget.module';
import { PersistentGatewayBudget } from './persistent-gateway-budget';
import { PrismaGatewayAccountingFacts, type GatewayActualUsagePricing } from './prisma-gateway-accounting-facts';
import { PrismaGatewayInvocationBindings } from './prisma-gateway-invocation-bindings';

export function createPersistedGatewayBudget(input: {
  db: ConstructorParameters<typeof PrismaGatewayInvocationBindings>[0] & ConstructorParameters<typeof PrismaGatewayAccountingFacts>[0];
  scopes: Pick<AiScopeRepository, 'resolveCurrent'>;
  subscriptions: Pick<SubscriptionService, 'readCategoryCommercialContext'>;
  authorization: BudgetAuthorizationSource;
  pricing: BudgetQuotePort & GatewayActualUsagePricing;
  clock?: () => Date;
}) {
  const bindings = new PrismaGatewayInvocationBindings(input.db, input.scopes, input.clock);
  const facts = new PrismaGatewayAccountingFacts(input.db, bindings, input.scopes, input.pricing, input.clock);
  const service = createPersistedBudgetSubsystem({ db: input.db, subscriptions: input.subscriptions, authorization: input.authorization,
    quotes: input.pricing, evidence: new PersistedBudgetEvidenceAdapter(facts), clock: input.clock });
  return { bindings, budget: new PersistentGatewayBudget(new BudgetGatewayAdapter(service, bindings), facts) };
}
