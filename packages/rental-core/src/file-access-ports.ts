/** Rental附件私有表视图与原事实/客户ACL参加者。公共文件存储不读取这些业务模型。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { RentalCoreFactRepository } from "./mysql-core-facts";
import type { RentalBusinessFactRepository } from "./mysql-business-facts";

export type RentalFileAccessStorage = Pick<PrismaClient,
  "fileAsset" | "customerProfile" | "businessWorkspace" | "rentalItemGroup" | "customerMembershipReview" |
  "customerCorporateContract" | "customerCorporateInvoiceProfile" | "customerCorporateCredit" | "asyncJob" | "documentPrintJob">;
export type RentalFileReferenceStorage = Pick<PrismaClient,
  "rentalOrder" | "rentalQuote" | "rentalItemGroup" | "rentalAsset" | "rentalWorkOrder" | "customerProfile" |
  "customerCorporateContract" | "customerCorporateInvoiceProfile" | "customerCorporateCredit" |
  "customerMembershipReview" | "businessWorkspace" | "asyncJob" | "documentPrintJob">;
export type RentalFileFacts = Pick<RentalCoreFactRepository,
  "assertFileOrderReadAccess" | "assertFileAssetReadAccess" | "assertFileWorkOrderReadAccess">;
export type RentalFileQuoteFacts = Pick<RentalBusinessFactRepository, "findQuote">;
export interface RentalCustomerFileAccess {
  assertCustomerFileReadAccess(tenantId: string, customerId: string, corporate?: boolean,
    tx?: Pick<Prisma.TransactionClient, "customerProfile" | "rentalOrder">): Promise<void>;
}
