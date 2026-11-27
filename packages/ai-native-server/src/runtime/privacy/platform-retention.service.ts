/** Original Rental and legacy host authority for the same PLATFORM retention. */
import type { PrismaClient } from '@prisma/client';
import { getRequestIdentity } from '@rental-os/platform-server/request-identity';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { AiTaskRepositoryError } from '../../task-errors';
import { fingerprint } from '../knowledge/knowledge-validation';
import { beginPlatformAiManagementTransaction } from '../platform-management-transaction';
import { erasePlatformTaskBodies } from './retention-task-bodies';
import { PlatformRetentionOperations, type PlatformRetentionIdentity } from './platform-retention';
export { platformRetentionCleanupSchema } from './platform-retention';

export class AiPlatformRetentionService extends PlatformRetentionOperations {
  constructor(db: PrismaClient, identity: PlatformRetentionIdentity, clock?: () => Date, restoreKeyHash?: string) {
    super(db, identity, {
      begin: beginPlatformAiManagementTransaction, eraseTaskBodies: erasePlatformTaskBodies,
      assertSelectedIdentity(context) {
        if (!hasRentalBusinessTenantFence()) return;
        const selected = getRequestIdentity();
        if (!selected || selected.isSaasAdmin !== true || selected.audience !== 'operator' || selected.staffApi
          || context.actor.kind !== 'saas_admin' || selected.userId !== context.actor.userId || !('permissions' in context)
          || fingerprint([...(selected.permissions ?? [])].sort()) !== fingerprint([...context.permissions].sort()))
          throw new AiTaskRepositoryError('AI_ACCESS_DENIED');
      }
    }, clock, restoreKeyHash);
  }
}
