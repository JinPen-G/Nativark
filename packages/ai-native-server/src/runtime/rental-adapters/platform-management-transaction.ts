/** Rental selected-host adapter for the public management transaction boundary.
 * Original sorted principal/Tenant locks and final data checks stay in Core. */
import type { Prisma } from '@prisma/client';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasRentalBusinessTenantFence, lockRentalBusinessTenant,
  assertRentalBusinessTenantAccessAfterLock } from '@rental-os/rental-core/mysql-business-fence';
import { beginPlatformAiManagementTransaction as beginPublicTransaction } from '../../platform-transactions';

export async function beginPlatformAiManagementTransaction(transaction: Prisma.TransactionClient, actorId: string) {
  // Only this compatibility adapter recognizes the legacy host. Public callers
  // must provide their actual principal/data participant even without a Core.
  if (!hasRentalBusinessTenantFence()) return undefined;
  const tenantId = getRequestIdentity()?.tenantId;
  return beginPublicTransaction(transaction, actorId, { async begin(tx) {
    await lockRentalBusinessTenant(tx, tenantId!);
    return { revalidate: () => assertRentalBusinessTenantAccessAfterLock(tx, tenantId!), close() {} };
  } });
}
