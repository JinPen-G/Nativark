/** 原Nest对账文件接线，沿相同数据库和当前完整经营空间财务权消费Rental单源应用。 */
import { Injectable } from "@nestjs/common";
import { PaymentReconciliationFileService as RentalPaymentReconciliationFileService } from "@rental-os/rental-core/mysql-payment-reconciliation-file";
import { PrismaService } from "../database/prisma.service";
import { getRequestIdentity } from "../../common/request-identity";

@Injectable()
export class PaymentReconciliationFileService extends RentalPaymentReconciliationFileService {
  constructor(prisma: PrismaService) { super(prisma, { getRequestIdentity }); }
}

export { parsePaymentStatementCsv, type UploadedPaymentStatement } from "@rental-os/rental-core/mysql-payment-reconciliation-file";
