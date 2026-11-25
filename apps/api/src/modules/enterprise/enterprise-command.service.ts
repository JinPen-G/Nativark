/** 原Nest企业命令provider，同一数据库/事务供给Rental单源实现，不新增执行者或改变原收据。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseCommandService as CoreEnterpriseCommandService } from "@rental-os/rental-core/mysql-enterprise-command";
import { PrismaService } from "../database/prisma.service";
export { enterpriseHash, enterpriseJson } from "@rental-os/rental-core/enterprise-receipt";

@Injectable()
export class EnterpriseCommandService extends CoreEnterpriseCommandService {
  constructor(prisma: PrismaService) { super(prisma); }
}
