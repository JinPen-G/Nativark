/** 原Nest批准换货入口，只组合原Core、检查、企业政策/授信与同一数据库。
 * 执行、原键恢复和提交后发布由Rental包单源负责，保留原八项注入顺序。 */
import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { RentalApprovedExchangeService as RentalApprovedExchangeImplementation } from "@rental-os/rental-core/mysql-approved-exchange-execution";
import { EnterprisePolicyService } from "../enterprise/enterprise-policy.service";
import { CustomerCorporateSettlementService } from "../platform/customer-corporate-settlement.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalBusinessService } from "./rental-business.service";
import { RentalExchangePreviewService } from "./rental-exchange-preview.service";
import { RentalExchangeInspectionPreparationService } from "./rental-exchange-inspection-preparation.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";

@Injectable()
export class RentalApprovedExchangeService extends RentalApprovedExchangeImplementation<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, core: RentalCoreService,
    prices: RentalExchangePreviewService, business: RentalBusinessService,
    inspections: RentalExchangeInspectionPreparationService, idempotent: RentalIdempotentActionService,
    policies: EnterprisePolicyService, corporateSettlement: CustomerCorporateSettlementService) {
    super(prisma, core, prices, business, inspections, idempotent, policies, corporateSettlement);
  }
}
