/** 原企业参与者继续使用调用方Prisma事务，合同来自Rental正式出口。 */
import type { Prisma } from "@prisma/client";
import type { ApprovedExchangeTransaction as CoreApprovedExchangeTransaction } from "@rental-os/rental-core/approved-exchange-ports";
export type { ApprovedExchangeBinding } from "@rental-os/rental-core/approved-exchange-ports";
export type ApprovedExchangeTransaction = CoreApprovedExchangeTransaction<Prisma.TransactionClient>;
