/** 原Nest兼容provider，仅供给同一企业业务实例与事务；实现由Rental包维护。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseExchangeApprovalService as Implementation } from "@rental-os/rental-core/mysql-enterprise-exchange-approval";
import { ClientApiService } from "../client/client-api.service";
import { AuthService } from "../auth/auth.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "../rental-core/rental-core.service";
import { RentalExchangePreviewService } from "../rental-core/rental-exchange-preview.service";
import { RentalExchangeInspectionPreparationService } from "../rental-core/rental-exchange-inspection-preparation.service";
import { RentalIdempotentActionService } from "../rental-core/rental-idempotent-action.service";
import { EnterpriseCommandService } from "./enterprise-command.service";
import { EnterprisePolicyService } from "./enterprise-policy.service";

@Injectable()
export class EnterpriseExchangeApprovalService extends Implementation {
  constructor(prisma: PrismaService, commands: EnterpriseCommandService, policies: EnterprisePolicyService, access: EnterpriseAccessService, core: RentalCoreService, prices: RentalExchangePreviewService, clientApi: ClientApiService, auth: AuthService, inspections?: RentalExchangeInspectionPreparationService, inspectionReceipts?: RentalIdempotentActionService) {
    super(prisma, commands, policies, access, core, prices, clientApi, auth, inspections, inspectionReceipts);
  }
}
