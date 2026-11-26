import type { Prisma } from '@prisma/client';
import { BudgetError } from '../runtime/budget/budget.ports';
import { aiPersistenceScopeColumns } from '../runtime/persistence-scope';

/** The original canonical Scope must still be the one preflight authorized. */
export async function assertPlatformFinanceScope(tx: Pick<Prisma.TransactionClient, 'aiScope'>, scopeId: string) {
  const columns = aiPersistenceScopeColumns({ kind: 'platform' });
  const scope = await tx.aiScope.findFirst({ where: columns });
  if (!scope || scope.id !== scopeId || scope.kind !== columns.kind || scope.scopeKey !== columns.scopeKey
    || scope.tenantId !== null || scope.workspaceId !== null) throw new BudgetError('FORBIDDEN');
}
