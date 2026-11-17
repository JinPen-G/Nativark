/** 原Nest兼容provider，仅供给同一企业业务实例与事务；实现由Rental包维护。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseApprovalService as Implementation } from "@rental-os/rental-core/mysql-enterprise-approval";
import { PrismaService } from "../database/prisma.service";
import { ClientApiService } from "../client/client-api.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { RentalBusinessFactRepository } from "../rental-core/rental-business-fact.repository";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";

@Injectable()
export class EnterpriseApprovalService extends Implementation {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, policies: EnterprisePolicyService, access: EnterpriseAccessService, facts: RentalBusinessFactRepository, orders: RentalOrderConfirmationService, clientApi: ClientApiService) {
    super(prisma, commands, policies, access, facts, orders, clientApi);
  }
}
