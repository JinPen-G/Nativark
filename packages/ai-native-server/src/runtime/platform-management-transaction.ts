/** Selected-host platform management joins the original owning transaction.
 * The original SaaS principal is locked before AI metadata; tenant assignment
 * and model invocation rights are never synthesized for a platform operator. */
import type { Prisma } from '@prisma/client';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { requestFingerprint } from '@rental-os/platform-contracts/request-fingerprint';
import { hasRentalBusinessTenantFence, lockRentalBusinessTenant,
  assertRentalBusinessTenantAccessAfterLock } from '@rental-os/rental-core/mysql-business-fence';
import { ModelGatewayError } from './model-gateway.ports';

export async function beginPlatformAiManagementTransaction(transaction: Prisma.TransactionClient, actorId: string) {
  if (!hasRentalBusinessTenantFence()) return undefined;
  const source = getRequestIdentity(), fingerprint = requestFingerprint(source ?? null);
  if ('$transaction' in transaction || !source?.tenantId || source.userId !== actorId
    || source.isSaasAdmin !== true || source.audience !== 'operator' || source.staffApi)
    throw new ModelGatewayError('FORBIDDEN');
  let active = true;
  const live = () => {
    if (!active || getRequestIdentity() !== source || requestFingerprint(source) !== fingerprint)
      throw new ModelGatewayError('FORBIDDEN');
  };
  try {
    // The selected access layer acquires its same-request PlatformPrincipal lease
    // before the Tenant parent and checks the actual installed Core/AI data.
    await lockRentalBusinessTenant(transaction, source.tenantId);
    live();
    return Object.freeze({ async revalidate() {
      live();
      await assertRentalBusinessTenantAccessAfterLock(transaction, source.tenantId!);
      live();
    }, close() { active = false; } });
  } catch (error) { active = false; throw error; }
}
