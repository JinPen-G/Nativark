/** 原组合的企业成员审计provider，供给原受权数据库；仅投影允许的原收据字段。 */
import { Injectable } from "@nestjs/common";
import { EnterpriseMembershipAuditService as RentalEnterpriseMembershipAuditService } from "@rental-os/rental-core/mysql-enterprise-membership-audit";
import { PrismaService } from "../database/prisma.service";
import { EnterpriseAccessService } from "../client/enterprise-access.service";
export * from "@rental-os/rental-core/mysql-enterprise-membership-audit";

@Injectable()
export class EnterpriseMembershipAuditService extends RentalEnterpriseMembershipAuditService {
  constructor(prisma: PrismaService, access: EnterpriseAccessService) {
    super(prisma, access);
  }
}
