/** 原批准消费者实例化同一Rental事务合同，保持本宿主Prisma类型与Core封存标记。 */
import type { Prisma } from "@prisma/client";
import type { ApprovedOrderTransaction as CoreApprovedOrderTransaction } from "@rental-os/rental-core/approved-order-ports";
export type { ApprovedOrderBinding, ApprovedOrderMerchantDelegation } from "@rental-os/rental-core/approved-order-ports";
export type ApprovedOrderTransaction = CoreApprovedOrderTransaction<Prisma.TransactionClient>;
