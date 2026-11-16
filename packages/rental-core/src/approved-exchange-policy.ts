/** 原换货批准的私有MySQL与企业政策接点；同一事务复验当前依据，不接收客户端批准标志。 */
import type { Prisma } from "@prisma/client";
import type { EnterpriseBookingBasis, RentalOrder } from "./index";

export interface RentalApprovedExchangeSql {
  $queryRaw: Prisma.TransactionClient["$queryRaw"];
}

export interface RentalApprovedExchangePolicies<TTransaction extends RentalApprovedExchangeSql> {
  revalidateOrderExpense(
    tenantId: string, workspaceId: string, order: RentalOrder, transaction: TTransaction
  ): Promise<EnterpriseBookingBasis | undefined>;
  assertSameBasis(before: EnterpriseBookingBasis | undefined, after: EnterpriseBookingBasis | undefined): void;
  assertQuoteAmount(
    tenantId: string, corporateId: string, membershipId: string,
    quote: { currency?: string; payableAmount: number }, transaction: TTransaction
  ): Promise<void>;
  assertReviewer(
    tenantId: string, corporateId: string, applicantId: string,
    reviewerId: string | null, membershipId: string | null, updatedAt: Date | null,
    transaction: TTransaction
  ): Promise<void>;
}
