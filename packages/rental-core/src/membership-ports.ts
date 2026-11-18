/** Rental会员业务的私有MySQL视图与真实参加者。租户共享主档和空间业务分别校验；
 * 公共Core合同不暴露生成模型，宿主必须供给同一客户、注册及政策实例。 */
import type { PrismaClient } from "@prisma/client";
import type { SharedCustomerRepository } from "./mysql-customer-master";
import type { CustomerRegistrationService } from "./mysql-customer-registration";
import type { EnterprisePolicyService } from "./mysql-enterprise-policy";
import type { RentalMembershipOperations } from "./customer-operations-ports";

export type RentalMembershipStorage = Pick<PrismaClient,
  "$transaction" | "businessWorkspace" | "clientAuthSession" | "customerCorporateMembership" |
  "customerCorporateProfile" | "customerMembership" | "customerMembershipPlan" |
  "customerMembershipPlanAssignment" | "customerMembershipPlanVersion" |
  "customerMembershipQualificationType" | "customerMembershipRegistrationSettings" |
  "customerMembershipReview" | "customerProfile" | "customerQualificationRef" |
  "customerQualificationRevision" | "rentalOrder" | "rentalValueAddedService" | "rentalCategoryDefinition">;

export interface RentalMembershipParticipants {
  operations: RentalMembershipOperations;
  customers: Pick<SharedCustomerRepository, "createMembership" | "createProfile" | "createReview" |
    "saveEnterpriseRelation" | "updateAccount" | "updateCorporateProfileStatus" | "updateProfile" |
    "updateReview" | "upsertAccountCredentials" | "upsertCorporateProfile">;
  registration: Pick<CustomerRegistrationService, "registerPersonal">;
  enterprisePolicy: Pick<EnterprisePolicyService, "authorize">;
}
