/** Rental compatibility entry. All repositories and business participants share
 * this one public transaction boundary; deployment selection stays in the adapter. */
import type { Prisma } from '@prisma/client';
import { hasRentalBusinessTenantFence } from '@rental-os/rental-core/mysql-business-fence';
import { createAiTaskTransactionBoundary, type AiTaskTransactionAuthority as PublicAuthority } from '../task-transactions';
export type { AiTaskTransactionReference } from '../task-transactions';
export { holdAiTaskDeploymentAdmission } from './rental-adapters/task-deployment-admission';
export type AiTaskTransactionAuthority = PublicAuthority<Prisma.TransactionClient>;

const boundary = createAiTaskTransactionBoundary<Prisma.TransactionClient>({ isRequired: hasRentalBusinessTenantFence });
export const { withAiTaskTransactionAuthority, withAiTaskTransaction, withHeldAiTaskTransaction,
  hasAiTaskTransactionAuthority } = boundary;
