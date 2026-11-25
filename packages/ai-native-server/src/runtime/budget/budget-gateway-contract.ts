import { BudgetError } from './budget.ports';

export type GatewayBudgetOutcome = 'before_dispatch' | 'dispatch_claimed' | 'completed' | 'failed_not_dispatched' | 'unknown' | 'reconciled';
export type GatewayBudgetMethod = 'reserve' | 'dispatch' | 'settle' | 'release' | 'markUnknown' | 'reconcile';

/**
 * Contract only: this module does not dispatch a provider and does not choose
 * a winner. The Gateway retains dispatch ownership and calls the corresponding
 * budget method exactly once for this invocation ledger.
 */
export function budgetMethodForGatewayOutcome(outcome: GatewayBudgetOutcome): GatewayBudgetMethod {
  switch (outcome) {
    case 'before_dispatch': return 'reserve';
    case 'dispatch_claimed': return 'dispatch';
    case 'completed': return 'settle';
    case 'failed_not_dispatched': return 'release';
    case 'unknown': return 'markUnknown';
    case 'reconciled': return 'reconcile';
  }
}

export function assertGatewayBudgetEvidence(outcome: GatewayBudgetOutcome, evidence: { dispatchToken?: string | null; usageRef?: string | null; provesNotDispatched?: boolean } = {}) {
  if (outcome === 'completed' || outcome === 'reconciled') {
    if (!evidence.dispatchToken || !evidence.usageRef) throw new BudgetError('PENDING_RECONCILIATION');
  }
  if (outcome === 'unknown' && !evidence.dispatchToken) throw new BudgetError('PENDING_RECONCILIATION');
  if (outcome === 'failed_not_dispatched' && evidence.provesNotDispatched !== true) throw new BudgetError('PENDING_RECONCILIATION');
  if (outcome === 'dispatch_claimed' && !evidence.dispatchToken) throw new BudgetError('FORBIDDEN');
}
