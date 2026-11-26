/** Rental-only deployment selection. Called after Auth/Tenant/Core and before
 * business/Task locks; control reads cannot grant new work or acquire late locks. */
import type { Prisma } from '@prisma/client';
import { createMysqlCoreDeploymentAdmission } from '@rental-os/core-host/mysql-deployment-admission';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { AiTaskRepositoryError } from '../../task-errors';

export async function holdAiTaskDeploymentAdmission(tx: Prisma.TransactionClient, purpose: 'new_work' | 'task_control') {
  if (!hasRentalBusinessTenantFence()) return Object.freeze({ requireNewWork() {} });
  if ('$transaction' in tx) throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
  const admission = createMysqlCoreDeploymentAdmission(tx);
  let accepting = false;
  if (purpose === 'new_work') {
    try { await admission.requireAccepting('rental'); accepting = true; }
    catch { throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE'); }
  } else accepting = (await admission.readCurrent('rental')).state === 'accepting';
  return Object.freeze({ requireNewWork() {
    if (!accepting) throw new AiTaskRepositoryError('AI_RESOURCE_UNAVAILABLE');
  } });
}
