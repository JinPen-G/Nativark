/** 原Nest检查同意入口，只供给原数据库、幂等和客户/文件参加者。
 * 应用、SQL与恢复校验由Rental包单源执行，保留原可选文件依赖和注入顺序。 */
import { Injectable, Optional } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { RentalExchangeInspectionConsentService as RentalExchangeInspectionConsentImplementation } from "@rental-os/rental-core/mysql-exchange-inspection-consent";
import { ClientAuthService } from "../client/client-auth.service";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService } from "../integrations/file-storage.runtime.service";
import { RentalIdempotentActionService } from "./rental-idempotent-action.service";
export { exchangeInspectionCustomerMaterial, readExchangeInspectionConsent, verifyExchangeInspectionConsentReceipt,
  type ExchangeInspectionConsentRow } from "@rental-os/rental-core/mysql-exchange-inspection-consent";

@Injectable()
export class RentalExchangeInspectionConsentService extends RentalExchangeInspectionConsentImplementation<Prisma.TransactionClient> {
  constructor(prisma: PrismaService, idempotent: RentalIdempotentActionService,
    auth: ClientAuthService, @Optional() files?: FileStorageRuntimeService) {
    super(prisma, idempotent, auth, files);
  }
}
