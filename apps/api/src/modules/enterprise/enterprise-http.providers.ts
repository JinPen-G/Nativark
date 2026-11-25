/** 原企业HTTP服务装配。类型核对每个实际参加者，useExisting保留唯一数据库、事务和生命周期。 */
import type { Provider, Type } from "@nestjs/common";
import { RENTAL_ENTERPRISE_HTTP, type RentalEnterpriseHttpApplications } from "@rental-os/rental-core/http-enterprise-applications";
import { PrismaService } from "../database/prisma.service";
import { RentalFundingService } from "../rental-core/rental-funding.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { TenantIntegrationService } from "../integrations/tenant-integration.service";
import { EnterpriseOrderReaderService } from "./enterprise-order-reader.service";
import { EnterpriseApplicationService } from "./enterprise-application.service";
import { EnterpriseMembersService } from "./enterprise-members.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";
import { EnterpriseManagementRequestService } from "./enterprise-management-request.service";
import { EnterpriseExchangeApprovalService } from "./enterprise-exchange-approval.service";
import { RentalApprovedExchangeService } from "../rental-core/rental-approved-exchange.service";
import { EnterpriseMerchantDelegationService } from "./enterprise-merchant-delegation.service";
import { EnterpriseMerchantOrderSubmissionService } from "./enterprise-merchant-order-submission.service";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseExtensionApprovalService } from "./enterprise-extension-approval.service";
import { EnterpriseTaskCenterService } from "./enterprise-task-center.service";
import { EnterpriseRentalHandoffService } from "./enterprise-rental-handoff.service";
import { EnterpriseMembershipAuditService } from "./enterprise-membership-audit.service";
import { RentalExchangeInspectionConsentService } from "../rental-core/rental-exchange-inspection-consent.service";

const participants = {
  orders: EnterpriseOrderReaderService,
  database: PrismaService,
  funding: RentalFundingService,
  credit: CustomerCorporateSettlementService,
  applications: EnterpriseApplicationService,
  members: EnterpriseMembersService,
  commands: EnterpriseCommandService,
  policies: EnterprisePolicyService,
  management: EnterpriseManagementRequestService,
  exchanges: EnterpriseExchangeApprovalService,
  approvedExchanges: RentalApprovedExchangeService,
  delegations: EnterpriseMerchantDelegationService,
  delegatedOrders: EnterpriseMerchantOrderSubmissionService,
  approvals: EnterpriseApprovalService,
  extensions: EnterpriseExtensionApprovalService,
  tasks: EnterpriseTaskCenterService,
  handoffs: EnterpriseRentalHandoffService,
  membershipAudit: EnterpriseMembershipAuditService,
  exchangeInspections: RentalExchangeInspectionConsentService,
  files: FileStorageRuntimeService,
  integrations: TenantIntegrationService
} satisfies { [K in keyof RentalEnterpriseHttpApplications]: Type<RentalEnterpriseHttpApplications[K]> };

export const RENTAL_ENTERPRISE_HTTP_PROVIDERS: Provider[] = Object.entries(participants).map(([key, source]) => ({
  provide: RENTAL_ENTERPRISE_HTTP[key as keyof RentalEnterpriseHttpApplications],
  useExisting: source
}));
