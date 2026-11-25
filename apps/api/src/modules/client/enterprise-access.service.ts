/** 原Nest企业动作资格provider，使用同一数据库与Rental单源SQL；客户/成员/关系和当前会话门禁不变。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseAccessService as CoreEnterpriseAccessService } from "@rental-os/rental-core/mysql-enterprise-access";
import { PrismaService } from "../database/prisma.service";

@Injectable()
export class EnterpriseAccessService extends CoreEnterpriseAccessService {
  constructor(prisma: PrismaService) { super(prisma); }
}
