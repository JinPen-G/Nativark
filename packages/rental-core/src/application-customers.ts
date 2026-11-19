/** 租户客户、会员和企业基础应用的单源组合。
 * 同一客户主档/状态写入者供给注册、治理、会员与企业政策；不建立账号、分配Core或改变历史账。 */
import type { Prisma } from "@prisma/client";
import { SharedCustomerRepository } from "./mysql-customer-master";
import { CustomerOperationsRepository } from "./mysql-customer-operations";
import { CustomerRegistrationService } from "./mysql-customer-registration";
import { CustomerOperationsService } from "./mysql-customer-governance";
import { CustomerMergeService } from "./mysql-customer-merge";
import { CustomerCorporateService } from "./mysql-customer-corporate";
import { CustomerCorporateSettlementService } from "./mysql-customer-corporate-settlement";
import { MembershipService } from "./mysql-membership";
import { EnterprisePortalService } from "./mysql-enterprise-portal";
import { EnterpriseAccessService } from "./mysql-enterprise-access";
import { EnterpriseCommandService } from "./mysql-enterprise-command";
import { EnterprisePolicyService } from "./mysql-enterprise-policy";
import { CustomerAvatarService } from "./mysql-customer-avatar";

export type RentalCustomerApplicationDatabase = ConstructorParameters<typeof SharedCustomerRepository>[0]
  & ConstructorParameters<typeof CustomerOperationsRepository>[0]
  & ConstructorParameters<typeof CustomerOperationsService>[0]
  & ConstructorParameters<typeof CustomerMergeService>[0]
  & ConstructorParameters<typeof CustomerCorporateService<Prisma.TransactionClient>>[0]
  & ConstructorParameters<typeof CustomerCorporateSettlementService<Prisma.TransactionClient>>[0]
  & ConstructorParameters<typeof MembershipService>[0]
  & ConstructorParameters<typeof EnterprisePortalService>[0]
  & ConstructorParameters<typeof EnterpriseAccessService>[0]
  & ConstructorParameters<typeof EnterpriseCommandService>[0]
  & ConstructorParameters<typeof EnterprisePolicyService>[0]
  & ConstructorParameters<typeof CustomerAvatarService>[0];

export function createRentalCustomerApplications(input: {
  database: RentalCustomerApplicationDatabase;
  funding: NonNullable<ConstructorParameters<typeof CustomerCorporateSettlementService<Prisma.TransactionClient>>[1]>;
  principals: NonNullable<ConstructorParameters<typeof CustomerCorporateSettlementService<Prisma.TransactionClient>>[2]>;
}) {
  if (!input.database || !input.funding || !input.principals) throw new Error("Rental 客户组合缺少数据库、实收或当前主体读取器");
  const { database, funding, principals } = input;
  const customers = new SharedCustomerRepository(database);
  const customerStates = new CustomerOperationsRepository(database, customers);
  const registration = new CustomerRegistrationService(customers, customerStates);
  const customerMerge = new CustomerMergeService(database, customers, customerStates);
  const customerOperations = new CustomerOperationsService(database, customers, customerStates, customerMerge);
  const corporate = new CustomerCorporateService<Prisma.TransactionClient>(database, customers);
  const corporateSettlement = new CustomerCorporateSettlementService<Prisma.TransactionClient>(database, funding, principals);
  const enterpriseAccess = new EnterpriseAccessService(database);
  const enterpriseCommands = new EnterpriseCommandService(database);
  const enterprisePolicies = new EnterprisePolicyService(database, enterpriseCommands, enterpriseAccess);
  const memberships = new MembershipService(database, customerStates, customers, registration, enterprisePolicies);
  const enterprisePortal = new EnterprisePortalService(database);
  const customerAvatar = new CustomerAvatarService(database);
  return Object.freeze({ customers, customerStates, registration, customerMerge, customerOperations,
    corporate, corporateSettlement, enterpriseAccess, enterpriseCommands, enterprisePolicies,
    memberships, enterprisePortal, customerAvatar });
}

export type RentalCustomerApplications = ReturnType<typeof createRentalCustomerApplications>;
