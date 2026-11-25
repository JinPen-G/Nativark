/** 原组合的企业待办provider，供给同一申请、批准及原收据读取实例，不另发通知或执行业务。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseTaskCenterService as RentalEnterpriseTaskCenterService } from "@rental-os/rental-core/mysql-enterprise-task-center";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterpriseApplicationService } from "./enterprise-application.service";
import { EnterpriseMembersService } from "./enterprise-members.service";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { EnterpriseManagementRequestService } from "./enterprise-management-request.service";
import { EnterpriseExtensionApprovalService } from "./enterprise-extension-approval.service";
import { EnterpriseExchangeApprovalService } from "./enterprise-exchange-approval.service";
import { EnterpriseRentalHandoffService } from "./enterprise-rental-handoff.service";
export * from "@rental-os/rental-core/mysql-enterprise-task-center";

@Injectable()
export class EnterpriseTaskCenterService extends RentalEnterpriseTaskCenterService {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, applications: EnterpriseApplicationService, members: EnterpriseMembersService,
    approvals: EnterpriseApprovalService, access: EnterpriseAccessService, management: EnterpriseManagementRequestService,
    extensions: EnterpriseExtensionApprovalService, exchanges: EnterpriseExchangeApprovalService, handoffs: EnterpriseRentalHandoffService) {
    super(prisma, commands, applications, members, approvals, access, management, extensions, exchanges, handoffs);
  }
}
