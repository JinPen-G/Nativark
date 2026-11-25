/** Rental 企业应用组合：复用原客户 API、企业政策、Core、同一事务和原操作收据。
 * 企业批准、客户检查同意和 Core 执行保持各自边界；只构造服务，不创建身份、后台任务或外部连接。 */
import type { Prisma } from "@prisma/client";
import type { RentalCustomerApplications } from "./application-customers";
import type { RentalClientApplications } from "./application-client";
import { EnterpriseApplicationService } from "./mysql-enterprise-application";
import { EnterpriseMembersService } from "./mysql-enterprise-members";
import { EnterpriseApprovalService } from "./mysql-enterprise-approval";
import { EnterpriseExtensionApprovalService } from "./mysql-enterprise-extension-approval";
import { EnterpriseExchangeApprovalService } from "./mysql-enterprise-exchange-approval";
import { EnterpriseManagementRequestService } from "./mysql-enterprise-management-request";
import { EnterpriseMerchantDelegationService } from "./mysql-enterprise-merchant-delegation";
import { EnterpriseMerchantOrderSubmissionService } from "./mysql-enterprise-merchant-order-submission";
import { EnterpriseRentalHandoffService } from "./mysql-enterprise-rental-handoff";
import { EnterpriseTaskCenterService } from "./mysql-enterprise-task-center";
import { EnterpriseOrderReaderService } from "./mysql-enterprise-orders";
import { EnterpriseMembershipAuditService } from "./mysql-enterprise-membership-audit";
import { RentalExchangeInspectionPreparationService } from "./mysql-exchange-inspection-preparation";
import { RentalExchangeInspectionConsentService } from "./mysql-exchange-inspection-consent";
import { RentalApprovedExchangeService } from "./mysql-approved-exchange-execution";

type ApprovalDependencies = ConstructorParameters<typeof EnterpriseApprovalService>;
type ExtensionDependencies = ConstructorParameters<typeof EnterpriseExtensionApprovalService>;
type ExchangeDependencies = ConstructorParameters<typeof EnterpriseExchangeApprovalService>;
type DelegationDependencies = ConstructorParameters<typeof EnterpriseMerchantDelegationService>;
type DelegatedOrderDependencies = ConstructorParameters<typeof EnterpriseMerchantOrderSubmissionService>;
type InspectionPreparationDependencies = ConstructorParameters<typeof RentalExchangeInspectionPreparationService<Prisma.TransactionClient>>;
type InspectionConsentDependencies = ConstructorParameters<typeof RentalExchangeInspectionConsentService<Prisma.TransactionClient>>;
type ApprovedExchangeDependencies = ConstructorParameters<typeof RentalApprovedExchangeService<Prisma.TransactionClient>>;

/** 原企业适配使用固定 MySQL 事务；不会将生成 ORM 类型扩入公共 Core 合同。 */
export type RentalEnterpriseApplicationDatabase = ConstructorParameters<typeof EnterpriseApplicationService>[0]
  & ConstructorParameters<typeof EnterpriseMembersService>[0]
  & ApprovalDependencies[0] & ExtensionDependencies[0] & ExchangeDependencies[0]
  & ConstructorParameters<typeof EnterpriseManagementRequestService>[0] & DelegationDependencies[0]
  & ConstructorParameters<typeof EnterpriseRentalHandoffService>[0]
  & ConstructorParameters<typeof EnterpriseTaskCenterService>[0]
  & ConstructorParameters<typeof EnterpriseOrderReaderService>[0]
  & ConstructorParameters<typeof EnterpriseMembershipAuditService>[0]
  & InspectionPreparationDependencies[0] & InspectionConsentDependencies[0] & ApprovedExchangeDependencies[0];

export interface RentalEnterpriseApplicationDependencies {
  database: RentalEnterpriseApplicationDatabase;
  customerApplications: Pick<RentalCustomerApplications, "customers" | "enterpriseCommands" | "enterprisePolicies"
    | "enterpriseAccess" | "enterprisePortal" | "corporateSettlement">;
  clientApplications: Pick<RentalClientApplications, "api" | "auth">;
  core: ExtensionDependencies[4] & ExchangeDependencies[4] & DelegatedOrderDependencies[2]
    & InspectionPreparationDependencies[1] & ApprovedExchangeDependencies[1];
  business: DelegatedOrderDependencies[3] & ApprovedExchangeDependencies[3];
  businessFacts: ApprovalDependencies[4] & DelegationDependencies[4];
  coreFacts: ConstructorParameters<typeof EnterpriseRentalHandoffService>[3];
  orderConfirmation: ApprovalDependencies[5] & DelegationDependencies[5] & DelegatedOrderDependencies[1];
  receipts: ExtensionDependencies[6];
  idempotent: NonNullable<ExchangeDependencies[9]> & InspectionPreparationDependencies[3]
    & InspectionConsentDependencies[1] & ApprovedExchangeDependencies[5];
  exchangePreview: ExchangeDependencies[5] & InspectionPreparationDependencies[2] & ApprovedExchangeDependencies[2];
  operatorAuth: ExchangeDependencies[7] & DelegationDependencies[6] & InspectionPreparationDependencies[4]
    & NonNullable<ConstructorParameters<typeof EnterpriseManagementRequestService>[3]>;
  files: NonNullable<InspectionConsentDependencies[3]>;
}

const dependencyNames = ["database", "customerApplications", "clientApplications", "core", "business",
  "businessFacts", "coreFacts", "orderConfirmation", "receipts", "idempotent", "exchangePreview", "operatorAuth", "files"] as const;
const customerDependencyNames = ["customers", "enterpriseCommands", "enterprisePolicies", "enterpriseAccess",
  "enterprisePortal", "corporateSettlement"] as const;

/** 先客户、后企业。原 ClientApi 不依赖审批服务，批准及委托仅持有它的同一实例。 */
export function createRentalEnterpriseApplications(input: RentalEnterpriseApplicationDependencies) {
  for (const name of dependencyNames) {
    if (input[name] == null) throw new Error(`Rental 企业装配缺少依赖: ${name}`);
  }
  for (const name of customerDependencyNames) {
    if (input.customerApplications[name] == null) throw new Error(`Rental 企业装配缺少客户应用: ${name}`);
  }
  if (!input.clientApplications.api || !input.clientApplications.auth) throw new Error("Rental 企业装配缺少原客户 API 或认证实例");
  const { database, customerApplications: customers, clientApplications: client } = input;
  const commands = customers.enterpriseCommands, policies = customers.enterprisePolicies, access = customers.enterpriseAccess;
  const applications = new EnterpriseApplicationService(database, customers.customers, commands);
  const members = new EnterpriseMembersService(database, commands, access, customers.customers);
  const approvals = new EnterpriseApprovalService(database, commands, policies, access,
    input.businessFacts, input.orderConfirmation, client.api);
  const extensions = new EnterpriseExtensionApprovalService(database, commands, policies, access, input.core, client.api, input.receipts);
  const exchangeInspectionPreparation = new RentalExchangeInspectionPreparationService<Prisma.TransactionClient>(database,
    input.core, input.exchangePreview, input.idempotent, input.operatorAuth);
  const exchangeInspections = new RentalExchangeInspectionConsentService<Prisma.TransactionClient>(database,
    input.idempotent, client.auth, input.files);
  const approvedExchanges = new RentalApprovedExchangeService<Prisma.TransactionClient>(database, input.core,
    input.exchangePreview, input.business, exchangeInspectionPreparation, input.idempotent, policies, customers.corporateSettlement);
  const exchanges = new EnterpriseExchangeApprovalService(database, commands, policies, access, input.core,
    input.exchangePreview, client.api, input.operatorAuth, exchangeInspectionPreparation, input.idempotent);
  const management = new EnterpriseManagementRequestService(database, commands, access, input.operatorAuth);
  const delegations = new EnterpriseMerchantDelegationService(database, commands, approvals, policies,
    input.businessFacts, input.orderConfirmation, input.operatorAuth);
  const delegatedOrders = new EnterpriseMerchantOrderSubmissionService(delegations, input.orderConfirmation, input.core, input.business);
  const handoffs = new EnterpriseRentalHandoffService(database, commands, client.api, input.coreFacts);
  const tasks = new EnterpriseTaskCenterService(database, commands, applications, members, approvals,
    access, management, extensions, exchanges, handoffs);
  const orders = new EnterpriseOrderReaderService(database, access);
  const membershipAudit = new EnterpriseMembershipAuditService(database, access);
  return Object.freeze({ applications, members, approvals, extensions, exchanges, management, delegations,
    delegatedOrders, handoffs, tasks, orders, membershipAudit, exchangeInspectionPreparation, exchangeInspections,
    approvedExchanges, commands, policies, access, portal: customers.enterprisePortal });
}

export type RentalEnterpriseApplications = ReturnType<typeof createRentalEnterpriseApplications>;
