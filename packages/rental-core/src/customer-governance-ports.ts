/** Rental客户治理的私有MySQL与业务参加者。保留原事务和同一主档/状态写入者，
 * 身份、数据范围及注销事实仍由原业务入口复验，不形成公共平台客户权限。 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type { SharedCustomerRepository } from "./mysql-customer-master";
import type { CustomerOperationsRepository } from "./mysql-customer-operations";
import type { CustomerMergeService } from "./mysql-customer-merge";

export type RentalCustomerGovernanceStorage = Pick<PrismaClient,
  "$transaction" | "rentalOrder" | "customerProfile" | "customerIdentityVerification" | "fileAsset"
  | "customerDeliveryAddress" | "customerQualificationRevision" | "rentalBenefitAccount"
  | "rentalRewardLedgerEntry" | "rentalCustomerCoupon" | "customerMembershipPlanAssignment"
  | "customerCorporateMembership">;
export type RentalCustomerGovernanceCustomers = Pick<SharedCustomerRepository,
  "findById" | "listByTenant" | "invalidatePersonalEnterpriseAuthority" | "findMembership"
  | "invalidateCorporateEnterpriseAuthority" | "findBusinessGate" | "setIdentityVerificationState">;
export type RentalCustomerGovernanceOperations = Pick<CustomerOperationsRepository,
  "recordSensitiveReadAccess" | "findAccountByCustomer" | "createAccount" | "lockCustomerBusinessGate"
  | "updateAccountStatus" | "updateMembershipStatus" | "listRiskRecords" | "createRiskRecord"
  | "findRiskRecord" | "updateRiskRecordDecision" | "listStatusHistory" | "listSensitiveAccess">;
export type RentalCustomerClosability = Pick<CustomerMergeService, "assertClosable">;

export type RentalCustomerMergeStorage = Pick<PrismaClient,
  "$transaction" | "customerProfile" | "customerCorporateProfile" | "customerContact"
  | "customerMergeMapping" | "rentalOrder" | "rentalPaymentRefund" | "customerCorporateCredit">;
export type RentalCustomerMergeCustomers = Pick<SharedCustomerRepository,
  "findById" | "markMerged" | "invalidateCorporateEnterpriseAuthority" | "updateAccount">;
export type RentalCustomerMergeOperations = Pick<CustomerOperationsRepository,
  "lockCustomerBusinessGate" | "findAccountByCustomer" | "appendStatusHistory"
  | "recordSensitiveAccess" | "hasOpenRisk">;

/** 原头像字段使用参数化SQL，避免依赖尚未完成加字段的生成模型。 */
export interface RentalCustomerAvatarTransaction {
  $queryRaw<T>(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): PromiseLike<T>;
  $executeRaw(query: TemplateStringsArray | Prisma.Sql, ...values: unknown[]): PromiseLike<number>;
}
export interface RentalCustomerAvatarStorage extends RentalCustomerAvatarTransaction {
  $transaction<T>(work: (transaction: RentalCustomerAvatarTransaction) => Promise<T>,
    options: { isolationLevel: "ReadCommitted" }): Promise<T>;
}
