/** Rental客户主档的私有MySQL视图，只提供本仓储所用的五个客户模型和企业关系表。
 * 流程持有者供给原事务与锁；公共Core清单和领域合同不暴露这些ORM方法。 */
import type { Prisma } from "@prisma/client";

export type RentalCustomerMasterTransaction = Pick<Prisma.TransactionClient,
  "$executeRaw" | "customerProfile" | "customerAccount" | "customerMembership" |
  "customerMembershipReview" | "customerCorporateProfile" | "customerCorporateMembership">;

export interface RentalCustomerMasterStorage extends RentalCustomerMasterTransaction {
  $transaction<T>(work: (transaction: RentalCustomerMasterTransaction) => Promise<T>): Promise<T>;
}
