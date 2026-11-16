/** 原Nest凭证provider；供给当前订单/资金服务和同一快照表。
 * Rental包持有生成、不可变归档和当前权限下的历史回读，纯渲染构造兼容沿原Optional保留。 */
import { Injectable, Optional } from "@nestjs/common";
import { RentalDocumentService as CoreRentalDocumentService } from "@rental-os/rental-core/mysql-documents";
import { PrismaService } from "../database/prisma.service";
import { RentalFundingService } from "./rental-funding.service";
import { RentalCoreService } from "./rental-core.service";

@Injectable()
export class RentalDocumentService extends CoreRentalDocumentService {
  constructor(core: RentalCoreService, funding: RentalFundingService, @Optional() prisma?: PrismaService) {
    super(core, funding, prisma);
  }
}
