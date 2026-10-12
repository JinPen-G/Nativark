import type { AiExecutionContext } from '@rental-os/shared';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { BudgetError } from './budget.ports';

/** Normalize an already server-authorized current principal. This neither
 * resolves credentials nor grants task, budget, configuration or dispatch rights.
 * Customer and user IDs share no ownership namespace. */
export function gatewayBudgetPrincipal(value: AiExecutionContext) {
  const context = structuredClone(value);
  if (!isAiStepExecutionContext(context) || context.scope.kind !== 'workspace') throw new BudgetError('FORBIDDEN');
  const subject = context.audience === 'client' && context.actor.kind === 'customer'
    ? { actorId: context.actor.customerId, actorKind: 'CUSTOMER' as const }
    : ['operator', 'staff'].includes(context.audience) && context.actor.kind === 'user'
      ? { actorId: context.actor.userId, actorKind: 'USER' as const } : null;
  if (!subject) throw new BudgetError('FORBIDDEN');
  return { ...subject, tenantId: context.scope.tenantId, workspaceId: context.scope.workspaceId };
}
