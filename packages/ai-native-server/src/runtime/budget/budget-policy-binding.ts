import { BudgetError, type BudgetQuote } from './budget.ports';
import { byokMeterScene } from './byok-usage-meter';
import { platformCreditScene } from './platform-credit-policy';

/** Business scenes and private meter policy keys are different identities.
 * Only the deterministic original configuration/price mapping is accepted;
 * this validation grants no policy, allowance or dispatch permission. */
export function assertBudgetPolicyBinding(quote: BudgetQuote, sceneCode: string): void {
  const consumer = quote.consumerScope, association = quote.association;
  if (!consumer || !Array.isArray(quote.policies) || !quote.policies.some(policy =>
    policy.scopeId === consumer.scopeId && policy.scopeKind === consumer.scopeKind && policy.sceneCode === consumer.sceneCode)) {
    throw new BudgetError('INVALID');
  }
  let expected = (_kind: string) => sceneCode;
  if (consumer.sceneCode !== sceneCode) {
    if (association.config.serviceMode === 'tenant_managed' && association.scope.kind !== 'platform'
      && quote.quantity.unit === 'calls' && consumer.sceneCode === byokMeterScene(sceneCode, association)) {
      expected = () => byokMeterScene(sceneCode, association);
    } else if (association.config.serviceMode === 'platform_managed' && association.scope.kind === 'workspace'
      && quote.quantity.unit === 'money' && consumer.scopeKind === 'WORKSPACE'
      && consumer.sceneCode === platformCreditScene(sceneCode, association)) {
      expected = kind => kind === 'PLATFORM' ? sceneCode : platformCreditScene(sceneCode, association);
    } else throw new BudgetError('INVALID');
  }
  if (quote.policies.some(policy => policy.sceneCode !== expected(policy.scopeKind))) throw new BudgetError('INVALID');
}
