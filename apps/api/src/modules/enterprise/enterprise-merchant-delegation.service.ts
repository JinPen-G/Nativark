/** 原Nest兼容provider，仅供给同一企业业务实例与事务；实现由Rental包维护。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseMerchantDelegationService as Implementation } from "@rental-os/rental-core/mysql-enterprise-merchant-delegation";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { RentalBusinessFactRepository } from "../rental-core/rental-business-fact.repository";
import { RentalOrderConfirmationService } from "../rental-core/rental-order-confirmation.service";
import { EnterpriseApprovalService } from "./enterprise-approval.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";
export type { EnterpriseMerchantDelegationActorAuth } from "@rental-os/rental-core/mysql-enterprise-merchant-delegation";

@Injectable()
export class EnterpriseMerchantDelegationService extends Implementation {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, approvals: EnterpriseApprovalService, policies: EnterprisePolicyService, facts: RentalBusinessFactRepository, orders: RentalOrderConfirmationService, auth: AuthService) {
    super(prisma, commands, approvals, policies, facts, orders, auth);
  }
}
