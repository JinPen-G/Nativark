import type { AiExecutionContext } from '@rental-os/shared';
import { isAiStepExecutionContext } from '../task-contract-validation';
import { BudgetError } from './budget.ports';

/** Explicit SaaS/platform budget principal. No tenant/workspace fields exist to
 * borrow: platform consumers must never be charged through a tenant policy. */
export interface GatewayPlatformBudgetPrincipal {
  actorKind: 'SAAS_ADMIN';
  actorId: string;
}

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

/** Platform-scope counterpart of gatewayBudgetPrincipal for the SaaS operator
 * audience only. A workspace/customer context stays FORBIDDEN here, so a
 * platform ledger row can never be attributed to a tenant member. */
export function gatewayPlatformBudgetPrincipal(value: AiExecutionContext): GatewayPlatformBudgetPrincipal {
  const context = structuredClone(value);
  if (!isAiStepExecutionContext(context) || context.scope.kind !== 'platform'
    || context.audience !== 'operator' || context.actor.kind !== 'saas_admin') throw new BudgetError('FORBIDDEN');
  return { actorKind: 'SAAS_ADMIN', actorId: context.actor.userId };
}
