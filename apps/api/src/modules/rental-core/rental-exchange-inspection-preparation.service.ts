/** 原Nest检查准备provider。检查事实与原收据由Rental包单源维护；
 * 原身份、Core、试算和幂等实例按原注入顺序供给，不扩大当前经营权限。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalExchangeInspectionPreparationService as CoreRentalExchangeInspectionPreparationService } from "@rental-os/rental-core/mysql-exchange-inspection-preparation";
import { AuthService } from "../auth/auth.service";
import { PrismaService } from "../database/prisma.service";
import { RentalCoreService } from "./rental-core.service";
import { RentalExchangePreviewService } from "./rental-exchange-preview.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";

@Injectable()
export class RentalExchangeInspectionPreparationService extends CoreRentalExchangeInspectionPreparationService<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, core: RentalCoreService, prices: RentalExchangePreviewService,
    idempotent: RentalIdempotentActionService, auth: AuthService) {
    super(prisma, core, prices, idempotent, auth);
  }
}
