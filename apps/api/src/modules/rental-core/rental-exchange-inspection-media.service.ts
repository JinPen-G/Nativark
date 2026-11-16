/** 原Nest专用检查影像provider。当前检查范围和原文件冻结实例按原顺序注入；
 * Rental包核原绑定/占用/完成，文件适配持有自己的私有计划和对象存储配置。 */
import { Injectable } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { RentalExchangeInspectionMediaService as CoreRentalExchangeInspectionMediaService } from "@rental-os/rental-core/mysql-exchange-inspection-media";
import { PrismaService } from "../database/prisma.service";
import { FileStorageRuntimeService, type ExchangeInspectionUploadPlan } from "../integrations/file-storage.runtime.service";
import { RentalExchangeInspectionPreparationService } from "./rental-exchange-inspection-preparation.service";

@Injectable()
export class RentalExchangeInspectionMediaService extends CoreRentalExchangeInspectionMediaService<Prisma.TransactionClient, ExchangeInspectionUploadPlan> {
  constructor(prisma: PrismaService, inspections: RentalExchangeInspectionPreparationService, files: FileStorageRuntimeService) {
    super(prisma, inspections, files);
  }
}
