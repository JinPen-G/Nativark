/** 原Nest兼容provider，仅供给同一企业业务实例与事务；实现由Rental包维护。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseExtensionApprovalService as Implementation } from "@rental-os/rental-core/mysql-enterprise-extension-approval";
import { ClientApiService } from "../client/client-api.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { RentalIdempotencyRepository } from "../rental-core/rental-idempotency.repository";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";

@Injectable()
export class EnterpriseExtensionApprovalService extends Implementation {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, policies: EnterprisePolicyService, access: EnterpriseAccessService, core: RentalCoreService, clientApi: ClientApiService, idempotency: RentalIdempotencyRepository) {
    super(prisma, commands, policies, access, core, clientApi, idempotency);
  }
}
