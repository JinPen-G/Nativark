/** 原Nest订单读取provider。原企业动作与同一数据库供给Rental包，历史/告知投影和必需审计单源执行。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseOrderReaderService as CoreEnterpriseOrderReaderService } from "@rental-os/rental-core/mysql-enterprise-orders";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";

@Injectable()
export class EnterpriseOrderReaderService extends CoreEnterpriseOrderReaderService {
  constructor(prisma: PrismaService, access: EnterpriseAccessService) { super(prisma, access); }
}
